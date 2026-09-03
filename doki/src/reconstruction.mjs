import { digestJson } from './hash.mjs';
import { TERMINAL_STATES } from './contracts.mjs';

export const RECONSTRUCTION_RULE_VERSION = 'doki-reconstruction-v1';

const asText = (value) => value == null ? null : String(value);

function parsePayload(value) {
  if (value == null || value === '') return null;
  try { return JSON.parse(value); }
  catch { return { _invalid_json: true, raw: String(value) }; }
}

// Canonical code-unit ordering. localeCompare() is locale/ICU-dependent and
// would make digests and reconstructions differ between runtimes; a plain
// code-unit comparison is deterministic everywhere.
const compareUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function stableFinding(finding) {
  return {
    round: Number(finding.round ?? 0),
    wave: asText(finding.wave),
    mode: asText(finding.mode),
    befund: asText(finding.befund),
    verdict: asText(finding.verdict),
  };
}

function stableFindings(findings) {
  return [...(findings ?? [])]
    .map(stableFinding)
    .sort((a, b) =>
      a.round - b.round
      || compareUnits(String(a.wave ?? ''), String(b.wave ?? ''))
      || compareUnits(String(a.mode ?? ''), String(b.mode ?? ''))
      || compareUnits(String(a.verdict ?? ''), String(b.verdict ?? ''))
      || compareUnits(String(a.befund ?? ''), String(b.befund ?? ''))
    );
}

function terminalProjection(event) {
  const toState = asText(event.to_state);
  return {
    is_terminal: TERMINAL_STATES.includes(toState),
    terminal_state: TERMINAL_STATES.includes(toState) ? toState : null,
  };
}

/**
 * Layer 1 reconstruction only.
 *
 * Input is the snapshot read directly from FalsifyMe's SQLite append-only
 * loop_events stream plus its referenced job/scope/findings records. The
 * output contains source facts and deterministic projections only. It does
 * not infer causes, emotions, beliefs, relationships, narrative intent, or
 * verdict authority.
 */
export function reconstructTerminalEvent(snapshot) {
  if (!snapshot?.loop_event?.id) throw new Error('Rekonstruktion benötigt loop_event.id');

  const event = snapshot.loop_event;
  const terminal = terminalProjection(event);
  if (!terminal.is_terminal) {
    throw new Error(`Nur Terminalereignisse sind rekonstruierbar: ${event.id} (${asText(event.to_state)})`);
  }
  const findings = stableFindings(snapshot.findings);
  const waves = [...new Set(findings.map((f) => f.wave).filter(Boolean))];
  const payload = typeof event.payload === 'string' ? parsePayload(event.payload) : (event.payload ?? null);

  const facts = {
    rule_version: RECONSTRUCTION_RULE_VERSION,
    source: 'FalsifyMe.loop_events',
    source_event: {
      id: asText(event.id),
      job_id: asText(event.job_id),
      scope_id: asText(event.scope_id),
      handoff_id: asText(event.handoff_id),
      change_digest: asText(event.change_digest),
      event_type: asText(event.event_type),
      from_state: asText(event.from_state),
      to_state: asText(event.to_state),
      payload,
      created_at: asText(event.created_at),
    },
    terminal,
    job: snapshot.job ? {
      checkout_id: asText(snapshot.job.checkout_id),
      loop_state: asText(snapshot.job.loop_state),
      status: asText(snapshot.job.status),
      verdict: asText(snapshot.job.verdict),
      wave: asText(snapshot.job.wave),
      attempt: Number(snapshot.job.attempt ?? 0),
      loop_count: Number(snapshot.job.loop_count ?? 0),
      max_loop_count: Number(snapshot.job.max_loop_count ?? 0),
      parent_job_id: asText(snapshot.job.parent_job_id),
      iteration_id: asText(snapshot.job.iteration_id),
      review_iteration: Number(snapshot.job.review_iteration ?? 0),
      header_digest: asText(snapshot.job.header_digest),
      change_digest: asText(snapshot.job.change_digest),
      created_at: asText(snapshot.job.created_at),
      started_at: asText(snapshot.job.started_at),
      done_at: asText(snapshot.job.done_at),
    } : null,
    scope: snapshot.scope ? {
      header: asText(snapshot.scope.header),
      phase: asText(snapshot.scope.phase),
      last_befund: asText(snapshot.scope.last_befund),
      open_conflicts: Number(snapshot.scope.open_conflicts ?? 0),
      last_divergence: asText(snapshot.scope.last_divergence),
      research_additions: asText(snapshot.scope.research_additions),
      hardened_at: asText(snapshot.scope.hardened_at),
    } : null,
    project: snapshot.project ? {
      project_id: asText(snapshot.project.project_id),
      created_at: asText(snapshot.project.created_at),
    } : null,
    checkout: snapshot.checkout ? {
      project_id: asText(snapshot.checkout.project_id),
      checkout_id: asText(snapshot.checkout.checkout_id),
      bound_root: asText(snapshot.checkout.bound_root),
      anchor_digest: asText(snapshot.checkout.anchor_digest),
    } : null,
    findings,
    projections: {
      wave_refs: waves,
      finding_count: findings.length,
      verdict_refs: [...new Set(findings.map((f) => f.verdict).filter(Boolean))],
      phase_refs: [...new Set(findings.map((f) => f.mode).filter(Boolean))],
    },
  };

  return {
    schema: 'doki.reconstruction/v1',
    event_id: event.id,
    facts,
    facts_digest: digestJson(facts),
  };
}

/** Reconstruct every terminal event from the real FalsifyMe event stream. */
export function reconstructTerminalEvents(events, snapshotById) {
  // Non-terminal stream members are not reconstructable evidence; skip them
  // deterministically so a mixed stream still yields a canonical run.
  const rows = [...events]
    .filter((event) => TERMINAL_STATES.includes(asText(event.to_state)))
    .sort((a, b) =>
      compareUnits(String(a.created_at ?? ''), String(b.created_at ?? ''))
      || compareUnits(String(a.id), String(b.id))
    );

  const items = rows.map((event) => {
    const snapshot = snapshotById?.get(event.id) ?? snapshotById?.[event.id];
    if (!snapshot) throw new Error(`Snapshot für Terminalereignis fehlt: ${event.id}`);
    return reconstructTerminalEvent(snapshot);
  });

  return {
    schema: 'doki.reconstruction-run/v1',
    rule_version: RECONSTRUCTION_RULE_VERSION,
    event_count: items.length,
    event_refs: items.map((item) => item.event_id),
    items,
    run_digest: digestJson({ rule_version: RECONSTRUCTION_RULE_VERSION, items }),
  };
}
