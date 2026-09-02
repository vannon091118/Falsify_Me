// FalsifyMe TUI - Views: OUTPUT-Ansicht (t-Toggle „Thinking sichtbar machen“)
// Verantwortung: die ROH-Zeilen des LLM/der Pipeline sichtbar machen (statt
// Partikel-Animation). Neueste Zeile unten; begrenzt auf den Ring-Inhalt.
// Stateless: rendert nur snap; KEIN State/KEIN Parsing.
import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../wcwidth.mjs";

const h = React.createElement;

export default function OutputView({ snap, cols, rows, withStatusHeader = false }) {
  const inner = cols - 2;
  const lines = snap.output ?? [];
  // Kompakt-Status (mitStatusHeader): WER denkt (Thinker/Twin + Modell) und
  // die Aktivitaet bleiben sichtbar, waehrend der Reasoning-Verlauf laeuft.
  const statusLines = [];
  if (withStatusHeader) {
    const m = snap.model;
    if (m) {
      const whoLabel = m.who === "twin" ? "EVIL TWIN (Gegenpruefung)" : "THINKER (Erstpruefung)";
      const modelId = m.who === "twin" ? (m.twin ?? "-") : (m.thinker ?? "-");
      statusLines.push({ text: ` ${whoLabel} · ${modelId}`, color: m.who === "twin" ? "red" : "blue", bold: true });
    }
    if (snap.activity?.label) statusLines.push({ text: ` ${snap.activity.label}`, color: "cyan" });
  }
  const header = ` THINKING-VERLAUF (${lines.length} Zeilen) · Taste t = Status `;
  const body = [];
  if (lines.length === 0) {
    body.push(h(Text, { key: "none", color: "gray" }, "  – noch kein Output –"));
  } else {
    const maxBody = Math.max(1, rows - 2);
    const visible = lines.slice(-maxBody);
    visible.forEach((line, i) => {
      const isLast = i === visible.length - 1;
      body.push(h(Text, { key: `l${i}`, color: isLast ? "white" : "gray" },
        `  ${truncate(String(line), inner - 2, "…")}`));
    });
  }
  const out = [h(Text, { key: "h", bold: true, color: "cyan" }, header)];
  for (const s of statusLines) out.push(h(Text, { key: `s${out.length}`, color: s.color, bold: s.bold }, s.text.slice(0, Math.max(0, inner))));
  for (const el of body) out.push(el);
  while (out.length < rows) out.push(h(Text, { key: `f${out.length}`, color: "gray" }, ""));
  const rowsEl = [];
  for (let i = 0; i < rows; i++) {
    rowsEl.push(h(Box, { key: `row${i}`, width: cols }, out[i] ?? h(Text, { key: `e${i}`, color: "gray" }, "")));
  }
  return h(Box, { flexDirection: "column", width: cols, height: rows }, ...rowsEl);
}
