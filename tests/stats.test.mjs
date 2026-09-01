// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/stats.test.mjs – Progression-Statistik (User-Anker)
// -----------------------------------------------------------------------------
// Deckt ab: collectStats leitet die Gesamtzahlen NUR aus der Queue ab
// (jobs/findings/scopes/rate_limit), der Ein-Satz-User-Anker ist ehrlich
// (widerlegte Annahmen = findings PLAN/RESEARCH), und die Aggregation ist
// READ-ONLY (kein Schreiben, kein zweites Speichersystem - Regel 3).
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const savedHome = process.env.FALSIFY_HOME;

function withTempHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-stats-"));
  process.env.FALSIFY_HOME = tmp;
  return {
    tmp,
    cleanup() {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      if (savedHome === undefined) delete process.env.FALSIFY_HOME;
      else process.env.FALSIFY_HOME = savedHome;
    },
  };
}

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

test("collectStats: Gesamtzahlen aus der Queue abgeleitet (read-only)", async () => {
  const h = withTempHome();
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, addFinding } = await mod("artifacts/scopes.mjs");
    const { createJob, jobDone } = await mod("artifacts/jobs.mjs");
    const { collectStats, progressionStatement } = await mod("artifacts/stats.mjs");
    const db = openDb();

    const s1 = createScope(db, "Task A");
    const s2 = createScope(db, "Task B");
    createJob(db, { scopeId: s1.id, payload: "p", mode: "plan" });
    createJob(db, { scopeId: s1.id, payload: "p", mode: "plan" });
    createJob(db, { scopeId: s2.id, payload: "p", mode: "write" });
    createJob(db, { scopeId: s2.id, payload: "p", mode: "write" });
    createJob(db, { scopeId: s2.id, payload: "p", mode: "write" });
    // Verdicts setzen (jobDone): 2x PLAN, 1x RESEARCH, 2x WRITE
    const jobs = db.prepare("SELECT id FROM jobs ORDER BY created_at").all().map((r) => r.id);
    jobDone(db, jobs[0], "PLAN", null);
    jobDone(db, jobs[1], "PLAN", null);
    jobDone(db, jobs[2], "RESEARCH", null);
    jobDone(db, jobs[3], "WRITE", null);
    jobDone(db, jobs[4], "WRITE", null);

    // Findings: 2 widerlegte Annahmen (PLAN/RESEARCH) + 1 evil-twin-Bestaetigung
    addFinding(db, { scopeId: s1.id, jobId: jobs[0], round: 1, mode: "plan", befund: "b", content: "c", verdict: "PLAN" });
    addFinding(db, { scopeId: s2.id, jobId: jobs[2], round: 1, mode: "research", befund: "b", content: "c", verdict: "RESEARCH" });
    addFinding(db, { scopeId: s2.id, jobId: jobs[4], round: 2, wave: "evil-twin", mode: "write", befund: "GEGENPRUEFUNG BESTAETIGT", content: "c", verdict: "WRITE" });

    const st = collectStats(db);
    assert.equal(st.jobsTotal, 5);
    assert.equal(st.jobsByVerdict.WRITE, 2);
    assert.equal(st.jobsByVerdict.PLAN, 2);
    assert.equal(st.jobsByVerdict.RESEARCH, 1);
    assert.equal(st.findingsTotal, 3);
    assert.equal(st.findingsByVerdict.PLAN, 1);
    assert.equal(st.findingsByVerdict.RESEARCH, 1);
    assert.equal(st.findingsByWave["evil-twin"], 1);
    assert.equal(st.scopesTotal, 2);
    // Kern des User-Ankers: widerlegte Annahmen = findings PLAN/RESEARCH
    assert.equal(st.errorsCaught, 2);
    assert.equal(st.releases, 2);
    // Nachweisbare Calls: 5 Jobs mit Verdict + 1 Twin = 6
    assert.equal(st.modelCalls, 6);
    assert.ok(st.sqlite.bytes > 0, "DB-Datei existiert und hat Groesse");
    assert.equal(st.sqlite.rowsPerTable.jobs, 5);
    assert.equal(st.sqlite.rowsPerTable.findings, 3);

    // Ein-Satz-Anker: ehrliche Zahlen
    const stmt = progressionStatement(st);
    assert.match(stmt, /2 Fehler/);
    assert.match(stmt, /2 Tasks/);
    assert.match(stmt, /5 Jobs/);
    assert.match(stmt, /2 Freigaben/);
    assert.match(stmt, /widerlegt/);

    // READ-ONLY-Beweis: zweiter Lauf identisch, keine neuen Zeilen
    const before = db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n;
    const st2 = collectStats(db);
    const after = db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n;
    assert.equal(before, after, "collectStats schreibt nichts");
    assert.deepEqual(st2.jobsByVerdict, st.jobsByVerdict);

    closeDb();
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});

test("collectStats: UNBEKANNT wird aus dem STATUS gezaehlt (verdict NULL)", async () => {
  const h = withTempHome();
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, addFinding } = await mod("artifacts/scopes.mjs");
    const { createJob, jobDone } = await mod("artifacts/jobs.mjs");
    const { collectStats } = await mod("artifacts/stats.mjs");
    const db = openDb();

    const s1 = createScope(db, "Task");
    createJob(db, { scopeId: s1.id, payload: "p", mode: "plan" });
    createJob(db, { scopeId: s1.id, payload: "p", mode: "plan" });
    const jobs = db.prepare("SELECT id FROM jobs ORDER BY created_at").all().map((r) => r.id);
    jobDone(db, jobs[0], "WRITE", null);
    jobDone(db, jobs[1], null, null); // kein Verdict -> Status "DONE UNBEKANNT"
    addFinding(db, { scopeId: s1.id, jobId: jobs[0], round: 1, mode: "write", befund: "b", content: "c", verdict: "WRITE" });

    const st = collectStats(db);
    assert.equal(st.jobsTotal, 2);
    assert.equal(st.unbekannt, 1, "UNBEKANNT aus dem Status, nicht aus verdict");
    assert.equal(st.jobsByVerdict.WRITE, 1);
    assert.equal(st.jobsByVerdict["(leer)"], 1);
    assert.equal(st.releases, 1);
    closeDb();
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});

test("collectStats: leere DB -> Anker sagt 0, kein Crash", async () => {
  const h = withTempHome();
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { collectStats, progressionStatement } = await mod("artifacts/stats.mjs");
    const db = openDb();
    const empty = collectStats(db);
    assert.equal(empty.jobsTotal, 0);
    assert.equal(empty.findingsTotal, 0);
    assert.equal(empty.scopesTotal, 0);
    assert.equal(empty.errorsCaught, 0);
    assert.equal(empty.releases, 0);
    assert.match(progressionStatement(empty), /0 Fehler/);
    assert.match(progressionStatement(empty), /0 Jobs/);
    closeDb();
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});
