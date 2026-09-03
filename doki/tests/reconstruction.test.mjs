import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructTerminalEvent, reconstructTerminalEvents, RECONSTRUCTION_RULE_VERSION } from '../src/reconstruction.mjs';

function fixtureEvent(overrides = {}) {
  return {
    id: 'loop-001',
    job_id: 'job-001',
    scope_id: 'scope-001',
    handoff_id: null,
    change_digest: 'change-abc',
    event_type: 'terminal',
    from_state: 'RE_REVIEW_RUNNING',
    to_state: 'DONE',
    payload: JSON.stringify({ verdict: 'WRITE', source: 'falsifyme' }),
    created_at: '2026-09-03T10:00:00.000Z',
    ...overrides,
  };
}

function fixtureSnapshot(event = fixtureEvent()) {
  return {
    loop_event: event,
    job: {
      checkout_id: 'co-001', loop_state: event.to_state, status: 'DONE WRITE', verdict: 'WRITE',
      wave: 'replan', attempt: 2, loop_count: 1, max_loop_count: 5, parent_job_id: null,
      iteration_id: 'iter-001', review_iteration: 1, header_digest: 'header-abc',
      change_digest: 'change-abc', created_at: '2026-09-03T09:00:00.000Z',
      started_at: '2026-09-03T09:30:00.000Z', done_at: '2026-09-03T10:00:00.000Z',
    },
    scope: {
      header: 'Original user plan', phase: 'write', last_befund: 'No open conflict',
      open_conflicts: 0, last_divergence: null, research_additions: null, hardened_at: null,
    },
    project: { project_id: 'proj-001', created_at: '2026-09-03T08:00:00.000Z' },
    checkout: { project_id: 'proj-001', checkout_id: 'co-001', bound_root: '/repo', anchor_digest: 'anchor-abc' },
    findings: [
      { round: 2, wave: 'evil', mode: 'write', befund: 'Evil finding', verdict: 'WRITE' },
      { round: 1, wave: 'scan', mode: 'plan', befund: 'Scan finding', verdict: 'PLAN' },
    ],
  };
}

test('reconstructs only facts and deterministic projections from a terminal event', () => {
  const result = reconstructTerminalEvent(fixtureSnapshot());
  assert.equal(result.schema, 'doki.reconstruction/v1');
  assert.equal(result.facts.rule_version, RECONSTRUCTION_RULE_VERSION);
  assert.equal(result.facts.source, 'FalsifyMe.loop_events');
  assert.equal(result.event_id, 'loop-001');
  assert.deepEqual(result.facts.terminal, { is_terminal: true, terminal_state: 'DONE' });
  assert.deepEqual(result.facts.projections.wave_refs, ['scan', 'evil']);
  assert.deepEqual(result.facts.projections.verdict_refs, ['PLAN', 'WRITE']);
  assert.deepEqual(result.facts.findings.map((f) => f.round), [1, 2]);
});

test('same terminal source produces byte-equivalent digest and reconstruction', () => {
  const input = fixtureSnapshot();
  const a = reconstructTerminalEvent(input);
  const b = reconstructTerminalEvent(structuredClone(input));
  assert.deepEqual(a, b);
  assert.equal(a.facts_digest, b.facts_digest);
});

test('single-event reconstruction fails closed on non-terminal events', () => {
  const event = fixtureEvent({ to_state: 'WRITE_AUTHORIZED' });
  assert.throws(() => reconstructTerminalEvent(fixtureSnapshot(event)), /Nur Terminalereignisse/);
});

test('stream reconstruction skips non-terminal events deterministically', () => {
  const terminal = fixtureEvent({ id: 'loop-001', created_at: '2026-09-03T10:00:00.000Z', to_state: 'DONE' });
  const nonTerminal = fixtureEvent({ id: 'loop-000', created_at: '2026-09-03T09:00:00.000Z', to_state: 'WRITE_AUTHORIZED' });
  const snapshots = new Map([
    [terminal.id, fixtureSnapshot(terminal)],
    [nonTerminal.id, fixtureSnapshot(nonTerminal)],
  ]);
  const result = reconstructTerminalEvents([nonTerminal, terminal], snapshots);
  assert.deepEqual(result.event_refs, ['loop-001']);
  assert.equal(result.event_count, 1);
});

test('reconstructs an ordered terminal stream deterministically', () => {
  const first = fixtureEvent({ id: 'loop-002', created_at: '2026-09-03T10:01:00.000Z', to_state: 'ABORTED' });
  const second = fixtureEvent({ id: 'loop-001', created_at: '2026-09-03T10:00:00.000Z' });
  const snapshots = new Map([
    [first.id, fixtureSnapshot(first)],
    [second.id, fixtureSnapshot(second)],
  ]);
  const result = reconstructTerminalEvents([first, second], snapshots);
  assert.deepEqual(result.event_refs, ['loop-001', 'loop-002']);
  assert.equal(result.event_count, 2);
  assert.equal(result.run_digest, reconstructTerminalEvents([second, first], snapshots).run_digest);
});

test('invalid payload is preserved as source data, never interpreted', () => {
  const event = fixtureEvent({ payload: '{not-json}' });
  const result = reconstructTerminalEvent(fixtureSnapshot(event));
  assert.deepEqual(result.facts.source_event.payload, { _invalid_json: true, raw: '{not-json}' });
});
