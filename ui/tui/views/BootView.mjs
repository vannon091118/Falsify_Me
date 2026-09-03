// FalsifyMe TUI - Views: Maschinen-Boot-Intro (VOLLBILD-LABEL)
// Verantwortung: Visualisierung NUR beim Start während der Selftests -
// groes, zentriertes FALSIFYME-Wortmarken-Label ueber die volle Flaeche.
// Nach dem ersten Job (jobsStarted > 0) wird diese View NICHT mehr gerendert
// (Gate in App.mjs) - der Boot ist rein fuer Start/Selftest, nie fuer Jobs.
// Stateless.
import React from "react";
import { Box, Text } from "ink";
import { padStart } from "../wcwidth.mjs";
import { BLOCK_ROWS, CATCHPHRASE } from "../boot.mjs";

const h = React.createElement;

// ── 5-Zeilen-Block-Font (je Zeichen 3 Spalten) fuer die Vollbild-Wortmarke.
const GLYPHS = {
  F: ["███", "█  ", "███", "█  ", "█  "],
  A: [" █ ", "█ █", "███", "█ █", "█ █"],
  L: ["█  ", "█  ", "█  ", "█  ", "███"],
  S: ["███", "█  ", "███", "  █", "███"],
  I: ["███", " █ ", " █ ", " █ ", "███"],
  Y: ["█ █", "█ █", "███", " █ ", " █ "],
  M: ["█ █", "███", "█ █", "█ █", "█ █"],
  E: ["███", "█  ", "██ ", "█  ", "███"],
  _: ["   ", "   ", "   ", "   ", "███"],
};

const blockWord = (word) => {
  const rows = [0, 1, 2, 3, 4].map((r) =>
    word
      .split("")
      .map((ch) => GLYPHS[ch]?.[r] ?? "   ")
      .join(" ")
  );
  return rows;
};

export default function BootView({ snap, cols, rows }) {
  const b = snap.boot;
  const inner = cols - 2;
  const allRows = [];

  // Status-Label: Selftest pass/fail ehrlich, sonst ACTIVATING.
  const result = snap.testResult ?? null;
  const fail = result === "fail";
  const status = fail ? "SELF-TEST FEHLER" : result === "pass" ? "SELF-TEST PASS" : "ACTIVATING";
  const statusColor = fail ? "red" : result === "pass" ? "green" : "yellow";
  const statusRow = BLOCK_ROWS[b.block > 0 ? b.block : 0];

  const selftestSteps = (Array.isArray(snap.testSteps) ? snap.testSteps : [])
    .map((s) => {
      const icon = s.ok === true ? "✓" : s.ok === false ? "✕" : "→";
      const color = s.ok === true ? "green" : s.ok === false ? "red" : "yellow";
      return { text: padStart(` ${icon} ${s.name}`, inner), color };
    });

  // Vollbild-Anordnung (zentriert via Leerzeilen zuerst - Ink rendert von oben).
  const wordRows = blockWord("FALSIFY_ME");
  const wordW = wordRows[0].length;
  const padW = Math.max(0, Math.floor((inner - wordW) / 2));
  const center = (text, color = "white") => h(Text, { key: `b${allRows.length}`, color }, padStart(text, inner));

  // Puffer oben (vertikale Zentrierung).
  const wordH = wordRows.length + 8; // Wortmarke + Catchphrase + Status + Statusbar + Abstaende
  const topPad = Math.max(1, Math.floor((rows - wordH) / 2));
  for (let i = 0; i < topPad; i++) allRows.push(h(Text, { key: `p${i}`, color: "gray" }, ""));

  for (const line of wordRows) {
    allRows.push(h(Text, { key: `w${allRows.length}`, color: "white", bold: true }, " ".repeat(padW) + line));
  }
  allRows.push(center(CATCHPHRASE, "cyan"));
  allRows.push(h(Text, { key: `s0`, color: "gray" }, ""));
  allRows.push(center(status, statusColor));
  allRows.push(center(statusRow, "cyan"));
  allRows.push(h(Text, { key: `s1`, color: "gray" }, ""));

  // Selftest-Checklist (nur echte Worker-Steps, nie erfunden).
  for (const s of selftestSteps) allRows.push(center(s.text, s.color));
  if (result) {
    allRows.push(center(result === "pass" ? " ALLE KOMPONENTEN OK - BEREIT " : " BOOT-FEHLER - SIEHE SCHRITTE OBEN ", result === "pass" ? "green" : "red"));
  }

  return h(Box, { flexDirection: "column", width: cols, height: rows }, ...allRows);
}