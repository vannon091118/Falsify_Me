export const TERMINAL_STATES = Object.freeze(['DONE', 'LOOP_BLOCKED', 'ABORTED', 'ERROR']);
export const ACTIVE_STATES = Object.freeze(['RUNNING', 'RE_REVIEW_RUNNING']);
export const MESSAGE_MODES = Object.freeze(['NARRATIVE', 'FACTUAL_FALLBACK', 'UNAVAILABLE']);
export const RENDER_PATHS = Object.freeze(['SMALL_MODEL', 'RESWITCH_THINKER_MODEL', 'FACTUAL_FALLBACK']);
export const CORRELATIONS = Object.freeze(['CONVERGENT', 'PERSPECTIVE_DIFFERENCE', 'DIVERGENCE', 'UNAVAILABLE']);
export const RUNTIME_VERSION = 'doki-runtime-v1';
export const DEFAULT_MAX_RESWITCH = 5;
export const DEFAULT_MAX_CALLS = 6;
export const DEFAULT_TOKEN_BUDGET = 1500;

// ── FalsifyMe-Vertrag (Contract SHA) ─────────────────────────────────────────
// DOKI ist gegen einen KONKRETEN FalsifyMe-Freeze-Commit gebaut. Der SHA ist
// der Kompatibilitätsanker: weicht der konfigurierte SHA ab, darf DOKI keine
// Interpretation auf unbekannter Struktur durchführen (CONTRACT_MISMATCH →
// mode=UNAVAILABLE). Der Default ist der SHA des FalsifyMe-Freeze-Stands, der
// die Schemas definiert hat, gegen die DOKI getestet wurde.
export const EXPECTED_FALSIFYME_CONTRACT_SHA = process.env.FALSIFYME_CONTRACT_SHA || '56d2fb7e0fa6c2101700b2616f0b02d4725615bf';

export function checkContract(env = process.env) {
  const configured = String(env.FALSIFYME_CONTRACT_SHA || '').trim();
  const effective = configured || EXPECTED_FALSIFYME_CONTRACT_SHA;
  if (effective !== EXPECTED_FALSIFYME_CONTRACT_SHA) {
    return { ok: false, reason: 'CONTRACT_MISMATCH', expected: EXPECTED_FALSIFYME_CONTRACT_SHA, configured: effective };
  }
  return { ok: true, sha: effective };
}
