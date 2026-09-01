// FalsifyMe TUI - Views: Footer
// Verantwortung: nur die wichtigsten echten Fakten + Tasten-Hinweis.
// Zweite Zeile: echte Output-/Render-Metriken (keine Fake-Werte).
// Stateless.
import React from "react";
import { Box, Text } from "ink";
import { fill, truncate } from "../wcwidth.mjs";

const h = React.createElement;

const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export default function Footer({ snap, cols }) {
  const inner = cols - 2;
  const f = snap.findings;
  const counts = f.map((x) => `${x.icon} ${String(x.n).padStart(2, "0")}`).join(" ");
  const worker =
    snap.active ? "AKTIV"
      : snap.state === "IDLE" ? "BEREIT"
        : snap.state === "ABORTING" ? "ABBRUCH…"
          : snap.state === "ABORTED" ? "GESTOPPT"
            : "–";
  const verdictNote = snap.verdict && snap.state !== "VERDICT" ? ` · VERDICT ${snap.verdict.symbol} ${snap.verdict.code}` : "";
  const line1 = ` FINDINGS ${counts} · FILES ${String(snap.files).padStart(2, "0")} · WORKER ${worker}${verdictNote} · [Q]/[STRG-C] ABORT · [T] ANSICHT · ${snap.mode === "thinking" ? "THINKING" : "REASONING"}`;

  const m = snap.metrics;
  const rssMb = Math.round((m.rssPeak || process.memoryUsage?.().rss || 0) / 1048576);
  const line2 = ` OUTPUT ${m.spark} ${fmtK(m.linesPerSec)}/s · RENDER ${m.frames} frames max ${m.maxFrameMs}ms · RAM ${rssMb}MB`;

  return h(Box, { flexDirection: "column", width: cols },
    h(Text, null, "╭" + fill("─", inner) + "╮"),
    h(Box, { width: cols },
      h(Text, null, "│"),
      h(Text, null, truncate(line1, inner, "…")),
      h(Text, null, "│"),
    ),
    h(Box, { width: cols },
      h(Text, { color: "gray" }, "│"),
      h(Text, { color: "gray" }, truncate(line2, inner, "…")),
      h(Text, { color: "gray" }, "│"),
    ),
  );
}