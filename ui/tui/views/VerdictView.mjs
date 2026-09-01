// FalsifyMe TUI - Views: Verdict-Transformation
// Verantwortung: eindeutige visuelle Verdict-Box (Pulse waehrend PULSE_MS,
// danach dezent). Keine Fake-Entscheidung: nur echte Codes. Stateless.
import React from "react";
import { Box, Text } from "ink";
import { fill, padEnd, truncate } from "../wcwidth.mjs";

const h = React.createElement;

export default function VerdictView({ snap, cols, rows }) {
  const v = snap.verdict;
  if (!v) return h(Box, { width: cols, height: rows });
  const inner = Math.max(10, Math.min(28, cols - 6));
  const boxH = v.hint ? 5 : 4;
  const padTop = Math.max(0, Math.floor((rows - boxH) / 2));
  const pulse = v.pulse && Math.floor(snap.now / 400) % 2 === 0;
  const center = (s) => truncate(padEnd(s, inner), inner, "…");

  const els = [];
  for (let i = 0; i < padTop; i++) els.push(h(Text, { key: `p${i}` }, " ".repeat(cols)));
  els.push(h(Text, { key: "t", color: v.color }, "╭" + fill("─", inner) + "╮"));
  els.push(h(Text, { key: "m0", color: v.color, bold: pulse }, "│" + center(` ${v.symbol} ${v.code} `) + "│"));
  els.push(h(Text, { key: "m1", color: v.color }, "│" + center(v.label) + "│"));
  if (v.hint) els.push(h(Text, { key: "m2", color: v.color }, "│" + center(v.hint) + "│"));
  els.push(h(Text, { key: "b", color: v.color }, "╰" + fill("─", inner) + "╯"));

  return h(Box, { flexDirection: "column", width: cols, height: rows }, ...els);
}