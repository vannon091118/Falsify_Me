import { digestJson } from './hash.mjs';

const MATCH_RULES = Object.freeze([
  ['FIX', /\b(fix|bug|hotfix|patch|repair|fehler|korr)\b/i],
  ['DOC', /\b(doku|archiv|changelog|readme|plan|comment|docs)\b/i],
  ['REFACTOR', /\b(restruktur|refactor|cleanup|aufr|umstruktur|moved|verschoben|modular|extract|dedupli)/i],
  ['BUILD', /\b(build|commitlayer|commit_layer|author\.system|hook|verifier|pipeline|doki)\b/i],
  ['TEST', /\btest\w*\b/i],
  ['MERGE', /^\s*merge\b/i],
]);

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

function strings(snapshot) {
  const findings = snapshot.findings ?? [];
  return [
    snapshot.loop_event?.event_type,
    snapshot.job?.verdict,
    snapshot.scope?.header,
    snapshot.scope?.last_befund,
    ...findings.flatMap((f) => [f.befund, f.content, f.verdict, f.wave]),
  ].filter((x) => typeof x === 'string');
}

export function narrativeAnalysis(snapshot) {
  const findings = snapshot.findings ?? [];
  const values = strings(snapshot);
  const matches = [];
  for (const [name, pattern] of MATCH_RULES) {
    const matched = values.filter((value) => pattern.test(value));
    if (matched.length) matches.push({ rule: `match.${name.toLowerCase()}.v1`, count: matched.length });
  }

  const verdictCounts = {};
  const waveCounts = {};
  for (const finding of findings) {
    const verdict = String(finding.verdict ?? 'UNKNOWN');
    const wave = String(finding.wave ?? 'UNKNOWN');
    verdictCounts[verdict] = (verdictCounts[verdict] ?? 0) + 1;
    waveCounts[wave] = (waveCounts[wave] ?? 0) + 1;
  }

  const stats = {
    finding_count: findings.length,
    verdict_counts: verdictCounts,
    wave_counts: waveCounts,
    history_event_refs: [],
    active_state: snapshot.job?.loop_state ?? snapshot.loop_event?.to_state ?? null,
    from_state: snapshot.loop_event?.from_state ?? null,
    to_state: snapshot.loop_event?.to_state ?? null,
    job_verdict: snapshot.job?.verdict ?? null,
    file_count: Array.isArray(snapshot.job?.files) ? snapshot.job.files.length : 0,
    correlation_inputs: { thinker_findings: findings.filter((f) => f.wave !== 'evil').length, evil_findings: findings.filter((f) => f.wave === 'evil').length },
  };

  return { stats, matches, tracked: { findings, job: snapshot.job ?? null, scope: snapshot.scope ?? null } };
}

export function correlation(snapshot) {
  const findings = snapshot.findings ?? [];
  const thinker = findings.filter((f) => f.wave !== 'evil');
  const evil = findings.filter((f) => f.wave === 'evil');
  if (!thinker.length || !evil.length) return 'UNAVAILABLE';
  const t = new Set(thinker.map((f) => String(f.verdict ?? f.befund ?? '')));
  const e = new Set(evil.map((f) => String(f.verdict ?? f.befund ?? '')));
  const overlap = [...t].some((x) => e.has(x));
  if (overlap && t.size === 1 && e.size === 1) return 'CONVERGENT';
  if (overlap) return 'PERSPECTIVE_DIFFERENCE';
  return 'DIVERGENCE';
}
