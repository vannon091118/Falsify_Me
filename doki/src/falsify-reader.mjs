import { digestJson } from './hash.mjs';
import { TERMINAL_STATES } from './contracts.mjs';

function safeJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { _invalid_json: true, raw: String(text) }; }
}

export function readSnapshot(fdb, eventId) {
  fdb.exec('BEGIN');
  try {
    const event = fdb.prepare('SELECT id, job_id, scope_id, handoff_id, change_digest, event_type, from_state, to_state, payload, created_at FROM loop_events WHERE id = ?').get(eventId);
    if (!event) throw new Error(`loop_event nicht gefunden: ${eventId}`);
    const job = fdb.prepare(`SELECT project_id, checkout_id, loop_state, status, verdict, wave, attempt, loop_count, max_loop_count, parent_job_id, iteration_id,
      review_iteration, header_digest, change_digest, runtime_config, created_at, started_at, done_at FROM jobs WHERE id = ?`).get(event.job_id) ?? null;
    const findings = fdb.prepare('SELECT round, wave, mode, befund, verdict FROM findings WHERE job_id = ? AND wave IN (\'scan\', \'plan\', \'evil\', \'replan\') ORDER BY round ASC').all(event.job_id);
    const scope = event.scope_id ? (fdb.prepare('SELECT header, phase, last_befund, open_conflicts, last_divergence, research_additions, hardened_at FROM scopes WHERE id = ?').get(event.scope_id) ?? null) : null;
    const project = job?.project_id ? (fdb.prepare('SELECT project_id, checkout_id, bound_root, anchor_digest FROM projects WHERE project_id = ?').get(job.project_id) ?? null) : null;
    const checkout = job?.checkout_id ? (fdb.prepare('SELECT project_id, checkout_id, bound_root, anchor_digest FROM checkouts WHERE checkout_id = ?').get(job.checkout_id) ?? null) : null;
    const snapshot = { loop_event: { ...event, payload: safeJson(event.payload) }, job: job ? { ...job, runtime_config: safeJson(job.runtime_config) } : null, findings, scope, project, checkout };
    fdb.exec('COMMIT');
    return { snapshot, snapshotDigest: digestJson(snapshot) };
  } catch (error) {
    try { fdb.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function listTerminalEvents(fdb) {
  const states = TERMINAL_STATES.map(() => '?').join(', ');
  return fdb.prepare(`SELECT id, job_id, scope_id, handoff_id, change_digest, event_type, from_state, to_state, payload, created_at
    FROM loop_events WHERE to_state IN (${states}) ORDER BY created_at ASC, id ASC`).all(...TERMINAL_STATES);
}

export function inspectEventContinuity(fdb, event) {
  const previous = fdb.prepare(`SELECT id, from_state, to_state, created_at FROM loop_events
    WHERE job_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(event.job_id, event.created_at, event.created_at, event.id);
  if (!previous) return null;
  if (event.from_state && previous.to_state && event.from_state !== previous.to_state) {
    return { kind: 'STATE_SEQUENCE_GAP', detail: `${previous.id}:${previous.to_state} -> ${event.id}:${event.from_state}` };
  }
  return null;
}
