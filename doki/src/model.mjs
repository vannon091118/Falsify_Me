import { DEFAULT_MAX_RESWITCH } from './contracts.mjs';

function apiConfig(env = process.env) {
  return {
    base: String(env.DOKI_API_BASE || '').replace(/\/$/, ''), key: String(env.DOKI_API_KEY || ''),
    greenModel: String(env.DOKI_GREEN_MODEL || ''), thinkerModel: String(env.DOKI_THINKER_MODEL || ''),
    timeoutMs: Number(env.DOKI_TIMEOUT_MS || 12000),
  };
}

export async function callModel(prompt, model, env = process.env) {
  const cfg = apiConfig(env);
  if (!cfg.base || !cfg.key || !model) throw new Error('DOKI API nicht konfiguriert');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
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
  } finally { clearTimeout(timer); }
}

export function modelForAction(action, env = process.env) {
  const cfg = apiConfig(env); return action === 'RED' ? cfg.thinkerModel : cfg.greenModel;
}

export function resolveSwitches(decisions, { maxReswitch = DEFAULT_MAX_RESWITCH } = {}) {
  let count = 0; let selected = 'GREEN';
  for (const decision of decisions) {
    selected = decision === 'RED' ? 'RED' : 'GREEN';
    if (selected === 'RED') { if (count >= maxReswitch) return { action: 'FACTUAL_FALLBACK', reswitchCount: count }; count += 1; }
  }
  return { action: selected, reswitchCount: count };
}
