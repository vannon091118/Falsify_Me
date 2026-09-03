import test from 'node:test';
import assert from 'node:assert/strict';
import { etats, LADDER, pureContract } from '../src/etats.mjs';

const observation = (extra = {}) => ({
  t: 'phase',
  id: 'evt-1',
  seq: 1,
  phase: 'PLAN',
  v: 'PLAN',
  wave: 1,
  ...extra,
});

test('etats advances monotonically through the explicit ladder only', () => {
  const first = etats({}, observation(), { ladder: () => 'OBSERVED' });
  assert.equal(first.state.stage, 'OBSERVED');

  const persisted = etats(first.state, observation({ id: 'evt-2', seq: 2 }), { ladder: () => 'PERSISTED' });
  assert.equal(persisted.transition.to, 'PERSISTED');

  const denied = etats(persisted.state, observation({ id: 'evt-3', seq: 3 }), { ladder: () => 'OBSERVED' });
  assert.equal(denied.transition.to, 'PERSISTED');

  assert.deepEqual(LADDER, ['OBSERVED', 'PERSISTED', 'DERIVED', 'NARRATIVELY_RELEVANT']);
});

test('replay is deterministic for identical state, event and rules', () => {
  const rules = { ladder: () => 'DERIVED' };
  const a = etats({ stage: 'PERSISTED' }, observation(), rules);
  const b = etats({ stage: 'PERSISTED' }, observation(), rules);
  assert.deepEqual(a, b);
});

test('machine cannot infer narrative relevance from model output', () => {
  const result = etats({}, observation({ text: 'this should not become authority' }), {
    ladder: () => 'NARRATIVELY_RELEVANT',
  });
  assert.equal(result.decisions.prompt_eligible, true);
  assert.equal(result.derived.signal.source, 'FM_EVT');
  assert.equal(result.state.text, 'this should not become authority');
  // The state transition itself contains no model-score field and does not call a model.
  assert.equal(Object.hasOwn(result, 'creative_score'), false);
});

test('purity contract is explicit and side effects are disabled', () => {
  assert.deepEqual(pureContract, {
    imports_io: false,
    imports_falsifyme: false,
    imports_doki_runtime: false,
    imports_llm: false,
    mutates_input: false,
    persists: false,
  });
});
