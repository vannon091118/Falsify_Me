// Anker-Gate-Invarianten: kreativer Score rettet NIE, einmal je Muster,
// Reaktionsvertrag vor Prosa, NO_MATCH als Anomalie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreBlock, creativeScore, selectBlocks, reactionContract, contractDigest, PRIMITIVES, BLOCK_SLOTS, CREATIVE_CAP } from '../src/blocks.mjs';

const PK = 'p:PLAN|v:PLAN|w:scan';

test('Anker-Gate: ohne Evidenz-Referenz gibt es keinen Recall — kreativ rettet nichts', () => {
  const unanchored = { block_id: 'b1', slot: 'reaction', pattern_key: PK, evidence_refs: [] };
  const s = scoreBlock({ block: unanchored, patternKey: PK });
  assert.equal(s.anchor_ok, false);
  assert.equal(s.recall, false);
  // Selbst mit maximalem kreativem Score:
  const creative = creativeScore({ wit: 1, relevance: 1, grammar: 1 });
  assert.equal(creative.value, CREATIVE_CAP);
  const sel = selectBlocks({ candidates: [{ ...unanchored, creative }], patternKey: PK });
  assert.equal(sel.primary, null);
  assert.equal(sel.anomaly, 'NO_MATCH');
});

test('Anker-Gate: mit echter Evidenz wird recall-faehig; LLM-Output schreibt den Score nie', () => {
  const anchored = { block_id: 'b2', slot: 'observation', pattern_key: PK, evidence_refs: ['FM-EVT:f1'] };
  const s = scoreBlock({ block: anchored, patternKey: PK });
  assert.equal(s.anchor_ok, true);
  assert.equal(s.state_key_match, true);
  assert.equal(s.deterministic, 1);
  assert.equal(s.recall, true);
  // Struktur: scoreBlock hat keinen Parameterpfad fuer LLM-Output. Der
  // Funktionsquelltext nimmt kein Feld entgegen, das nach LLM/Prosa klingt.
  const src = String(scoreBlock);
  for (const w of ['creative', 'llm', 'model', 'prosa', 'text']) {
    assert.ok(!src.includes(w), `scoreBlock beruehrt LLM-Kanal-Feld ${w}`);
  }
});

test('Kreativ-Score ist Tiebreak unter verankerten Gleichen — nie ein Gate-Schlüssel', () => {
  const a = { block_id: 'a', slot: 'setup', pattern_key: PK, evidence_refs: ['E1'], creative: creativeScore({ wit: 0.1, relevance: 0.1, grammar: 0.1 }) };
  const b = { block_id: 'b', slot: 'setup', pattern_key: PK, evidence_refs: ['E2'], creative: creativeScore({ wit: 1, relevance: 1, grammar: 1 }) };
  const sel = selectBlocks({ candidates: [a, b], patternKey: PK });
  assert.equal(sel.primary.block_id, 'b', 'unter Gleichen gewinnt der kreativere');
  assert.equal(sel.primary.deterministic, 1, 'beide sind deterministisch gleich');
  assert.equal(sel.candidates.length, 1, 'Primary + Kandidaten');
});

test('Ein Block je Muster: bereits gesagtes Muster wird nicht wiederholt', () => {
  const c = { block_id: 'b2', slot: 'reaction', pattern_key: PK, evidence_refs: ['E1'] };
  const sel = selectBlocks({ candidates: [c], patternKey: PK, said: { [PK]: 1 } });
  assert.equal(sel.primary, null, 'gleiches Muster schon gesagt → kein zweites Mal');
  assert.equal(sel.anomaly, 'NO_MATCH');
});

test('Primitive- und Baustein-Vokabular sind fixiert (wie verabredet)', () => {
  assert.deepEqual([...PRIMITIVES], ['CLAIM', 'CONTRADICTION', 'REVERSAL', 'DISCOVERY', 'RECALL', 'TENSION', 'TRUST_SHIFT', 'STATUS_SHIFT', 'ADMISSION', 'UNRESOLVED_CONFLICT']);
  assert.deepEqual([...BLOCK_SLOTS], ['setup', 'observation', 'reaction', 'contrast', 'callback', 'escalation', 'punchline', 'closing']);
});

test('Reaktionsvertrag: feste Felder, verbotene Modi immer drin, Intensitaet aus Messung', () => {
  const c = reactionContract({
    actor: 'Buffy', target: 'Thinker', trigger: 'evil_twin_disagreement',
    impacts: [{ impact: 0.42, evidence_refs: ['finding-17'] }],
    catalog: { conflict_style: 'analytical', humor: 4, defensiveness: 6 },
  });
  assert.equal(c.actor, 'Buffy');
  assert.equal(c.trigger, 'evil_twin_disagreement');
  assert.equal(c.intensity, 0.42);
  assert.deepEqual(c.evidence_refs, ['finding-17']);
  assert.ok(c.allowed_modes.includes('dry'));
  assert.ok(c.allowed_modes.includes('skeptical'));
  assert.deepEqual([...c.forbidden_modes], ['rage', 'insult', 'obscene'], 'die „ich piss in dein hu“-Falle ist vertraglich verboten');
  assert.equal(c.authority, 'NONE');
  assert.equal(typeof contractDigest(c), 'string');
});

test('Reaktionsvertrag verlangt actor + trigger (kein anonymer Ausbruch)', () => {
  assert.throws(() => reactionContract({ trigger: 'x' }), /actor/);
  assert.throws(() => reactionContract({ actor: 'Buffy' }), /trigger/);
});
