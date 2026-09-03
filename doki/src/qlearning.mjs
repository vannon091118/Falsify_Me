import { DEFAULT_MAX_CALLS, DEFAULT_TOKEN_BUDGET } from './contracts.mjs';

export const ACTIONS = Object.freeze(['GREEN', 'RED']);

function keyOf(report) { return [report.phase, report.correlation_status, report.to_state].join('|'); }

export function chooseAction(db, report) {
  const stateKey = keyOf(report);
  const rows = db.prepare('SELECT action, q_value, visits FROM q_table WHERE state_key = ?').all(stateKey);
  const values = new Map(rows.map((r) => [r.action, Number(r.q_value)]));
  if (!values.has('GREEN')) values.set('GREEN', 0);
  if (!values.has('RED')) values.set('RED', 0);
  return { stateKey, action: values.get('RED') > values.get('GREEN') ? 'RED' : 'GREEN' };
}

export function updateQ(db, report, { reward = 0.0, action = 'GREEN', alpha = 0.25 } = {}) {
  const stateKey = keyOf(report);
  const now = new Date().toISOString();
  const current = db.prepare('SELECT q_value, visits FROM q_table WHERE state_key = ? AND action = ?').get(stateKey, action);
  const oldQ = Number(current?.q_value ?? 0);
  const nextQ = oldQ + alpha * (Number(reward) - oldQ);
  const visits = Number(current?.visits ?? 0) + 1;
  db.prepare(`INSERT INTO q_table(state_key, action, q_value, visits, source_event_id, updated_at)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(state_key, action) DO UPDATE SET q_value=excluded.q_value, visits=excluded.visits,
    source_event_id=excluded.source_event_id, updated_at=excluded.updated_at`).run(stateKey, action, nextQ, visits, report.loop_event_ref, now);
  return { stateKey, action, qValue: nextQ, visits, sourceEventId: report.loop_event_ref };
}

export function budgetDefaults(env = process.env) {
  return { maxCalls: Number(env.DOKI_MAX_CALLS || DEFAULT_MAX_CALLS), tokenBudget: Number(env.DOKI_TOKEN_BUDGET || DEFAULT_TOKEN_BUDGET) };
}
