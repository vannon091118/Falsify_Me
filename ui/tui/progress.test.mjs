import { test } from "node:test";
import assert from "node:assert/strict";
import { PHASES, createPhases, setPhase, setPhaseDone, activePhase, isDeterminate, barText, phasesView } from "./progress.mjs";
import { createUiState } from "./state.mjs";

test("Phasenliste ist PLAN/RESEARCH/WRITE/VERDICT", () => {
  assert.deepEqual(PHASES, ["PLAN", "RESEARCH", "WRITE", "VERDICT"]);
  const ph = createPhases();
  assert.equal(ph.length, 4);
  for (const p of ph) {
    assert.equal(p.status, "pending");
    assert.equal(p.progress, null);
  }
});

test("setPhase: aktiv + optionaler echter Wert; kein Fake ohne Zahl", () => {
  const s = createUiState();
  assert.equal(setPhase(s, "RESEARCH", 0.4), true);
  assert.equal(s.phases[1].status, "active");
  assert.equal(s.phases[1].progress, 0.4);
  setPhase(s, "WRITE"); // ohne Zahl
  assert.equal(s.phases[2].status, "active");
  assert.equal(s.phases[2].progress, null);
  assert.equal(activePhase(s).phase, "WRITE");
});

test("unbekannte Phase -> false", () => {
  const s = createUiState();
  assert.equal(setPhase(s, "BOGUS", 0.5), false);
  assert.equal(setPhaseDone(s, "BOGUS"), false);
});

test("isDeterminate/barText: nur mit echten Zahlen", () => {
  const s = createUiState();
  assert.equal(isDeterminate(activePhase(s)), false);
  setPhase(s, "RESEARCH", 0.4);
  const ap = activePhase(s);
  assert.equal(isDeterminate(ap), true);
  const bar = barText(ap, 20);
  assert.equal(bar.length, 20);
  assert.ok(bar.includes("█") && bar.includes("░"));
  assert.ok(bar.indexOf("█") === 0);
  // 0 und 1 sind Abschluesse, keine "laufenden" Prozente:
  setPhase(s, "RESEARCH", 1);
  assert.equal(isDeterminate(activePhase(s)), false);
});

test("phasesView: Icons je Status", () => {
  const s = createUiState();
  setPhaseDone(s, "PLAN");
  setPhase(s, "RESEARCH", 0.5);
  const v = phasesView(s);
  assert.equal(v[0].icon, "✓");
  assert.equal(v[0].status, "done");
  assert.equal(v[1].icon, "▸");
  assert.equal(v[2].icon, "○");
});