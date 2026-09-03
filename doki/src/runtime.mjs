import { digestJson } from './hash.mjs';
import { buildHistory, correlation } from './history.mjs';
import { chooseAction, updateQ, budgetDefaults } from './qlearning.mjs';
import { compilePrompt, detectInstructionLikeData } from './prompt.mjs';
import { callModel, modelForAction } from './model.mjs';
import { DEFAULT_MAX_RESWITCH, RUNTIME_VERSION } from './contracts.mjs';
import { inspectEventContinuity, readSnapshot } from './falsify-reader.mjs';

const now = () => new Date().toISOString();
const updateIdFor = (eventId) => digestJson(`doki:${eventId}:${RUNTIME_VERSION}`);

function claimUpdate(db, updateId, eventId) {
  const existing = db.prepare('SELECT update_id FROM update_jobs WHERE loop_event_id=?').get(eventId);
  if (existing) return false;
  db.prepare("INSERT INTO update_jobs(update_id,loop_event_id,status,created_at,started_at) VALUES(?,?, 'RUNNING',?,?)").run(updateId,eventId,now(),now());
  return true;
}

function makeReport(snapshot, history, updateId) {
  const report = {
    schema:'doki.phase_report/v1', report_id:'', update_id:updateId, loop_event_ref:snapshot.loop_event.id,
    job_id:snapshot.loop_event.job_id, scope_id:snapshot.loop_event.scope_id ?? null,
    phase:snapshot.job?.loop_state ?? snapshot.loop_event.to_state, from_state:snapshot.loop_event.from_state,
    to_state:snapshot.loop_event.to_state, verdict_ref:snapshot.job?.verdict ?? null,
    wave_refs:[...new Set((snapshot.findings??[]).map((f)=>f.wave))], falsify_observation_refs:[],
    history_refs:history.refs, pattern_refs:[], correlation_status:correlation(snapshot),
    facts_digest:digestJson({ event:snapshot.loop_event.event_type, to:snapshot.loop_event.to_state, verdict:snapshot.job?.verdict ?? null }),
    rule_versions:{runtime:RUNTIME_VERSION}, report_digest:''
  };
  report.report_digest=digestJson(report); report.report_id=digestJson({schema:report.schema,report_digest:report.report_digest});
  return report;
}

async function narrate({db,report,snapshot,history,action,updateId,env}) {
  const budget=budgetDefaults(env); const prompt=compilePrompt(report,snapshot,history,{perspective:report.correlation_status==='DIVERGENCE'?'abweichende Perspektiven explizit benennen':'neutral'});
  db.prepare('INSERT OR REPLACE INTO prompt_runs(prompt_id,update_id,prompt_digest,report_digest,prompt_json,created_at) VALUES(?,?,?,?,?,?)').run(prompt.promptId,updateId,prompt.promptDigest,report.report_digest,JSON.stringify(prompt),now());
  if(detectInstructionLikeData(snapshot)) return {mode:'FACTUAL_FALLBACK',renderPath:'FACTUAL_FALLBACK',reswitchCount:0,body:'DOKI hat instruction-like Daten erkannt und zeigt deshalb nur die belegten Fakten.',prompt};
  let current=action, calls=0, reswitch=0, lastError=null;
  while(calls<budget.maxCalls){
    try{
      const result=await callModel(prompt.body,modelForAction(current,env),env); calls++;
      return {mode:'NARRATIVE',renderPath:current==='RED'?'RESWITCH_THINKER_MODEL':'SMALL_MODEL',reswitchCount:reswitch,body:result.text,prompt};
    }catch(error){
      lastError=error; calls++;
      if(reswitch>=DEFAULT_MAX_RESWITCH) break;
      reswitch++; current='RED';
    }
  }
  return {mode:'FACTUAL_FALLBACK',renderPath:'FACTUAL_FALLBACK',reswitchCount:reswitch,body:`DOKI konnte keine Prosa erzeugen: ${String(lastError?.message||lastError||'unbekannter Fehler')}. Fakten bleiben erhalten.`,prompt};
}

export async function processEvent({falsifyDb,dokiDb,eventId,env=process.env}){
  const {snapshot,snapshotDigest}=readSnapshot(falsifyDb,eventId), updateId=updateIdFor(eventId);
  if(!claimUpdate(dokiDb,updateId,eventId)){
    const row=dokiDb.prepare('SELECT message_json FROM dialog_messages WHERE update_id=?').get(updateId);
    return row?JSON.parse(row.message_json):{schema:'doki_message/v1',message_id:digestJson(updateId),update_ref:updateId,phase_report_ref:null,mode:'UNAVAILABLE',render_path:'FACTUAL_FALLBACK',reswitch_count:0,narrator_ref:null,body:'DOKI-Update bereits bearbeitet.',evidence_refs:[],anomaly_refs:[],authority:'NONE'};
  }
  try{
    const gap=inspectEventContinuity(falsifyDb,snapshot.loop_event);
    if(gap)dokiDb.prepare('INSERT INTO gaps(update_id,job_id,kind,detail,created_at) VALUES(?,?,?,?,?)').run(updateId,snapshot.loop_event.job_id,gap.kind,gap.detail,now());
    dokiDb.prepare('INSERT INTO observations(update_id,loop_event_id,job_id,scope_id,event_type,from_state,to_state,snapshot_json,snapshot_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(updateId,eventId,snapshot.loop_event.job_id,snapshot.loop_event.scope_id??null,snapshot.loop_event.event_type,snapshot.loop_event.from_state,snapshot.loop_event.to_state,JSON.stringify(snapshot),snapshotDigest,now());
    const history=buildHistory(dokiDb,snapshot); const report=makeReport(snapshot,history,updateId);
    dokiDb.prepare('INSERT INTO phase_reports(report_id,update_id,report_json,report_digest,created_at) VALUES(?,?,?,?,?)').run(report.report_id,updateId,JSON.stringify(report),report.report_digest,now());
    const action=chooseAction(dokiDb,report).action; updateQ(dokiDb,report,{action,reward:report.correlation_status==='CONVERGENT'?1:0});
    const r=await narrate({db:dokiDb,report,snapshot,history,action,updateId,env});
    const message={schema:'doki_message/v1',message_id:digestJson(updateId),update_ref:updateId,phase_report_ref:report.report_id,mode:r.mode,render_path:r.renderPath,reswitch_count:r.reswitchCount,narrator_ref:r.prompt.promptId,body:r.body,evidence_refs:report.wave_refs,anomaly_refs:[],authority:'NONE'};
    dokiDb.prepare('INSERT INTO dialog_messages(message_id,update_id,message_json,created_at) VALUES(?,?,?,?)').run(message.message_id,updateId,JSON.stringify(message),now());
    dokiDb.prepare('UPDATE update_jobs SET status=\'DONE\',finished_at=? WHERE update_id=?').run(now(),updateId); return message;
  }catch(error){
    const message={schema:'doki_message/v1',message_id:digestJson(updateId),update_ref:updateId,phase_report_ref:null,mode:'FACTUAL_FALLBACK',render_path:'FACTUAL_FALLBACK',reswitch_count:0,narrator_ref:null,body:`DOKI konnte dieses Update nicht narrativ verarbeiten. Fehler: ${String(error?.message||error)}`,evidence_refs:[],anomaly_refs:['UPDATE_RUNTIME_FAILURE'],authority:'NONE'};
    dokiDb.prepare('INSERT OR REPLACE INTO dialog_messages(message_id,update_id,message_json,created_at) VALUES(?,?,?,?)').run(message.message_id,updateId,JSON.stringify(message),now());
    dokiDb.prepare('UPDATE update_jobs SET status=\'DONE_WITH_FALLBACK\',finished_at=?,error=? WHERE update_id=?').run(now(),String(error?.message||error),updateId); return message;
  }
}
