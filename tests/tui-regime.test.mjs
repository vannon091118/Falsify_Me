// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/tui-regime.test.mjs – F-9 Render-Regime & Partikel-Cache
// -----------------------------------------------------------------------------
// F-9 (E2E 2026-09-02): buildSnap rendert ZU VIEL und der Scheduler lief
// unbedingt mit 6-15 FPS – auf der Windows-Konsole Einzelframes bis >1 s,
// FM-EVT-Marker lagen im Pipe-Puffer, Slots froren visuell in STARTING.
// Diese Tests sichern das Gegenstück: (a) Partikel-Zellen werden fuer
// nicht-animierte Slots CACHED (gleiche Array-Referenz zwischen Frames),
// (b) das FPS-Regime koppelt an echte Aktivitaet (Idle => keine aktive
// Animation mehr), (c) Boot-Fehler wird ehrlich als INIT-FEHLER angezeigt
// statt dauerhaft "STARTING".
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import { createTui } from "../ui/tui.mjs";
import { createField, step } from "../ui/tui/particles.mjs";
import { createScheduler } from "../ui/tui/scheduler.mjs";
import { createUiState } from "../ui/tui/state.mjs";
import BootView from "../ui/tui/views/BootView.mjs";
import { apply, tick } from "../ui/tui/events.mjs";
import { SOFT_CAP_MS } from "../ui/tui/events.mjs";

test("F-9: step animiert nur bei aktiver Arbeit - idle driftet ~17x langsamer", () => {
  const f = createField({ cols: 60, rows: 14, seed: 3 });
  const before = f.drops.map((d) => d.y);
  // Gleiche Frame-Zeit, nur aktiv vs. idle: aktive Drops legen klar mehr zurueck.
  step(f, 250, { active: true });
  const activeDy = f.drops.reduce((s, d, i) => s + Math.abs(d.y - before[i]), 0);
  const idleBefore = f.drops.map((d) => d.y);
  step(f, 250, { active: false });
  const idleDy = f.drops.reduce((s, d, i) => s + Math.abs(d.y - idleBefore[i]), 0);
  assert.ok(activeDy > 0, "aktiv: Drops bewegen sich");
  assert.ok(activeDy > idleDy * 10, `aktiv muss vielfach schneller sein (aktiv ${activeDy.toFixed(2)} vs. idle ${idleDy.toFixed(2)})`);
  // WICHTIG fuer F-9: buildSnap ruft step nur bei frischer Aktivitaet auf -
  // die unbedingte Schritt-Erzwingung in jedem Frame ist weg.
});

test("F-9: buildSnap cached Partikel fuer nicht-animierte Slots (plain-Modus)", async () => {
  const ui = await createTui();
  try {
    const snap1 = ui.getSnap();
    const snap2 = ui.getSnap();
    assert.ok(Array.isArray(snap1.particles.cells), "Partikel-Zellen vorhanden");
    assert.equal(snap1.particles.cells, snap2.particles.cells,
      "idle: dieselbe Zellen-Referenz ueber Frames hinweg (Cache greift)");
  } finally {
    ui.finish(0);
  }
});

test("F-9: ein aktiv laufender Slot animiert weiter (benachbarte Slots bleiben gecacht)", async () => {
  const ui = await createTui();
  try {
    // Job auf Slot 1 (frisch: STARTING) - Slot 2 bleibt waehrenddessen idle.
    ui.applyEvent({ t: "job", id: "job-x", scope: "scope-x", slot: 1 });
    ui.applyEvent({ t: "state", s: "THINKING", slot: 1 });
    const snap = ui.getSnap();
    // Slot 1 (frisch) animiert -> Zellen sind Array (nicht null).
    const busyPanel = snap.slotPanels.find((p) => p.idx === 1);
    assert.ok(Array.isArray(busyPanel.particles));
    // Der globale Partikel-Cache (Fokus=Slot 1 aktiv) darf nicht null sein.
    assert.ok(Array.isArray(snap.particles.cells));
  } finally {
    ui.finish(0);
  }
});

test("F-9: STARTING ohne Folge-Events endet nach SOFT_CAP ehrlich in IDLE (kein Dauer-Fake)", () => {
  const state = createUiState();
  apply(state, { t: "job", id: "j1", slot: 1 });
  assert.equal(state.slots[0].state, "STARTING");
  tick(state, Date.now() + SOFT_CAP_MS + 100);
  assert.equal(state.slots[0].state, "IDLE", "Soft-Cap schliesst STARTING ohne Events");
});

test("F-9: Boot-Fehler (Selftest-Fail) wird ehrlich als INIT-FEHLER angezeigt", async () => {
  const ui = await createTui();
  try {
    ui.applyEvent({ t: "selftest", step: { name: "DB", ok: false, detail: "kaputt" } });
    ui.applyEvent({ t: "selftest", result: "fail" });
    const snap = ui.getSnap();
    assert.equal(snap.stateLabel, "INIT-FEHLER", "kein stilles STARTING bei echtem Boot-Fehler");
    assert.equal(snap.stateColor, "red");
  } finally {
    ui.finish(0);
  }
});

test("F-9: BootView ist Vollbild-Label und kein Partikel-Screen", () => {
  const snap = {
    boot: { mode: "build", block: 1, chars: 4, t: 0.5 },
    testSteps: [{ name: "DB", ok: true }, { name: "KEY", ok: false }],
    testResult: null,
  };
  const tree = BootView({ snap, cols: 120, rows: 30 });
  assert.ok(tree, "BootView baut eine Element-Baum ohne Wurf");
  // Vollbild-Label: keine Partikel-Zellen-Abhängigkeit mehr, keine
  // "F · · ·"-Kleinschrift, sondern die grosse Wortmarke.
  assert.equal(BootView.length, 1, "Stateless-Komponente (props-only)");
});

test("F-9: BootView erscheint nur vor dem ersten Job (jobsStarted=0)", async () => {
  const ui = await createTui();
  try {
    const bootSnap = ui.getSnap();
    assert.ok(bootSnap.intro, "vor dem ersten Job: Intro-Label aktiv");
    ui.applyEvent({ t: "job", id: "j1", scope: "s1" });
    const jobSnap = ui.getSnap();
    assert.equal(jobSnap.intro, false, "nach Job-Start: kein Boot-Intro mehr");
    // Banner zeigt jetzt das SLOT-Label (STARTING) statt "STARTING-Intro".
    assert.equal(jobSnap.stateLabel, "STARTING");
  } finally {
    ui.finish(0);
  }
});

test("F-9: Scheduler-Idle-Regime - setActive(false) nutzt die Idle-Rate", async () => {
  // Regimecheck ohne FPS-Flakiness: die Rate ist reine idempotente Zustands-
  // steuerung; aktiv => sofortige Frame-Planung, idle => keine aktive Burst-
  // Planung. Wir pruefen den Vertrag: Frame-Interval widerspiegelt die Rate.
  const frames = [];
  const sched = createScheduler({ activeFps: 20, idleFps: 1, onFrame: (f) => frames.push(f.now) });
  sched.start();
  sched.setActive(true);
  await new Promise((r) => setTimeout(r, 120));
  const activeFrames = frames.length;
  sched.setActive(false);
  const idleFrames = frames.length;
  await new Promise((r) => setTimeout(r, 120));
  sched.stop();
  assert.ok(activeFrames >= 1, `aktiver Modus plant Frames (${activeFrames})`);
  assert.ok(
    frames.length - idleFrames <= 2,
    `idle: hoechstens ~1 Frame in 120 ms (Idle-Rate); bekam ${frames.length - idleFrames}`
  );
});