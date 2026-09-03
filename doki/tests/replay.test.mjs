import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDokiDb } from '../src/db.mjs';
import { REPLAY_RULE_VERSION, advanceReplayCursor, readReplayCursor, resetReplayCursor, selectReplayEvents } from '../src/replay.mjs';
import { digestJson } from '../src/hash.mjs';

const events = [
  { id: 'loop-2', job_id: 'job-2', created_at: '2026-09-03T10:01:00.000Z' },
  { id: 'loop-1', job_id: 'job-1', created_at: '2026-09-03T10:00:00.000Z' },
  { id: 'loop-3', job_id: 'job-3', created_at: '2026-09-03T10:02:00.000Z' },
];

function cursorFor(event, seq) {
  return {
    cursor_id: event.id,
    cursor_seq: seq,
    cursor_digest: digestJson({ rule_version: REPLAY_RULE_VERSION, id: event.id, job_id: event.job_id, created_at: event.created_at }),
  };
}

test('replay selection is deterministic and resumes strictly after cursor', () => {
  const selected = selectReplayEvents(events, cursorFor(events[0], 2));
  assert.deepEqual(selected.map((event) => event.id), ['loop-3']);
  assert.deepEqual(selectReplayEvents([...events].reverse(), cursorFor(events[0], 2)).map((event) => event.id), ['loop-3']);
});

test('missing or tampered cursor fails closed', () => {
  assert.throws(() => selectReplayEvents(events, { cursor_id: 'gone', cursor_seq: 1, cursor_digest: 'x' }), /unbekanntes Terminalereignis/);
  assert.throws(() => selectReplayEvents(events, { ...cursorFor(events[0], 2), cursor_digest: 'tampered' }), /Digest stimmt nicht/);
});

test('durable cursor is monotonic, idempotent for same event, and resettable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doki-replay-'));
  const dbPath = join(dir, 'doki.sqlite');
  try {
    const db = openDokiDb(dbPath);
    assert.equal(readReplayCursor(db).cursor_id, null);
    assert.equal(advanceReplayCursor(db, events[1], 1), true);
    assert.equal(readReplayCursor(db).cursor_id, 'loop-1');
    assert.equal(advanceReplayCursor(db, events[1], 1), false);
    assert.throws(() => advanceReplayCursor(db, events[0], 1), /nicht rückwärts/);
    assert.equal(advanceReplayCursor(db, events[0], 2), true);
    resetReplayCursor(db);
    assert.equal(readReplayCursor(db).cursor_id, null);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
