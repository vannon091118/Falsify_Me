// FalsifyMe TUI - Views: Header
// Verantwortung: Identitaet + globaler Zustand (Status-Punkt farbcodiert).
// Stateless: rendert nur snap; KEIN State/KEIN Parsing.
import React from "react";
import { Box, Text } from "ink";
import { fill, truncate, strWidth } from "../wcwidth.mjs";

const h = React.createElement;

export default function Header({ snap, cols }) {
  const inner = cols - 2;
  // Fortschrittsindikator IMMER sichtbar (auch wenn der Thinking-Block
  // ausgeblendet ist): aktive Phase + Prozent + Modus-Selbsterklaerung (t).
  const phase = snap.activePhase?.phase ?? snap.phases?.find?.((p) => p.status === "active")?.phase ?? "–";
  const pct = Math.round((snap.activePhase?.progress ?? 0) * 100);
  const modeLabel = snap.mode === "thinking" ? "t:Text" : "t:Status";
  const left = ` FALSIFYME${snap.windowIdx ? ` · FEN ${snap.windowIdx}` : ""}${snap.jobId ? ` · JOB ${snap.jobId}` : ""}${snap.scopeId ? ` · SCOPE ${snap.scopeId}` : ""} · ${phase} ${pct}% · ${modeLabel}`;
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