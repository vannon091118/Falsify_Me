import assert from 'node:assert/strict';
import test from 'node:test';
import { CHARACTERS, CHARACTER_AXES, RELATIONSHIP_COUNT, EnsembleState } from '../src/ensemble-state.mjs';
import { allNarrators, narratorByIndex, narratorByName, REACTIVITY_AXES } from '../src/narrator-catalog.mjs';

test('SnipWar narrator catalog contains all 14 persistent identities', () => {
  assert.equal(CHARACTERS.length, 14);
  assert.deepEqual(CHARACTERS, ['Buffy','Basher','Thinker','Vannon','Squizzle','Devin','Argos','Ghost','Spark','Glitch','Null','Echo','Flux','Sage']);
  assert.equal(allNarrators().length, 14);
  for (let index = 1; index <= 14; index += 1) {
    const narrator = narratorByIndex(index);
    assert.equal(narrator.index, index);
    assert.equal(narratorByName(narrator.name), narrator);
    assert.equal(narrator.reactivity && Object.keys(narrator.reactivity).length, REACTIVITY_AXES.length);
  }
});

test('character personality is static while runtime state is mutable', () => {
  const ensemble = new EnsembleState();
  const before = structuredClone(ensemble.profile('Buffy'));
  ensemble.recordRecall('Buffy', 'obs-1');
  ensemble.setKnowledge('Buffy', 'fix', true);
  ensemble.remember('Buffy', { memoryId: 'mem-1', observationId: 'obs-1' });
  ensemble.applyEmotion('Buffy', { curiosity: 0.4 });
  assert.deepEqual(ensemble.profile('Buffy'), before);
  assert.equal(ensemble.characters.get('Buffy').recallCount, 1);
});

test('14 characters materialize the complete directed relationship graph', () => {
  const ensemble = new EnsembleState();
  assert.equal(RELATIONSHIP_COUNT, 182);
  assert.equal(ensemble.relationships.size, 182);
  for (const from of CHARACTERS) {
    for (const to of CHARACTERS) {
      if (from !== to) assert.deepEqual(Object.keys(ensemble.relationships.get(`${from}->${to}`)), CHARACTER_AXES);
    }
  }
  assert.throws(() => ensemble.profile('Unknown'));
  assert.throws(() => ensemble.applyRelationshipDelta('Buffy', 'Buffy', { trust: 0.1 }));
});
