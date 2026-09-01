// FalsifyMe TUI - Views: Slots-Split (2..3 parallele Fenster im EINEN Terminal)
// Verantwortung: mehrere beschaeftigte Slots als gestapelte, eingerahmte
// Mini-Fenster zeigen (max. 3, gleicher pid). Jedes Panel: FEN-Kopf,
// Phasen-/Progress-Zeile, Findings + Aktivitaet, Mini-Partikelfeld des Slots.
// Stateless: reine Darstellung aus snap.slotPanels.
import React from "react";
import { Box, Text } from "ink";
import { fill, padEnd, strWidth, truncate } from "../wcwidth.mjs";
import { renderCells } from "./ParticlesView.mjs";

const h = React.createElement;

const phasePart = (p) => {
  if (p.status === "done") return `${p.phase} ✓`;
  if (p.status === "active") return `${p.phase} ▸`;
  return `${p.phase} ○`;
};

export default function SlotsView({ snap, cols, rows }) {
  const panels = snap.slotPanels ?? [];
  const n = Math.max(1, panels.length);
  const base = Math.floor(rows / n);
  const extra = rows - base * n;
  const inner = cols - 2;

  const els = [];
  let row = 0;
  for (let i = 0; i < n; i++) {
    const pH = base + (i < extra ? 1 : 0);
    const p = panels[i];
    const stateColor = p.stateColor ?? "white";
    // Fenster-Selbsterklärung: Fenster + Job + Zustand (farbig) + Phase/Fortschritt.
    const phase = p.phases?.find?.((x) => x.status === "active")?.phase ?? p.activePhase?.phase ?? "–";
    const pct = Math.round((p.activePhase?.progress ?? 0) * 100);
    const head = ` ${p.fen} · ${p.jobId ? `JOB ${p.jobId}` : "–"} · ${p.stateLabel} · ${phase} ${pct}%`;
    els.push(h(Text, { key: `h${i}`, color: "gray" }, "╭" + truncate(head + fill("─", Math.max(0, inner - strWidth(head))), inner, "…") + "╮"));

    // Phasen inline
    const phases = (p.phases ?? []).map(phasePart).join("  ");
    els.push(h(Box, { key: `p${i}`, width: cols },
      h(Text, { color: "gray" }, "│"),
      h(Text, { color: stateColor }, truncate(` ${phases}`, inner, "…")),
      h(Text, { color: "gray" }, "│"),
    ));

    // Findings + Aktivitaet
    const f = p.findings ?? [];
    const counts = f.map((x) => `${x.icon} ${String(x.n).padStart(2, "0")}`).join(" ");
    const act = truncate(p.activity?.label ?? p.activity?.file ?? "–", Math.max(1, inner - 26), "…");
    els.push(h(Box, { key: `f${i}`, width: cols },
      h(Text, { color: "gray" }, "│"),
      h(Text, { color: "cyan" }, truncate(` FINDINGS ${counts} · FILES ${String(p.files ?? 0).padStart(2, "0")} · ${act}`, inner, "…")),
      h(Text, { color: "gray" }, "│"),
    ));

    // Verdict-Zeile (falls vorhanden) ODER Mini-Partikelfeld
    const interior = pH - 4; // Kopf + 2 Info-Zeilen + Rahmen unten
    if (p.verdict) {
      const v = p.verdict;
      els.push(h(Box, { key: `v${i}`, width: cols },
        h(Text, { color: "gray" }, "│"),
        h(Text, { color: v.color, bold: v.pulse },
          padEnd(truncate(` ${v.symbol} ${v.code} · ${v.label}`, inner, "…"), inner)),
        h(Text, { color: "gray" }, "│"),
      ));
      for (let r = 1; r < interior; r++) {
        els.push(h(Box, { key: `vp${i}_${r}`, width: cols },
          h(Text, { color: "gray" }, "│"),
          h(Text, { color: "gray" }, fill(" ", inner)),
          h(Text, { color: "gray" }, "│"),
        ));
      }
    } else {
      const cellLines = renderCells(p.particles, cols).slice(0, Math.max(0, interior));
      for (const line of cellLines) {
        els.push(h(Box, { key: `c${i}_${els.length}`, width: cols },
          h(Text, { color: "gray" }, "│"),
          h(Text, { color: line?.dimOnly ? "gray" : "white" }, padEnd(truncate(line?.text ?? "", inner, "…"), inner)),
          h(Text, { color: "gray" }, "│"),
        ));
      }
      const used = cellLines.length;
      for (let r = used; r < interior; r++) {
        els.push(h(Box, { key: `e${i}_${r}`, width: cols },
          h(Text, { color: "gray" }, "│"),
          h(Text, { color: "gray" }, fill(" ", inner)),
          h(Text, { color: "gray" }, "│"),
        ));
      }
    }
    els.push(h(Text, { key: `b${i}`, color: "gray" }, "╰" + fill("─", inner) + "╯"));
    row += pH;
  }
  while (row < rows) {
    els.push(h(Text, { key: `x${row}`, color: "gray" }, ""));
    row++;
  }

  return h(Box, { flexDirection: "column", width: cols, height: rows }, ...els);
}