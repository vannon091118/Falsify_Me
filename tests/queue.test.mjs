// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/queue.test.mjs – Queue-Invarianten des Batch-Refactors
// -----------------------------------------------------------------------------
// Deckt ab: falsify wait --ping (Coder-Auswertung, Exit 4 = laeuft noch),
// falsify abort (Flag in der Queue, kein Fake-Verdict), Worker-Status nur aus
// frischen Heartbeats (--check liest NUR die Queue), GAP-Erfassung im Scope,
// Anti-Self-Check-Bias (WRITE ohne Challenge -> UNKNOWN) und onTool-Art.
// Alles laeuft gegen Wegwerf-FALSIFY_HOME.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const savedHome = process.env.FALSIFY_HOME;

function withTempHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-q-"));
  process.env.FALSIFY_HOME = tmp;
  return {
    tmp,
    cleanup() {
      fs.rmSync(tmp, { recursive: true, force: true });
      if (savedHome === undefined) delete process.env.FALSIFY_HOME;
      else process.env.FALSIFY_HOME = savedHome;
    },
  };
}

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

function createJob(db, { scopeId = null, status = "QUEUED" } = {}) {
  const { createJob } = dbModule;
  return createJob(db, { scopeId, payload: "Plan", diffText: null, root: ROOT, files: "a.js", mode: "plan", status });
}

let dbModule;
let scopeModule;

test.before(async () => {
  dbModule = await mod("artifacts/jobs.mjs");
  scopeModule = await mod("artifacts/scopes.mjs");
});

test("wait --ping: laufender Job -> Exit 4 (Coder wertet aus), DONE WRITE -> 0", () => {
  const home = withTempHome();
  try {
    const { openDb, closeDb } = requireDb();
    const db = openDb();
    const id = createJob(db, { status: "QUEUED" });
    closeDb();

    const { runPing } = requireCliJobs();
    runPing(id); // QUEUED -> laeuft noch
    assert.equal(process.exitCode, 4, "QUEUED/RUNNING = Exit 4 (Auswertung durch Coder)");
    process.exitCode = 0;

    // Job auf DONE WRITE setzen
    const db2 = openDb();
    dbModule.jobDone(db2, id, "WRITE", null);
    closeDb();
    runPing(id);
    assert.equal(process.exitCode, 0, "DONE WRITE = Exit 0");
    process.exitCode = 0;

    // DONE PLAN -> Exit 1
    const db3 = openDb();
    dbModule.jobDone(db3, id, "PLAN", null);
    closeDb();
    runPing(id);
    assert.equal(process.exitCode, 1, "DONE PLAN = Exit 1");
    process.exitCode = 0;

    // ERROR -> Exit 3
    const db4 = openDb();
    dbModule.jobDone(db4, id, null, "Kaputt");
    closeDb();
    runPing(id);
    assert.equal(process.exitCode, 3, "ERROR = Exit 3");
    process.exitCode = 0;
  } finally {
    home.cleanup();
  }
});

test("falsify abort: setzt Flag in der Queue (kein Fake-Verdict), Job bleibt offen", () => {
  const home = withTempHome();
  try {
    const { openDb, closeDb } = requireDb();
    const db = openDb();
    const id = createJob(db, { status: "QUEUED" });
    closeDb();

    const { runAbort } = requireCliJobs();
    runAbort(id);
    const db2 = openDb();
    assert.equal(dbModule.isAbortRequested(db2, id), true, "Abort-Flag gesetzt");
    assert.equal(dbModule.getJob(db2, id).status, "QUEUED", "Job endet NICHT sofort (Worker killt erst)");
    dbModule.clearJobAbort(db2, id);
    assert.equal(dbModule.isAbortRequested(db2, id), false, "Flag nach Verarbeitung geloescht");
    closeDb();
  } finally {
    home.cleanup();
  }
});

test("listWorkers: stale Heartbeat -> kein RUNNING (Root-Cause-Fix statt PowerShell-CIM)", () => {
  const home = withTempHome();
  try {
    const { openDb, closeDb, setMeta } = requireDb();
    const db = openDb();
    // Lebende PID (dieser Testprozess), aber Herzschlag 2 h alt -> STALE.
    setMeta(db, "worker.1.pid", String(process.pid));
    setMeta(db, "worker.1.ts", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
    let workers = dbModule.listWorkers(db, 3);
    assert.equal(workers[0].alive, false, "alter Heartbeat darf kein RUNNING erzeugen");
    assert.equal(workers[0].pid, process.pid, "PID vorhanden, aber frisch entscheidet");

    // Frischer Heartbeat (gleiche PID) -> RUNNING.
    setMeta(db, "worker.1.ts", new Date().toISOString());
    workers = dbModule.listWorkers(db, 3);
    assert.equal(workers[0].alive, true, "frischer Heartbeat + lebende PID = RUNNING");
    closeDb();
  } finally {
    home.cleanup();
  }
});

test("GAP-Erfassung: PLAN/RESEARCH haelt den Gap offen, WRITE schliesst ihn", () => {
  const home = withTempHome();
  try {
    const { openDb, closeDb } = requireDb();
    const { createScope } = scopeModule;
    const db = openDb();
    const scope = createScope(db, "Auftrag 1:1");
    scopeModule.updateScopeAfterReview(db, scope.id, "PLAN", "Plan widerspricht Header", null);
    let s = scopeModule.getScope(db, scope.id);
    assert.equal(s.last_gap, "Plan widerspricht Header", "GAP offen bei PLAN");
    const viewPlan = scopeModule.artifactView(s, []);
    assert.ok(viewPlan.includes("GAP (offen"), "Scope-Show zeigt offenen GAP");

    scopeModule.updateScopeAfterReview(db, scope.id, "WRITE", "Kein Befund", null);
    s = scopeModule.getScope(db, scope.id);
    assert.equal(s.last_gap, null, "GAP geschlossen bei WRITE");
    const viewWrite = scopeModule.artifactView(s, []);
    assert.ok(viewWrite.includes("GAP: geschlossen"), "Scope-Show zeigt geschlossenen GAP");
    closeDb();
  } finally {
    home.cleanup();
  }
});

test("Anti-Self-Check-Bias: WRITE ohne Challenge-Nachweis -> UNKNOWN (keine Freigabe)", async () => {
  const { enforceWriteChallenge, hasChallengeEvidence, findingSeverity, parseVerdict } = await mod("core/verdict.mjs");
  // Rubber-Stamp: VERDICT WRITE, aber keine Falsifikationsversuche/BEFUND.
  assert.equal(parseVerdict("Alles gut.\nVERDICT: WRITE"), "WRITE");
  assert.equal(hasChallengeEvidence("Alles gut.\nVERDICT: WRITE"), false);
  assert.equal(enforceWriteChallenge("Alles gut.\nVERDICT: WRITE", "WRITE"), null, "WRITE ohne Challenge = keine Freigabe");
  // Echter Challenge-Nachweis (Struktur aus SYSTEM_DE) -> WRITE bleibt.
  const withChallenge = "## Falsifikationsversuche\n1. Race im Claim\nBEFUND: Claim nicht atomar\nVERDICT: WRITE";
  assert.equal(enforceWriteChallenge(withChallenge, "WRITE"), "WRITE", "Challenge-Beleg erlaubt WRITE");
  assert.equal(enforceWriteChallenge("BEFUND: nix\nVERDICT: WRITE", "WRITE"), "WRITE", "BEFUND zaehlt als Beleg");
  // Severity echt (UI-065-Befund 3)
  assert.equal(findingSeverity("WRITE"), "discovered");
  assert.equal(findingSeverity("PLAN"), "warning");
  assert.equal(findingSeverity("RESEARCH"), "warning");
  assert.equal(findingSeverity(null), "critical");
  assert.equal(findingSeverity("UNBEKANNT"), "critical");
});

test("onTool-Dateipfad-Extraktion: nur pfadartige Argumente werden als Datei gemeldet", async () => {
  // Die Extraktionslogik lebt inline in core/agent.mjs; wir pruefen hier den
  // Vertrag über das Verhalten der Regex (gleiche Regeln wie im Modul).
  const looksLikePath = (v) => {
    if (typeof v !== "string" || !v.trim()) return false;
    if (/[\\/\\\\]/.test(v)) return true;
    return /^[^\s"']+\.\w{1,10}$/.test(v.trim());
  };
  assert.equal(looksLikePath("src/app.js"), true, "Pfad mit Separator");
  assert.equal(looksLikePath("app.js"), true, "Datei mit Endung");
  assert.equal(looksLikePath("Login-Problem"), false, "Suchbegriff ist keine Datei");
  assert.equal(looksLikePath('{"a":1}'), false, "JSON ist keine Datei");
  assert.equal(looksLikePath("job-1788234473210"), false, "ID ist keine Datei");
  assert.equal(looksLikePath(""), false);
});

function requireDb() {
  return { openDb: dbModuleOpen.openDb, closeDb: dbModuleOpen.closeDb, setMeta: dbModuleOpen.setMeta };
}
let dbModuleOpen;
test.before(async () => {
  dbModuleOpen = await mod("artifacts/db.mjs");
});

function requireCliJobs() {
  return cliJobs;
}
let cliJobs;
test.before(async () => {
  cliJobs = await mod("cli/jobs.mjs");
});
