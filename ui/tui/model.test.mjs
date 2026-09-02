// FalsifyMe TUI - UI-Traceability (E2E-Befund 2026-09-02): Die UI zeigt
// Animationen, aber NICHT WER denkt (Thinker vs. Evil Twin) und MIT WELCHEM
// MODELL. Ein Beobachter kann die Gegenprüfung nicht von der Erstprüfung
// unterscheiden. Vertrag:
//   Event { t: "model", thinker, twin, who: "thinker"|"twin" }
//   → Slot speichert model = { thinker, twin, who }
//   → Views zeigen Belegung + aktive Rolle.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

test("apply erkennt das model-Event als gueltigen Event-Typ", async () => {
  const { apply, EVENT_TYPES } = await mod("ui/tui/events.mjs");
  assert.ok(EVENT_TYPES.includes("model"), "EVENT_TYPES enthaelt 'model'");
  const { createUiState } = await mod("ui/tui/state.mjs");
  const state = createUiState();
  const ok = apply(state, { t: "model", thinker: "nvidia/nemotron-3-super-120b-a12b", twin: "qwen/qwen3.6-27b", who: "thinker" });
  assert.equal(ok, true, "model-Event wird akzeptiert");
});

test("model-Event speichert thinker/twin/who im Slot (Spiegel im Top-Level)", async () => {
  const { apply } = await mod("ui/tui/events.mjs");
  const { createUiState, activeSlotOf } = await mod("ui/tui/state.mjs");
  const state = createUiState();
  apply(state, { t: "job", id: "j1" });
  apply(state, { t: "model", thinker: "nvidia/nemotron-3-super-120b-a12b", twin: "qwen/qwen3.6-27b", who: "thinker" });
  const slot = activeSlotOf(state);
  assert.equal(slot.model.thinker, "nvidia/nemotron-3-super-120b-a12b");
  assert.equal(slot.model.twin, "qwen/qwen3.6-27b");
  assert.equal(slot.model.who, "thinker");
  assert.equal(state.model.who, "thinker", "Top-Level-Spiegel zeigt aktive Rolle");
});

test("who-Wechsel auf 'twin' wird sichtbar (Gegenpruefung unterscheidbar)", async () => {
  const { apply } = await mod("ui/tui/events.mjs");
  const { createUiState, activeSlotOf } = await mod("ui/tui/state.mjs");
  const state = createUiState();
  apply(state, { t: "model", thinker: "A", twin: "B", who: "thinker" });
  apply(state, { t: "model", who: "twin" });
  assert.equal(activeSlotOf(state).model.who, "twin");
  // Nur Belegung ohne Rollenwechsel: who bleibt unveraendert
  apply(state, { t: "model", thinker: "A2" });
  assert.equal(activeSlotOf(state).model.thinker, "A2");
  assert.equal(activeSlotOf(state).model.who, "twin");
});

test("Slots bleiben getrennt: model gilt pro Slot, nicht global", async () => {
  const { apply } = await mod("ui/tui/events.mjs");
  const { createUiState } = await mod("ui/tui/state.mjs");
  const state = createUiState();
  apply(state, { t: "job", id: "j1", slot: 1 });
  apply(state, { t: "job", id: "j2", slot: 2 });
  apply(state, { t: "model", thinker: "A", twin: "B", who: "thinker", slot: 1 });
  apply(state, { t: "model", thinker: "C", twin: "D", who: "twin", slot: 2 });
  assert.equal(state.slots[0].model.thinker, "A");
  assert.equal(state.slots[1].model.thinker, "C");
  assert.equal(state.slots[1].model.who, "twin");
});

test("ungueltiges model-Event wird ignoriert (kein Fake-State)", async () => {
  const { apply } = await mod("ui/tui/events.mjs");
  const { createUiState, activeSlotOf } = await mod("ui/tui/state.mjs");
  const state = createUiState();
  apply(state, { t: "job", id: "j1" });
  apply(state, { t: "model", who: "unsinn" });
  assert.equal(activeSlotOf(state).model, null, "ohne gueltige Rolle kein model-State");
  apply(state, { t: "model" });
  assert.equal(activeSlotOf(state).model, null, "leeres Event setzt nichts");
  apply(state, { t: "model", thinker: "X", who: "twin" });
  assert.equal(activeSlotOf(state).model, null, "twin-Rolle ohne twin-Modell ist ungueltig");
});

test("run.mjs emittiert model-Events (Thinker vor phase, Twin vor VERIFYING)", async () => {
  const src = fs.readFileSync(path.join(ROOT, "cli", "run.mjs"), "utf8");
  assert.match(src, /uiEvt\(\{\s*t:\s*"model"/, "run.mjs sendet model-Events");
  assert.match(src, /who:\s*"twin"/, "Twin-Rolle wird deklariert");
  assert.match(src, /who:\s*"thinker"/, "Thinker-Rolle wird deklariert");
});
