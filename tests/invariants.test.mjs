// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/invariants.test.mjs – Regel 3 (keine zweite Wahrheit)
// -----------------------------------------------------------------------------
// 1) STATISCH: Der Single-Writer-Anspruch als Regressionstest — ALLE
//    schreibenden Funktionen des Zustandsmodells (jobs.mjs + scopes.mjs:
//    createJob/jobToRunning/jobDone/setJobAbort/clearJobAbort/claimNextJob/
//    reapStaleJobs/registerWorker/unregisterWorker/heartbeatWorker/
//    setWorkerScope/createScope/updateScopeAfterReview/markScopeDone/
//    addFinding) dürfen in Produktionscode NUR aus ihren Heimatmodulen und
//    den bekannten Orchestrierern aufgerufen werden (cli/run.mjs,
//    ui/worker.mjs, cli/jobs.mjs [abort], cli/scope.mjs [new]). Ein neuer
//    Schreibpfad bricht diesen Test — keine zweite Wahrheit, die still entsteht.
// 2) DYNAMISCH: checkQueueConsistency erkennt verletzte Ableitungen
//    (hardened mit offenen Konflikten, GAP-Verdrehung, Orphan-RUNNING,
//    jobs- vs. findings-Verdict) und bestätigt konsistente Zustände.
// Alles gegen Wegwerf-FALSIFY_HOME.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const savedHome = process.env.FALSIFY_HOME;

const WRITERS = [
  "createJob\\(", "jobToRunning\\(", "jobDone\\(", "setJobAbort\\(", "clearJobAbort\\(",
  "claimNextJob\\(", "reapStaleJobs\\(", "registerWorker\\(", "unregisterWorker\\(",
  "heartbeatWorker\\(", "setWorkerScope\\(",
  "createScope\\(", "updateScopeAfterReview\\(", "markScopeDone\\(", "addFinding\\(",
];
/**
 * Einzig erlaubte Produktions-Aufrufer der Writer:
 * Heimatmodule (Definition + interne Aufrufe) + die bekannten Orchestrierer
 * (run.mjs = Job-Ausführung, worker.mjs = Claim/Loop, cli/jobs.mjs = abort,
 * cli/scope.mjs = scope new). read-only-Helfer (invariants.mjs) sind bewusst
 * NICHT darunter — ein Writer-Aufruf von dort wäre ein Verstoß.
 */
const ALLOWED_CALLERS = new Set([
  "artifacts/jobs.mjs", "artifacts/scopes.mjs",
  "cli/run.mjs", "ui/worker.mjs", "cli/jobs.mjs", "cli/scope.mjs",
]);

function prodSources() {
  const out = [];
  for (const dir of ["artifacts", "cli", "core", "ui"]) {
    const base = path.join(ROOT, dir);
    if (!fs.existsSync(base)) continue;
    for (const f of fs.readdirSync(base, { recursive: true })) {
      const p = String(f);
      if (p.endsWith(".mjs")) out.push(path.join(dir, p));
    }
  }
  return out;
}

test("STATISCH: Writer nur aus Heimatmodulen + run/worker (kein zweiter Schreibpfad)", async () => {
  const violations = [];
  for (const file of prodSources()) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const src = fs.readFileSync(abs, "utf8");
    for (const w of WRITERS) {
      if (new RegExp(w).test(src)) {
        const base = file.split(path.sep)[0];
        const key = file.replace(/\\/g, "/");
        if (!ALLOWED_CALLERS.has(key)) {
          violations.push(`${key} ruft Writer ${w.replace("\\(", "()")} auf`);
        }
        // Auch strukturell: „import … updateScopeAfterReview“ außerhalb run.mjs
        // wäre ein Hinweis (Import steht auch in jobs.mjs nicht).
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("DYNAMISCH: konsistenter Zustand meldet keine Verstöße", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-inv-"));
  process.env.FALSIFY_HOME = home;
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, updateScopeAfterReview, addFinding } = await mod("artifacts/scopes.mjs");
    const { createJob, jobDone } = await mod("artifacts/jobs.mjs");
    const { checkQueueConsistency } = await mod("artifacts/invariants.mjs");
    const db = openDb();
    // Normaler Loop: PLAN -> RESEARCH -> WRITE (Challenge), Job+Verdict + Finding.
    const s = createScope(db, "Task");
    const j1 = createJob(db, { scopeId: s.id, payload: "P", root: ROOT, files: "a.js", mode: "plan" });
    updateScopeAfterReview(db, s.id, "PLAN", "Lücken", "sub1");
    addFinding(db, { scopeId: s.id, jobId: j1, round: 1, mode: "plan", befund: "Lücken", content: "x", verdict: "PLAN" });
    jobDone(db, j1, "PLAN", null);
    const j2 = createJob(db, { scopeId: s.id, payload: "P", root: ROOT, files: "a.js", mode: "research" });
    updateScopeAfterReview(db, s.id, "WRITE", "Nach Challenge ok", "sub2");
    addFinding(db, { scopeId: s.id, jobId: j2, round: 2, mode: "write", befund: "Nach Challenge ok", content: "x", verdict: "WRITE" });
    jobDone(db, j2, "WRITE", null);
    const q = checkQueueConsistency(db);
    assert.deepEqual(q.violations, []);
    assert.equal(q.ok, true);
    closeDb();
  } finally {
    process.env.FALSIFY_HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("DYNAMISCH: verletzte Ableitungen werden gefunden (hardened+Konflikte, GAP-Verdrehung, Orphan, Verdict-Abweichung)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-inv-"));
  process.env.FALSIFY_HOME = home;
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, updateScopeAfterReview, addFinding } = await mod("artifacts/scopes.mjs");
    const { createJob, jobDone, registerWorker } = await mod("artifacts/jobs.mjs");
    const { checkQueueConsistency } = await mod("artifacts/invariants.mjs");
    const db = openDb();
    const s = createScope(db, "Task");
    const j = createJob(db, { scopeId: s.id, payload: "P", root: ROOT, files: "a.js", mode: "plan" });
    updateScopeAfterReview(db, s.id, "WRITE", "ok", null);
    addFinding(db, { scopeId: s.id, jobId: j, round: 1, mode: "write", befund: "ok", content: "x", verdict: "WRITE" });
    jobDone(db, j, "WRITE", null);
    // Manipulation 1: Konflikte nachträglich hochgezählt (hardened unzulässig).
    db.prepare("UPDATE scopes SET open_conflicts = 3 WHERE id = ?").run(s.id);
    // Manipulation 2: GAP veschrieben (phase=write, aber last_gap gesetzt).
    db.prepare("UPDATE scopes SET last_gap = 'irgendwas' WHERE id = ?").run(s.id);
    // Manipulation 3: Orphan-RUNNING (Fenster 2, kein Worker registriert).
    const o = createJob(db, { scopeId: null, payload: "P", root: ROOT, files: "a.js", mode: "plan", status: "RUNNING" });
    db.prepare("UPDATE jobs SET window_idx = 2 WHERE id = ?").run(o);
    registerWorker(db, 2, 9_999_999);
    // Manipulation 4: jobs.verdict != letztes Finding-Verdict.
    db.prepare("UPDATE jobs SET verdict = 'PLAN' WHERE id = ?").run(j);

    const q = checkQueueConsistency(db);
    const joined = q.violations.join("\n");
    assert.match(joined, /open_conflicts=3/, "hardened mit Konflikten gefunden");
    assert.match(joined, /phase=write, aber last_gap/, "GAP-Verdrehung gefunden");
    assert.match(joined, /RUNNING, aber Fenster 2 hat keinen lebenden Worker/, "Orphan gefunden");
    assert.match(joined, /jobs\.verdict=PLAN, aber letztes Finding=WRITE/, "Verdict-Abweichung gefunden");
    assert.equal(q.ok, false);
    closeDb();
  } finally {
    process.env.FALSIFY_HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("UNBEKANNT bewegt die Scope-Phase nicht (nur echte Verdicts ändern Zustand)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-inv-"));
  process.env.FALSIFY_HOME = home;
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, updateScopeAfterReview, getScope } = await mod("artifacts/scopes.mjs");
    const db = openDb();
    const s = createScope(db, "Task");
    updateScopeAfterReview(db, s.id, "RESEARCH", "Daten fehlen", null);
    assert.equal(getScope(db, s.id).phase, "research");
    updateScopeAfterReview(db, s.id, null, "Kein Verdict erkannt", null);
    assert.equal(getScope(db, s.id).phase, "research", "UNBEKANNT/leer darf die Phase nicht zurücksetzen");
    closeDb();
  } finally {
    process.env.FALSIFY_HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}