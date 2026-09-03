import { digestJson } from './hash.mjs';
import { buildHistory, correlation } from './history.mjs';
import { chooseAction, updateQ, budgetDefaults } from './qlearning.mjs';
import { compilePrompt, detectInstructionLikeData } from './prompt.mjs';
import { callModel, modelForAction, activeThinkerRunExists } from './model.mjs';
import { DEFAULT_MAX_RESWITCH, RUNTIME_VERSION, checkContract } from './contracts.mjs';
import { inspectEventContinuity, readSnapshot } from './falsify-reader.mjs';
import { sharedKeyWindowOpen } from './rotation.mjs';

const now = () => new Date().toISOString();
const updateIdFor = (eventId) => digestJson(`doki:${eventId}:${RUNTIME_VERSION}`);

function claimUpdate(db, updateId, eventId) {
  const existing = db.prepare('SELECT update_id FROM update_jobs WHERE loop_event_id=?').get(eventId);
  if (existing) {
    const message = db.prepare('SELECT message_json FROM dialog_messages WHERE update_id=?').get(updateId);
    if (message) return { claimed: false, message: JSON.parse(message.message_json) };
    // Crash-Recovery: Update wurde geclaimt, aber nie finalisiert (kein
    // dialog_message). Teilweise persistierte Zwischenstände entfernen und
    // das Update deterministisch neu aufnehmen — keine doppelte Narration,
    // keine verlorene Idempotenz (message_id = digest(updateId) bleibt stabil).
    for (const table of ['observations','phase_reports','prompt_runs','gaps','anomalies','dialog_messages']) {
      db.prepare('DELETE FROM ' + table + ' WHERE update_id = ?').run(updateId);
    }
    // q_table hat keine update_id-Spalte, ist aber an source_event_id (= loop_event.id) gebunden
    db.prepare('DELETE FROM q_table WHERE source_event_id = ?').run(eventId);
    db.prepare("UPDATE update_jobs SET status='RUNNING', started_at=?, error=NULL, finished_at=NULL WHERE update_id=?").run(now(), updateId);
    return { claimed: true, resumed: true };
  }
  db.prepare("INSERT INTO update_jobs(update_id,loop_event_id,status,created_at,started_at) VALUES(?,?, 'RUNNING',?,?)").run(updateId,eventId,now(),now());
  return { claimed: true, resumed: false };
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

function fallback(prompt, reason='DOKI konnte keine Prosa erzeugen.', reswitchCount=0) {
  return { mode:'FACTUAL_FALLBACK', renderPath:'FACTUAL_FALLBACK', reswitchCount, body:`${reason} Fakten bleiben erhalten.`, prompt };
}

async function narrate({report,snapshot,history,action,updateId,env,falsifyDb,dokiDb,modelCall = callModel}) {
  const budget=budgetDefaults(env);
  const prompt=compilePrompt(report,snapshot,history,{perspective:report.correlation_status==='DIVERGENCE'?'abweichende Perspektiven explizit benennen':'neutral'});
  dokiDb.prepare('INSERT OR REPLACE INTO prompt_runs(prompt_id,update_id,prompt_digest,report_digest,prompt_json,created_at) VALUES(?,?,?,?,?,?)').run(prompt.promptId,updateId,prompt.promptDigest,report.report_digest,JSON.stringify(prompt),now());
  if(detectInstructionLikeData(snapshot)){
    dokiDb.prepare('INSERT INTO anomalies(update_id,kind,detail,created_at) VALUES(?,?,?,?)').run(updateId,'INSTRUCTION_LIKE_DATA','Narrative input contained instruction-like data; authority unchanged.',now());
    return fallback(prompt,'DOKI hat instruction-like Daten erkannt.');
  }
  if(!sharedKeyWindowOpen(falsifyDb,snapshot.loop_event.id) || activeThinkerRunExists(falsifyDb)) return fallback(prompt,'DOKI Shared-Key-Fenster ist geschlossen.');
  let current=action, calls=0, reswitch=0, lastError=null;
  while(calls < budget.maxCalls){
    if(!sharedKeyWindowOpen(falsifyDb,snapshot.loop_event.id) || activeThinkerRunExists(falsifyDb)) return fallback(prompt,'DOKI Kill-Switch ausgelöst.');
    try{
      const result=await modelCall(prompt.body,modelForAction(current,env),{env,shouldAbort:()=>!sharedKeyWindowOpen(falsifyDb,snapshot.loop_event.id)||activeThinkerRunExists(falsifyDb)});
      calls++;
      dokiDb.prepare('INSERT OR REPLACE INTO rotation_state(id,window_key,reswitch_count,call_count,token_count,updated_at) VALUES(1,?,?,?,?,?)').run(snapshot.loop_event.job_id,reswitch,calls,0,now());
      return {mode:'NARRATIVE',renderPath:current==='RED'?'RESWITCH_THINKER_MODEL':'SMALL_MODEL',reswitchCount:reswitch,body:result.text,prompt};
    }catch(error){
      lastError=error; calls++;
      if(reswitch>=DEFAULT_MAX_RESWITCH) break;
      reswitch++; current='RED';
      if(reswitch>DEFAULT_MAX_RESWITCH) break;
    }
  }
  return fallback(prompt, reswitch>=DEFAULT_MAX_RESWITCH ? 'RESWITCH-Limit (5) erreicht.' : ('DOKI-LLM-Fehler: ' + String(lastError?.message||lastError||'unbekannter Fehler') + '.'), reswitch);
}

export async function processEvent({falsifyDb,dokiDb,eventId,env=process.env,modelCall=callModel}){
  // FalsifyMe-Contract-Anker: unbekannte Struktur darf nie interpretiert werden.
  const contract=checkContract(env);
  if(!contract.ok){
    const updateId=updateIdFor(eventId);
    return {schema:'doki_message/v1',message_id:digestJson(updateId),update_ref:updateId,phase_report_ref:null,mode:'UNAVAILABLE',render_path:'FACTUAL_FALLBACK',reswitch_count:0,narrator_ref:null,body:'DOKI kann diesen FalsifyMe-Zustand nicht interpretieren (CONTRACT_MISMATCH: erwartet '+contract.expected+', konfiguriert '+contract.configured+').',evidence_refs:[],anomaly_refs:['CONTRACT_MISMATCH'],authority:'NONE'};
  }
  const {snapshot,snapshotDigest}=readSnapshot(falsifyDb,eventId), updateId=updateIdFor(eventId);
  const claim=claimUpdate(dokiDb,updateId,eventId);
  if(!claim.claimed) return claim.message;
  try{
    const gap=inspectEventContinuity(falsifyDb,snapshot.loop_event);
    if(gap)dokiDb.prepare('INSERT INTO gaps(update_id,job_id,kind,detail,created_at) VALUES(?,?,?,?,?)').run(updateId,snapshot.loop_event.job_id,gap.kind,gap.detail,now());
    dokiDb.prepare('INSERT INTO observations(update_id,loop_event_id,job_id,scope_id,event_type,from_state,to_state,snapshot_json,snapshot_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(updateId,eventId,snapshot.loop_event.job_id,snapshot.loop_event.scope_id??null,snapshot.loop_event.event_type,snapshot.loop_event.from_state,snapshot.loop_event.to_state,JSON.stringify(snapshot),snapshotDigest,now());
    const history=buildHistory(dokiDb,snapshot); const report=makeReport(snapshot,history,updateId);
    dokiDb.prepare('INSERT INTO phase_reports(report_id,update_id,report_json,report_digest,created_at) VALUES(?,?,?,?,?)').run(report.report_id,updateId,JSON.stringify(report),report.report_digest,now());
    const action=chooseAction(dokiDb,report).action;
    updateQ(dokiDb,report,{action,reward:report.correlation_status==='CONVERGENT'?1:0});
    const r=await narrate({report,snapshot,history,action,updateId,env,falsifyDb,dokiDb,modelCall});
    const message={schema:'doki_message/v1',message_id:digestJson(updateId),update_ref:updateId,phase_report_ref:report.report_id,mode:r.mode,render_path:r.renderPath,reswitch_count:r.reswitchCount,narrator_ref:r.prompt.promptId,body:r.body,evidence_refs:report.wave_refs,anomaly_refs:[],authority:'NONE'};
    dokiDb.prepare('INSERT INTO dialog_messages(message_id,update_id,message_json,created_at) VALUES(?,?,?,?)').run(message.message_id,updateId,JSON.stringify(message),now());
    dokiDb.prepare('UPDATE update_jobs SET status=\'DONE\',finished_at=? WHERE update_id=?').run(now(),updateId); return message;
  }catch(error){
    const message={schema:'doki_message/v1',message_id:digestJson(updateId),update_ref:updateId,phase_report_ref:null,mode:'FACTUAL_FALLBACK',render_path:'FACTUAL_FALLBACK',reswitch_count:0,narrator_ref:null,body:`DOKI konnte dieses Update nicht narrativ verarbeiten. Fehler: ${String(error?.message||error)}`,evidence_refs:[],anomaly_refs:['UPDATE_RUNTIME_FAILURE'],authority:'NONE'};
    dokiDb.prepare('INSERT OR REPLACE INTO dialog_messages(message_id,update_id,message_json,created_at) VALUES(?,?,?,?)').run(message.message_id,updateId,JSON.stringify(message),now());
    dokiDb.prepare('UPDATE update_jobs SET status=\'DONE_WITH_FALLBACK\',finished_at=?,error=? WHERE update_id=?').run(now(),String(error?.message||error),updateId); return message;
  }
}
