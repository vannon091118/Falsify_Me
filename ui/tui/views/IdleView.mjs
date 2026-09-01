// FalsifyMe TUI - Views: WARTE AUF EINGABE (kein Job aktiv)
// Verantwortung: fester, animierter Warte-Screen, wenn KEIN Slot beschaeftigt
// ist. Ehrlich: pulsiert, aber stellt keine Aktivitaet dar. Zeigt die
// 3 Fenster-Slots (FEN 1..3) des EINEN Terminal-Prozesses (pid).
// Stateless: reine Darstellung aus snap.
import React from "react";
import { Box, Text } from "ink";
import { strWidth, truncate } from "../wcwidth.mjs";

const h = React.createElement;

const padCenter = (s, cols) => {
  const w = strWidth(s);
  if (w >= cols) return truncate(s, cols, "…");
  return " ".repeat(Math.floor((cols - w) / 2)) + s;
};

const BREATH = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"];

// Slot-Status: Endzustaende ehrlich benennen, freie Slots BEREIT.
const slotStatus = (s) => {
  if (s.state === "SUCCESS") return "COMPLETE";
  if (s.state === "ABORTED") return "GESTOPPT";
  if (s.state === "ERROR") return "ERROR";
  if (s.state === "TIMEOUT") return "TIMEOUT";
  return "BEREIT";
};

// Slot-Zeile: FEN n · STATUS - jeder Slot mit eigener Farbe (wie FindingsPanel).
const slotLine = (slots, inner) => {
  const kids = [];
  slots.forEach((s, i) => {
    const label = slotStatus(s);
    const color =
      s.state === "SUCCESS" ? "green"
        : s.state === "ERROR" || s.state === "TIMEOUT" ? "red"
          : s.state === "ABORTED" ? "yellow"
            : "gray";
    kids.push(h(Text, { key: `f${i}`, color }, `FEN ${s.idx} · ${label}`));
    if (i < slots.length - 1) kids.push(h(Text, { key: `sp${i}`, color: "gray" }, "        "));
  });
  return h(Text, null, ...kids);
};

export default function IdleView({ snap, cols, rows }) {
  const inner = cols - 2;
  const t = snap.now / 420; // Animationsphase
  const wave = new Array(inner);
  for (let i = 0; i < inner; i++) {
    const k = Math.floor((t + i / Math.max(1, inner)) * 8) % BREATH.length;
    wave[i] = BREATH[(k + 4) % BREATH.length]; // Welle wandert dezent
  }
  const waveLine = wave.join("");

  const slots = snap.slots ?? [];
  const block = [
    { text: "WARTE AUF EINGABE", color: "yellow", bold: true },
    { text: waveLine, color: "gray" },
    { text: "KEIN JOB AKTIV · JOBS KOMMEN VON AGENTS/WORKER", color: "gray" },
    { text: "Q ODER STRG-C SCHLIESST DIESES BEOBACHTUNGSFENSTER", color: "gray" },
  ];

  const topPad = Math.max(0, Math.floor((rows - block.length - 2) / 2));
  const els = [];
  for (let r = 0; r < topPad; r++) els.push(h(Text, { key: `t${r}`, color: "gray" }, ""));
  for (const [i, line] of block.entries()) {
    const txt = padCenter(line.text, inner);
    if (line.bold) {
      els.push(h(Text, { key: `b${i}`, color: line.color, bold: true }, txt));
    } else {
      els.push(h(Text, { key: `b${i}`, color: line.color }, txt));
    }
  }
  const mid = Math.max(0, Math.floor((rows - els.length - 2) / 2));
  for (let r = 0; r < mid; r++) els.push(h(Text, { key: `m${r}`, color: "gray" }, ""));
  els.push(h(Box, { key: "slots", width: cols }, slotLine(slots, inner)));
  els.push(h(Text, { key: "hint", color: "gray" }, padCenter(`FREI: ${slots.filter((s) => s.state === "IDLE").length}/${slots.length || 3} FENSTER`, inner)));
  while (els.length < rows) els.push(h(Text, { key: `f${els.length}`, color: "gray" }, ""));

  return h(Box, { flexDirection: "column", width: cols, height: rows }, ...els);
}