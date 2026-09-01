import { test } from "node:test";
import assert from "node:assert/strict";
import { bump, reset, total, isPulsing, countersView, PULSE_MS, ICONS } from "./findings.mjs";
import { createUiState } from "./state.mjs";

const t0 = 5_000_000;

test("bump zaehlt; unbekannte Severity -> discovered", () => {
  const s = createUiState();
  bump(s, "critical", t0);
  bump(s, "critical", t0 + 1);
  bump(s, "warning", t0 + 2);
  bump(s, "nope", t0 + 3);
  assert.equal(s.findings.discovered, 1);
  assert.equal(s.findings.warning, 1);
  assert.equal(s.findings.critical, 2);
  assert.equal(total(s), 4);
});

test("reset setzt auf Null zurueck", () => {
  const s = createUiState();
  bump(s, "warning", t0);
  reset(s);
  assert.equal(total(s), 0);
  assert.equal(s.findings.lastSeverity, null);
});

test("isPulsing: nur innerhalb PULSE_MS nach letztem Finding", () => {
  const s = createUiState();
  assert.equal(isPulsing(s, t0), false);
  bump(s, "warning", t0);
  assert.equal(isPulsing(s, t0 + 100), true);
  assert.equal(isPulsing(s, t0 + PULSE_MS + 1), false);
});

test("countersView: Reihenfolge + Pulse-Flag nur am letzten Severity", () => {
  const s = createUiState();
  bump(s, "critical", t0);
  const v = countersView(s, t0 + 500);
  assert.deepEqual(v.map((c) => c.icon), [ICONS.discovered, ICONS.warning, ICONS.critical]);
  assert.equal(v[2].n, 1);
  assert.equal(v[2].pulse, true);
  assert.equal(v[0].pulse, false);
  assert.equal(v[1].pulse, false);
});