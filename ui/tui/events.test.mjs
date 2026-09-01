import { test } from "node:test";
import assert from "node:assert/strict";
import { createUiState, SLOT_TERMINAL } from "./state.mjs";
import { apply, focusSlot, tick, SOFT_CAP_MS } from "./events.mjs";

const t0 = 1_000_000;

test("boot: IDLE -> STARTING", () => {
  const s = createUiState();
  assert.equal(apply(s, { t: "boot" }, t0), true);
  assert.equal(s.state, "STARTING");
  assert.equal(s.bootAt, t0);
});

test("job: belegt Slot (window/slot) + Fokus folgt + resettet Slot-Anzeigen", () => {
  const s = createUiState();
  apply(s, { t: "job", id: "job-8f42-77", scope: "scope-31a7", window: 2 }, t0);
  assert.equal(s.jobId, "JOB8");
  assert.equal(s.scopeId, "SCOP");
  assert.equal(s.activeSlotIdx, 2, "Fokus folgt dem neuesten Job");
  assert.equal(s.slots[1].state, "STARTING");
  assert.equal(s.state, "STARTING", "Spiegel = aktiver Slot");
  assert.deepEqual(s.slots[1].findings, { discovered: 0, warning: 0, critical: 0, lastAt: 0, lastSeverity: null });
});

test("job: belegter Wunsch-Slot -> naechster freier Slot", () => {
  const s = createUiState();
  apply(s, { t: "job", id: "a", slot: 1 }, t0);
  // Slot 1 laeuft, neuer Job will Slot 1 -> freier Slot 2
  apply(s, { t: "job", id: "b", slot: 1 }, t0 + 1);
  assert.equal(s.slots[0].jobId, "A");
  assert.equal(s.slots[1].jobId, "B");
  assert.equal(s.activeSlotIdx, 2);
});

test("state: erlaubte und verbotene Uebergaenge (pro Slot)", () => {
  const s = createUiState();
  apply(s, { t: "state", s: "THINKING" }, t0); // aus IDLE nicht erlaubt -> false
  assert.equal(s.slots[0].state, "IDLE");
  apply(s, { t: "job", id: "j1" }, t0);
  apply(s, { t: "state", s: "THINKING" }, t0 + 1);
  assert.equal(s.slots[0].state, "THINKING");
  assert.equal(s.state, "THINKING");
  apply(s, { t: "state", s: "ABORTING" }, t0 + 2);
  assert.equal(s.state, "ABORTING");
});

test("parallel: beide Slots unabhaengig, Spiegel zeigt Fokus-Slot", () => {
  const s = createUiState();
  apply(s, { t: "job", id: "slot1-job", slot: 1 }, t0);
  apply(s, { t: "state", s: "THINKING", slot: 1 }, t0 + 1);
  apply(s, { t: "job", id: "slot2-job", slot: 2 }, t0 + 2); // Fokus -> Slot 2
  apply(s, { t: "state", s: "CLAIMING", slot: 2 }, t0 + 3);
  assert.equal(s.slots[0].state, "THINKING");
  assert.equal(s.slots[1].state, "CLAIMING");
  assert.equal(s.activeSlotIdx, 2);
  assert.equal(s.state, "CLAIMING", "Spiegel = Fokus");

  // Fokus wechseln -> Spiegel folgt
  assert.equal(apply(s, { t: "focus", slot: 1 }, t0 + 4), true);
  assert.equal(s.state, "THINKING");

  // Slot 1 endet -> Slot 2 laeuft noch -> NICHT globalIdle
  apply(s, { t: "done", slot: 1 }, t0 + 5);
  assert.equal(s.slots[0].state, "IDLE");
  assert.equal(s.slots[1].state, "CLAIMING");
  assert.equal(apply(s, { t: "focus", slot: 2 }, t0 + 6), true);
  assert.equal(s.state, "CLAIMING");
});

test("globalIdle: erst wenn ALLE Slots endzustaendig", () => {
  const s = createUiState();
  assert.equal(s.slots.every((x) => SLOT_TERMINAL.has(x.state)), true);
  apply(s, { t: "job", id: "j1", slot: 1 }, t0);
  apply(s, { t: "job", id: "j2", slot: 2 }, t0 + 1);
  apply(s, { t: "done", slot: 1 }, t0 + 2); // WRITE fehlt -> IDLE
  apply(s, { t: "done", slot: 2 }, t0 + 3);
  assert.equal(s.slots[0].state, "IDLE");
  assert.equal(s.slots[1].state, "IDLE");
  assert.equal(s.state, "IDLE", "alle Slots frei -> WARTE AUF EINGABE");
});

test("activity: setzt Label + letzte Aktivitaet + Event im Slot-Ring", () => {
  const s = createUiState();
  apply(s, { t: "job", id: "j1" }, t0);
  apply(s, { t: "state", s: "THINKING" }, t0 + 1);
  apply(s, { t: "activity", tool: "read_file", file: "app.js", label: "read_file(app.js)" }, t0 + 2);
  assert.equal(s.activity.tool, "read_file");
  assert.equal(s.activity.file, "app.js");
  assert.equal(s.slots[0].lastActivityAt, t0 + 2);
  assert.equal(s.slots[0].events.last().t, "activity");
});

test("finding: Zaehler + Severity-Fallback (pro Slot)", () => {
  const s = createUiState();
  apply(s, { t: "finding", severity: "critical" }, t0);
  apply(s, { t: "finding", severity: "critical" }, t0 + 1);
  apply(s, { t: "finding", severity: "warning" }, t0 + 2);
  apply(s, { t: "finding", severity: "bogus" }, t0 + 3); // Fallback discovered
  assert.equal(s.slots[0].findings.critical, 2);
  assert.equal(s.slots[0].findings.warning, 1);
  assert.equal(s.slots[0].findings.discovered, 1);
});

test("phase: determinate/indeterminate + done", () => {
  const s = createUiState();
  apply(s, { t: "phase", phase: "RESEARCH", progress: 0.4 }, t0);
  assert.equal(s.slots[0].phases[1].status, "active");
  assert.equal(s.slots[0].phases[1].progress, 0.4);
  apply(s, { t: "phase", phase: "WRITE" }, t0 + 1); // ohne Zahl -> bleibt indeterminiert
  assert.equal(s.slots[0].phases[2].status, "active");
  assert.equal(s.slots[0].phases[2].progress, null);
  apply(s, { t: "phase_done", phase: "WRITE" }, t0 + 2);
  assert.equal(s.slots[0].phases[2].status, "done");
  assert.equal(s.slots[0].phases[2].progress, 1);
});

test("verdict: setzt Cue VERDICT; done -> WRITE=SUCCESS, sonst IDLE", () => {
  const s = createUiState();
  apply(s, { t: "job", id: "j1" }, t0);
  apply(s, { t: "verdict", v: "WRITE" }, t0 + 1);
  assert.equal(s.slots[0].state, "VERDICT");
  assert.equal(s.state, "VERDICT");
  assert.equal(s.verdict.code, "WRITE");
  apply(s, { t: "done" }, t0 + 2);
  assert.equal(s.slots[0].state, "SUCCESS");
  assert.equal(s.state, "IDLE", "letzter Job fertig -> global WARTE AUF EINGABE");

  const s2 = createUiState();
  apply(s2, { t: "job", id: "j2" }, t0);
  apply(s2, { t: "verdict", v: "PLAN" }, t0 + 1);
  apply(s2, { t: "done" }, t0 + 2);
  assert.equal(s2.state, "IDLE"); // Plan -> Queue -> ehrlich warten
});

test("verdict: unbekannter Code -> ERROR, kein Fake", () => {
  const s = createUiState();
  apply(s, { t: "job", id: "j1" }, t0);
  apply(s, { t: "verdict", v: "BOGUS" }, t0 + 1);
  assert.equal(s.verdict.code, "ERROR");
  assert.equal(s.state, "VERDICT");
});

test("output: Ring bleibt begrenzt (Fokus-Slot)", () => {
  const s = createUiState();
  for (let i = 0; i < 500; i++) apply(s, { t: "output", line: `line ${i}` }, t0);
  assert.equal(s.slots[0].output.length, 200);
  assert.equal(s.slots[0].output.last(), "line 499");
});

test("tick: STARTING ohne Events endet ehrlich in IDLE (Soft-Cap)", () => {
  const s = createUiState();
  apply(s, { t: "boot" }, t0);
  tick(s, t0 + SOFT_CAP_MS + 1);
  assert.equal(s.state, "IDLE");
  // Mit Events vor dem Cap bleibt STARTING/LOADING:
  const s2 = createUiState();
  apply(s2, { t: "job", id: "j1" }, t0);
  apply(s2, { t: "state", s: "LOADING" }, t0 + SOFT_CAP_MS - 1000);
  tick(s2, t0 + SOFT_CAP_MS + 1000);
  assert.equal(s2.state, "LOADING");
  // Ein Job, der haengt, gibt seinen Slot ehrlich frei:
  const s3 = createUiState();
  apply(s3, { t: "job", id: "j1", slot: 2 }, t0);
  tick(s3, t0 + SOFT_CAP_MS + 1);
  assert.equal(s3.slots[1].state, "IDLE");
});

test("unbekanntes Event -> false, State unveraendert", () => {
  const s = createUiState();
  assert.equal(apply(s, { t: "nonsense" }, t0), false);
  assert.equal(apply(s, null, t0), false);
  assert.equal(s.state, "IDLE");
});

test("state-Event: kein direkter Sprung SUCCESS -> THINKING", () => {
  const s = createUiState();
  apply(s, { t: "job", id: "j1" }, t0);
  apply(s, { t: "verdict", v: "WRITE" }, t0 + 1);
  apply(s, { t: "done" }, t0 + 2);
  assert.equal(s.slots[0].state, "SUCCESS");
  apply(s, { t: "state", s: "THINKING" }, t0 + 3); // ungueltig -> bleibt SUCCESS
  assert.equal(s.slots[0].state, "SUCCESS");
});

test("focusSlot: nur gueltige 1..3", () => {
  const s = createUiState();
  assert.equal(focusSlot(s, 3), true);
  assert.equal(s.activeSlotIdx, 3);
  assert.equal(focusSlot(s, 0), false);
  assert.equal(focusSlot(s, 4), false);
  assert.equal(focusSlot(s, "2"), false, "kein String-Coercion");
  assert.equal(s.activeSlotIdx, 3);
});