import { test } from "node:test";
import assert from "node:assert/strict";
import { MAP, CODES, applyTo, isPulsing, view, PULSE_MS } from "./verdict.mjs";
import { createUiState } from "./state.mjs";

const t0 = 7_000_000;

test("MAP hat alle Pflicht-Verdicts", () => {
  for (const c of ["WRITE", "PLAN", "RESEARCH", "ASK", "ERROR", "TIMEOUT"]) {
    assert.ok(MAP[c], `fehlt: ${c}`);
    assert.ok(MAP[c].symbol && MAP[c].label && MAP[c].color);
  }
  assert.equal(CODES.length, 6);
});

test("WRITE -> gruener Pass, kein Fake", () => {
  assert.equal(MAP.WRITE.symbol, "✓");
  assert.equal(MAP.WRITE.color, "green");
  assert.equal(MAP.WRITE.label, "FALSIFICATION PASS");
});

test("applyTo setzt Cue + Verdict; unbekannt -> ERROR", () => {
  const s = createUiState();
  assert.equal(applyTo(s, "WRITE", t0), true);
  assert.equal(s.state, "VERDICT");
  assert.equal(s.verdict.code, "WRITE");
  const s2 = createUiState();
  applyTo(s2, "MAYBE", t0);
  assert.equal(s2.verdict.code, "ERROR");
});

test("view/isPulsing: Animation nur im Puls-Fenster", () => {
  const s = createUiState();
  applyTo(s, "PLAN", t0);
  assert.equal(isPulsing(s, t0 + 100), true);
  assert.equal(isPulsing(s, t0 + PULSE_MS + 1), false);
  const v = view(s, t0 + 100);
  assert.equal(v.symbol, "!");
  assert.equal(v.color, "yellow");
  assert.equal(v.pulse, true);
  const v2 = view(s, t0 + PULSE_MS + 1);
  assert.equal(v2.pulse, false);
});

test("view ohne Verdict -> null", () => {
  assert.equal(view(createUiState(), t0), null);
});