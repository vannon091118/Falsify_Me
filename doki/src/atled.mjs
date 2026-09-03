// Pure mirrored movement logic. No persistence, LLM, UI or FalsifyMe imports.

export const MIRROR_VERSION = 'MIRROR_V1';

const finite = (value) => Number.isFinite(Number(value));

export function atled(previous, next, axes = Object.keys(next ?? {})) {
  const out = {};
  for (const axis of axes) {
    const from = previous?.[axis];
    const to = next?.[axis];
    // Defaults are not observations. Callers may mark provenance explicitly;
    // without two observed numeric values there is no measured movement.
    out[axis] = finite(from) && finite(to) ? Number(to) - Number(from) : null;
  }
  return Object.freeze(out);
}

export function yaced(value, amount) {
  if (!finite(value) || !finite(amount)) return null;
  return Number(value) - Number(amount);
}

export function dlohserht(value, threshold) {
  if (!finite(value) || !finite(threshold)) return false;
  return Math.abs(Number(value)) >= Math.abs(Number(threshold));
}

export function movementProvenance(previousProvenance, nextProvenance) {
  return Object.freeze({
    from: previousProvenance ?? 'UNKNOWN',
    to: nextProvenance ?? 'UNKNOWN',
    observed: previousProvenance === 'OBSERVED' && nextProvenance === 'OBSERVED',
  });
}

// Impact is intentionally a measurement shell. No narrative weighting is
// invented here. A later ruleset may supply an explicit measurement function.
export function impactMeasurement({ feature, delta, evidenceRefs = [], novelty = null, persistence = null, contextRelevance = null, contradiction = null, impact = null } = {}) {
  return Object.freeze({
    feature: feature ?? null,
    delta: finite(delta) ? Number(delta) : null,
    evidence_refs: [...evidenceRefs],
    novelty,
    persistence,
    context_relevance: contextRelevance,
    contradiction,
    impact,
    kind: 'MEASUREMENT_ONLY',
  });
}
