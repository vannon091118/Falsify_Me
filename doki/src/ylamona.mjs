// Pure anomaly predicates. The existing DOKI anomalies table is the later
// persistence target; this module performs no database work.

export const ANOMALY_KINDS = Object.freeze([
  'NO_MATCH',
  'DELTA_ANOMALY',
]);

export function ylamona({ delta, threshold, evidenceRefs = [] } = {}) {
  const numeric = Number(delta);
  const limit = Number(threshold);
  if (!Number.isFinite(numeric) || !Number.isFinite(limit)) return null;
  if (Math.abs(numeric) < Math.abs(limit)) return null;
  if (evidenceRefs.length > 0) return null;
  return Object.freeze({
    kind: 'DELTA_ANOMALY',
    detail: JSON.stringify({ delta: numeric, threshold: limit, evidence_refs: [] }),
  });
}

export function noMatchAnomaly(candidateCount) {
  if (Number(candidateCount) !== 0) return null;
  return Object.freeze({ kind: 'NO_MATCH', detail: 'no candidate passed the recall gate' });
}

export function shouldRetire({ anomalyRuns = [], maxAnomalies, windowRuns } = {}) {
  const anomalies = anomalyRuns.slice(-Math.max(0, Number(windowRuns) || 0)).length;
  const limit = Number(maxAnomalies);
  const window = Number(windowRuns);
  return Number.isFinite(limit) && Number.isFinite(window) && window > 0 && anomalies >= limit;
}
