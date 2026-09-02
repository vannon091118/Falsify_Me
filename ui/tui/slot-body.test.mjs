// FalsifyMe TUI · slot-body.test.mjs
// E2E-Befund 2026-09-02 (Multi-Window-Sichtbarkeit): Im SlotsView werden pro
// Panel nur Partikel gezeigt; der lesbare Reasoning-Verlauf bleibt unsichtbar,
// obwohl er im snapshot.output-Ring liegt. Die Entscheidungsfunktion
// `slotBodyLines` muss für eine Slot-Panel im Denk-Zustand die echten
// Output-Zeilen liefern (statt Partikel). Pure, testbar ohne Ink-Rendering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { slotBodyLines } from "./views/panelBody.mjs";

test("slotBodyLines: reasoning-Slot mit Output liefert lesbare Zeilen (statt null)", () => {
  const panel = {
    state: "THINKING",
    output: ["word ".repeat(80).trim(), "BEFUND: kein Fehler.", "VERDICT: PLAN"],
  };
  const lines = slotBodyLines(panel, 100, 10);
  assert.ok(Array.isArray(lines), "liefert ein Array (nicht null = Partikel)");
  assert.ok(lines.length >= 2, `mehrere Verlauf-Zeilen (got ${lines.length})`);
  assert.ok(lines.some((l) => l.includes("word word")), "Reasoning-Inhalt sichtbar");
  assert.ok(lines.every((l) => l.length <= 100), "Zeilen passen in die Breite");
});

test("slotBodyLines: reasoning-Slot OHNE Output faellt auf Partikel zurueck (null)", () => {
  const lines = slotBodyLines({ state: "THINKING", output: [] }, 100, 10);
  assert.equal(lines, null, "kein Output -> Partikel-Modus");
});

test("slotBodyLines: nicht-reasoning-Slot zeigt Partikel (null)", () => {
  const lines = slotBodyLines({ state: "STARTING", output: ["x"] }, 100, 10);
  assert.equal(lines, null, "STARTING ist kein Denk-Zustand -> Partikel");
});
