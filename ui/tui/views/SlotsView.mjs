// FalsifyMe TUI - Views: Slots-Split (2..3 parallele Fenster im EINEN Terminal)
// Verantwortung: mehrere beschaeftigte Slots als gestapelte, eingerahmte
// Mini-Fenster zeigen (max. 3, gleicher pid). Jedes Panel: FEN-Kopf,
// Phasen-/Progress-Zeile, Findings + Aktivitaet, Mini-Partikelfeld des Slots.
// Stateless: reine Darstellung aus snap.slotPanels.
import React from "react";
import { Box, Text } from "ink";
import { fill, padEnd, strWidth, truncate } from "../wcwidth.mjs";
import { renderCells } from "./ParticlesView.mjs";
import { slotBodyLines } from "./panelBody.mjs";

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
    // Evil-Twin-Gegenpruefung (Regel 6, UI-109): das Fenster wechselt in den
    // Rot-Kontrast und traegt den TWIN-Tag - die Phase erklaert sich selbst.
    const twin = p.twinActive === true || p.state === "VERIFYING";
    const stateColor = twin ? "red" : (p.stateColor ?? "white");
    // Fenster-Selbsterklärung: Fenster + Job + Zustand (farbig) + Phase/Fortschritt.
    const phase = p.phases?.find?.((x) => x.status === "active")?.phase ?? p.activePhase?.phase ?? "–";
    const pct = Math.round((p.activePhase?.progress ?? 0) * 100);
    const head = ` ${twin ? "⚔ EVIL TWIN · " : ""}${p.fen} · ${p.jobId ? `JOB ${p.jobId}` : "–"} · ${p.stateLabel} · ${phase} ${pct}%`;
    els.push(h(Text, { key: `h${i}`, color: twin ? "red" : "gray", bold: twin },
      "╭" + truncate(head + fill("─", Math.max(0, inner - strWidth(head))), inner, "…") + "╮"));

    // Phasen inline
    const phases = (p.phases ?? []).map(phasePart).join("  ");
    els.push(h(Box, { key: `p${i}`, width: cols },
      h(Text, { color: "gray" }, "│"),
      h(Text, { color: stateColor }, truncate(` ${phases}`, inner, "…")),
      h(Text, { color: "gray" }, "│"),
    ));

    // UI-128: Auto-Scope-Entscheidung sichtbar — WER (FalsifyMe) hat WIE
    // (neu/Fortsetzung) welchen Scope zum Ticket bestimmt. Nur Anzeige des
    // scope_auto-Events; ohne Event keine Zeile (kein Fake-Zustand).
    if (p.scopeAuto) {
      const sa = p.scopeAuto;
      const what = sa.outcome === "new" ? "NEU ANGELEGT" : "FORTSETZUNG";
      const ticketKurz = sa.ticket ? truncate(sa.ticket, Math.max(10, inner - 46), "…") : "–";
      const line = ` SCOPE AUTO (${what}): ${sa.scopeId ?? "–"} · Ticket: ${ticketKurz}`;
      els.push(h(Box, { key: `sa${i}`, width: cols },
        h(Text, { color: "gray" }, "│"),
        h(Text, { color: sa.outcome === "new" ? "green" : "cyan" }, truncate(line, inner, "…")),
        h(Text, { color: "gray" }, "│"),
      ));
    }

    // UI-128: Prüfauftrag an den externen Agenten sichtbar — nach der WRITE-
    // Freigabe zeigt das Fenster, DASS ein Handoff existiert, WELCHER, und
    // was er enthält (Ticket + Falsifikation + Probe-Ergebnisse).
    if (p.handoff) {
      const hf = p.handoff;
      const probes = Number.isInteger(hf.probes) ? `${hf.probes} Proben` : "Proben: –";
      const ticketKurz = hf.ticket ? truncate(hf.ticket, Math.max(10, inner - 52), "…") : "–";
      const line = ` PRÜFAUFTRAG → EXTERNER AGENT (${hf.id ?? "–"}) · Ticket: ${ticketKurz} · ${probes} · Ergebnis → Re-Review`;
      els.push(h(Box, { key: `hf${i}`, width: cols },
        h(Text, { color: "gray" }, "│"),
        h(Text, { color: "yellow", bold: true }, truncate(line, inner, "…")),
        h(Text, { color: "gray" }, "│"),
      ));
    }

    // Loop-Zustand (UI-123): Spiegel des persistierten jobs.loop_state —
    // nur angezeigt, wenn die Pipeline ihn gemeldet hat (kein Fake-Zustand).
    if (p.loopLabel) {
      els.push(h(Box, { key: `l${i}`, width: cols },
        h(Text, { color: "gray" }, "│"),
        h(Text, { color: p.loopColor ?? "gray" }, truncate(` ${p.loopLabel}`, inner, "…")),
        h(Text, { color: "gray" }, "│"),
      ));
    }

    // Findings + Aktivitaet
    const f = p.findings ?? [];
    const counts = f.map((x) => `${x.icon} ${String(x.n).padStart(2, "0")}`).join(" ");
    const act = truncate(p.activity?.label ?? p.activity?.file ?? "–", Math.max(1, inner - 26), "…");
    els.push(h(Box, { key: `f${i}`, width: cols },
      h(Text, { color: "gray" }, "│"),
      h(Text, { color: "cyan" }, truncate(` FINDINGS ${counts} · FILES ${String(p.files ?? 0).padStart(2, "0")} · ${act}`, inner, "…")),
      h(Text, { color: "gray" }, "│"),
    ));

    // Modell-/Rollen-Traceability: WER denkt (Thinker oder Evil Twin) und
    // mit WELCHEM Modell — ohne diese Zeile sind Erst- und Gegenpruefung
    // fuer den Beobachter nicht unterscheidbar (E2E-Befund 2026-09-02).
    const m = p.model;
    if (m) {
      const whoLabel = m.who === "twin" ? "EVIL TWIN" : "THINKER";
      const modelId = m.who === "twin" ? (m.twin ?? "–") : (m.thinker ?? "–");
      const whoColor = m.who === "twin" ? "red" : "blue";
      els.push(h(Box, { key: `m${i}`, width: cols },
        h(Text, { color: "gray" }, "│"),
        h(Text, { color: whoColor, bold: m.who === "twin" },
          truncate(` ${whoLabel} · ${modelId}`, inner, "…")),
        h(Text, { color: "gray" }, "│"),
      ));
    }

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
      // Multi-Window-Sichtbarkeit (E2E-Befund 2026-09-02): Ein Slot im
      // Denk-Zustand zeigt SEINEN lesbaren Output-Verlauf (statt Partikel),
      // damit Erst- und Gegenpruefung wirklich ablesbar sind. Partikel nur,
      // wenn noch kein Output da ist (Start/Idle).
      const verText = slotBodyLines(p, cols, Math.max(0, interior));
      const cellLines = verText
        ? verText.map((t) => ({ text: t, dimOnly: false }))
        : renderCells(p.particles, cols).slice(0, Math.max(0, interior));
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