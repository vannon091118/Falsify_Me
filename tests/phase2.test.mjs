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

// ─────────────────────────────────────────────────────────────────────────────
// ensure_dock_window (Skill) – MSYS-sicherer Fensterstart als Regression
// -----------------------------------------------------------------------------
// WIRING §4: Der Fensterstart aus Bash darf NIE ueber "cmd.exe /c start ..."
// laufen (Git-Bash zerlegt Argumente, Fehler 0x80070002, kaputte Pfade) -
// sondern via cygpath -w + PowerShell Start-Process. Der Skill ist source-
// sicher (CLI-Modus nur bei BASH_SOURCE[0] == "$0"), also sourcen wir ihn in
// einer frischen bash und schatten `node`/`powershell.exe`/`sleep` als
// bash-Funktionen: Die Start-Process-Kommandokonstruktion wird dabei exakt so
// ausgefuehrt wie im echten Skill-Lauf (echtes cygpath), ohne ein echtes
// Fenster zu oeffnen. Regression fuer UI-058/UI-063/UI-064.
// -----------------------------------------------------------------------------
const SKILL = path.join(ROOT, "skills", "agent-skill-falsify.sh");

// Fuehrt ensure_dock_window in einer frischen bash aus.
// planLines: Sequenz der fake-node-Antworten (eine Zeile pro --check-Aufruf,
//   letzte Zeile bleibt fuer weitere Aufrufe stehen).
// v2Override: ersetzt V2_DIR NACH dem Source (fuer den Fehlerpfad).
// Rueckgabe: { status, stdout, cap, nodeLog } – cap/nodeLog aus der Sandbox
//   (`` und undefined, wenn die fakes nie aufgerufen wurden).
function runEnsureDockWindow({ planLines, v2Override = "" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-dock-"));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const planFile = path.join(dir, "plan.txt");
  const capFile = path.join(dir, "cap.txt");
  const logFile = path.join(dir, "node.log");
  fs.writeFileSync(planFile, planLines.join("\n") + "\n", "utf8");
  const script = `
node() {
  local f="$FAKE_PLAN_FILE" line rest
  printf '%s' "$*" >> "$FAKE_NODE_LOG"
  if [ -f "$f" ]; then
    line=$(head -1 "$f" 2>/dev/null)
    rest=$(tail -n +2 "$f" 2>/dev/null)
    printf '%s\\n' "$rest" > "$f"
    if [ -n "$line" ]; then printf '%s\\n' "$line"; return 0; fi
  fi
  printf 'RUNNING 9999 (Fenster 1)\\n'
}
powershell.exe() { printf '%s\\n' "$*" > "$FAKE_CAP_FILE"; }
sleep() { :; }
source "$FAKE_SKILL"
[ -n "$FAKE_V2_OVERRIDE" ] && V2_DIR="$FAKE_V2_OVERRIDE"
ensure_dock_window
echo "ENSURE_EXIT=$?"
`;
  const r = spawnSync("bash", ["-c", script], {
    env: {
      ...process.env,
      FAKE_PLAN_FILE: planFile, FAKE_CAP_FILE: capFile, FAKE_NODE_LOG: logFile,
      FAKE_SKILL: SKILL, FAKE_V2_OVERRIDE: v2Override,
    },
    encoding: "utf8",
  });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    cap: fs.existsSync(capFile) ? fs.readFileSync(capFile, "utf8") : undefined,
    nodeLog: fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : undefined,
  };
}

test("Skill ensure_dock_window: laufendes Fenster -> kein Doppelstart (--check RUNNING)", () => {
  const r = runEnsureDockWindow({ planLines: ["RUNNING 4242 (Fenster 1)"] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /laufen bereits \(Worker: 4242\s*\)/);
  assert.match(r.stdout, /ENSURE_EXIT=0/);
  // Powershell darf NICHT aufgerufen worden sein (kein zweites Fenster).
  assert.equal(r.cap, undefined, "kein Start-Process bei laufendem Fenster");
  assert.match(r.nodeLog, /--check/, "--check gegen den echten Worker-Pfad");
  assert.match(r.nodeLog, /worker\.mjs/);
});

test("Skill ensure_dock_window: MSYS-sicherer Start via Start-Process + cygpath -w", () => {
  const r = runEnsureDockWindow({ planLines: ["STOPPED", "RUNNING 7777 (Fenster 1)"] });
  assert.equal(r.status, 0, r.stderr);
  // Poll fand den (langsam) startenden Worker – keine False-Negative (UI-064).
  assert.match(r.stdout, /Falsify-Worker gestartet - Fenster bleiben offen/);
  assert.match(r.stdout, /ENSURE_EXIT=0/);
  // Echte Start-Process-Kommandokonstruktion (WIRING §4), NICHT cmd /c start.
  assert.ok(r.cap, "powershell.exe wurde aufgerufen");
  assert.match(r.cap, /Start-Process -WindowStyle Normal/);
  assert.match(r.cap, /-FilePath 'cmd\.exe'/);
  assert.match(r.cap, /-ArgumentList '\/k','/);
  // cygpath -w hat den Windows-Pfad (Backslashes, Laufwerksbuchstabe) erzeugt.
  assert.match(r.cap, /"[A-Za-z]:\\[^"]*start-dock\.cmd"/, "Windows-Pfad in ArgumentList");
  // MSYS-Mangling-Regressionen: kein Forward-Slash-Pfad, kein altes Muster.
  assert.ok(!/\/ui\/start-dock\.cmd/.test(r.cap), "kein MSYS-konvertierter Pfad");
  assert.ok(!/\/c start/.test(r.cap), "kein cmd /c start Muster");
  // Der echte Repo-Worker-Pfad wurde fuer --check verwendet (V2_DIR-Aufloesung).
  assert.match(r.nodeLog, /worker\.mjs --check/);
});

test("Skill ensure_dock_window: fehlende start-dock.cmd -> klarer Fehler (Exit 1)", () => {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-dock-nocmd-"));
  cleanup.push(() => fs.rmSync(fakeRoot, { recursive: true, force: true }));
  const r = runEnsureDockWindow({ planLines: ["STOPPED"], v2Override: fakeRoot });
  assert.equal(r.status, 0); // bash -c selbst; der Fehler steht im Output
  // log_error geht auf stderr (bewusst, so bleibt stdout fuer Maschinenwerte).
  assert.match(r.stdout + r.stderr, /start-dock\.cmd fehlt/);
  assert.match(r.stdout, /ENSURE_EXIT=1/);
  assert.equal(r.cap, undefined, "kein Start ohne start-dock.cmd");
});