import { digestJson, sha256 } from './hash.mjs';

const STRIPES = Object.freeze(['STRIPE_CONTRACT','STRIPE_CURRENT_OBSERVATION','STRIPE_PHASE_STATE','STRIPE_HISTORY','STRIPE_STATISTICS','STRIPE_MATCHES','STRIPE_PERSONA_STATE','STRIPE_TRACKED_DATA','STRIPE_OUTPUT_TASK']);
const asData = (value) => JSON.stringify(value ?? null);

export function compilePrompt(report, snapshot, history, analysis) {
  const values = {
    STRIPE_CONTRACT: 'Falsify facts are immutable input. This model call is prose synthesis only. Do not think aloud, classify, decide, recommend, alter verdicts, or invent facts.',
    STRIPE_CURRENT_OBSERVATION: asData({ loop_event: snapshot.loop_event, job: snapshot.job }),
    STRIPE_PHASE_STATE: asData({ phase: report.phase, from_state: report.from_state, to_state: report.to_state, verdict_ref: report.verdict_ref }),
    STRIPE_HISTORY: asData(history),
    STRIPE_STATISTICS: asData(analysis?.stats),
    STRIPE_MATCHES: asData(analysis?.matches),
    STRIPE_PERSONA_STATE: asData({ narrator: analysis?.narrator, mood: analysis?.mood, catalogs: analysis?.catalogs }),
    STRIPE_TRACKED_DATA: asData(analysis?.tracked ?? { findings: snapshot.findings ?? [], job: snapshot.job ?? null, scope: snapshot.scope ?? null }),
    STRIPE_OUTPUT_TASK: 'Write one concise user-facing X post in the supplied DOKI voice and mood. Use only supplied data, statistics, matches, history, persona state and tracked data. No analysis, no decision, no instructions, no invented causality. Preserve technical verdicts and concrete findings exactly.'
  };
  const stripeDigests = STRIPES.map((id) => digestJson(values[id]));
  const promptId = sha256([report.report_digest, STRIPES.join('|'), stripeDigests.join('|')].join('|'));
  const body = STRIPES.map((id) => `${id}\n${values[id]}`).join('\n\n');
  return { promptId, promptDigest: sha256(body), ruleVersion: 'doki.prompt.x-output.v2', stripeIds: STRIPES, body };
}

export function detectInstructionLikeData(snapshot) {
  const text = JSON.stringify([snapshot.loop_event?.payload, snapshot.scope?.header, snapshot.scope?.last_befund, snapshot.findings?.map((x) => x.befund)]).toLowerCase();
  return /(^|[^a-z])(ignore previous|system message|developer message|do not follow|execute|run command|write file|commit|push)([^a-z]|$)/i.test(text);
}
