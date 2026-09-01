// FalsifyMe TUI - Findings-Modell
// Verantwortung: Zaehler (discovered/warning/critical), Puls-Zeitfenster.
// Mutationen nur ueber events.apply -> diese Helfer.
// Pure, kein I/O.

export const SEVERITIES = ["discovered", "warning", "critical"];
export const PULSE_MS = 1600;
export const ICONS = { discovered: "●", warning: "▲", critical: "!" };

export const fresh = () => ({ discovered: 0, warning: 0, critical: 0, lastAt: 0, lastSeverity: null });

export const reset = (state) => {
  state.findings = fresh();
};

export const bump = (state, severity, now = Date.now()) => {
  const sev = SEVERITIES.includes(severity) ? severity : "discovered";
  state.findings[sev] += 1;
  state.findings.lastAt = now;
  state.findings.lastSeverity = sev;
  state.lastActivityAt = now;
};

export const total = (state) => state.findings.discovered + state.findings.warning + state.findings.critical;

export const isPulsing = (state, now = Date.now()) => now - state.findings.lastAt < PULSE_MS;

export const countersView = (state, now = Date.now()) =>
  SEVERITIES.map((s) => ({
    severity: s,
    icon: ICONS[s],
    n: state.findings[s],
    pulse: state.findings.lastSeverity === s && now - state.findings.lastAt < PULSE_MS,
  }));