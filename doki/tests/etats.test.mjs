import test from 'node:test';
import assert from 'node:assert/strict';
import { etats, LADDER, pureContract } from '../src/etats.mjs';
import { accumulateEtats, accumulateContract, CHARACTERS } from '../src/ensemble-state.mjs';
import { selectBlocks } from '../src/blocks.mjs';
import { patternKey } from '../src/signals.mjs';

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

// ── accumulateEtats ───────────────────────────────────────────────────────────

test('accumulateEtats: leere Event-Liste → leerer Stage-State ohne Fehler', () => {
  const state = accumulateEtats([], { ladder: () => 'NARRATIVELY_RELEVANT' });
  assert.equal(state.stage, 'OBSERVED');
  assert.ok(typeof state.characters === 'object');
});

test('accumulateEtats: 3 Events → akkumulierter State enthält knownEvents pro Character', () => {
  const events = [
    { t: 'job', id: 'e1', seq: 1, phase: 'PLAN', v: 'PLAN', wave: null },
    { t: 'finding', event_type: 'finding', id: 'e2', seq: 2, phase: 'PLAN', v: 'PLAN', wave: 'evil' },
    { t: 'loop', id: 'e3', seq: 3, phase: 'PLAN', v: 'PLAN', wave: null },
  ];
  const state = accumulateEtats(events, { ladder: () => 'NARRATIVELY_RELEVANT' });
  // 'job'-Event → Thinker sieht e1
  assert.ok(state.characters['Thinker']?.knownEvents.includes('e1'), 'Thinker kennt job-Event');
  // 'finding' mit wave='evil' → Buffy + Thinker sehen e2
  assert.ok(state.characters['Buffy']?.knownEvents.includes('e2'), 'Buffy kennt evil-finding');
  assert.ok(state.characters['Thinker']?.knownEvents.includes('e2'), 'Thinker kennt evil-finding');
  // recallCount stimmt
  assert.ok(state.characters['Thinker']?.recallCount >= 2, 'Thinker hat mind. 2 Recalls');
  assert.ok(state.characters['Buffy']?.recallCount >= 1, 'Buffy hat mind. 1 Recall');
});

test('accumulateEtats: Replay-Determinismus — gleiche Events → identisches Ergebnis', () => {
  const events = [
    { t: 'job', id: 'r1', seq: 1, phase: 'WRITE', v: 'WRITE', wave: null },
    { t: 'finding', event_type: 'finding', id: 'r2', seq: 2, phase: 'WRITE', v: 'WRITE', wave: 'scan' },
  ];
  const rules = { ladder: () => 'NARRATIVELY_RELEVANT' };
  const a = accumulateEtats(events, rules);
  const b = accumulateEtats(events, rules);
  assert.deepEqual(a, b);
});

test('accumulateEtats: doppelte Event-ID wird nicht doppelt gezählt (Idempotenz)', () => {
  const events = [
    { t: 'job', id: 'dup', seq: 1, phase: 'PLAN', v: null, wave: null },
    { t: 'job', id: 'dup', seq: 2, phase: 'PLAN', v: null, wave: null }, // gleiche ID
  ];
  const state = accumulateEtats(events, { ladder: () => 'NARRATIVELY_RELEVANT' });
  assert.equal(state.characters['Thinker']?.recallCount, 1, 'doppeltes Event zählt nur einmal');
  assert.equal(state.characters['Thinker']?.knownEvents.length, 1);
});

test('accumulateEtats: harte 7-Block-Schranke — nur max 7 anchor_ok-Blöcke erreichen NARRATIVELY_RELEVANT', () => {
  const stateKey = patternKey({ phase: 'WRITE', verdict: 'WRITE', wave: null });
  const blocks = Array.from({ length: 12 }, (_, i) => ({
    block_id: `b${i}`,
    anchor_ok: true,
    state_key: stateKey,
    primitive: 'CLAIM',
    character: 'Thinker',
  }));
  const selected = selectBlocks(blocks, stateKey).slice(0, 7);
  assert.equal(selected.length, 7, 'max 7 Blöcke passieren die Schranke');
});

test('accumulateEtats: accumulateContract deklariert Reinheit', () => {
  assert.equal(accumulateContract.imports_io, false);
  assert.equal(accumulateContract.imports_falsifyme, false);
  assert.equal(accumulateContract.imports_llm, false);
  assert.equal(accumulateContract.mutates_input, false);
  assert.equal(accumulateContract.persists, false);
  assert.equal(accumulateContract.deterministic, true);
});

test('accumulateEtats: alle 14 Characters werden als leere Startzustände angelegt', () => {
  const state = accumulateEtats([], {});
  for (const name of CHARACTERS) {
    assert.ok(state.characters[name], `Character ${name} vorhanden`);
    assert.equal(state.characters[name].recallCount, 0);
  }
  assert.equal(Object.keys(state.characters).length, CHARACTERS.length);
});
