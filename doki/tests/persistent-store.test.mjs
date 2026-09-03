import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DOKI_SCHEMA_VERSION, openDokiDb } from '../src/db.mjs';
import { createPersistentStore } from '../src/observer-store.mjs';

test('persistent observer store survives close and reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doki-store-'));
  const path = join(dir, 'doki.sqlite');
  try {
    const first = createPersistentStore({ path });
    const event = { id: 'obs_001', source_event_id: 'terminal-7', session_id: 's1', job_id: 'j1',
      seq: 7, source: 'terminal', event_type: 'monologue', observed_text: 'scan complete',
      text: 'scan complete', observed_at: '2026-09-03T00:00:00.000Z' };
    assert.equal(first.appendObservation(event), true);
    assert.equal(first.appendObservation(event), false);
    assert.equal(first.readCursor(), 'obs_001');
    first.putCharacterState({ characterId: 'Buffy', state: { recallCount: 1 } });
    first.putMemory({ memoryId: 'mem_1', characterId: 'Buffy', memoryKind: 'event', memory: { text: 'scan complete' } });
    assert.equal(first.putMemory({ memoryId: 'mem_2', characterId: 'Buffy', memoryKind: 'event', memory: { text: 'updated' } }), 'mem_1');
    first.putRelationship({ fromCharacter: 'Buffy', toCharacter: 'Thinker', state: { trust: 0.7 } });
    first.putThread({ threadId: 'thread_1', state: { status: 'open' } });
    first.putPerspective({ characterId: 'Buffy', topicKey: 'scan', state: { stance: 'positive' } });
    first.appendBelief({ beliefId: 'belief_1', characterId: 'Buffy', topicKey: 'scan', belief: { value: true }, evidence: ['obs_001'] });
    first.putConflict({ conflictId: 'conflict_1', conflict: { kind: 'none' } });
    first.appendHistoryRun({ historyId: 'history_1', baseCursorId: 'obs_001', inputDigest: 'in', ruleVersion: 'test/v1', stateDigest: 'state' });
    first.appendNarrativeOutput({ outputId: 'out_1', historyId: 'history_1', narratorId: 'narrator-15', promptDigest: 'prompt', messageText: 'Done.' });
    first.close();

    const db = openDokiDb(path);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, DOKI_SCHEMA_VERSION);
    const second = createPersistentStore({ db });
    assert.equal(second.readCursor(), 'obs_001');
    assert.equal(second.hasObservation('obs_001'), true);
    assert.deepEqual(second.list()[0].event, event);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_states').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_memory').get().n, 1);
    assert.equal(db.prepare('SELECT memory_json FROM character_memory WHERE memory_id=?').get('mem_1').memory_json, JSON.stringify({ text: 'updated' }));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM relationships').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM threads').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM perspectives').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM beliefs').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conflicts').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM history_runs').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM narrative_outputs').get().n, 1);
    second.close();
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('persistent store rejects self relationships', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doki-store-'));
  const path = join(dir, 'doki.sqlite');
  try {
    const store = createPersistentStore({ path });
    assert.throws(() => store.putRelationship({ fromCharacter: 'Buffy', toCharacter: 'Buffy', state: {} }));
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
