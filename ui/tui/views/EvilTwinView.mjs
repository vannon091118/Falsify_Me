// FalsifyMe TUI - Views: EVIL-TWIN-Ansicht (Regel 6, UI-109/UI-114)
// Verantwortung: waehrend der unabhaengigen Gegenpruefung (VERIFYING) den
// Bildschirm in den Rot/Schwarz-Kontrast zwingen und drei Dinge ZEIGEN:
//   1. Den Twin-Prompt-Text (Mandat + Ton + Kernregeln) — der User sieht,
//      WAS der Gegenpruefer gerade treibt, nicht nur dass er laeuft.
//   2. Den Job-Status (JOB/Scope/Phase/Findings) — Kontext bleibt erhalten.
//   3. Den ROH-TEXT des Gegenpruefers (Output-Ring, live).
// Stateless: rendert nur snap; KEIN State/KEIN Parsing. Der Ton (Schaden-
// freude, will recht haben) lebt im Twin-System-Prompt (UI-104) — diese
// Ansicht zerstoert die Output-Anzeige nicht: Body-Zeilen sind hart auf
// bodyRows gedeckelt, Rest scrollt im Ring (der Ring ist die Wahrheit,
// nicht das Fenster).
import React from "react";
import { Box, Text } from "ink";
import { truncate, padEnd, strWidth } from "../wcwidth.mjs";

const h = React.createElement;

// Der sichtbare Ausschnitt des Twin-Mandats (Prompt-Kern, bewusst kurz —
// der volle Text steht in core/prompt-text/system-eviltwin-*.md).
const TWIN_BRIEF = Object.freeze([
  "  MANDAT  Greife die Widerlegung des Agents an — unabhaengig, mit leerem Kontext.",
  "  PFLICHT Lies die zitierten Dateien selbst; zitiere nur selbst gelesene Datei:Zeile.",
  "  GEGENPROBE Suche die Gegenstelle, die der Erstpruefer uebersehen hat.",
  "  TON      Du geniesst es, den Agenten zu widerlegen — Schadenfreude erlaubt,",
  "           aber deine Freude ist nie ein Argument. Nur echte Evidenz tragt.",
  "  FAIL-CLOSED  BESTAETIGT ohne eigenes Lesen/eigene Referenz ist VERBOTEN.",
]);

export default function EvilTwinView({ snap, cols, rows }) {
  const inner = cols - 2;
  const lines = snap.output ?? [];

  // Layout-Budget (Prioritaet vor Menge): Balken, Job-Status, Ergebnis-
  // Legende sind fix; das Mandat ist wichtig, aber kappbar; der Body
  // (Roh-Text) bekommt den REST — bei winzigen Fenstern schrumpft er auf
  // 0 (der Ring im State bleibt die Wahrheit, nichts geht verloren), die
  // Freigabe-Semantik bleibt IMMER sichtbar.
  const fixedRows = 3; /* Balken + Job-Status + Ergebnis */
  const mandateRows = 1 + TWIN_BRIEF.length; /* Kopf + Brief */
  const bodyRows = Math.max(0, rows - fixedRows - mandateRows - 1 /* Legende */);

  const els = [];
  // Rot auf Schwarz = der Kontrast, den ein Evil-Twin-Prozess bekommt
  // (kein normales Fenster mehr). Kopf invertiert (roter Balken).
  els.push(h(Text, { key: "band", backgroundColor: "red", color: "black", bold: true },
    " EVIL TWIN AKTIV – GEGENPRUEFUNG (Regel 6) "));

  // Job-Status: JOB/Scope/Phase — der Kontext der Gegenpruefung bleibt
  // sichtbar, ohne dass der User das Fenster wechseln muss.
  const phase = snap.activePhase?.phase
    ?? (snap.phases ?? []).find((p) => p.status === "active")?.phase ?? "–";
  const f = snap.findings ?? [];
  const counts = f.length
    ? f.map((x) => `${x.icon} ${String(x.n).padStart(2, "0")}`).join(" ")
    : "● 00 ▲ 00 ! 00";
  els.push(h(Text, { key: "job", color: "red", bold: true },
    padEnd(truncate(`  JOB ${snap.jobId ?? "–"} · SCOPE ${snap.scopeId ?? "–"} · ${snap.stateLabel ?? "VERIFYING"} · ${phase} · FINDINGS ${counts}`,
      inner, "…"), inner)));

  // Ergebnis-Legende FRUEH (fixe Zeile) — die Freigabe-Semantik ist das
  // Wichtigste und darf bei kleinen Fenstern nicht wegfallen.
  els.push(h(Text, { key: "out", color: "red", bold: true },
    "  Ergebnis: BESTAETIGT = Freigabe belastbar · WIDERSPRUCH/UNKLAR = keine Freigabe (fail-closed)."));

  // Twin-Prompt-Text (Mandat/Ton/Regeln) — was der Gegenpruefer treibt
  // (kappbar: bei winzigen Fenstern weicht es dem Roh-Text).
  if (bodyRows > 0 || rows >= fixedRows + mandateRows) {
    els.push(h(Text, { key: "mh", color: "red", bold: true }, "  TWIN-PROMPT (Mandat):"));
    for (let i = 0; i < TWIN_BRIEF.length; i++) {
      els.push(h(Text, { key: `m${i}`, color: "red", dimColor: true },
        truncate(TWIN_BRIEF[i], inner, "…")));
    }
  }

  // Roh-Text des Gegenpruefers: letzte bodyRows Zeilen, neueste fett.
  if (bodyRows > 0) {
    if (lines.length === 0) {
      els.push(h(Text, { key: "none", color: "red" }, "  – Gegenpruefer liest die Behauptungen … –"));
    } else {
      const visible = lines.slice(-bodyRows);
      visible.forEach((line, i) => {
        const isLast = i === visible.length - 1;
        els.push(h(Text, { key: `l${i}`, color: "red", backgroundColor: "black", bold: isLast },
          `  ${truncate(String(line), inner - 2, "…")}`));
      });
    }
  }
  els.push(h(Text, { key: "leg", color: "red", dimColor: true },
    "  Nur selbst gelesene Datei:Zeile-Evidenz traegt – eigene Falsifikation, keine Nachlese (UI-112)."));

  // Gesamte Flaeche schwarz; Zeilen hart auf rows gedeckelt (ueberzaehlige
  // els fallen unten weg — der Ring im State bleibt die vollstaendige
  // Wahrheit, nichts geht verloren).
  const shown = els.slice(0, rows);
  const rowsEl = [];
  for (let i = 0; i < rows; i++) {
    const el = shown[i];
    rowsEl.push(h(Box, { key: `row${i}`, width: cols, backgroundColor: "black" },
      el && el.props?.backgroundColor === "red"
        ? el
        : (el ?? h(Text, { key: `e${i}`, color: "red", backgroundColor: "black" }, padEnd("", Math.max(0, strWidth("")))))));
  }
  return h(Box, { flexDirection: "column", width: cols, height: rows }, ...rowsEl);
}
