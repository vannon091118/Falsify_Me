// FalsifyMe TUI - Verdict-Modell
// Verantwortung: Mapping Verdict-Codes -> Symbol/Farbe/Label + Zustands-Cue.
// Keine Entscheidung wird erfunden: nur echte Codes werden dargestellt.
// Pure, kein I/O.

export const MAP = Object.freeze({
  WRITE: { symbol: "✓", color: "green", label: "FALSIFICATION PASS", hint: "FREIGABE: READ-ONLY → WRITE" },
  PLAN: { symbol: "!", color: "yellow", label: "REVISION NEEDED", hint: "PLAN ÜBERARBEITEN" },
  RESEARCH: { symbol: "?", color: "blue", label: "MORE DATA NEEDED", hint: "READ-ONLY RECHERCHE" },
  ASK: { symbol: "?", color: "cyan", label: "TASK AMBIGUOUS", hint: "RÜCKFRAGE AN DEN USER" },
  ERROR: { symbol: "✕", color: "red", label: "FALSIFICATION FAILED", hint: "" },
  TIMEOUT: { symbol: "✕", color: "red", label: "FALSIFICATION FAILED", hint: "TIMEOUT" },
});

export const CODES = Object.keys(MAP);
export const PULSE_MS = 2200;

// Wendet ein echte Verdict an: setzt state.verdict und steuert den Zustands-Cue.
// Erlaubt aus jedem aktiven Zustand; setzt den UI-Zustand auf VERDICT.
export const applyTo = (state, code, now = Date.now()) => {
  const c = MAP[code] ? code : "ERROR";
  state.verdict = { code: c, at: now };
  state.state = "VERDICT";
  state.lastActivityAt = now;
  state.events?.push({ t: "verdict", v: c, ts: now });
  return true;
};

export const isPulsing = (state, now = Date.now()) => state.verdict !== null && now - state.verdict.at < PULSE_MS;

export const view = (state, now = Date.now()) => {
  if (state.verdict === null) return null;
  const meta = MAP[state.verdict.code] ?? MAP.ERROR;
  return {
    code: state.verdict.code,
    symbol: meta.symbol,
    color: meta.color,
    label: meta.label,
    hint: meta.hint,
    pulse: isPulsing(state, now),
  };
};