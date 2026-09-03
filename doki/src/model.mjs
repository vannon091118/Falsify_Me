import { digestJson } from './hash.mjs';
import { ACTIVE_STATES, DEFAULT_MAX_RESWITCH } from './contracts.mjs';
import { waitForModelSlot } from './rate-limit.mjs';

function now() { return new Date().toISOString(); }

function apiConfig(env = process.env) {
  return {
    base: String(env.DOKI_API_BASE || '').replace(/\/$/, ''),
    key: String(env.DOKI_API_KEY || ''),
    greenModel: String(env.DOKI_GREEN_MODEL || ''),
    thinkerModel: String(env.DOKI_THINKER_MODEL || ''),
    timeoutMs: Number(env.DOKI_TIMEOUT_MS || 12000),
    maxCalls: Number(env.DOKI_MAX_CALLS || 6),
    tokenBudget: Number(env.DOKI_TOKEN_BUDGET || 1500),
  };
}

function activeThinkerRunExists(fdb) {
  const marks = ACTIVE_STATES.map(() => '?').join(', ');
  return Boolean(fdb.prepare(`SELECT 1 FROM jobs WHERE loop_state IN (${marks}) LIMIT 1`).get(...ACTIVE_STATES));
}

export function modelForAction(action, env = process.env) {
  const cfg = apiConfig(env);
  return action === 'RED' ? cfg.thinkerModel : cfg.greenModel;
}

export async function callModel(prompt, model, { env = process.env, shouldAbort = () => false } = {}) {
  const cfg = apiConfig(env);
  if (!cfg.base || !cfg.key || !model) throw new Error('DOKI API nicht konfiguriert');
  await waitForModelSlot({ env, shouldAbort });
  const controller = new AbortController();
  const abortPoll = setInterval(() => { if (shouldAbort()) controller.abort(new Error('DOKI-KILL-SWITCH')); }, 100);
  const timer = setTimeout(() => controller.abort(new Error('DOKI-TIMEOUT')), cfg.timeoutMs);
  try {
    const response = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 600, temperature: 0 }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json(); const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('LLM lieferte keine Message');
    return { text: text.trim(), model };
  } finally { clearTimeout(timer); clearInterval(abortPoll); }
}

export function resolveSwitches(decisions = []) {
  const reswitchCount = decisions.filter((decision) => decision === 'RED').length;
  const last = decisions.at(-1);
  if (reswitchCount > DEFAULT_MAX_RESWITCH) {
    return { action: 'FACTUAL_FALLBACK', reswitchCount: DEFAULT_MAX_RESWITCH };
  }
  return { action: last ?? 'FACTUAL_FALLBACK', reswitchCount };
}

export function config(env = process.env) { return apiConfig(env); }
export { activeThinkerRunExists };