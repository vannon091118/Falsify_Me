import { ACTIVE_STATES } from './contracts.mjs';
import { waitForModelSlot } from './rate-limit.mjs';

function apiConfig(env = process.env) {
  return {
    base: String(env.DOKI_API_BASE || '').replace(/\/$/, ''),
    key: String(env.DOKI_THINKER_API_KEY || env.DOKI_API_KEY || ''),
    model: String(env.DOKI_THINKER_MODEL || ''),
    timeoutMs: Number(env.DOKI_TIMEOUT_MS || 12000),
    tokenBudget: Number(env.DOKI_TOKEN_BUDGET || 600),
  };
}

function activeThinkerRunExists(fdb) {
  const marks = ACTIVE_STATES.map(() => '?').join(', ');
  return Boolean(fdb.prepare(`SELECT 1 FROM jobs WHERE loop_state IN (${marks}) LIMIT 1`).get(...ACTIVE_STATES));
}

export async function callModel(prompt, { env = process.env, shouldAbort = () => false } = {}) {
  const cfg = apiConfig(env);
  if (!cfg.base || !cfg.key || !cfg.model) throw new Error('DOKI Thinker API nicht konfiguriert');
  await waitForModelSlot({ env, shouldAbort });
  const controller = new AbortController();
  const abortPoll = setInterval(() => { if (shouldAbort()) controller.abort(new Error('DOKI-KILL-SWITCH')); }, 100);
  const timer = setTimeout(() => controller.abort(new Error('DOKI-TIMEOUT')), cfg.timeoutMs);
  try {
    const response = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: cfg.tokenBudget,
        temperature: 0,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('LLM lieferte keine Message');
    return { text: text.trim(), model: cfg.model };
  } finally {
    clearTimeout(timer);
    clearInterval(abortPoll);
  }
}

export function config(env = process.env) { return apiConfig(env); }
export { activeThinkerRunExists };
