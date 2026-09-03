import { digestJson } from './hash.mjs';
import { buildHistory, correlation, narrativeAnalysis } from './history.mjs';
import { compilePrompt, detectInstructionLikeData } from './prompt.mjs';
import { callModel, activeThinkerRunExists } from './model.mjs';
import { RUNTIME_VERSION } from './contracts.mjs';
import { inspectEventContinuity, readSnapshot } from './falsify-reader.mjs';
import { sharedKeyWindowOpen } from './rotation.mjs';

const now = () => new Date().toISOString();
const updateIdFor = (eventId) => digestJson(`doki:${eventId}:${RUNTIME_VERSION}`);

function claimUpdate(db, updateId, eventId) {
  const existing = db.prepare('SELECT update_id FROM update_jobs WHERE loop_event_id=?').get(eventId);
  if (existing) return false;
  db.prepare("INSERT INTO update_jobs(update_id,loop_event_id,status,created_at,started_at) VALUES(?,?, 'RUNNING',?,?)").run(updateId,eventId,now(),now());
  return true;
}

function persistPersonaState(db, analysis) {
  const current = db.prepare('SELECT recall_count, fatigue, emotional_weight FROM persona_state WHERE narrator=?').get(analysis.narrator);
  const recallCount = Number(current?.recall_count ?? 0) + 1;
  const fatigue = Math.min(100, Number(current?.fatigue ?? 0) * 0.9 + 1);
  const emotionalWeight = Math.max(-100, Math.min(100, Number(current?.emotional_weight ?? 0) * 0.92 + (analysis.mood === 'alert' ? 3 : analysis.mood === 'focused' ? 1 : 0)));
  db.prepare(`INSERT INTO persona_state(narrator,mood,recall_count,fatigue,emotional_weight,updated_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(narrator) DO UPDATE SET mood=excluded.mood, recall_count=excluded.recall_count,
    fatigue=excluded.fatigue, emotional_weight=excluded.emotional_weight, updated_at=excluded.updated_at`).run(
    analysis.narrator, analysis.mood, recallCount, fatigue, emotionalWeight, now());
  return { narrator: analysis.narrator, mood: analysis.mood, recall_count: recallCount, fatigue, emotional_weight: emotionalWeight };
}

function persistRelationship(db, analysis, history) {
  const previous = db.prepare('SELECT message_json FROM dialog_messages ORDER BY rowid DESC LIMIT 1').get();
  if (!previous) return null;
  try {
    const prev = JSON.parse(previous.message_json).narrator_ref;
    if (!prev || prev === analysis.narrator) return null;
    const relation = db.prepare('SELECT relation, interaction_count FROM persona_relationships WHERE narrator=? AND other_narrator=?').get(analysis.narrator, prev);
    const nextRelation = Math.max(-100, Math.min(100, Number(relation?.relation ?? 0) + 1));
    const interactions = Number(relation?.interaction_count ?? 0) + 1;
    db.prepare(`INSERT INTO persona_relationships(narrator,other_narrator,relation,interaction_count,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(narrator,other_narrator) DO UPDATE SET relation=excluded.relation,
      interaction_count=excluded.interaction_count, updated_at=excluded.updated_at`).run(analysis.narrator, prev, nextRelation, interactions, now());
    return { narrator: analysis.narrator, other_narrator: prev, relation: nextRelation, interaction_count: interactions };
  } catch { return null; }
}

function makeReport(snapshot, history, analysis, personaState, relationship, updateId) {
  const report = {
    schema:'doki.phase_report/v4', report_id:'', update_id:updateId, loop_event_ref:snapshot.loop_event.id,
    job_id:snapshot.loop_event.job_id, scope_id:snapshot.loop_event.scope_id ?? null,
    phase:snapshot.job?.loop_state ?? snapshot.loop_event.to_state,
    from_state:snapshot.loop_event.from_state, to_state:snapshot.loop_event.to_state,
    verdict_ref:snapshot.job?.verdict ?? null,
    wave_refs:[...new Set((snapshot.findings??[]).map((f)=>f.wave))],
    history_refs:history.refs, statistics:analysis.stats, matches:analysis.matches,
    narrator:analysis.narrator, mood:analysis.mood, persona_state:personaState,
    relationship:relationship, tracked:analysis.tracked,
    correlation_status:correlation(snapshot),
    facts_digest:digestJson({ snapshot, analysis, history:history.refs, personaState, relationship }),
    rule_versions:{runtime:RUNTIME_VERSION, prompt:'doki.prompt.x-output.v2'}, report_digest:''
  };
  report.report_digest=digestJson(report);
  report.report_id=digestJson({schema:report.schema,report_digest:report.report_digest});
  return report;
}

function fallback(prompt, reason='DOKI konnte keine Prosa erzeugen.') {
  return { mode:'FACTUAL_FALLBACK', renderPath:'FACTUAL_FALLBACK', body:`${reason} Fakten bleiben unverändert.`, prompt };
}

async function narrate({report,snapshot,history,analysis,updateId,env,falsifyDb,dokiDb}) {
  const prompt=compilePrompt(report,snapshot,history,analysis);
  dokiDb.prepare('INSERT OR REPLACE INTO prompt_runs(prompt_id,update_id,prompt_digest,report_digest,prompt_json,created_at) VALUES(?,?,?,?,?,?)').run(prompt.promptId,updateId,prompt.promptDigest,report.report_digest,JSON.stringify(prompt),now());
  if(detectInstructionLikeData(snapshot)){
    dokiDb.prepare('INSERT INTO anomalies(update_id,kind,detail,created_at) VALUES(?,?,?,?)').run(updateId,'INSTRUCTION_LIKE_DATA','Narrative input contained instruction-like data; authority unchanged.',now());
    return fallback(prompt,'DOKI hat instruction-like Daten erkannt.');
  }
  if(!sharedKeyWindowOpen(falsifyDb,snapshot.loop_event.id) || activeThinkerRunExists(falsifyDb)) return fallback(prompt,'DOKI Shared-Key-Fenster ist geschlossen.');
  try {
    const result=await callModel(prompt.body,{env,shouldAbort:()=>!sharedKeyWindowOpen(falsifyDb,snapshot.loop_event.id)||activeThinkerRunExists(falsifyDb)});
    dokiDb.prepare('INSERT OR REPLACE INTO rotation_state(id,window_key,reswitch_count,call_count,token_count,updated_at) VALUES(1,?,?,?,?,?)').run(snapshot.loop_event.job_id,0,1,0,0,now());
    return {mode:'NARRATIVE',renderPath:'THINKER_OUTPUT',body:result.text,prompt};
  } catch(error) {
    return fallback(prompt,`DOKI-LLM-Fehler: ${String(error?.message||error||'unbekannter Fehler')}.`);
  }
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
    const history=buildHistory(dokiDb,snapshot);
    const analysis=narrativeAnalysis(snapshot,history);
    const personaState=persistPersonaState(dokiDb,analysis);
    const relationship=persistRelationship(dokiDb,analysis,history);
    const report=makeReport(snapshot,history,analysis,personaState,relationship,updateId);
    dokiDb.prepare('INSERT INTO phase_reports(report_id,update_id,report_json,report_digest,created_at) VALUES(?,?,?,?,?)').run(report.report_id,updateId,JSON.stringify(report),report.report_digest,now());
    const r=await narrate({report,snapshot,history,analysis,updateId,env,falsifyDb,dokiDb});
    const message={schema:'doki_message/v1',message_id:digestJson(updateId),update_ref:updateId,phase_report_ref:report.report_id,mode:r.mode,render_path:r.renderPath,reswitch_count:0,narrator_ref:analysis.narrator,body:r.body,evidence_refs:report.wave_refs,anomaly_refs:[],authority:'NONE'};
    dokiDb.prepare('INSERT INTO dialog_messages(message_id,update_id,message_json,created_at) VALUES(?,?,?,?)').run(message.message_id,updateId,JSON.stringify(message),now());
    dokiDb.prepare("UPDATE update_jobs SET status='DONE',finished_at=? WHERE update_id=?").run(now(),updateId); return message;
  }catch(error){
    const message={schema:'doki_message/v1',message_id:digestJson(updateId),update_ref:updateId,phase_report_ref:null,mode:'FACTUAL_FALLBACK',render_path:'FACTUAL_FALLBACK',reswitch_count:0,narrator_ref:null,body:`DOKI konnte dieses Update nicht narrativ verarbeiten. Fehler: ${String(error?.message||error)}`,evidence_refs:[],anomaly_refs:['UPDATE_RUNTIME_FAILURE'],authority:'NONE'};
    dokiDb.prepare('INSERT OR REPLACE INTO dialog_messages(message_id,update_id,message_json,created_at) VALUES(?,?,?,?)').run(message.message_id,updateId,JSON.stringify(message),now());
    dokiDb.prepare("UPDATE update_jobs SET status='DONE_WITH_FALLBACK',finished_at=?,error=? WHERE update_id=?").run(now(),String(error?.message||error),updateId); return message;
  }
}
