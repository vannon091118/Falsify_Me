const DEFAULT_RPM = 40;
const MIN_DELAY_MS = 60_000 / DEFAULT_RPM;
let nextAllowedAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function rateLimitMs(env = process.env) {
  const rpm = Number(env.DOKI_RPM || DEFAULT_RPM);
  if (!Number.isFinite(rpm) || rpm <= 0) throw new Error('DOKI_RPM muss > 0 sein');
  return 60_000 / rpm;
}

export async function waitForModelSlot({ env = process.env, shouldAbort = () => false } = {}) {
  const delayMs = Math.max(MIN_DELAY_MS, rateLimitMs(env));
  const now = Date.now();
  const slot = Math.max(now, nextAllowedAt);
  nextAllowedAt = slot + delayMs;
  const waitMs = slot - now;
  if (waitMs <= 0) return;
  const deadline = Date.now() + waitMs;
  while (true) {
    if (shouldAbort()) throw new Error('DOKI-KILL-SWITCH');
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    await sleep(Math.min(remaining, 100));
  }
}

export function resetRateLimiter() {
  nextAllowedAt = 0;
}
