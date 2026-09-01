// FalsifyMe TUI - Views: Maschinen-Boot-Intro
// Verantwortung: Visualisierung NUR des STARTING-Zustands (build -> condense),
// danach sofort Live-UI. Partikel laufen ohne Bruch in die Activity-Animation
// (gleiche snap.particles-Zellen). Stateless.
import React from "react";
import { Box, Text } from "ink";
import { fill, truncate, padEnd } from "../wcwidth.mjs";
import { WORD, BLOCK_ROWS, particlesVisible } from "../boot.mjs";
import { renderCells, mergeOverlay } from "./ParticlesView.mjs";

const h = React.createElement;

export default function BootView({ snap, cols, rows }) {
  const b = snap.boot;
  const inner = cols - 2;
  const cellRows = rows;
  const cellLines = renderCells(snap.particles?.cells, cols).slice(0, cellRows);

  const word = WORD.split("")
    .map((ch, i) => (i < b.chars ? ch : "·"))
    .join(" ");

  // Selftest-Checklist (Spec §6): echte Step-Ergebnisse (✓/→/✕) vom
  // Worker, nie künstlich. steps kommt nur aus echten selftest-Events.
  const steps = Array.isArray(snap.testSteps) ? snap.testSteps : [];
  const result = snap.testResult ?? null;
  const selftestLines = [];
  if (steps.length || result) {
    selftestLines.push({ text: padEnd("SELF-TEST", inner), color: "gray", __overlay: true });
    for (const s of steps) {
      const icon = s.ok === true ? "✓" : s.ok === false ? "✕" : "→";
      const color = s.ok === true ? "green" : s.ok === false ? "red" : "yellow";
      const detail = s.detail ? ` (${s.detail})` : "";
      selftestLines.push({ text: padEnd(` ${icon} ${s.name}${detail}`, inner), color, __overlay: true });
    }
    if (result === "pass") {
      selftestLines.push({ text: padEnd(" SELFTEST PASS", inner), color: "green", __overlay: true });
    } else if (result === "fail") {
      selftestLines.push({ text: padEnd(" SELFTEST FAILED", inner), color: "red", __overlay: true });
    }
  } else if (snap.testStatus) {
    // Kompatibilität: nur ein Status-String, keine Steps.
    selftestLines.push({ text: padEnd(`SELFTEST  ${snap.testStatus}`, inner), color: "cyan", __overlay: true });
  }

  const overlayLines = [];
  if (b.mode === "build") {
    overlayLines.push({ text: padEnd(word, inner), color: "white", __overlay: true });
    overlayLines.push({ text: padEnd(BLOCK_ROWS[b.block], inner), color: "cyan", __overlay: true });
    overlayLines.push({ text: padEnd(result === "fail" ? "FAILED" : "ACTIVATING", inner), color: result === "fail" ? "red" : "yellow", __overlay: true });
    overlayLines.push({ text: padEnd("● ● ●", inner), color: "yellow", __overlay: true });
    for (const l of selftestLines) overlayLines.push(l);
  } else if (b.mode === "condense") {
    overlayLines.push({ text: truncate(word, inner), color: "white", __overlay: true });
    overlayLines.push({ text: fill("━", Math.min(inner, 26)), color: "gray", __overlay: true });
    overlayLines.push({ text: padEnd(snap.stateLabel, inner), color: snap.stateColor, __overlay: true });
    overlayLines.push({ text: fill("━", Math.min(inner, 26)), color: "gray", __overlay: true });
    for (const l of selftestLines) overlayLines.push(l);
  } else if (b.mode === "live") {
    // Live: Selftest-Checklist bleibt sichtbar, bis der erste Job die
    // Live-UI übernimmt (Spec §6: PASS → READY → JOB ARRIVES).
    for (const l of selftestLines) overlayLines.push(l);
  }

  const showParticles = particlesVisible(b);
  const base = showParticles
    ? cellLines
    : cellLines.map(() => ({ text: "", dimOnly: true, __cell: true }));
  const merged = mergeOverlay(base, overlayLines.length ? overlayLines : null, cellRows);

  const rowsEl = [];
  for (let r = 0; r < merged.length; r++) {
    const line = merged[r];
    if (line && line.__overlay) {
      rowsEl.push(h(Text, { key: r, color: line.color }, line.text));
    } else {
      rowsEl.push(h(Text, { key: r, color: line?.dimOnly ? "gray" : "white" }, line?.text ?? ""));
    }
  }

  return h(Box, { flexDirection: "column", width: cols, height: rows }, ...rowsEl);
}