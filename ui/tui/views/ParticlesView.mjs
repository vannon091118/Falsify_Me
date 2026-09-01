// FalsifyMe TUI - Views: Partikel-Aktivitaetsflaeche (THINKING-Ansicht)
// Verantwortung: Partikel-Zellen als Zeilen zeichnen + Statuszeile + ggf.
// Overlay (ERROR/ABORTING/ABORTED/SUCCESS). Stateless.
import React from "react";
import { Box, Text } from "ink";
import { truncate, strWidth } from "../wcwidth.mjs";

const h = React.createElement;

// Partikel-Zellen -> Zeilen: { text, dimOnly, __cell }. Zeilen mit echten
// Aktivitaets-Labels (dim=false) werden hell gezeichnet - generische
// Fragmente bleiben dezent grau.
export const renderCells = (cells, cols) => {
  if (!cells || cells.length === 0) return [];
  const rows = cells.length;
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row = cells[r] ?? [];
    let text = "";
    let hasLabel = false;
    for (let c = 0; c < cols; c++) {
      const cell = row[c];
      text += cell ? cell.ch : " ";
      if (cell && !cell.dim) hasLabel = true;
    }
    out[r] = { text: truncate(text, Math.max(0, cols), ""), dimOnly: !hasLabel, __cell: true };
  }
  return out;
};

// Overlay (zentrierte Box-Zeilen) in die Zellzeilen einbetten.
export const mergeOverlay = (cellLines, overlayLines, rows) => {
  const merged = cellLines.map((l) => l);
  if (!overlayLines || overlayLines.length === 0) return merged;
  const start = Math.max(0, Math.floor((rows - overlayLines.length) / 2));
  overlayLines.forEach((ol, i) => {
    const r = start + i;
    if (r >= 0 && r < merged.length) merged[r] = ol;
  });
  return merged;
};

const statusLineOf = (snap) => {
  const dot = snap.active ? "●" : "○";
  return `${dot} ${dot} ${dot}  ${snap.stateLabel}  ${dot} ${dot} ${dot}`;
};

const padCenter = (s, cols) => {
  const w = strWidth(s);
  if (w >= cols) return truncate(s, cols, "…");
  const left = Math.floor((cols - w) / 2);
  return " ".repeat(left) + s;
};

const renderLine = (key, line) => {
  if (line && line.__overlay) {
    return h(Text, { key, color: line.color }, line.text);
  }
  return h(Text, { key, color: line?.dimOnly ? "gray" : "white" }, line?.text ?? "");
};

export const renderParticleFrame = (cells, cols, rows, overlayLines, stateColor, statusText, now) => {
  const cellRows = rows - 1; // letzte Zeile = Statuszeile
  const cellLines = renderCells(cells, cols).slice(0, cellRows);
  const merged = mergeOverlay(cellLines, overlayLines, cellRows);
  const els = [];
  for (let r = 0; r < merged.length; r++) els.push(renderLine(r, merged[r]));
  els.push(h(Text, { key: "status", color: stateColor }, padCenter(statusText, cols)));
  return els;
};

export default function ParticlesView({ snap, cols, rows }) {
  const overlay = snap.overlay;
  const overlayLines = overlay
    ? overlay.lines.map((t) => ({ text: t, color: overlay.color, __overlay: true }))
    : null;
  const els = renderParticleFrame(
    snap.particles?.cells,
    cols,
    rows,
    overlayLines,
    snap.stateColor,
    statusLineOf(snap),
    snap.now,
  );
  return h(Box, { flexDirection: "column", width: cols, height: rows }, ...els);
}