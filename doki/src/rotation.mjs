import { ACTIVE_STATES } from './contracts.mjs';

export function sharedKeyWindowOpen(fdb, eventId) {
  const activeMarks = ACTIVE_STATES.map(() => '?').join(', ');
  const active = fdb.prepare(`SELECT id FROM jobs WHERE loop_state IN (${activeMarks}) LIMIT 1`).get(...ACTIVE_STATES);
  if (active) return false;
  const current = fdb.prepare('SELECT created_at FROM loop_events WHERE id = ?').get(eventId);
  if (!current) return false;
  // Rotation-Vertrag (DOKI-Blocker 6, gefixt 2026-09-03): das Fenster ist
  // GESCHLOSSEN, wenn der letzte thinker_start NACH dem letzten thinker_done
  // liegt (oder ein start OHNE je ein done existiert). Die alte Lesart
  // ("kein done -> frei") konnte ein offenes Erst-Fenster nie sehen — der
  // erste Denker-Call haette DOKI parallel laufen lassen.
  // Beide Events werden auf den Ankerzeitpunkt begrenzt (created_at <=
  // current) — spaetere Fenster zaehlen für diesen Event nicht.
  const start = fdb.prepare(`SELECT id, created_at FROM loop_events WHERE event_type='thinker_start' AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 1`).get(current.created_at);
  if (!start) return true; // noch nie gestartet -> frei
  const done = fdb.prepare(`SELECT id, created_at FROM loop_events WHERE event_type='thinker_done' AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 1`).get(current.created_at);
  if (!done) return false; // offenes Erst-Fenster
  if (Date.parse(start.created_at) >= Date.parse(done.created_at)) return false; // start nach letztem done = belegt
  return true;
}

export function activeThinkerRunExists(fdb) {
  const marks = ACTIVE_STATES.map(() => '?').join(', ');
  return Boolean(fdb.prepare(`SELECT 1 FROM jobs WHERE loop_state IN (${marks}) LIMIT 1`).get(...ACTIVE_STATES));
}
