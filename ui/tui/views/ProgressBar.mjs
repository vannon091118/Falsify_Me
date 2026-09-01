// FalsifyMe TUI - Views: Fortschrittsbalken
// Verantwortung: determinate Bar NUR aus echten Werten, sonst indeterminierter
// Sweep. KEINE Fake-Prozente - es wird nie "63%" gezeigt, wenn das Backend
// keinen numerischen Fortschritt kennt. Stateless.
import React from "react";
import { Text } from "ink";
import { padEnd, truncate, strWidth } from "../wcwidth.mjs";

const h = React.createElement;
const SWEEP_LEN = 8;

export default function ProgressBar({ activePhase, cols, now }) {
  const label = truncate(padEnd(activePhase?.phase ?? "PROCESSING", 10), 10, "…");
  const barCols = Math.max(4, cols - strWidth(label) - 3);

  let bar;
  let indeterminate = true;
  if (activePhase && typeof activePhase.progress === "number" && activePhase.progress > 0 && activePhase.progress < 1) {
    indeterminate = false;
    const n = Math.round(activePhase.progress * barCols);
    bar = "█".repeat(n) + "░".repeat(barCols - n);
  } else {
    const pos = Math.floor((now / 650) % (barCols + SWEEP_LEN)) - SWEEP_LEN;
    const chars = [];
    for (let i = 0; i < barCols; i++) {
      chars.push(i >= pos && i < pos + SWEEP_LEN ? "█" : "░");
    }
    bar = chars.join("");
  }

  return h(Text, null, `${label} ${bar}${indeterminate ? " PROCESSING" : ""}`);
}