// FalsifyMe TUI - Views: PhaseIndicator
// Verantwortung: AAA-State/Phase-Leiste aus dem echten Snapshot.
// Stateless: keine eigene Historie, keine Demo-Daten.
import React from "react";
import { Box, Text } from "ink";
import { COLORS, activeGradient, activeGlyph, processStepColor } from "../visuals.mjs";
const h = React.createElement;

const ORDER = ["IDLE", "STARTING", "LOADING", "CLAIMING", "THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERIFYING", "VERDICT", "SUCCESS", "ERROR", "TIMEOUT", "ABORTING", "ABORTED"];
const phaseMap = Object.freeze({
  PREP: ["STARTING", "LOADING", "CLAIMING"],
  REASON: ["THINKING", "TOOL_ACTIVITY", "FINDINGS"],
  ATTACK: ["VERIFYING"],
  END: ["VERDICT", "SUCCESS", "ERROR", "TIMEOUT", "ABORTING", "ABORTED"],
});
const activeStates = new Set(["STARTING", "LOADING", "CLAIMING", "THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERIFYING", "ABORTING"]);
const terminalStates = new Set(["SUCCESS", "ERROR", "TIMEOUT", "ABORTED", "VERDICT"]);
const pulseOn = (now, speed = 280) => Math.floor(Number(now || 0) / speed) % 2 === 0;

const phaseIndex = (current, states) => {
  const i = states.indexOf(current);
  return i >= 0 ? i : -1;
};

const statusFor = (current, states, phaseName, now) => {
  const currentIndex = ORDER.indexOf(current);
  const indexes = states.map((s) => ORDER.indexOf(s)).filter((n) => n >= 0);
  const start = Math.min(...indexes);
  const end = Math.max(...indexes);
  const active = states.includes(current);
  if (active) return { icon: activeGlyph(now), color: processStepColor({ index: phaseIndex(current, states), activeIndex: phaseIndex(current, states), animated: true, now }), bold: true, active: true };
  if (currentIndex < start) return { icon: "○", color: COLORS.subtle, bold: false, active: false };
  if (currentIndex > end || (phaseName === "REASON" && current === "VERIFYING")) return { icon: "✓", color: COLORS.active, bold: false, active: false };
  if (terminalStates.has(current) && phaseName === "END") return { icon: "✓", color: current === "SUCCESS" || current === "VERDICT" ? COLORS.active : COLORS.error, bold: true, active: false };
  return { icon: "·", color: COLORS.error, bold: false, active: false };
};

const processRail = (current, now, width) => {
  const phases = Object.entries(phaseMap);
  const currentPhase = phases.findIndex(([, states]) => states.includes(current));
  const count = Math.max(4, Math.min(36, width));
  return Array.from({ length: count }, (_, i) => {
    const phaseIndexAtCell = Math.min(phases.length - 1, Math.floor((i / count) * phases.length));
    const state = phases[phaseIndexAtCell][1];
    const local = phaseIndex(current, state);
    const active = phaseIndexAtCell === currentPhase;
    return processStepColor({
      index: local < 0 ? (phaseIndexAtCell < currentPhase ? 0 : 2) : local,
      activeIndex: local < 0 ? (phaseIndexAtCell < currentPhase ? 0 : -1) : local,
      animated: active,
      now,
    });
  });
};

export default function PhaseIndicator({ snap, cols }) {
  const current = String(snap.state ?? "IDLE");
  const stateColor = current === "VERIFYING" ? COLORS.error : snap.stateColor ?? COLORS.primary;
  const live = activeStates.has(current);
  const stateLabel = snap.stateLabel ?? current;
  const locus = current === "VERIFYING" ? " · EVIL TWIN ACTIVE" : snap.model?.who === "twin" ? " · EVIL TWIN" : " · THINKER";
  const rail = processRail(current, snap.now, Math.max(12, cols - 4));

  return h(Box, { flexDirection: "column", width: cols, height: 2 },
    h(Box, { width: cols },
      ...Object.entries(phaseMap).flatMap(([name, states], i) => {
        const p = statusFor(current, states, name, snap.now);
        return [
          h(Text, { key: name, color: p.color, bold: p.bold, dimColor: !p.active }, `${p.icon} ${name}`),
          i < 3 ? h(Text, { key: `${name}-sep`, color: COLORS.subtle, dimColor: true }, "  →  ") : null,
        ].filter(Boolean);
      }),
    ),
    h(Box, { width: cols },
      h(Text, { color: stateColor, bold: true }, `STATE ${live ? activeGlyph(snap.now) : current === "SUCCESS" || current === "VERDICT" ? "✓" : current === "ERROR" || current === "TIMEOUT" || current === "ABORTED" ? "!" : "●"} ${stateLabel}${locus}`),
      live && pulseOn(snap.now) ? h(Text, { color: stateColor, bold: true }, "  ACTIVE") : null,
      ...rail.map((color, i) => h(Text, { key: `rail-${i}`, color, dimColor: !live }, "━")),
    ),
  );
}
