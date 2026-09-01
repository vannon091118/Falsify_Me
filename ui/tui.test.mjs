// FalsifyMe TUI - Kompositions-Tests (Plain-Modus: kein TTY noetig)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTui } from "./tui.mjs";
import { createParser } from "./tui/parser.mjs";
import { createAbort, isDead } from "./tui/abort.mjs";

const AGENT = fileURLToPath(new URL("./demo-agent.mjs", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("plain: createTui liefert Plain-Branch (kein TTY)", async () => {
  const ui = await createTui();
  assert.equal(ui.plain, true);
  assert.ok(ui.applyEvent && ui.noteLine && ui.finish);
});

test("plain: Event-Pipeline boot->job->state->verdict->done", async () => {
  const ui = await createTui();
  ui.applyEvent({ t: "boot" });
  assert.equal(ui.state.state, "STARTING");
  ui.applyEvent({ t: "job", id: "job-1234-ab", scope: "scope-5678", window: 2 });
  assert.equal(ui.state.jobId, "34AB", "shortId = unterscheidbarer Suffix, nicht Praefix");
  ui.applyEvent({ t: "state", s: "LOADING" });
  ui.applyEvent({ t: "state", s: "CLAIMING" });
  ui.applyEvent({ t: "state", s: "THINKING" });
  ui.applyEvent({ t: "activity", tool: "read_file", file: "app.js", label: "read_file(app.js)" });
  ui.applyEvent({ t: "phase", phase: "PLAN" });
  ui.applyEvent({ t: "phase_done", phase: "PLAN" });
  ui.applyEvent({ t: "finding", severity: "critical" });
  ui.applyEvent({ t: "verdict", v: "WRITE" });
  assert.equal(ui.state.state, "VERDICT");
  ui.applyEvent({ t: "done" });
  assert.equal(ui.state.slots[1].state, "SUCCESS", "job window:2 -> Slot 2");
  const snap = ui.getSnap();
  assert.equal(snap.stateLabel, "WARTE AUF EINGABE", "JOB fertig -> Warte-Screen");
  assert.equal(snap.verdict.code, "WRITE");
  assert.equal(snap.boot.mode, "live");
});

test("plain: noteLine befuellt Ring begrenzt + Metrics", async () => {
  const ui = await createTui();
  for (let i = 0; i < 500; i++) ui.noteLine(`line ${i}`);
  assert.equal(ui.state.output.length, 200);
  assert.equal(ui.metrics.lines, 500);
  const snap = ui.getSnap();
  assert.ok(snap.metrics.spark.length > 0);
});

test("plain: VERIFYING (Evil Twin) setzt twinActive und zeigt Roh-Text", async () => {
  const ui = await createTui();
  ui.applyEvent({ t: "boot" });
  ui.applyEvent({ t: "job", id: "job-1", scope: "scope-1" });
  ui.applyEvent({ t: "state", s: "THINKING" });
  ui.applyEvent({ t: "state", s: "FINDINGS" });
  assert.equal(ui.getSnap().twinActive, false, "vor der Gegenpruefung kein Twin-Bild");
  // Roh-Text des Gegenpruefers streamt in den Output-Ring (worker noteLine)
  for (let i = 0; i < 5; i++) ui.noteLine(`twin-rohtext ${i}: datei.js:${i}`);
  ui.applyEvent({ t: "state", s: "VERIFYING" });
  assert.equal(ui.state.slots[0].state, "VERIFYING");
  const snap = ui.getSnap();
  assert.equal(snap.twinActive, true, "Gegenpruefung laeuft -> Rot/Schwarz-Bildschirm");
  assert.equal(snap.stateColor, "red", "VERIFYING-Farbe = rot (Evil-Twin-Kontrast)");
  assert.ok(snap.output.some((l) => String(l).includes("twin-rohtext")), "Twin-Roh-Text im Ring");
  assert.ok(snap.slots[0].twinActive, "Slots-Spiegel traegt twinActive");
  // Nach der Gegenpruefung: Bild wechselt zurueck
  ui.applyEvent({ t: "state", s: "FINDINGS" });
  assert.equal(ui.getSnap().twinActive, false, "nach der Gegenpruefung normales Bild");
});

test("plain: stats-Event (Progression-Anker) wird global gespeichert", async () => {
  const ui = await createTui();
  assert.equal(ui.getSnap().stats, null, "ohne Event kein Anker");
  ui.applyEvent({ t: "stats", data: { jobsTotal: 11, errorsCaught: 4, scopesTotal: 2, releases: 2, findingsTotal: 13, modelCalls: 12, jobsByVerdict: { WRITE: 2, PLAN: 5, RESEARCH: 2, UNBEKANNT: 1 }, sqlite: { bytes: 49152, rowsPerTable: { jobs: 11 } } } });
  const snap = ui.getSnap();
  assert.equal(snap.stats.jobsTotal, 11);
  assert.equal(snap.stats.errorsCaught, 4);
  assert.equal(snap.stats.releases, 2);
  // Ungueltiges Event (kein data-Objekt): ignoriert, kein Crash
  assert.equal(ui.applyEvent({ t: "stats" }), true);
  assert.equal(ui.getSnap().stats.jobsTotal, 11, "bestehender Anker bleibt");
});

test("plain: Aktivitaets-Labels landen im Partikel-Pool", async () => {
  const ui = await createTui();
  ui.applyEvent({ t: "activity", tool: "glob", file: "**/*.js", label: "glob('**/*.js')" });
  const snap = ui.getSnap();
  assert.ok(snap.particles.cells.length > 0);
});

test("E2E plain: echter Agenten-Stream wird zu Events + WRITE-Verdict", async () => {
  const ui = await createTui();
  const child = spawn(process.execPath, [AGENT], { env: { ...process.env, FM_SCENARIO: "write", FM_FAST: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  const parser = createParser({ onEvent: (e) => ui.applyEvent(e), onLine: (l) => ui.noteLine(l) });
  child.stdout.on("data", (c) => parser.feed(c.toString()));
  child.stdout.on("end", () => parser.flush());
  const code = await new Promise((res) => child.on("close", res));
  assert.equal(code, 0);
  assert.equal(ui.state.slots[0].state, "SUCCESS", "WRITE -> Slot SUCCESS");
  assert.equal(ui.state.slots[0].verdict.code, "WRITE");
  assert.ok(ui.state.slots[0].findings.discovered >= 2);
  assert.equal(ui.state.slots[0].phases[0].status, "done"); // PLAN
  assert.equal(ui.state.slots[0].phases[1].status, "done"); // RESEARCH
  assert.ok(ui.metrics.events > 10);
  assert.ok(ui.metrics.lines > 0);
});

test("E2E plain: ERROR-Szenario -> Zustand ERROR, Exit 3", async () => {
  const ui = await createTui();
  const child = spawn(process.execPath, [AGENT], { env: { ...process.env, FM_SCENARIO: "error", FM_FAST: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  const parser = createParser({ onEvent: (e) => ui.applyEvent(e), onLine: () => {} });
  child.stdout.on("data", (c) => parser.feed(c.toString()));
  child.stdout.on("end", () => parser.flush());
  const code = await new Promise((res) => child.on("close", res));
  assert.equal(code, 3);
  assert.equal(ui.state.slots[0].state, "ERROR");
});

test("E2E plain: TIMEOUT-Szenario -> Zustand TIMEOUT", async () => {
  const ui = await createTui();
  const child = spawn(process.execPath, [AGENT], { env: { ...process.env, FM_SCENARIO: "timeout", FM_FAST: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  const parser = createParser({ onEvent: (e) => ui.applyEvent(e), onLine: () => {} });
  child.stdout.on("data", (c) => parser.feed(c.toString()));
  child.stdout.on("end", () => parser.flush());
  await new Promise((res) => child.on("close", res));
  assert.equal(ui.state.slots[0].state, "TIMEOUT");
});

test("E2E plain: 2 Agenten parallel auf Slot 1+2 -> unabhaengige Endzustaende", async () => {
  const ui = await createTui();
  const spawnAgent = (scn, slot) => {
    const child = spawn(process.execPath, [AGENT], { env: { ...process.env, FM_SCENARIO: scn, FM_SLOT: String(slot), FM_FAST: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    // Slot hart am Kind verankern (wie die spaetere Integration: Komposition
    // taggt Events mit dem Fenster-Slot des Kindes).
    const parser = createParser({ onEvent: (e) => ui.applyEvent({ ...e, slot }), onLine: () => {} });
    child.stdout.on("data", (c) => parser.feed(c.toString()));
    child.stdout.on("end", () => parser.flush());
    return new Promise((res) => child.on("close", res));
  };
  const [c1, c2] = await Promise.all([spawnAgent("write", 1), spawnAgent("error", 2)]);
  assert.equal(c1, 0);
  assert.equal(c2, 3);
  assert.equal(ui.state.slots[0].state, "SUCCESS");
  assert.equal(ui.state.slots[1].state, "ERROR");
  assert.equal(ui.state.jobsStarted, 2);
  const snap = ui.getSnap();
  assert.equal(snap.globalIdle, true, "alle Slots endzustaendig -> WARTE AUF EINGABE");
  assert.equal(snap.slots.length, 3);
  assert.equal(snap.state, "IDLE");
  assert.equal(snap.stateLabel, "WARTE AUF EINGABE");
});

test("TTY-Views: App rendert Boot/Live/Reasoning/Verdict via Ink (fake stdout)", async () => {
  const ui = await createTui();
  // Boot-Zustand
  ui.applyEvent({ t: "boot" });
  let snap = ui.getSnap();

  const { EventEmitter } = await import("node:events");
  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = true;
  fakeStdin.setRawMode = () => fakeStdin;
  fakeStdin.setEncoding = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.resume = () => {};
  fakeStdin.read = () => null;

  const { render } = await import("ink");
  const App = (await import("./tui/views/App.mjs")).default;
  const React = (await import("react")).default;
  const h = React.createElement;

  // Jede Mount-Benutzung bekommt ein EIGENES stdout-Objekt: Ink registriert
  // Instanzen pro stdout-Identitaet und warnt bei Wiederverwendung desselben
  // Objekts ("render() called again ... Call unmount() first"), da das
  // Aufraeumen der alten Instanz asynchron laeuft.
  const makeFakeOut = () => ({
    write() {},
    columns: 100,
    rows: 30,
    isTTY: true,
    on() {},
  });

  const mount = (s) =>
    render(h(App, { getSnapshot: () => s, subscribe: () => () => {}, emit: () => {} }), {
      stdout: makeFakeOut(),
      stdin: fakeStdin,
      exitOnCtrlC: false,
    });

  let inst = mount(snap); // Boot-Ansicht
  inst.unmount();

  // Evil-Twin-Ansicht (Regel 6, UI-109): Rot/Schwarz-Kontrast-Bildschirm mit
  // dem Roh-Text des Gegenpruefers (VERIFYING) - rendert fehlerfrei.
  inst = mount({ ...snap, globalIdle: false, state: "VERIFYING", stateLabel: "VERIFYING", stateColor: "red", twinActive: true, boot: { mode: "live", chars: 9, block: 3, t: 1 }, output: ["Ich pruefe: datei.js:12", "BESTAETIGT? Warten ..."] });
  inst.unmount();

  snap = snap && { ...snap, boot: { mode: "live", chars: 9, block: 3, t: 1 } };
  inst = mount(snap); // Live (Partikel) Ansicht
  inst.unmount();

  inst = mount({ ...snap, mode: "reasoning" }); // Reasoning-Ansicht
  inst.unmount();

  inst = mount({ ...snap, state: "VERDICT", stateLabel: "VERDICT", stateColor: "magenta", verdict: { code: "WRITE", symbol: "✓", color: "green", label: "FALSIFICATION PASS", hint: "FREIGABE", pulse: true } });
  inst.unmount(); // Verdict-Ansicht

  inst = mount({ ...snap, state: "ERROR", stateLabel: "ERROR", stateColor: "red", overlay: { lines: [" ✕  ERROR  –  FALSIFICATION FAILED "], color: "red" } });
  inst.unmount(); // Error-Overlay-Ansicht

  // Idle-Ansicht (WARTE AUF EINGABE): leerer History-Pfad
  inst = mount({ ...snap, globalIdle: true, state: "IDLE", stateLabel: "WARTE AUF EINGABE" });
  inst.unmount();

  // Idle-Ansicht MIT Progression-Anker (stats-Event): rendert fehlerfrei
  inst = mount({
    ...snap, globalIdle: true, state: "IDLE", stateLabel: "WARTE AUF EINGABE",
    stats: { jobsTotal: 11, errorsCaught: 4, scopesTotal: 2, releases: 2, findingsTotal: 13, modelCalls: 12, jobsByVerdict: { WRITE: 2, PLAN: 5, RESEARCH: 2, UNBEKANNT: 1 }, sqlite: { bytes: 49152, rowsPerTable: { jobs: 11 } } },
  });
  inst.unmount();

  // Idle-Ansicht mit ECHTER Session-History (Slot mit Vorderdict + letzte Events)
  const idleSnap = {
    ...snap,
    globalIdle: true,
    state: "IDLE",
    stateLabel: "WARTE AUF EINGABE",
    slots: [
      { idx: 1, state: "SUCCESS", jobId: "job-1234-ab", verdict: { code: "WRITE" } },
      { idx: 2, state: "IDLE" },
      { idx: 3, state: "IDLE" },
    ],
    lastEvents: [
      { t: "activity", tool: "read_file", file: "app.js" },
      { t: "verdict", v: "WRITE" },
    ],
  };
  inst = mount(idleSnap);
  inst.unmount();

  // Tiny-Size-Pfad
  inst = mount({ ...snap, dims: { cols: 20, rows: 8 } });
  inst.unmount();
});

test("Abort: echtes Kind wird gekillt + verifiziert (kein weiterlaufender Prozess)", async () => {
  const ui = await createTui();
  const child = spawn(process.execPath, [AGENT], { env: { ...process.env, FM_SCENARIO: "write" }, stdio: ["ignore", "pipe", "pipe"] });
  const parser = createParser({ onEvent: (e) => ui.applyEvent(e), onLine: () => {} });
  child.stdout.on("data", (c) => parser.feed(c.toString()));
  await sleep(400); // Agent mitten in der Arbeit
  const ab = createAbort({ child, killDelayMs: 1500 });
  ui.applyEvent({ t: "state", s: "ABORTING" });
  const res = await ab.request();
  assert.equal(res, "ABORTED");
  assert.equal(isDead(child.pid), true, "kein weiterlaufender Child-Prozess nach Abort");
  ui.applyEvent({ t: "state", s: "ABORTED" });
  assert.equal(ui.state.slots[0].state, "ABORTED");
});