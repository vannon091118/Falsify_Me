// FalsifyMe TUI - Phasen-/Fortschrittsmodell
// Verantwortung: Phasenliste (PLAN/RESEARCH/WRITE/VERDICT), Status je Phase,
// determiniert/indeterminiert. Numerischer Fortschritt NUR aus echten Events.
// Pure, kein I/O.

export const PHASES = ["PLAN", "RESEARCH", "WRITE", "VERDICT"];
export const BAR_FILLED = "█";
export const BAR_EMPTY = "░";

export const createPhases = () => PHASES.map((phase) => ({ phase, status: "pending", progress: null }));

export const reset = (state) => {
  state.phases = createPhases();
};

const get = (state, phase) => state.phases.find((p) => p.phase === phase) ?? null;

export const setPhase = (state, phase, progress, now = Date.now()) => {
  const p = get(state, phase);
  if (!p) return false;
  // Nur EINE aktive Phase: andere laufende Phasen gehen zurueck auf pending
  // (done bleibt done - Abschluesse kommen nur von phase_done).
  for (const other of state.phases) {
    if (other !== p && other.status === "active") other.status = "pending";
  }
  p.status = "active";
  if (typeof progress === "number" && Number.isFinite(progress)) {
    p.progress = Math.min(1, Math.max(0, progress));
  }
  state.lastActivityAt = now;
  state.events?.push({ t: "phase", phase, progress: p.progress, ts: now });
  return true;
};

export const setPhaseDone = (state, phase, now = Date.now()) => {
  const p = get(state, phase);
  if (!p) return false;
  p.status = "done";
  p.progress = 1;
  state.lastActivityAt = now;
  state.events?.push({ t: "phase_done", phase, ts: now });
  return true;
};

export const activePhase = (state) => state.phases.find((p) => p.status === "active") ?? null;

export const isDeterminate = (entry) => entry !== null && typeof entry?.progress === "number" && entry.progress > 0 && entry.progress < 1;

export const statusIcon = (entry) => (entry.status === "done" ? "✓" : entry.status === "active" ? "▸" : "○");

export const phasesView = (state) =>
  state.phases.map((p) => ({
    phase: p.phase,
    status: p.status,
    progress: p.progress,
    icon: statusIcon(p),
    determinate: typeof p.progress === "number" && p.progress > 0 && p.progress < 1,
  }));

// Determinate Bar als String (nur wenn echte Zahlen vorliegen).
export const barText = (entry, cols) => {
  if (!entry || typeof entry.progress !== "number" || entry.status !== "active") return null;
  const n = Math.max(0, Math.min(cols, Math.round(entry.progress * cols)));
  return BAR_FILLED.repeat(n) + BAR_EMPTY.repeat(Math.max(0, cols - n));
};