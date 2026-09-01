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

  const overlayLines = [];
  if (b.mode === "build") {
    overlayLines.push({ text: padEnd(word, inner), color: "white", __overlay: true });
    overlayLines.push({ text: padEnd(BLOCK_ROWS[b.block], inner), color: "cyan", __overlay: true });
    overlayLines.push({ text: padEnd("INITIALIZING", inner), color: "yellow", __overlay: true });
    overlayLines.push({ text: padEnd("● ● ●", inner), color: "yellow", __overlay: true });
  } else if (b.mode === "condense") {
    overlayLines.push({ text: truncate(word, inner), color: "white", __overlay: true });
    overlayLines.push({ text: fill("━", Math.min(inner, 26)), color: "gray", __overlay: true });
    overlayLines.push({ text: padEnd(snap.stateLabel, inner), color: snap.stateColor, __overlay: true });
    overlayLines.push({ text: fill("━", Math.min(inner, 26)), color: "gray", __overlay: true });
  } else if (b.mode === "live" && snap.testStatus) {
    // Selftest bleibt bewusst klein am unteren Rand des Intro-Fensters.
    overlayLines.push({ text: padEnd(`SELFTEST  ${snap.testStatus}`, inner), color: "gray", __overlay: true });
  }

  const showParticles = particlesVisible(b);
  const base = showParticles
    ? cellLines
    : cellLines.map(() => ({ text: "", dimOnly: true, __cell: true }));
  const merged = mergeOverlay(base, b.mode === "live" ? null : overlayLines, cellRows);

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