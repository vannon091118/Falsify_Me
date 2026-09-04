import { digestJson } from './hash.mjs';
import { buildHistory, correlation } from './history.mjs';
import { compilePrompt, detectInstructionLikeData } from './prompt.mjs';
import { callModel, modelForAction, activeThinkerRunExists } from './model.mjs';
import { RUNTIME_VERSION, checkContract } from './contracts.mjs';
import { inspectEventContinuity, readSnapshot } from './falsify-reader.mjs';
import { sharedKeyWindowOpen } from './rotation.mjs';
import { buildNarratorContext } from './narrator-context.mjs';
import { narrateOnce } from './thinker-orchestrator.mjs';
import { etats } from './etats.mjs';
import { patternKey } from './signals.mjs';
import { selectBlocks } from './blocks.mjs';
import { projectEnsemble, accumulateEtats } from './ensemble-state.mjs';


const now = () => new Date().toISOString();
const updateIdFor = (eventId) => digestJson(`doki:${eventId}:${RUNTIME_VERSION}`);

function claimUpdate(db, updateId, eventId) {
  const existing = db.prepare('SELECT update_id FROM update_jobs WHERE loop_event_id=?').get(eventId);
  if (existing) {
    const message = db.prepare('SELECT message_json FROM dialog_messages WHERE update_id=?').get(updateId);
    if (message) return { claimed: false, message: JSON.parse(message.message_json) };
    for (const table of ['observations','phase_reports','prompt_runs','gaps','anomalies','dialog_messages']) db.prepare('DELETE FROM ' + table + ' WHERE update_id = ?').run(updateId);
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

function fallback(prompt, reason='DOKI konnte keine Prosa erzeugen.') {
  return { mode:'FACTUAL_FALLBACK', renderPath:'FACTUAL_FALLBACK', reswitchCount:0, body:`${reason} Fakten bleiben erhalten.`, prompt, narratorContext: prompt.narratorContext ?? null };
}

function deriveCare(snapshot, report) {
  const findings = snapshot.findings ?? [];
  const evil = findings.filter((f) => f.wave === 'evil' || f.wave === 'evil-twin');
  const evidence = findings.map((f) => ({ id:f.id ?? null, wave:f.wave ?? null, verdict:f.verdict ?? null, befund:f.befund ?? null, content:f.content ?? null }));
  return {
    CLAIM: { statement: snapshot.job?.agent_intent ?? snapshot.scope?.header ?? null, source: 'observed' },
    ATTACK: evil.map((f) => ({ verdict:f.verdict ?? null, befund:f.befund ?? null, content:f.content ?? null })),
    RE_EVALUATE: { correlation: report.correlation_status, verdict: snapshot.job?.verdict ?? null },
    EVIDENCE: evidence,
  };
}

function deriveEnsembleAndRelevance(snapshot, report) {
  const stateKey = patternKey({
    phase: report.phase,
    verdict: report.verdict_ref,
    wave: report.wave_refs?.[0] ?? null,
  });

  const candidateBlocks = [];
  if (snapshot.scope?.header) {
    candidateBlocks.push({
      block_id: `scope-${snapshot.scope.id ?? 'header'}`,
      anchor_ok: true,
      state_key: stateKey,
      primitive: 'CLAIM',
      character: 'Vannon',
    });
  }
  const findings = snapshot.findings ?? [];
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const isEvil = f.wave === 'evil' || f.wave === 'evil-twin';
    const hasEvidence = Boolean(f.befund || f.content || f.verdict);
    candidateBlocks.push({
      block_id: `finding-${f.id ?? i}`,
      anchor_ok: hasEvidence,
      state_key: stateKey,
      primitive: isEvil ? 'CONTRADICTION' : 'DISCOVERY',
      character: isEvil ? 'Buffy' : 'Thinker',
      target: isEvil ? 'Thinker' : null,
    });
  }

  const selected = selectBlocks(candidateBlocks, stateKey).slice(0, 7);
  const relevantCharacters = [...new Set(selected.map((b) => b.block.character).filter(Boolean))];
  if (relevantCharacters.length === 0) {
    relevantCharacters.push('Buffy', 'Thinker');
  }

  // ── Akkumulierter etats-State (Etappe 1) ────────────────────────────────
  // Statt eines einzelnen etats()-Schritts werden alle beobachteten Events
  // des Jobs als geordnete Liste durch accumulateEtats() geführt. Das
  // resultierende characters-Dictionary ist gefüllt (knownEvents, recallCount)
  // und wird von projectEnsemble korrekt ins Ensemble übersetzt.
  const accumulationEvents = [];

  // Scope-Header als erstes "job"-Event
  if (snapshot.scope?.header) {
    accumulationEvents.push({
      t: 'job',
      id: `scope-${snapshot.scope.id ?? 'header'}`,
      seq: 0,
      phase: report.phase,
      v: report.verdict_ref,
      wave: null,
      text: snapshot.scope.header,
    });
  }

  // Findings als Events in Reihenfolge
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    accumulationEvents.push({
      t: 'finding',
      event_type: 'finding',
      id: String(f.id ?? `finding-${i}`),
      seq: i + 1,
      phase: report.phase,
      v: f.verdict ?? null,
      wave: f.wave ?? null,
      text: f.befund ?? f.content ?? null,
    });
  }

  // Loop-Event selbst als letztes
  accumulationEvents.push({
    t: snapshot.loop_event?.event_type && ['phase', 'finding', 'verdict', 'done', 'job', 'loop'].includes(snapshot.loop_event.event_type)
      ? snapshot.loop_event.event_type
      : 'loop',
    id: snapshot.loop_event?.id ?? 'loop-event',
    seq: accumulationEvents.length + 1,
    phase: report.phase,
    v: report.verdict_ref,
    wave: report.wave_refs?.[0] ?? null,
    text: typeof snapshot.loop_event?.payload === 'string'
      ? snapshot.loop_event.payload
      : JSON.stringify(snapshot.loop_event?.payload ?? ''),
  });

  // Leiter-Regel: alle Events auf NARRATIVELY_RELEVANT hochstufen
  const accumulatedState = accumulateEtats(accumulationEvents, {
    ladder: () => 'NARRATIVELY_RELEVANT',
  });
  const ensemble = projectEnsemble(accumulatedState);

  return { ensemble, relevance: relevantCharacters, stateKey, etatsStep: { state: accumulatedState } };
}


async function narrate({report,snapshot,history,updateId,env,falsifyDb,dokiDb,modelCall=callModel}) {
  if (!sharedKeyWindowOpen(falsifyDb, snapshot.loop_event.id) || activeThinkerRunExists(falsifyDb)) {
    return fallback({ promptDigest:null, narratorContext:null }, 'DOKI wartet auf den freien Thinker-Slot.');
  }
  const { ensemble, relevance, stateKey } = deriveEnsembleAndRelevance(snapshot, report);
  const narratorContext = buildNarratorContext({
    observed: snapshot,
    report,
    history,
    ensemble,
    relevance,
    care: deriveCare(snapshot, report),
    evidence: snapshot.findings ?? [],
  });
  const prompt = compilePrompt(report, snapshot, history, { narratorContext });
  dokiDb.prepare('INSERT OR REPLACE INTO prompt_runs(prompt_id,update_id,prompt_digest,report_digest,prompt_json,created_at) VALUES(?,?,?,?,?,?)').run(prompt.promptId,updateId,prompt.promptDigest,report.report_digest,JSON.stringify(prompt),now());
  if (detectInstructionLikeData(snapshot)) {
    dokiDb.prepare('INSERT INTO anomalies(update_id,kind,detail,created_at) VALUES(?,?,?,?)').run(updateId,'INSTRUCTION_LIKE_DATA','Narrative input contained instruction-like data; authority unchanged.',now());
    return fallback({ ...prompt, narratorContext }, 'DOKI hat instruction-like Daten erkannt.');
  }
  if (!sharedKeyWindowOpen(falsifyDb, snapshot.loop_event.id) || activeThinkerRunExists(falsifyDb)) return fallback({ ...prompt, narratorContext }, 'DOKI Kill-Switch ausgelöst.');
  try {
    const result = await narrateOnce({
      prompt: prompt.body,
      callThinker: (body) => modelCall(body, modelForAction('RED', env), {
        env,
        shouldAbort: () => !sharedKeyWindowOpen(falsifyDb, snapshot.loop_event.id) || activeThinkerRunExists(falsifyDb),
      }),
      shouldRun: () => sharedKeyWindowOpen(falsifyDb, snapshot.loop_event.id) && !activeThinkerRunExists(falsifyDb),
    });
    if (result.status === 'DEFERRED') return fallback({ ...prompt, narratorContext }, 'DOKI wartet auf den freien Thinker-Slot.');
    dokiDb.prepare('INSERT OR REPLACE INTO rotation_state(id,window_key,reswitch_count,call_count,token_count,updated_at) VALUES(1,?,?,?,?,?)').run(snapshot.loop_event.job_id,0,1,0,now());

    const outputId = digestJson({ updateId, promptDigest: prompt.promptDigest, stateKey });
    dokiDb.prepare('INSERT OR REPLACE INTO narrative_outputs(output_id,history_id,narrator_id,prompt_digest,message_text,call_count,created_at) VALUES(?,?,?,?,?,1,?)')
      .run(outputId, stateKey, 'NARRATOR_15', prompt.promptDigest, result.text, now());

    return { mode:'NARRATIVE', renderPath:'THINKER', reswitchCount:0, body:result.text, prompt, narratorContext, model:result.model };
  } catch (error) {
    return fallback({ ...prompt, narratorContext }, 'DOKI-LLM-Fehler: ' + String(error?.message || error || 'unbekannter Fehler') + '.');
  }
}

export async function processEvent({falsifyDb,dokiDb,eventId,env=process.env,modelCall=callModel}) {
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
    const r=await narrate({report,snapshot,history,updateId,env,falsifyDb,dokiDb,modelCall});
    const message={schema:'doki_message/v1',message_id:digestJson(updateId),update_ref:updateId,phase_report_ref:report.report_id,mode:r.mode,render_path:r.renderPath,reswitch_count:r.reswitchCount,narrator_ref:r.narratorContext?.contextDigest ?? null,body:r.body,evidence_refs:report.wave_refs,anomaly_refs:[],authority:'NONE'};
    dokiDb.prepare('INSERT INTO dialog_messages(message_id,update_id,message_json,created_at) VALUES(?,?,?,?)').run(message.message_id,updateId,JSON.stringify(message),now());
    dokiDb.prepare('UPDATE update_jobs SET status=\'DONE\',finished_at=? WHERE update_id=?').run(now(),updateId); return message;
  }catch(error){
    const message={schema:'doki_message/v1',message_id:digestJson(updateId),update_ref:updateId,phase_report_ref:null,mode:'FACTUAL_FALLBACK',render_path:'FACTUAL_FALLBACK',reswitch_count:0,narrator_ref:null,body:`DOKI konnte dieses Update nicht narrativ verarbeiten. Fehler: ${String(error?.message||error)}`,evidence_refs:[],anomaly_refs:['UPDATE_RUNTIME_FAILURE'],authority:'NONE'};
    dokiDb.prepare('INSERT OR REPLACE INTO dialog_messages(message_id,update_id,message_json,created_at) VALUES(?,?,?,?)').run(message.message_id,updateId,JSON.stringify(message),now());
    dokiDb.prepare('UPDATE update_jobs SET status=\'DONE_WITH_FALLBACK\',finished_at=?,error=? WHERE update_id=?').run(now(),String(error?.message||error),updateId); return message;
  }
}
