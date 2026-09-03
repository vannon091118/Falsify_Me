import { ACTIVE_STATES } from './contracts.mjs';

export function sharedKeyWindowOpen(fdb, eventId) {
  const activeMarks = ACTIVE_STATES.map(() => '?').join(', ');
  const active = fdb.prepare(`SELECT id FROM jobs WHERE loop_state IN (${activeMarks}) LIMIT 1`).get(...ACTIVE_STATES);
  if (active) return false;
  const current = fdb.prepare('SELECT created_at FROM loop_events WHERE id = ?').get(eventId);
  if (!current) return false;
  const done = fdb.prepare(`SELECT id, created_at FROM loop_events WHERE event_type='thinker_done' AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 1`).get(current.created_at);
  const start = fdb.prepare(`SELECT id, created_at FROM loop_events WHERE event_type='thinker_start' AND created_at >= ? ORDER BY created_at ASC, id ASC LIMIT 1`).get(done?.created_at ?? '0000-01-01T00:00:00Z');
  if (!done) return true;
  if (start && Date.parse(start.created_at) >= Date.parse(done.created_at)) return false;
  return true;
}

export function activeThinkerRunExists(fdb) {
  const marks = ACTIVE_STATES.map(() => '?').join(', ');
  return Boolean(fdb.prepare(`SELECT 1 FROM jobs WHERE loop_state IN (${marks}) LIMIT 1`).get(...ACTIVE_STATES));
}
