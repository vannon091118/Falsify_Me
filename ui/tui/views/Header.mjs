// FalsifyMe TUI - Views: Header
// Verantwortung: Identitaet + globaler Zustand (Status-Punkt farbcodiert).
// Stateless: rendert nur snap; KEIN State/KEIN Parsing.
import React from "react";
import { Box, Text } from "ink";
import { fill, truncate, strWidth } from "../wcwidth.mjs";

const h = React.createElement;

export default function Header({ snap, cols }) {
  const inner = cols - 2;
  const left = ` FALSIFYME${snap.windowIdx ? ` · FEN ${snap.windowIdx}` : ""}${snap.jobId ? ` · JOB ${snap.jobId}` : ""}${snap.scopeId ? ` · SCOPE ${snap.scopeId}` : ""}`;
  const right = `● ${snap.stateLabel}`;
  // Status rechtsbuendig, links wird gekuerzt - nie ueberlaufen.
  const leftText = truncate(left, Math.max(1, inner - strWidth(right) - 2), "…");
  const gap = Math.max(1, inner - strWidth(leftText) - strWidth(right) - 2);

  return h(Box, { flexDirection: "column", width: cols },
    h(Text, null, "╭" + fill("─", inner) + "╮"),
    h(Box, { width: cols },
      h(Text, null, "│"),
      h(Text, null, leftText),
      h(Text, null, " ".repeat(gap)),
      h(Text, { color: snap.stateColor }, "●"),
      h(Text, null, ` ${snap.stateLabel}`),
      h(Text, null, "│"),
    ),
    h(Text, null, "╰" + fill("─", inner) + "╯"),
  );
}