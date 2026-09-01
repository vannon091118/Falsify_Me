// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · tests/phase2.test.mjs – Worker/CLI → TUI-Verdrahtung (Phase 2)
// -----------------------------------------------------------------------------
// Prüft den FM-EVT:-Event-Vertrag der echten Produkt-Kette ohne Netz:
//   · cli/run.mjs gibt Marker NUR mit FALSIFY_UI=1 aus (sonst unverändert),
//   · Marker → createParser → UI-State-Maschine (echter Kindprozess-Stream),
//   · ui/worker.mjs bleibt headless (kein TTY) textkompatibel und ohne Marker.
// Alles läuft gegen Wegwerf-Homes (FALSIFY_HOME) – kein API-Key → Fehlerpfad.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = [];
test.after(() => { for (const fn of cleanup.splice(0)) { try { fn(); } catch {} } });

function tmpHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-p2-"));
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

// Job-ROW in einer frischen DB anlegen (wie selbsttest.sh: node -e gegen Module).
function createQueuedJob(home, { scopeId = null, mode = "plan", files = "a.js,b.js", root = ROOT } = {}) {
  const script = `import { openDb, closeDb } from "./artifacts/db.mjs";
import { createJob } from "./artifacts/jobs.mjs";
const db = openDb();
const id = createJob(db, { scopeId: ${JSON.stringify(scopeId)}, payload: "Test-Iteration", diffText: null, root: ${JSON.stringify(root)}, files: ${JSON.stringify(files)}, mode: ${JSON.stringify(mode)} });
console.log("JOB=" + id);
closeDb();`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT, env: { ...process.env, FALSIFY_HOME: home }, encoding: "utf8",
  });
  assert.equal(r.status, 0, `Job-Anlage fehlgeschlagen: ${r.stderr}`);
  const m = /JOB=(\S+)/.exec(r.stdout);
  assert.ok(m, r.stdout);
  return m[1];
}

const jobStatus = (home, jobId) => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { openDb, closeDb, falsifyHome } from "./artifacts/db.mjs";
     import { getJob } from "./artifacts/jobs.mjs";
     const db = openDb(); console.log((getJob(db, ${JSON.stringify(jobId)}) || {}).status || "NICHT-GEFUNDEN"); closeDb();`],
    { cwd: ROOT, env: { ...process.env, FALSIFY_HOME: home }, encoding: "utf8" });
  return r.stdout.trim();
};

test("run.mjs: FM-EVT-Marker NUR mit FALSIFY_UI=1 (Ausgabe sonst unveraendert)", () => {
  const home = tmpHome();
  const job = createQueuedJob(home);
  const runCli = (ui) => spawnSync(process.execPath, [path.join(ROOT, "cli", "run.mjs"), "--job-id", job], {
    env: { ...process.env, FALSIFY_HOME: home, ...(ui ? { FALSIFY_UI: "1", FALSIFY_WINDOW: "2" } : {}) },
    encoding: "utf8",
  });

  // Ohne FALSIFY_UI: keine Marker, menschlicher Text (stderr), Exit 2 (Fehlerpfad).
  const plain = runCli(false);
  assert.equal(plain.status, 2, plain.stderr);
  assert.ok(!/FM-EVT:/.test(plain.stdout), "ohne FALSIFY_UI duerfen keine Marker erscheinen");
  assert.match(plain.stderr, /FEHLER: Kein API-Key gefunden/);

  // Mit FALSIFY_UI: Job-/State-Marker zusätzlich (stdout), menschlicher Text bleibt (stderr).
  const ui = runCli(true);
  assert.equal(ui.status, 2, ui.stderr);
  assert.match(ui.stdout, /FM-EVT: \{"t":"job","id":"/);
  assert.match(ui.stdout, /"t":"state","s":"ERROR"/);
  assert.match(ui.stdout, /"t":"phase","phase":"PLAN"/);
  assert.match(ui.stdout, /"t":"files","n":2/);
  assert.match(ui.stderr, /FEHLER: Kein API-Key gefunden/, "menschlicher Text bleibt");
});

test("Worker-Pipeline: run.mjs-Marker -> createParser -> UI-State (kein Crash)", async () => {
  const home = tmpHome();
  const job = createQueuedJob(home, { files: "a.js,b.js", mode: "plan" });
  const { createUiState } = await import(pathToFileURL(path.join(ROOT, "ui", "tui", "state.mjs")).href);
  const { apply } = await import(pathToFileURL(path.join(ROOT, "ui", "tui", "events.mjs")).href);
  const { createParser } = await import(pathToFileURL(path.join(ROOT, "ui", "tui", "parser.mjs")).href);

  const state = createUiState();
  const events = [];
  const child = spawn(process.execPath, [path.join(ROOT, "cli", "run.mjs"), "--job-id", job], {
    cwd: ROOT,
    env: { ...process.env, FALSIFY_HOME: home, FALSIFY_UI: "1", FALSIFY_WINDOW: "1" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  const parser = createParser({
    onEvent: (evt) => { events.push(evt); apply(state, evt); },
    onLine: () => {},
  });
  child.stdout.on("data", (c) => parser.feed(c.toString()));
  child.stdout.on("end", () => parser.flush());
  const code = await new Promise((r) => child.on("close", r));

  assert.equal(code, 2);
  const types = events.map((e) => e.t);
  // Der Fehlerpfad (kein Key) liefert: job/state/phase/files + Endzustand ERROR.
  for (const t of ["job", "state", "phase", "files"]) assert.ok(types.includes(t), `Event ${t} fehlt: ${types.join(",")}`);
  assert.ok(types.filter((t) => t === "state").length >= 2, "mind. LOADING + ERROR als state-Events");
  // Fokus-Slot 1: Job belegt, Slot-Endzustand ERROR (global = WARTE-Screen), Whitelist-Zaehler echt.
  assert.equal(state.jobsStarted, 1);
  assert.ok(state.jobId, "Job-ID im UI-Zustand");
  assert.equal(state.slots[0].state, "ERROR");
  assert.equal(state.state, "IDLE");
  assert.equal(state.files, 2);
});

test("Worker headless (kein TTY): Claim-Loop + Text unveraendert, keine Marker", async () => {
  const home = tmpHome();
  const job = createQueuedJob(home);
  const worker = spawn(process.execPath, [path.join(ROOT, "ui", "worker.mjs")], {
    cwd: ROOT,
    env: { ...process.env, FALSIFY_HOME: home, FALSIFY_WINDOW: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  worker.stdout.on("data", (c) => { out += c; });
  worker.stderr.on("data", (c) => { err += c; });

  const deadline = Date.now() + 30000;
  let st = "";
  while (Date.now() < deadline) {
    st = jobStatus(home, job);
    if (st.startsWith("ERROR")) break;
    await sleep(500);
  }
  worker.kill();
  await new Promise((r) => worker.on("close", r));

  assert.ok(st.startsWith("ERROR API-Key fehlt"), `ECHTE Statusfolge QUEUED->RUNNING->ERROR erwartet, ist: ${st}`);
  assert.ok(!/FM-EVT:/.test(out), "Headless-Worker-Ausgabe ohne Marker");
  assert.match(out, /▶ JOB/);
  assert.match(out, /JOB FERTIG mit Fehler: ERROR/);
  // run.mjs-Fehlertext fliesst wie immer nach stderr (Sichtbarkeit bleibt).
  assert.match(err, /FEHLER: Kein API-Key gefunden/, "menschlicher Fehlertext auf stderr bleibt");
});

test("Worker --check bleibt Text (Headless-Kompatibilitaet)", () => {
  const home = tmpHome();
  const r = spawnSync(process.execPath, [path.join(ROOT, "ui", "worker.mjs"), "--check"], {
    cwd: ROOT, env: { ...process.env, FALSIFY_HOME: home }, encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "STOPPED");
});