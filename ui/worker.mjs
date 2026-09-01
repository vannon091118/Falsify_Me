#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · ui/worker.mjs – Worker-Fenster (bis zu MAX_WINDOWS = 3)
// -----------------------------------------------------------------------------
// Der Fenster-Block ist AUFGEHOBEN: Es laufen bis zu 3 Worker-Fenster parallel
// (FALSIFY_WINDOW=1..3). Jeder Job inkl. Scope bekommt ein eigenes Fenster; ein
// Scope bleibt möglichst in seinem Fenster (Scope-Affinität). Die Warteschlange
// liegt in SQLite – Jobs werden ATOMAR geclaimt (kein Lock-File-Rennen mehr).
//
//   node ui/worker.mjs --check   → "RUNNING <pid> (Fenster <idx>)" je Fenster | "STOPPED"
//   node ui/worker.mjs --state   → "IDLE" | "BUSY <idx> <jobid>"
//   node ui/worker.mjs           → Worker starten (FALSIFY_WINDOW, Default 1)
//
// Fenster sind IMMER SICHTBAR – der Start läuft ausschliesslich über
// ui/start-dock.cmd (öffnet ein sichtbares Fenster; kein headless Start).
//
// API-Key-Slots (mehrere Keys) kommen später; aktuell teilen sich alle Fenster
// den konfigurierten API-Key (aus ~/.Falsify/.env, provider-neutral).
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, closeDb, falsifyHome } from "../artifacts/db.mjs";
import {
  claimNextJob, getJob, jobDone,
  registerWorker, unregisterWorker, heartbeatWorker,
  workerScope, setWorkerScope, workerPid, isWorkerAlive, listWorkers,
} from "../artifacts/jobs.mjs";
// ── Phase 2: Terminal-UI im Worker-Fenster ───────────────────────────────────
import { createTui } from "./tui.mjs";
import { createParser } from "./tui/parser.mjs";
import { createAbort } from "./tui/abort.mjs";

const V2_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ENTRY = path.join(V2_DIR, "cli", "run.mjs");
const MAX_WINDOWS = Number(process.env.FALSIFY_MAX_WINDOWS || 3);
const WINDOW_IDX = Number(process.env.FALSIFY_WINDOW || 1);

const title = (t) => process.stdout.write(`\x1b]0;${t}\x07`);
const bell = () => process.stdout.write("\x07");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEBUG_LOG = path.join(falsifyHome(), "logs", "worker.debug.log");
// logs/ sicherstellen: In einem frischen FALSIFY_HOME fehlt der Ordner und
// appendFileSync wuerde sonst still scheitern (kein Debug-Log sichtbar).
const dlog = (msg) => {
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true });
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* egal */ }
};

dlog(`worker.mjs gestartet (pid=${process.pid}, fenster=${WINDOW_IDX})`);

// Alle registrierten Fenster-Zeilen sind nur dann echte Worker, wenn ihre PID
// wirklich ein ui/worker.mjs-Prozess ist. PID-Recycling-Guard: Wird ein Fenster
// hart gekillt (taskkill //T z.B. aus dem Selftest-Cleanup), bleibt die Zeile
// stehen — und die PID kann an einen fremden Prozess neu vergeben werden.
// Ohne diesen Guard wuerde --check/--state dann ein falsches RUNNING/BUSY
// melden (und z.B. der Skill wuerde das Dock nicht neu starten).
function realWorkerPids() {
  try {
    const ps = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", "(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' }) | ForEach-Object { return (\"$($_.ProcessId);$($_.CommandLine)\") }"],
      { encoding: "utf8", timeout: 15000 },
    );
    if (ps.status !== 0 || !ps.stdout) return null;
    return new Set(
      ps.stdout
        .split(/\r?\n/)
        .filter((l) => l.includes("worker.mjs"))
        .map((l) => l.split(";")[0].trim())
        .filter(Boolean),
    );
  } catch {
    return null;
  }
}

function reportWorkers(filter) {
  const db = openDb();
  const workers = listWorkers(db, MAX_WINDOWS);
  const realPids = realWorkerPids(); // null => PowerShell nicht verfuegbar: DB-Aliveness als Fallback
  const alive = workers.filter((w) =>
    w.alive && (realPids ? realPids.has(String(w.pid)) : true)
  );
  const hits = alive.filter(filter ?? (() => true));
  closeDb();
  return { workers: alive, hits };
}

// ── --check: welche Worker-Fenster laufen? (für Launcher & Agents) ───────────
if (process.argv.includes("--check")) {
  const { hits: alive } = reportWorkers();
  if (!alive.length) console.log("STOPPED");
  for (const w of alive) console.log(`RUNNING ${w.pid} (Fenster ${w.idx})`);
  process.exit(0);
}

// ── --state: beschäftigt oder leer? ──────────────────────────────────────────
if (process.argv.includes("--state")) {
  const { hits: busy } = reportWorkers((w) => w.runningJob);
  if (!busy.length) console.log("IDLE");
  for (const w of busy) console.log(`BUSY ${w.idx} ${w.runningJob}${w.runningScope ? ` (scope ${w.runningScope})` : ""}`);
  process.exit(0);
}

if (!(WINDOW_IDX >= 1 && WINDOW_IDX <= MAX_WINDOWS)) {
  console.error(`FEHLER: FALSIFY_WINDOW muss zwischen 1 und ${MAX_WINDOWS} liegen (ist ${WINDOW_IDX}).`);
  process.exit(2);
}

const db = openDb();

function cleanup() {
  unregisterWorker(db, WINDOW_IDX);
  dlog(`EXIT fenster=${WINDOW_IDX}`);
  try { closeDb(); } catch { /* egal */ }
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("uncaughtException", (e) => {
  try { fs.appendFileSync(path.join(falsifyHome(), "logs", "worker.crash.log"), `${new Date().toISOString()} UNCAUGHT ${e?.stack || e}\n`); } catch { /* egal */ }
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  try { fs.appendFileSync(path.join(falsifyHome(), "logs", "worker.crash.log"), `${new Date().toISOString()} UNHANDLED ${e}\n`); } catch { /* egal */ }
  process.exit(1);
});

async function main() {
  // Gleiche Fenster-Nummer schon belegt? → dieses Fenster schließt sich.
  if (isWorkerAlive(db, WINDOW_IDX)) {
    const pid = workerPid(db, WINDOW_IDX);
    console.log(`Fenster ${WINDOW_IDX} läuft bereits (PID ${pid}) – dieses Fenster schließt sich.`);
    console.log("Die Jobs laufen über die SQLite-Warteschlange im bestehenden Fenster weiter.");
    process.exit(0);
  }
  registerWorker(db, WINDOW_IDX, process.pid);

  // ── Phase 2: TUI im sichtbaren Worker-Fenster (nur bei TTY) ───────────────
  // Die Anzeige ist reine Beobachtung: Events kommen von run.mjs (FM-EVT:-Marker)
  // bzw. von hier (Claim/Abort). Text-Ausgaben (say) bleiben dem Headless-Betrieb
  // (Agent-Kontexte, Logs) vorbehalten - Ausgabe dort unverändert wie bisher.
  const TTY = Boolean(process.stdout.isTTY);
  let ui = null;
  let childRef = null;   // laufender run.mjs-Kindprozess (für Abort)
  let aborting = false;
  const uiEvt = (o) => ui?.applyEvent({ ...o, slot: WINDOW_IDX });
  const say = (s) => {
    if (!TTY) console.log(s);
  };

  if (TTY) {
    ui = await createTui({
      onAbort: async () => { abortFlow().catch(() => {}); },
      onExit: (code) => process.exit(code || 0),
      options: { stdin: process.stdin, seed: WINDOW_IDX * 13 + 7 },
    });
  }

  const abortFlow = async () => {
    if (aborting || !ui) return;
    const child = childRef;
    if (!child) {
      // Kein Job am Laufen: Beobachtungsfenster schließen (Q/STRG-C).
      ui.finish(0);
      return;
    }
    aborting = true;
    uiEvt({ t: "state", s: "ABORTING" });
    const r = await createAbort({ child, killDelayMs: 2000 }).request();
    uiEvt({ t: "state", s: r === "ABORTED" ? "ABORTED" : "ERROR" });
    aborting = false;
  };

  say("");
  say("┌─────────────────────────────────────────────────────────────┐");
  const box = `  Falsify-Dock · Fenster ${WINDOW_IDX}/${MAX_WINDOWS}`;
  say(`│${box}${' '.repeat(58 - box.length)}│`);
  say("│  Dieses Fenster bleibt OFFEN und verarbeitet Jobs aus der   │");
  say("│  SQLite-Warteschlange (FALSIFY_HOME), live, parallel.       │");
  say("└─────────────────────────────────────────────────────────────┘");
  say(`FALSIFY_HOME : ${falsifyHome()}`);
  say("Strg+C beendet dieses Fenster. Status je Job: falsify status <job-id>");
  title(`Falsify-Dock ${WINDOW_IDX}/${MAX_WINDOWS} · wartet auf Jobs`);
  say("");

  for (;;) {
    heartbeatWorker(db, WINDOW_IDX);
    const preferred = workerScope(db, WINDOW_IDX);
    let job;
    try {
      job = claimNextJob(db, WINDOW_IDX, preferred);
    } catch (e) {
      dlog(`claim-Fehler: ${e.message}`);
      await sleep(2000);
      continue;
    }
    if (!job) { await sleep(1000); continue; }

    setWorkerScope(db, WINDOW_IDX, job.scope_id || "");
    title(`Falsify-Dock ${WINDOW_IDX} · ${job.scope_id || "ohne Scope"} · ${job.id}`);
    uiEvt({ t: "job", id: job.id, scope: job.scope_id || null });
    uiEvt({ t: "state", s: "CLAIMING" });
    say(`\n──────────────────────────────────────────────`);
    say(`▶ JOB ${job.id}  gestartet ${new Date().toLocaleTimeString()}  (Fenster ${WINDOW_IDX})`);
    say(`  Scope: ${job.scope_id || "–"}  ·  Phase: ${job.mode || "?"}`);
    if (job.root) say(`  Datenzugriff: ${job.root}`);
    if (job.files) say(`  Whitelist: ${job.files}`);
    say(`──────────────────────────────────────────────\n`);

    const child = spawn(process.execPath, [RUN_ENTRY, "--job-id", job.id], {
      cwd: V2_DIR,
      // TTY (sichtbares Fenster): stdout des Kindes wird gefüttert (FM-EVT:
      // → UI-Pipeline; sonstige Zeilen → Ring). Headless: wie bisher inheriten,
      // damit die Ausgabe unverändert im Fenster/Log landet.
      ...(TTY
        ? { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FALSIFY_UI: "1" } }
        : { stdio: "inherit" }),
    });
    childRef = child;
    if (TTY) {
      const parser = createParser({
        onEvent: (evt) => ui.applyEvent({ ...evt, slot: WINDOW_IDX }),
        onLine: (line) => ui?.noteLine(line),
      });
      child.stdout.on("data", (chunk) => parser.feed(chunk.toString()));
      child.stdout.on("end", () => parser.flush());
      child.stderr.on("data", (chunk) => {
        for (const l of chunk.toString().split("\n")) if (l.trim()) ui?.noteLine(l);
      });
    }
    const code = await new Promise((resolve) => child.on("close", resolve));
    childRef = null;
    dlog(`job ${job.id} beendet code=${code}`);

    // Falls run.mjs den Job nicht abgeschlossen hat (Crash), hier nachziehen.
    const done = getJob(db, job.id);
    if (!done || done.status === "RUNNING") {
      jobDone(db, job.id, null, `Worker-Abbruch (Exit-Code ${code})`);
      uiEvt({ t: "state", s: "ERROR" });
    }

    say(`\n──────────────────────────────────────────────`);
    const d = getJob(db, job.id);
    if (d?.status?.startsWith("DONE")) {
      const v = d.verdict || d.status.replace("DONE ", "");
      if (v === "WRITE") {
        say("▶ JOB FERTIG: WRITE — Freigabe: READ-ONLY → WRITE.");
        title(`Falsify-Dock ${WINDOW_IDX} · FERTIG: WRITE`);
        bell();
      } else if (v === "RESEARCH") {
        say("▶ JOB FERTIG: RESEARCH — FalsifyMe braucht weitere Daten (Loop).");
        title(`Falsify-Dock ${WINDOW_IDX} · FERTIG: RESEARCH`);
        bell();
      } else if (v === "PLAN") {
        say("▶ JOB FERTIG: PLAN — Iteration überarbeiten (Loop).");
        title(`Falsify-Dock ${WINDOW_IDX} · FERTIG: PLAN`);
        bell();
      } else {
        say(`▶ JOB FERTIG: ${v} — nicht freigegeben.`);
        title(`Falsify-Dock ${WINDOW_IDX} · FERTIG: ${v}`);
        bell();
      }
    } else if (d?.status?.startsWith("ERROR")) {
      say(`▶ JOB FERTIG mit Fehler: ${d.status}`);
      title(`Falsify-Dock ${WINDOW_IDX} · FEHLER`);
      bell();
    } else {
      say(`▶ JOB FERTIG mit Code ${code} (Fehler – siehe oben)`);
      title(`Falsify-Dock ${WINDOW_IDX} · FEHLER`);
      bell();
    }
    say(`──────────────────────────────────────────────\n`);

    await sleep(400);
    title(`Falsify-Dock ${WINDOW_IDX}/${MAX_WINDOWS} · wartet auf Jobs`);
  }
}

// Nur bei direktem Aufruf ausführen (Import bleibt reiner Modul-Import).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
