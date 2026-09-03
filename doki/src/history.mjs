import { digestJson } from './hash.mjs';

export function buildHistory(db, snapshot) {
  const jobId = snapshot.loop_event.job_id;
  const rows = db.prepare(`SELECT loop_event_id, snapshot_json, snapshot_digest FROM observations
    WHERE job_id = ? ORDER BY rowid ASC`).all(jobId);
  const current = snapshot.loop_event;
  const late = rows.some((row) => {
    try {
      const created = JSON.parse(row.snapshot_json)?.loop_event?.created_at;
      return Number(created ? Date.parse(created) : 0) > Date.parse(current.created_at);
    } catch { return false; }
  });
  const refs = rows.map((row) => row.loop_event_id);
  const historyDigest = digestJson({ refs, late, current_id: current.id });
  return { refs, late, historyDigest };
}

export function correlation(snapshot) {
  const findings = snapshot.findings ?? [];
  const isEvil = (f) => f.wave === 'evil' || f.wave === 'evil-twin';
  const thinker = findings.filter((f) => !isEvil(f));
  const evil = findings.filter(isEvil);
  if (!thinker.length || !evil.length) return 'UNAVAILABLE';
  const t = new Set(thinker.map((f) => String(f.verdict ?? f.befund ?? '')));
  const e = new Set(evil.map((f) => String(f.verdict ?? f.befund ?? '')));
  const overlap = [...t].some((x) => e.has(x));
  if (overlap && t.size === 1 && e.size === 1) return 'CONVERGENT';
  if (overlap) return 'PERSPECTIVE_DIFFERENCE';
  return 'DIVERGENCE';
}
