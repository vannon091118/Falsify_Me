// FalsifyMe TUI - Views: REASONING-Ansicht (Toggle)
// Verantwortung: kompakter strukturierter Status: Phase-Checkliste, aktuelle
// Aktivitaet, letzte Events. KEIN Endlos-Scrolltext - begrenzte Zeilen.
// Stateless.
import React from "react";
import { Box, Text } from "ink";
import { padEnd, truncate } from "../wcwidth.mjs";
import ProgressBar from "./ProgressBar.mjs";
import FindingsPanel from "./FindingsPanel.mjs";

const h = React.createElement;

const fmtTime = (ts) => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

const statusColor = (status) => (status === "done" ? "green" : status === "active" ? "cyan" : "gray");

const eventDesc = (e) => {
  switch (e.t) {
    case "state":
      return `Zustand → ${e.s}`;
    case "activity":
      return `${e.tool ?? "aktivität"} ${e.file ?? e.label ?? ""}`.trim();
    case "finding":
      return `Finding ${e.severity}`;
    case "phase":
      return `Phase ${e.phase}${typeof e.progress === "number" ? ` ${Math.round(e.progress * 100)}%` : ""}`;
    case "phase_done":
      return `Phase ${e.phase} abgeschlossen`;
    case "verdict":
      return `VERDICT: ${e.v}`;
    case "job":
      return `Job ${e.id}${e.scope ? ` · Scope ${e.scope}` : ""}`;
    case "boot":
      return "Systemstart";
    case "done":
      return "Job beendet";
    default:
      return e.t;
  }
};

export default function ReasoningView({ snap, cols, rows }) {
  const inner = cols - 2;
  const lines = [];

  lines.push(h(Text, { key: "h", bold: true }, "FALSIFICATION"));
  for (const p of snap.phases) {
    lines.push(
      h(Text, { key: p.phase, color: statusColor(p.status) },
        `  ${p.icon} ${padEnd(p.phase, 10)}`),
    );
  }
  lines.push(h(Box, { key: "bar", width: inner },
    h(ProgressBar, { activePhase: snap.activePhase, cols: inner, now: snap.now })));

  // Gescannte Dateien sichtbar machen (echte Whitelist aus dem files-Event).
  if (Array.isArray(snap.filesList) && snap.filesList.length) {
    lines.push(h(Text, { key: "scanH", color: "gray" }, `SCAN ${snap.filesList.length} DATEIEN`));
    lines.push(h(Text, { key: "scan", color: "cyan" }, `  ${truncate(snap.filesList.join(", "), inner - 2, "…")}`));
  }

  lines.push(h(Text, { key: "actH", color: "gray" }, "AKTIVITÄT"));
  const activity = snap.activity;
  if (activity) {
    const label = truncate(activity.label ?? [activity.tool, activity.file].filter(Boolean).join(" "), inner, "…");
    lines.push(h(Text, { key: "act", color: "cyan" }, `  ${label}`));
  } else {
    lines.push(h(Text, { key: "act0", color: "gray" }, "  –"));
  }

  lines.push(h(Box, { key: "fnd", width: inner },
    h(FindingsPanel, { findings: snap.findings })));

  lines.push(h(Text, { key: "evtH", color: "gray" }, "LETZTE EVENTS"));
  const maxEvents = Math.max(1, rows - lines.length - 1);
  const evts = snap.lastEvents.slice(-maxEvents);
  evts.forEach((e, i) => {
    const desc = eventDesc(e);
    const color = i === evts.length - 1 ? "white" : "gray";
    lines.push(h(Text, { key: `e${i}`, color }, `  ${fmtTime(e.ts)} ${truncate(desc, inner - 8, "…")}`));
  });

  const visible = lines.slice(0, rows);
  while (visible.length < rows) {
    visible.push(h(Text, { key: `f${visible.length}`, color: "gray" }, ""));
  }

  const rowsEl = [];
  for (let i = 0; i < visible.length; i++) {
    rowsEl.push(h(Box, { key: `row${i}`, width: cols }, visible[i]));
  }
  return h(Box, { flexDirection: "column", width: cols, height: rows }, ...rowsEl);
}