// Narrative blocks stay structured until prose generation. This module never
// grants recall from a creative score.

export const PRIMITIVES = Object.freeze([
  'CLAIM', 'CONTRADICTION', 'REVERSAL', 'DISCOVERY', 'RECALL',
  'TENSION', 'TRUST_SHIFT', 'STATUS_SHIFT', 'ADMISSION', 'UNRESOLVED_CONFLICT',
]);

export const BLOCK_SLOTS = Object.freeze([
  'setup', 'observation', 'reaction', 'contrast', 'callback',
  'escalation', 'punchline', 'closing',
]);

export function scoreBlock(block = {}, expectedStateKey = null) {
  const anchorOk = block.anchor_ok === true;
  const stateKeyMatch = expectedStateKey == null || block.state_key === expectedStateKey;
  const deterministicScore = anchorOk && stateKeyMatch ? 1 : 0;
  return Object.freeze({
    block_id: block.block_id ?? block.id ?? null,
    anchor_ok: anchorOk,
    state_key_match: stateKeyMatch,
    deterministic_score: deterministicScore,
    recall_eligible: deterministicScore === 1,
    creative_score: null,
  });
}

export function selectBlocks(blocks = [], expectedStateKey = null) {
  return blocks
    .map((block) => ({ block, score: scoreBlock(block, expectedStateKey) }))
    .filter(({ score }) => score.recall_eligible)
    .map(({ block, score }) => Object.freeze({ block, score }));
}

export function reactionContract({ actor, target, trigger, reaction, intensity, evidenceRefs = [], allowedModes = [], forbiddenModes = [] } = {}) {
  const numericIntensity = Number(intensity);
  if (!actor || !trigger || !reaction || !Number.isFinite(numericIntensity)) return null;
  return Object.freeze({
    actor: String(actor),
    target: target == null ? null : String(target),
    trigger: String(trigger),
    reaction: String(reaction),
    intensity: numericIntensity,
    evidence_refs: [...evidenceRefs],
    allowed_modes: [...allowedModes],
    forbidden_modes: [...forbiddenModes],
  });
}

export function primitivesFor(...primitives) {
  return Object.freeze(primitives.filter((primitive) => PRIMITIVES.includes(primitive)));
}
