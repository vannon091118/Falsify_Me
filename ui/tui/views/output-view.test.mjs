// UI-XXX (2026-09-04): OutputView wickelt breite Reasoning-Zeilen an
// Wortgrenzen auf die Dock-Breite um, statt sie mit "…" abzuschneiden —
// NVIDIA/LLM-Reasoning kommt als Scrolltext OHNE Newlines (Ring-Zeilen
// breiter als das Dock); Truncate zeigte nur statische Zeilenfragmente.
// Render-frei: pure Funktion snap -> React-Baum; Text-Children sammeln.
import test from "node:test";
import assert from "node:assert/strict";
import OutputView from "./OutputView.mjs";

const textOf = (el) => {
  const out = [];
  const seen = new Set();
  const walk = (node) => {
    if (node == null || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === "object" && node.props && !seen.has(node)) {
      seen.add(node);
      walk(node.props.children);
    }
  };
  walk(el);
  return out.join("\n");
};

test("UI-XXX: lange Reasoning-Zeile wird auf Dock-Breite umgebrochen (kein '…'-Fragment)", () => {
  const longLine = Array.from({ length: 40 }, (_, i) => `wort${i}`).join(" ");
  const cols = 40;  // schmales Dock: eine ~110-Zeichen-Ring-Zeile
  const rows = 20;
  const el = OutputView({ snap: { output: [longLine] }, cols, rows });
  const text = textOf(el);
  assert.ok(!text.includes("…"), "keine Truncation-Ellipse mehr (Zeile wird umgebrochen, nicht gekappt)");
  for (const w of ["wort0", "wort39"]) assert.ok(text.includes(w), `Inhalt ${w} vollständig sichtbar`);
  // Umbruch: mindestens zwei Anzeige-Zeilen aus der einen Ring-Zeile
  const lines = text.split("\n").filter((l) => l.trim().startsWith("wort"));
  assert.ok(lines.length >= 2, `breite Zeile in ${lines.length} Anzeige-Zeilen umgebrochen`);
  for (const l of lines) assert.ok(l.trim().length <= cols - 2, `Zeile passt in Dock-Breite (${l.trim().length} <= ${cols - 2})`);
});

test("UI-XXX: Scroll-Budget — neueste Zeilen bleiben, aelteste scrollen (nicht umgekehrt)", () => {
  const many = Array.from({ length: 100 }, (_, i) => `zeile-${String(i).padStart(3, "0")}`);
  const cols = 60;
  const rows = 12;
  const el = OutputView({ snap: { output: many }, cols, rows });
  const text = textOf(el);
  assert.ok(text.includes("zeile-099"), "neueste Zeile sichtbar");
  assert.ok(!text.includes("zeile-000"), "älteste Zeilen scrollen im Ring");
  assert.ok(text.includes("100 Zeilen"), "Header zählt den Ring (vollständige Wahrheit), nicht das Fenster");
});

test("UI-XXX: mitStatusHeader — Modell/Status fix, Body scrollt darunter", () => {
  const many = Array.from({ length: 80 }, (_, i) => `s-${String(i).padStart(3, "0")}`);
  const cols = 80;
  const rows = 12;
  const snap = { output: many, model: { thinker: "nvidia/nemotron-3-ultra-550b", twin: "nvidia/nemotron-3-super-120b", who: "thinker" } };
  const el = OutputView({ snap, cols, rows, withStatusHeader: true });
  const text = textOf(el);
  assert.ok(text.includes("THINKER (Erstpruefung)"), "Status-Header bleibt sichtbar");
  assert.ok(text.includes("ultra-550b"), "Modell-Name sichtbar");
  assert.ok(text.includes("s-079"), "neueste Body-Zeile sichtbar");
  assert.ok(!text.includes("s-000"), "älteste Body-Zeilen scrollen weg");
});
