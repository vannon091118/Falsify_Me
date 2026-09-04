// FalsifyMe TUI - Views: OUTPUT-Ansicht (t-Toggle „Thinking sichtbar machen“)
// Verantwortung: die ROH-Zeilen des LLM/der Pipeline sichtbar machen (statt
// Partikel-Animation). Neueste Zeile unten; begrenzt auf den Ring-Inhalt.
// Stateless: rendert nur snap; KEIN State/KEIN Parsing.
import React from "react";
import { Box, Text } from "ink";
import { truncate, strWidth } from "../wcwidth.mjs";

const h = React.createElement;

// Wrappt eine Roh-Zeile an Wortgrenzen auf maxWidth DISPLAY-Spalten statt
// sie mit "…" abzuschneiden (UI-XXX 2026-09-04): NVIDIA/LLM-Reasoning
// kommt als Scrolltext ohne Newlines; die Ring-Zeile ist dann breiter als
// das Dock. Truncate zeigte nur den Zeilenanfang (statisch wirkende
// Verlaufs-Fragmente). Jetzt wird pro verfügbarer Anzeige-Spalte sauber
// umgebrochen — der Verlauf bleibt lesbar, nichts wird abgeschnitten.
// Reine Darstellung: der Ring (State) bleibt die vollständige Wahrheit.
function wrapLineToWidth(text, maxWidth) {
  const s = String(text ?? "");
  if (maxWidth <= 0 || strWidth(s) <= maxWidth) return [s];
  const out = [];
  let line = "";
  let lineW = 0;
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const w = strWidth(word);
    if (line && lineW + 1 + w > maxWidth) {
      out.push(line);
      line = "";
      lineW = 0;
    }
    // Ein einzelnes Wort breiter als die Zeile: hart schneiden (Zeile
    // bleibt sonst endlos — UI-Sicherheit).
    if (w > maxWidth) {
      let rest = word;
      while (strWidth(rest) > maxWidth) {
        const cut = truncate(rest, maxWidth, "");
        if (!cut) break;
        out.push(cut);
        rest = rest.slice(cut.length);
      }
      line = rest;
      lineW = strWidth(rest);
      continue;
    }
    line = line ? line + " " + word : word;
    lineW += line ? 1 + w : w;
  }
  if (line) out.push(line);
  return out.length ? out : [s];
}

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
  // Erst umbrechen, DANN die Anzeige-Kappung anwenden: eine breite
  // Ring-Zeile belegt mehrere Anzeige-Zeilen, der Verlauf muss die
  // NEUESTEN Zeilen zeigen (das Ende des Scrolls), nicht die ältesten
  // Fragmente einer langen Zeile.
  const avail = Math.max(1, inner - 2);
  const body = [];
  if (lines.length === 0) {
    body.push("  – noch kein Output –");
  } else {
    for (const line of lines) {
      for (const frag of wrapLineToWidth(String(line), avail)) body.push(frag);
    }
  }
  const out = [h(Text, { key: "h", bold: true, color: "cyan" }, header)];
  for (const s of statusLines) out.push(h(Text, { key: `s${out.length}`, color: s.color, bold: s.bold }, s.text.slice(0, Math.max(0, inner))));
  // Kopf/Status sind fix (oben); nur der BODY scrollt (unten neueste Zeile).
  const fixedRows = out.length;
  const bodyBudget = Math.max(0, rows - fixedRows);
  const visibleBody = body.slice(-bodyBudget);
  visibleBody.forEach((frag, i) => {
    const isLast = i === visibleBody.length - 1;
    out.push(h(Text, { key: `l${i}`, color: isLast ? "white" : "gray" }, `  ${frag}`));
  });
  // Kopf/Status/Body sind oben fix bzw. gesliced — fehlende Zeilen auffüllen.
  while (out.length < rows) out.push(h(Text, { key: `f${out.length}`, color: "gray" }, ""));
  const rowsEl = [];
  for (let i = 0; i < rows; i++) {
    rowsEl.push(h(Box, { key: `row${i}`, width: cols }, out[i] ?? h(Text, { key: `e${i}`, color: "gray" }, "")));
  }
  return h(Box, { flexDirection: "column", width: cols, height: rows }, ...rowsEl);
}
