import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreBlock, selectBlocks, reactionContract, primitivesFor } from '../src/blocks.mjs';
import { ylamona, noMatchAnomaly, shouldRetire } from '../src/ylamona.mjs';

test('creative score can never make an unanchored block recallable', () => {
  const result = scoreBlock({ block_id: 'b1', anchor_ok: false, state_key: 'PLAN|PLAN|1', creative_score: 1 }, 'PLAN|PLAN|1');
  assert.equal(result.deterministic_score, 0);
  assert.equal(result.recall_eligible, false);
  assert.equal(result.creative_score, null);
});

test('state-key and anchor are both required for recall', () => {
  const selected = selectBlocks([
    { block_id: 'ok', anchor_ok: true, state_key: 'PLAN|PLAN|1' },
    { block_id: 'wrong-state', anchor_ok: true, state_key: 'WRITE|WRITE|1' },
    { block_id: 'no-anchor', anchor_ok: false, state_key: 'PLAN|PLAN|1' },
  ], 'PLAN|PLAN|1');
  assert.deepEqual(selected.map(({ block }) => block.block_id), ['ok']);
});

test('reaction contract is structured before prose exists', () => {
  const contract = reactionContract({
    actor: 'Spark',
    target: 'Thinker',
    trigger: 'finding',
    reaction: 'skepticism',
    intensity: 0.42,
    evidenceRefs: ['finding-1'],
    allowedModes: ['humorous'],
    forbiddenModes: ['insult'],
  });
  assert.equal(contract.actor, 'Spark');
  assert.deepEqual(contract.evidence_refs, ['finding-1']);
  assert.deepEqual(contract.forbidden_modes, ['insult']);
});

test('primitive vocabulary cannot silently become prose', () => {
  assert.deepEqual(primitivesFor('DISCOVERY', 'NOT_A_PRIMITIVE', 'TRUST_SHIFT'), ['DISCOVERY', 'TRUST_SHIFT']);
});

test('delta anomaly requires a supplied threshold and has no evidence escape hatch', () => {
  assert.equal(ylamona({ delta: 0.8, threshold: 0.5, evidenceRefs: [] }).kind, 'DELTA_ANOMALY');
  assert.equal(ylamona({ delta: 0.8, threshold: 0.5, evidenceRefs: ['evt-1'] }), null);
});

test('NO_MATCH and retirement stay pure predicates', () => {
  assert.equal(noMatchAnomaly(0).kind, 'NO_MATCH');
  assert.equal(noMatchAnomaly(1), null);
  assert.equal(shouldRetire({ anomalyRuns: ['a', 'b', 'c'], maxAnomalies: 2, windowRuns: 3 }), true);
  assert.equal(shouldRetire({ anomalyRuns: ['a'], maxAnomalies: 2, windowRuns: 3 }), false);
});
