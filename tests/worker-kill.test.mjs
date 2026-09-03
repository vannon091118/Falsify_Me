// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/worker-kill.test.mjs – `falsify worker kill` + Agent-Namen
// -----------------------------------------------------------------------------
// Deckt ab (UI-141/UI-142):
//  - Gezieltes Orphan-Killen: registrierte Worker (Fenster 0..N) inventarisieren,
//    Orphans (tote PID ODER abgelaufener Heartbeat) stoppen, Registry räumen,
//    Waisen-Jobs fail-closed über die BESTEHENDE Recovery schließen.
//  - Frische Worker werden ohne --force nie angetastet; --dry-run ändert nichts;
//    die eigene PID wird nie gekillt (Selbstschutz).
//  - Agent-Namen  (UI-142): Registrierungsmetadatum, sichtbar in agentName/
//    listWorkers – Basis dafür, dass parallele Agents sich adressieren können.
// Alles läuft gegen Wegwerf-FALSIFY_HOME.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const savedHome = process.env.FALSIFY_HOME;

function withTempHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-wk-"));
  process.env.FALSIFY_HOME = tmp;
  return {
    tmp,
    cleanup() {
      // ENV ZUERST restaurieren (ein Cleanup-Fehler darf die Umgebung des
      // nächsten Tests NICHT vergiften), dann rm mit Windows-WAL-Flicker-
      // Retries (Queue-Test-Quirk) – niemals werfend.
      if (savedHome === undefined) delete process.env.FALSIFY_HOME;
      else process.env.FALSIFY_HOME = savedHome;
      try {
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      } catch (e) {
        console.warn(`Cleanup-Hinweis: ${tmp} konnte nicht entfernt werden (${e.code || e.message}) – Wegwerf-Home, unkritisch.`);
      }
    },
  };
}

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

/** Langlebiger Dummy-Prozess (bis wir ihn killen). */
function spawnDummy() {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},250)"], { stdio: "ignore" });
  return child;
}

/** PID sicher tot machen und tot NACHWEISEN (kein PID-Raten). */
async function spawnAndKillDummy() {
  const child = spawnDummy();
  await new Promise((res) => { child.on("spawn", res); child.kill("SIGKILL"); });
  await new Promise((res) => child.on("close", res));
  return child.pid;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Heartbeat eines Fensters zurückdatieren (jobs.mjs re-exportiert setMeta nicht). */
function backdateHeartbeat(db, setMetaFn, idx, msAgo = 3600_000) {
  setMetaFn(db, `worker.${idx}.ts`, new Date(Date.now() - msAgo).toISOString());
}

test("worker kill: Agent-Namen sind Registrierungs-Metadatum (UI-142)", async () => {
  const home = withTempHome();
  try {
    const dbModule = await mod("artifacts/jobs.mjs");
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const db = openDb();
    // Expliziter Name + Default-Name.
    dbModule.registerWorker(db, 1, 424242, "TestAgent");
    dbModule.registerWorker(db, 2, 424243);
    assert.equal(dbModule.agentName(db, 1), "TestAgent");
    assert.equal(dbModule.agentName(db, 2), "Agent 2");
    const ws = dbModule.listWorkers(db, 3);
    assert.equal(ws.find((w) => w.idx === 1).name, "TestAgent");
    // unregister räumt den Namen mit (keine Leiche im Meta-Store).
    dbModule.unregisterWorker(db, 1);
    assert.equal(dbModule.agentName(db, 1), "Agent 1");
    closeDb();
  } finally { home.cleanup(); }
});

test("worker kill: tote registrierte PID wird geräumt, ohne Kill-Versuch", async () => {
  const home = withTempHome();
  try {
    const dbModule = await mod("artifacts/jobs.mjs");
    const killModule = await mod("cli/worker-kill.mjs");
    const { openDb, closeDb, setMeta } = await mod("artifacts/db.mjs");
    const deadPid = await spawnAndKillDummy();
    const db = openDb();
    dbModule.registerWorker(db, 2, deadPid, "Agent-Tot");
    closeDb();

    let out = "";
    const origLog = console.log;
    console.log = (l) => { out += `${l}\n`; };
    try { killModule.runWorkerKill([]); } finally { console.log = origLog; }

    assert.match(out, /Agent-Tot/);
    assert.match(out, /Prozess tot/);
    const db2 = openDb();
    assert.equal(dbModule.workerPid(db2, 2), 0, "Registry geräumt (keine PID mehr)");
    closeDb();
  } finally { home.cleanup(); }
});

test("worker kill: echter Orphan (lebender Prozess, abgelaufener Heartbeat) wird gestoppt + Waise fail-closed geschlossen", async () => {
  const home = withTempHome();
  try {
    const dbModule = await mod("artifacts/jobs.mjs");
    const killModule = await mod("cli/worker-kill.mjs");
    const { openDb, closeDb, setMeta } = await mod("artifacts/db.mjs");

    const dummy = spawnDummy();
    try {
      const db = openDb();
      const jobId = dbModule.createJob(db, { payload: "P", diffText: null, root: ROOT, files: "a.js", mode: "plan" });
      dbModule.jobToRunning(db, jobId, 2); // RUNNING-Waise von Fenster 2
      dbModule.registerWorker(db, 2, dummy.pid, "Agent-Haengend");
      // Heartbeat 1 h zurückdatieren → Orphan nach Status-API-Maßstab.
      setMeta(db, "worker.2.ts", new Date(Date.now() - 3600_000).toISOString());
      closeDb();
      await sleep(150); // Spawn stabilisieren

      let out = "";
      const origLog = console.log;
      console.log = (l) => { out += `${l}\n`; };
      try { killModule.runWorkerKill([]); } finally { console.log = origLog; }

      assert.match(out, /Agent-Haengend/);
      assert.match(out, /Heartbeat abgelaufen/);
      assert.match(out, /Waisen-Job/);
      const db2 = openDb();
      assert.equal(dbModule.workerPid(db2, 2), 0, "Registrierung geräumt");
      const job = dbModule.getJob(db2, jobId);
      assert.match(job.status, /^ERROR/);
      assert.match(job.status, /Worker-Abbruch \(Recovery\)/, "fail-closed über den EINEN Recovery-Pfad");
      closeDb();
    } finally {
      try { dummy.kill("SIGKILL"); } catch { /* egal */ }
    }
  } finally { home.cleanup(); }
});

test("worker kill: frischer Worker wird ohne --force nicht angetastet", async () => {
  const home = withTempHome();
  try {
    const dbModule = await mod("artifacts/jobs.mjs");
    const killModule = await mod("cli/worker-kill.mjs");
    const { openDb, closeDb, setMeta } = await mod("artifacts/db.mjs");

    const dummy = spawnDummy();
    try {
      const db = openDb();
      dbModule.registerWorker(db, 1, dummy.pid, "Agent-Frisch");
      closeDb();
      await sleep(150);

      let out = "";
      const origLog = console.log;
      console.log = (l) => { out += `${l}\n`; };
      try { killModule.runWorkerKill([]); } finally { console.log = origLog; }

      assert.match(out, /FRISCH/);
      assert.match(out, /übersprungen/);
      const db2 = openDb();
      assert.equal(dbModule.workerPid(db2, 1), dummy.pid, "Registry unangetastet");
      closeDb();
      // --force mit Nummer: gezieltes Töten ist möglich.
      console.log = (l) => { out += `${l}\n`; };
      try { killModule.runWorkerKill(["--force", "1"]); } finally { console.log = origLog; }
      assert.match(out, /gestoppt/);
      const db3 = openDb();
      assert.equal(dbModule.workerPid(db3, 1), 0, "Registry nach --force geräumt");
      closeDb();
    } finally {
      try { dummy.kill("SIGKILL"); } catch { /* egal */ }
    }
  } finally { home.cleanup(); }
});

test("worker kill: --dry-run ändert NICHTS, eigene PID wird nie gekillt", async () => {
  const home = withTempHome();
  try {
    const dbModule = await mod("artifacts/jobs.mjs");
    const killModule = await mod("cli/worker-kill.mjs");
    const { openDb, closeDb, setMeta } = await mod("artifacts/db.mjs");

    // (a) Dry-Run über einen echten Orphan: Anzeige ja, Zustand unverändert.
    const dummy = spawnDummy();
    try {
      const db = openDb();
      dbModule.registerWorker(db, 2, dummy.pid, "Agent-Dry");
      setMeta(db, "worker.2.ts", new Date(Date.now() - 3600_000).toISOString());
      closeDb();
      await sleep(150);

      let out = "";
      const origLog = console.log;
      console.log = (l) => { out += `${l}\n`; };
      try { killModule.runWorkerKill(["--dry-run"]); } finally { console.log = origLog; }

      assert.match(out, /DRY-RUN/);
      assert.match(out, /würde gestoppt/);
      const db2 = openDb();
      assert.equal(dbModule.workerPid(db2, 2), dummy.pid, "Registry unverändert");
      closeDb();
      const { isProcessAlive } = await mod("artifacts/db.mjs");
      assert.ok(isProcessAlive(dummy.pid), "Dry-Run: Prozess lebt noch");
    } finally {
      try { dummy.kill("SIGKILL"); } catch { /* egal */ }
    }

    // (b) Selbstschutz: eigene PID registriert → übersprungen, Registry bleibt.
    const proc = await import("node:process");
    const db3 = openDb();
    dbModule.registerWorker(db3, 3, proc.default.pid, "Agent-Selbst");
    setMeta(db3, "worker.3.ts", new Date(Date.now() - 3600_000).toISOString());
    closeDb();
    let out2 = "";
    const origLog2 = console.log;
    console.log = (l) => { out2 += `${l}\n`; };
    try { killModule.runWorkerKill([]); } finally { console.log = origLog2; }
    assert.match(out2, /eigene PID, NICHT getötet/);
    const db4 = openDb();
    assert.equal(dbModule.workerPid(db4, 3), proc.default.pid, "Selbstregistrierung bleibt (kein Selbstmord)");
    closeDb();
  } finally { home.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// repairStaleWorkers (UI-150): programmatische Orphan-Reparatur für
// `falsify doctor --repair-all` — gleiche Klassifikation wie der CLI-Pfad,
// keine eigene Queue-Schreiblogik (unregisterWorker + reapStaleJobs), kein
// console.log (Bericht als Rückgabe), nie frische Worker, nie eigene PID.
// ─────────────────────────────────────────────────────────────────────────────
test("repairStaleWorkers: tote Registrierung + RUNNING-Waise -> geräumt + fail-closed (stiller Bericht)", async () => {
  const home = withTempHome();
  try {
    const dbModule = await mod("artifacts/jobs.mjs");
    const killModule = await mod("cli/worker-kill.mjs");
    const { openDb, closeDb, setMeta } = await mod("artifacts/db.mjs");

    const deadPid = await spawnAndKillDummy();
    const db = openDb();
    const jobId = dbModule.createJob(db, { payload: "P", diffText: null, root: ROOT, files: "a.js", mode: "plan" });
    dbModule.jobToRunning(db, jobId, 2); // RUNNING-Waise von Fenster 2
    dbModule.registerWorker(db, 2, deadPid, "Agent-Tot");
    closeDb();

    let out = "";
    const origLog = console.log;
    console.log = (l) => { out += `${l}\n`; };
    let report;
    try { report = killModule.repairStaleWorkers(); } finally { console.log = origLog; }

    assert.equal(out, "", "repairStaleWorkers meldet per Rückgabe, nicht per console.log");
    assert.equal(report.cleaned, 1, "tote Registrierung geräumt");
    assert.equal(report.killed, 0, "tote PID: kein Kill-Versuch");
    assert.equal(report.stopped.length, 1);
    assert.equal(report.stopped[0].name, "Agent-Tot");
    assert.equal(report.reaped.length, 1, "Waisen-Job fail-closed geschlossen");
    assert.ok(report.reaped.includes(jobId));
    const db2 = openDb();
    assert.equal(dbModule.workerPid(db2, 2), 0, "Registry geräumt");
    const job = dbModule.getJob(db2, jobId);
    assert.match(job.status, /^ERROR/);
    assert.match(job.status, /Worker-Abbruch \(Recovery\)/, "EIN Recovery-Pfad");
    closeDb();
  } finally { home.cleanup(); }
});

test("repairStaleWorkers: frischer Worker wird nicht angetastet (Reap bleibt No-op)", async () => {
  const home = withTempHome();
  try {
    const dbModule = await mod("artifacts/jobs.mjs");
    const killModule = await mod("cli/worker-kill.mjs");
    const { openDb, closeDb } = await mod("artifacts/db.mjs");

    const dummy = spawnDummy();
    try {
      const db = openDb();
      dbModule.registerWorker(db, 1, dummy.pid, "Agent-Frisch");
      closeDb();
      await sleep(150);
      const report = killModule.repairStaleWorkers();
      assert.equal(report.cleaned, 0, "frischer Worker unangetastet");
      assert.equal(report.stopped.length, 0);
      assert.equal(report.killed, 0);
      assert.equal(report.reaped.length, 0, "keine Waisen (Reap idempotent No-op)");
      assert.equal(report.registeredTotal, 1);
      const db2 = openDb();
      assert.equal(dbModule.workerPid(db2, 1), dummy.pid, "Registry unangetastet");
      closeDb();
    } finally {
      try { dummy.kill("SIGKILL"); } catch { /* egal */ }
    }
  } finally { home.cleanup(); }
});
