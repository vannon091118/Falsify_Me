// FalsifyMe TUI - Views: EVIL-TWIN-Ansicht (Regel 6, UI-109)
// Verantwortung: waehrend der unabhaengigen Gegenpruefung (VERIFYING) den
// Bildschirm in den Rot/Schwarz-Kontrast zwingen und den ROH-TEXT des
// Gegenpruefers (Evil Twin) sichtbar machen - der Twin-System-Prompt traegt
// den Ton (Schadenfreude gegenueber Agents), hier wird die Phase als solche
// erkennbar. Stateless: rendert nur snap; KEIN State/KEIN Parsing.
import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../wcwidth.mjs";

const h = React.createElement;

export default function EvilTwinView({ snap, cols, rows }) {
  const inner = cols - 2;
  const lines = snap.output ?? [];

  // Kopf (3 Zeilen) + Ergebnis-Zeile = 4 fixe Zeilen; Rest = Roh-Text.
  const headerRows = 3;
  const footerRows = 1;
  const bodyRows = Math.max(1, rows - headerRows - footerRows);

  const els = [];
  // Rot auf Schwarz = der Kontrast, den ein Evil-Twin-Prozess bekommt
  // (kein normales Fenster mehr). Kopf invertiert (roter Balken).
  els.push(h(Text, { key: "band", backgroundColor: "red", color: "black", bold: true },
    " EVIL TWIN AKTIV – GEGENPRUEFUNG (Regel 6) "));
  els.push(h(Text, { key: "mandat", color: "red" },
    "  Unabhaengige zweite Instanz greift die Widerlegung des Agents an:"));
  els.push(h(Text, { key: "ton", color: "red" },
    "  sucht Fehler, freut sich ueber jeden Treffer – aber nur mit echter, selbst gelesener Datei:Zeile-Evidenz."));

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
  els.push(h(Text, { key: "out", color: "red" },
    "  Ergebnis: BESTAETIGT = Freigabe belastbar · WIDERSPRUCH/UNKLAR = keine Freigabe (fail-closed)."));

  const rowsEl = [];
  for (let i = 0; i < rows; i++) {
    rowsEl.push(h(Box, { key: `row${i}`, width: cols, backgroundColor: "black" },
      els[i] ?? h(Text, { key: `e${i}`, color: "red" }, "")));
  }
  return h(Box, { flexDirection: "column", width: cols, height: rows }, ...rowsEl);
}
