// DOKI signal vocabulary. This file names only values that already exist in the
// repository. It is a catalog, not a second source of truth.

export const DOKI_SIGNAL_SOURCE = Object.freeze({
  FM_EVT: 'ui/tui/events.mjs',
  FALSIFY_SNAPSHOT: 'doki/src/falsify-reader.mjs',
  CHARACTER_AXES: 'doki/src/ensemble-state.mjs',
  REACTIVITY_AXES: 'doki/src/narrator-catalog.mjs',
  LOOP_STATES: 'artifacts/loops.mjs',
});

export const FM_EVENT_TYPES = Object.freeze([
  'boot', 'job', 'state', 'activity', 'finding', 'phase', 'phase_done',
  'verdict', 'output', 'files', 'done', 'focus', 'selftest', 'stats', 'model', 'loop',
  'scope_auto', 'handoff', 'doki',
]);

export const SNAPSHOT_FIELDS = Object.freeze({
  loop_event: Object.freeze([
    'id', 'job_id', 'scope_id', 'handoff_id', 'change_digest', 'event_type',
    'from_state', 'to_state', 'created_at',
  ]),
  job: Object.freeze([
    'loop_state', 'status', 'verdict', 'wave', 'attempt', 'loop_count',
    'max_loop_count', 'parent_job_id', 'iteration_id', 'review_iteration',
    'header_digest', 'change_digest',
  ]),
  findings: Object.freeze(['round', 'wave', 'mode', 'befund', 'verdict']),
  scope: Object.freeze([
    'header', 'phase', 'last_befund', 'open_conflicts', 'last_divergence',
    'research_additions', 'hardened_at',
  ]),
  checkout: Object.freeze(['bound_root', 'anchor_digest']),
  project: Object.freeze(['project_id']),
});

export const CHARACTER_AXES = Object.freeze([
  'trust', 'respect', 'irritation', 'affinity',
  'competence_confidence', 'resentment', 'curiosity', 'defensiveness',
]);

export const REACTIVITY_AXES = Object.freeze([
  'bug_witnessed', 'bug_introduced', 'bug_fixed', 'praise_received',
  'criticism_received', 'merge_observed', 'disagreement', 'admission_made',
]);

export const LOOP_STATES = Object.freeze([
  'QUEUED', 'RUNNING', 'WRITE_AUTHORIZED', 'WAITING_FOR_AGENT',
  'WRITE_IN_PROGRESS', 'CHANGE_CAPTURED', 'RE_REVIEW_QUEUED',
  'RE_REVIEW_RUNNING', 'DONE', 'LOOP_BLOCKED', 'ABORTED', 'ERROR',
]);

export const VERDICT_CODES = Object.freeze([
  'WRITE', 'PLAN', 'RESEARCH', 'ASK', 'ERROR', 'TIMEOUT',
]);

// These are pattern inputs already represented by the runtime contract.
// No new weighting or narrative semantics are invented here.
export function patternKey({ phase, verdict, wave }) {
  return [String(phase ?? ''), String(verdict ?? ''), String(wave ?? '')].join('|');
}

export function eventSignal(event) {
  if (!event || typeof event !== 'object' || typeof event.t !== 'string') return null;
  if (!FM_EVENT_TYPES.includes(event.t)) return null;
  return Object.freeze({
    source: 'FM_EVT',
    type: event.t,
    eventId: event.id ?? null,
    seq: Number.isInteger(event.seq) ? event.seq : null,
    payload: event,
  });
}

// User reaction is a schema placeholder only. The repository must provide a
// concrete producer before this becomes active; no WhatsApp/social/UI scraping.
export const USER_SIGNAL_TYPES = Object.freeze([
  'USER_ACTION', 'USER_MESSAGE', 'USER_FEEDBACK',
  'USER_OVERRIDE', 'USER_APPROVAL', 'USER_REJECTION',
]);
