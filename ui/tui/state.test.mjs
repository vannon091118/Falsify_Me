import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES, canTransition, createUiState, shortId, isActive, STATE_LABEL, activeSlotOf, busySlots, globalIdle } from "./state.mjs";

test("Zustaende enthalten alle Pflicht-Zustaende", () => {
  for (const s of ["STARTING", "LOADING", "CLAIMING", "THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERDICT", "SUCCESS", "ERROR", "ABORTING", "ABORTED", "IDLE"]) {
    assert.ok(STATES.includes(s), `fehlt: ${s}`);
  }
});

test("jeder Zustand hat ein Label", () => {
  for (const s of STATES) {
    assert.ok(typeof STATE_LABEL[s] === "string" && STATE_LABEL[s].length > 0, `Label fehlt: ${s}`);
  }
});

test("canTransition: erlaubte + verbotene Uebergaenge", () => {
  assert.ok(canTransition("IDLE", "STARTING"));
  assert.ok(canTransition("THINKING", "TOOL_ACTIVITY"));
  assert.ok(canTransition("THINKING", "VERDICT"));
  assert.ok(canTransition("VERDICT", "SUCCESS"));
  assert.ok(!canTransition("SUCCESS", "THINKING"));
  assert.ok(!canTransition("IDLE", "SUCCESS"));
  assert.ok(canTransition("RUNNING", "ABORTING") === false); // RUNNING existiert nicht als Zustand
});

test("Abbruch-Pfad: jeder aktive Zustand darf ABORTING erreichen", () => {
  for (const s of ["STARTING", "LOADING", "CLAIMING", "THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERDICT"]) {
    assert.ok(canTransition(s, "ABORTING"), `${s} -> ABORTING`);
  }
  assert.ok(canTransition("ABORTING", "ABORTED"));
});

test("createUiState: Initialstruktur", () => {
  const s = createUiState();
  assert.equal(s.state, "IDLE");
  assert.equal(s.phases.length, 4);
  assert.equal(s.findings.discovered, 0);
  assert.equal(s.events.capacity, 80);
  assert.equal(s.output.capacity, 200);
});

test("3 Fenster-Slots im einen Terminal (pid): alle initial IDLE", () => {
  const s = createUiState();
  assert.equal(s.slots.length, 3);
  for (const slot of s.slots) {
    assert.equal(slot.state, "IDLE");
    assert.equal(slot.findings.discovered, 0);
    assert.equal(slot.phases.length, 4);
    assert.equal(slot.events.capacity, 80);
    assert.equal(slot.output.capacity, 200);
  }
  assert.equal(s.activeSlotIdx, 1);
});

test("globalIdle: wahr bei keiner Arbeit, falsch sobald ein Slot beschaeftigt", () => {
  const s = createUiState();
  assert.equal(globalIdle(s), true);
  s.slots[1].state = "THINKING";
  assert.equal(globalIdle(s), false);
  s.slots[1].state = "ABORTED";
  assert.equal(globalIdle(s), true, "ABORTED ist endzustaendig -> wieder frei");
});

test("activeSlotOf/busySlots/slotsOf Helfer", () => {
  const s = createUiState();
  assert.equal(activeSlotOf(s).idx, 1);
  s.activeSlotIdx = 3;
  assert.equal(activeSlotOf(s).idx, 3);
  s.slots[0].state = "THINKING";
  s.slots[2].state = "FINDINGS";
  assert.deepEqual(busySlots(s).map((x) => x.idx), [1, 3]);
  assert.equal(globalIdle(s), false);
});

test("shortId: normalisiert und kuert", () => {
  assert.equal(shortId("8f42a1"), "8F42");
  assert.equal(shortId("scope-31a7-xyz"), "SCOP");
  assert.equal(shortId(""), null);
  assert.equal(shortId(null), null);
});

test("isActive: nur bei echtem Aktivitaetszustand + frischer Aktivitaet", () => {
  const s = createUiState();
  assert.equal(isActive(s, Date.now()), false); // IDLE
  s.state = "THINKING";
  s.lastActivityAt = Date.now();
  assert.equal(isActive(s, Date.now()), true);
  s.lastActivityAt = Date.now() - 60_000;
  assert.equal(isActive(s, Date.now()), false); // veraltet -> ehrlich inaktiv
});