// FalsifyMe TUI - Views: WARTE AUF EINGABE (kein Job aktiv)
// Verantwortung: fester, animierter Warte-Screen, wenn KEIN Slot beschaeftigt
// ist. Ehrlich: pulsiert, aber stellt keine Aktivitaet dar. Zeigt die
// 3 Fenster-Slots (FEN 1..3) des EINEN Terminal-Prozesses (pid) sowie eine
// kompakte, ECHTE Session-History ("LETZTE AKTIVITAET") aus abgeschlossenen
// Jobs und letzten Events - nie erfunden, leer wenn nichts passiert ist.
// Stateless: reine Darstellung aus snap.
import React from "react";
import { Box, Text } from "ink";
import { strWidth, truncate } from "../wcwidth.mjs";
import { shortId } from "../state.mjs";

const h = React.createElement;

const padCenter = (s, cols) => {
  const w = strWidth(s);
  if (w >= cols) return truncate(s, cols, "…");
  return " ".repeat(Math.floor((cols - w) / 2)) + s;
};

const BREATH = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"];

// Farbverlauf der Welle ueber die Breite: Gruen -> Cyan -> Blau -> Violett.
const WAVE_RAMP = ["#22c55e", "#10b981", "#06b6d4", "#3b82f6", "#6366f1", "#a855f7"];

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

// Ein strukturiertes Event kompakt als eine History-Zeile darstellen.
const eventLine = (e) => {
  switch (e?.t) {
    case "job":
      return `JOB ${shortId(e.id) || "?"}${e.window ? ` (FEN ${e.window})` : ""}`;
    case "state":
      return `STATUS → ${e.s}`;
    case "phase":
      return `PHASE ${e.phase}`;
    case "phase_done":
      return `PHASE ${e.phase} FERTIG`;
    case "activity":
      return `TOOL ${e.tool}${e.file != null ? ` (${String(e.file)})` : ""}`;
    case "finding":
      return `BEFUND · ${String(e.severity || "info").toUpperCase()}`;
    case "verdict":
      return `VERDICT ${e.v}`;
    case "done":
      return "JOB FERTIG";
    default:
      return null;
  }
};

// Echte abgeschlossene Jobs aus den Slots (Endzustaende, sichtbar bis ein
// neuer Job den Slot belegt) - ehrliche Session-Geschichte.
const historyFromSlots = (snap) =>
  (snap.slots ?? []).filter((s) => s.state !== "IDLE").map((s) => {
    const v = s.verdict?.code ? ` · ${s.verdict.code}` : "";
    return {
      text: `FEN ${s.idx} ${s.jobId ? shortId(s.jobId) : ""} · ${slotStatus(s)}${v}${s.files > 0 ? ` · ${s.files} DATEIEN` : ""}`.replace(/\s+/g, " ").trim(),
      color: s.state === "SUCCESS" ? "green" : s.state === "ERROR" || s.state === "TIMEOUT" ? "red" : s.state === "ABORTED" ? "yellow" : "gray",
    };
  });

export default function IdleView({ snap, cols, rows }) {
  const inner = cols - 2;
  const t = snap.now / 420; // Animationsphase
  const wave = new Array(inner);
  for (let i = 0; i < inner; i++) {
    const k = Math.floor((t + i / Math.max(1, inner)) * 8) % BREATH.length;
    wave[i] = BREATH[(k + 4) % BREATH.length]; // Welle wandert dezent
  }
  // Welle in Farbsegmenten mit Verlauf darstellen.
  const seg = Math.max(1, Math.floor(inner / WAVE_RAMP.length));
  const waveKids = [];
  for (let i = 0; i < inner; i += seg) {
    const part = wave.slice(i, i + seg).join("");
    if (!part) break;
    waveKids.push(h(Text, { key: `w${i}`, color: WAVE_RAMP[i / seg % WAVE_RAMP.length] }, part));
  }

  const slots = snap.slots ?? [];
  const labelPulse = Math.floor(snap.now / 700) % 2 === 0;
  const labelColor = labelPulse ? "yellow" : "white";

  // Rahmen ums Label - promi­nenter Warte-Kern.
  const labelInner = Math.max(6, Math.min(inner - 4, 26));
  const pad = labelInner - strWidth("WARTE AUF EINGABE") - 2;
  const leftPad = Math.max(1, Math.floor(pad / 2));
  const rightPad = Math.max(1, pad - leftPad);
  const rim = "═".repeat(labelInner);

  // History: echte abgeschlossene Jobs + letzte Fokus-Slot-Events.
  const slotHist = historyFromSlots(snap);
  const evtHist = (snap.lastEvents ?? [])
    .map(eventLine)
    .filter(Boolean)
    .slice(-3)
    .map((txt) => ({ text: `  · ${txt}`, color: "gray" }));
  const history = [...slotHist, ...evtHist].slice(0, 4);
  const busyCount = slots.filter((s) => s.state !== "IDLE").length;

  const block = [
    { w: "wave" },
    { w: "labelTop" },
    { w: "labelMid" },
    { w: "labelBot" },
    { w: "text", text: "KEIN JOB AKTIV · JOBS KOMMEN VON AGENTS/WORKER", color: "gray" },
  ];
  if (history.length) {
    block.push({ w: "text", text: "LETZTE AKTIVITÄT", color: "cyan", bold: true });
    for (const line of history) block.push({ w: "text", text: truncate(line.text, inner, "…"), color: line.color });
  } else {
    block.push({ w: "text", text: "(noch keine Jobs in dieser Sitzung)", color: "gray" });
  }
  block.push({ w: "text", text: `FREI: ${slots.length - busyCount}/${slots.length || 3} FENSTER · T = ANSICHT WÄHREND JOB`, color: "gray" });
  block.push({ w: "text", text: "Q ODER STRG-C SCHLIESST DIESES BEOBACHTUNGSFENSTER", color: "gray" });
  // Halt: FEN-Statuszeile immer ans Ende (unter Q-Hinweis wie bisher).
  block.push({ w: "slots" });

  const topPad = Math.max(0, Math.floor((rows - block.length) / 2));
  const els = [];
  for (let r = 0; r < topPad; r++) els.push(h(Text, { key: `t${r}`, color: "gray" }, ""));
  for (const line of block) {
    if (line.w === "wave") {
      els.push(h(Text, { key: "wave", color: "gray" }, waveKids));
    } else if (line.w === "labelTop") {
      els.push(h(Text, { key: "lt", color: "gray" }, padCenter(`╔${rim}╗`, inner)));
    } else if (line.w === "labelMid") {
      const mid = " ".repeat(leftPad) + "WARTE AUF EINGABE" + " ".repeat(rightPad);
      els.push(h(Text, { key: "lm", color: labelColor, bold: true }, padCenter(`║${mid}║`, inner)));
    } else if (line.w === "labelBot") {
      els.push(h(Text, { key: "lb", color: "gray" }, padCenter(`╚${rim}╝`, inner)));
    } else if (line.w === "slots") {
      els.push(h(Box, { key: "slots", width: cols }, slotLine(slots, inner)));
    } else if (line.bold) {
      els.push(h(Text, { key: `h${els.length}`, color: line.color, bold: true }, padCenter(line.text, inner)));
    } else {
      els.push(h(Text, { key: `h${els.length}`, color: line.color }, padCenter(line.text, inner)));
    }
  }
  while (els.length < rows) els.push(h(Text, { key: `f${els.length}`, color: "gray" }, ""));

  return h(Box, { flexDirection: "column", width: cols, height: rows }, ...els);
}