import { digestJson } from './hash.mjs';
import { listTerminalEvents } from './falsify-reader.mjs';
import { processEvent } from './runtime.mjs';

export const REPLAY_RULE_VERSION = 'doki-replay-v1';

const cursorDigest = (event) => digestJson({
  rule_version: REPLAY_RULE_VERSION,
  id: String(event.id),
  job_id: event.job_id ?? null,
  created_at: event.created_at ?? null,
});

function compareEvents(a, b) {
  const ta = String(a.created_at ?? '');
  const tb = String(b.created_at ?? '');
  return ta < tb ? -1 : ta > tb ? 1 : String(a.id).localeCompare(String(b.id));
}

export function readReplayCursor(dokiDb) {
  return dokiDb.prepare('SELECT cursor_id, cursor_seq, cursor_digest FROM observation_cursor WHERE id=1').get() ?? {
    cursor_id: null,
    cursor_seq: null,
    cursor_digest: null,
  };
}

export function resetReplayCursor(dokiDb) {
  dokiDb.prepare('DELETE FROM observation_cursor WHERE id=1').run();
}

export function advanceReplayCursor(dokiDb, event, ordinal) {
  const digest = cursorDigest(event);
  const current = readReplayCursor(dokiDb);
  if (current.cursor_id === event.id) {
    if (current.cursor_digest !== digest) throw new Error(`Replay-Cursor beschädigt: ${event.id}`);
    return false;
  }
  if (current.cursor_id != null && Number.isInteger(current.cursor_seq) && ordinal <= current.cursor_seq) {
    throw new Error(`Replay-Cursor darf nicht rückwärts laufen: ${current.cursor_id} -> ${event.id}`);
  }
  dokiDb.prepare(`
    INSERT INTO observation_cursor(id,cursor_id,cursor_seq,cursor_digest,updated_at)
    VALUES(1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET cursor_id=excluded.cursor_id,
      cursor_seq=excluded.cursor_seq,cursor_digest=excluded.cursor_digest,updated_at=excluded.updated_at
  `).run(event.id, ordinal, digest, new Date().toISOString());
  return true;
}

export function selectReplayEvents(events, cursor) {
  const ordered = [...events].sort(compareEvents);
  if (!cursor?.cursor_id) return ordered;
  const position = ordered.findIndex((event) => event.id === cursor.cursor_id);
  if (position < 0) throw new Error(`Replay-Cursor verweist auf unbekanntes Terminalereignis: ${cursor.cursor_id}`);
  if (cursor.cursor_digest !== cursorDigest(ordered[position])) {
    throw new Error(`Replay-Cursor-Digest stimmt nicht: ${cursor.cursor_id}`);
  }
  return ordered.slice(position + 1);
}

/**
 * Real-runtime replay: the durable cursor advances only after processEvent
 * returns. A crash before that point replays the source event. processEvent
 * already keys its durable update/message by the source event, so the replay
 * produces the same persisted result instead of a second narrative update.
 */
export async function replayTerminalEvents({ falsifyDb, dokiDb, modelCall, env = process.env, process = processEvent }) {
  const allEvents = listTerminalEvents(falsifyDb).sort(compareEvents);
  const cursor = readReplayCursor(dokiDb);
  const pending = selectReplayEvents(allEvents, cursor);
  const messages = [];

  for (const event of pending) {
    const message = await process({ falsifyDb, dokiDb, eventId: event.id, env, modelCall });
    messages.push(message);
    const ordinal = allEvents.findIndex((row) => row.id === event.id) + 1;
    advanceReplayCursor(dokiDb, event, ordinal);
  }

  return { cursor: readReplayCursor(dokiDb), processed: pending.map((event) => event.id), messages };
}
