import assert from 'node:assert/strict';
import test from 'node:test';
import { DokiObserver, observationId } from '../src/observer.mjs';
import { CHARACTERS, RELATIONSHIP_COUNT, EnsembleState } from '../src/ensemble-state.mjs';
import { COMMIT_NARRATOR, assertNarratorBoundary } from '../src/commit-narrator.mjs';
import { createMemoryStore } from '../src/observer-store.mjs';

test('observer is exactly-once for repeated terminal material', () => {
  const store = createMemoryStore();
  const observer = new DokiObserver({ store });
  const event = { session: 's1', job: 'j1', seq: 7, source: 'terminal', type: 'monologue', text: 'scan complete' };
  assert.equal(observer.ingest(event).accepted, true);
  assert.equal(observer.ingest(event).duplicate, true);
  assert.equal(store.list().length, 1);
  assert.equal(observer.snapshot().cursor, observationId(event));
});

test('ensemble materializes directed 14-character graph without self edges', () => {
  assert.equal(CHARACTERS.length, 14);
  assert.equal(RELATIONSHIP_COUNT, 182);
  const ensemble = new EnsembleState();
  assert.equal(ensemble.relationships.size, 182);
  assert.throws(() => ensemble.applyRelationshipDelta('Sage', 'Sage', { trust: 0.1 }));
});

test('15th narrator cannot acquire technical authority', () => {
  assert.equal(COMMIT_NARRATOR.index, 15);
  assertNarratorBoundary({ narrator: COMMIT_NARRATOR });
});
