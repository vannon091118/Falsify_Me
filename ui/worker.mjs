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
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, closeDb, falsifyHome } from "../artifacts/db.mjs";
import {
  claimNextJob, getJob, jobDone,
  registerWorker, unregisterWorker, heartbeatWorker,
  workerScope, setWorkerScope, workerPid, isWorkerAlive, listWorkers,
} from "../artifacts/jobs.mjs";

const V2_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ENTRY = path.join(V2_DIR, "cli", "run.mjs");
const MAX_WINDOWS = Number(process.env.FALSIFY_MAX_WINDOWS || 3);
const WINDOW_IDX = Number(process.env.FALSIFY_WINDOW || 1);

const title = (t) => process.stdout.write(`\x1b]0;${t}\x07`);
const bell = () => process.stdout.write("\x07");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEBUG_LOG = path.join(falsifyHome(), "logs", "worker.debug.log");
const dlog = (msg) => { try { fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`); } catch { /* egal */ } };

dlog(`worker.mjs gestartet (pid=${process.pid}, fenster=${WINDOW_IDX})`);

// ── --check: welche Worker-Fenster laufen? (für Launcher & Agents) ───────────
if (process.argv.includes("--check")) {
  const db = openDb();
  const workers = listWorkers(db, MAX_WINDOWS);
  const alive = workers.filter((w) => w.alive);
  if (!alive.length) console.log("STOPPED");
  for (const w of alive) console.log(`RUNNING ${w.pid} (Fenster ${w.idx})`);
  closeDb();
  process.exit(0);
}

// ── --state: beschäftigt oder leer? ──────────────────────────────────────────
if (process.argv.includes("--state")) {
  const db = openDb();
  const workers = listWorkers(db, MAX_WINDOWS);
  const busy = workers.filter((w) => w.alive && w.runningJob);
  if (!busy.length) console.log("IDLE");
  for (const w of busy) console.log(`BUSY ${w.idx} ${w.runningJob}${w.runningScope ? ` (scope ${w.runningScope})` : ""}`);
  closeDb();
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

  console.log("");
  console.log("┌─────────────────────────────────────────────────────────────┐");
  const box = `  Falsify-Dock · Fenster ${WINDOW_IDX}/${MAX_WINDOWS}`;
  console.log(`│${box}${' '.repeat(58 - box.length)}│`);
  console.log("│  Dieses Fenster bleibt OFFEN und verarbeitet Jobs aus der   │");
  console.log("│  SQLite-Warteschlange (FALSIFY_HOME), live, parallel.       │");
  console.log("└─────────────────────────────────────────────────────────────┘");
  console.log(`FALSIFY_HOME : ${falsifyHome()}`);
  console.log("Strg+C beendet dieses Fenster. Status je Job: falsify status <job-id>");
  title(`Falsify-Dock ${WINDOW_IDX}/${MAX_WINDOWS} · wartet auf Jobs`);
  console.log("");

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
    console.log(`\n──────────────────────────────────────────────`);
    console.log(`▶ JOB ${job.id}  gestartet ${new Date().toLocaleTimeString()}  (Fenster ${WINDOW_IDX})`);
    console.log(`  Scope: ${job.scope_id || "–"}  ·  Phase: ${job.mode || "?"}`);
    if (job.root) console.log(`  Datenzugriff: ${job.root}`);
    if (job.files) console.log(`  Whitelist: ${job.files}`);
    console.log(`──────────────────────────────────────────────\n`);

    const child = spawn(process.execPath, [RUN_ENTRY, "--job-id", job.id], { cwd: V2_DIR, stdio: "inherit" });
    const code = await new Promise((resolve) => child.on("close", resolve));
    dlog(`job ${job.id} beendet code=${code}`);

    // Falls run.mjs den Job nicht abgeschlossen hat (Crash), hier nachziehen.
    const done = getJob(db, job.id);
    if (!done || done.status === "RUNNING") {
      jobDone(db, job.id, null, `Worker-Abbruch (Exit-Code ${code})`);
    }

    console.log(`\n──────────────────────────────────────────────`);
    const d = getJob(db, job.id);
    if (d?.status?.startsWith("DONE")) {
      const v = d.verdict || d.status.replace("DONE ", "");
      if (v === "WRITE") {
        console.log("▶ JOB FERTIG: WRITE — Freigabe: READ-ONLY → WRITE.");
        title(`Falsify-Dock ${WINDOW_IDX} · FERTIG: WRITE`);
        bell();
      } else if (v === "RESEARCH") {
        console.log("▶ JOB FERTIG: RESEARCH — FalsifyMe braucht weitere Daten (Loop).");
        title(`Falsify-Dock ${WINDOW_IDX} · FERTIG: RESEARCH`);
        bell();
      } else if (v === "PLAN") {
        console.log("▶ JOB FERTIG: PLAN — Iteration überarbeiten (Loop).");
        title(`Falsify-Dock ${WINDOW_IDX} · FERTIG: PLAN`);
        bell();
      } else {
        console.log(`▶ JOB FERTIG: ${v} — nicht freigegeben.`);
        title(`Falsify-Dock ${WINDOW_IDX} · FERTIG: ${v}`);
        bell();
      }
    } else if (d?.status?.startsWith("ERROR")) {
      console.log(`▶ JOB FERTIG mit Fehler: ${d.status}`);
      title(`Falsify-Dock ${WINDOW_IDX} · FEHLER`);
      bell();
    } else {
      console.log(`▶ JOB FERTIG mit Code ${code} (Fehler – siehe oben)`);
      title(`Falsify-Dock ${WINDOW_IDX} · FEHLER`);
      bell();
    }
    console.log(`──────────────────────────────────────────────\n`);

    await sleep(400);
    title(`Falsify-Dock ${WINDOW_IDX}/${MAX_WINDOWS} · wartet auf Jobs`);
  }
}

// Nur bei direktem Aufruf ausführen (Import bleibt reiner Modul-Import).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
