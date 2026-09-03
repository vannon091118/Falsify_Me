// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/stats.test.mjs – Progression-Statistik (User-Anker)
// -----------------------------------------------------------------------------
// Deckt ab: collectStats leitet die Gesamtzahlen NUR aus der Queue ab
// (jobs/findings/scopes/rate_limit), der Ein-Satz-User-Anker ist ehrlich
// (widerlegte Annahmen = findings PLAN/RESEARCH), und die Aggregation ist
// READ-ONLY (kein Schreiben, kein zweites Speichersystem - Regel 3).
// ─────────────────────────────────────────────────────────────────────────────
// Loop-Trace (UI-116): `falsify scope trace <id>` leitet den GAP-Loop je Runde
// aus der Queue ab (Jobs+Welle+Verdict+Intent+Befund+Loop-Ausgang) — read-only,
// keine zweite Persistenz.
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

test("falsify state: PROGRESSION-Zeile + ANCHOR-Satz im --state-Output (UI-115)", async () => {
  // Integrationstest: Der echte --state-Pfad (worker.mjs) liest die Queue
  // und haengt die Progression-Zeilen an. Bewiesen per Spawn mit
  // isoliertem FALSIFY_HOME + Seed-Daten (2 Tasks, 3 Fehler, 5 Jobs).
  const h = withTempHome();
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, addFinding } = await mod("artifacts/scopes.mjs");
    const { createJob, jobDone, registerWorker } = await mod("artifacts/jobs.mjs");
    const db = openDb();
    const s1 = createScope(db, "Task A");
    const s2 = createScope(db, "Task B");
    const jobs = [];
    for (const sid of [s1.id, s1.id, s1.id, s2.id, s2.id]) {
      const j = createJob(db, { scopeId: sid, payload: "p", mode: "plan" });
      jobs.push(j);
    }
    const ids = db.prepare("SELECT id FROM jobs ORDER BY created_at").all().map((r) => r.id);
    jobDone(db, ids[0], "PLAN", null);
    jobDone(db, ids[1], "RESEARCH", null);
    jobDone(db, ids[2], "PLAN", null);
    jobDone(db, ids[3], "WRITE", null);
    jobDone(db, ids[4], "WRITE", null);
    addFinding(db, { scopeId: s1.id, jobId: ids[0], round: 1, mode: "plan", befund: "b", content: "c", verdict: "PLAN" });
    addFinding(db, { scopeId: s1.id, jobId: ids[1], round: 1, mode: "research", befund: "b", content: "c", verdict: "RESEARCH" });
    addFinding(db, { scopeId: s2.id, jobId: ids[2], round: 1, mode: "plan", befund: "b", content: "c", verdict: "PLAN" });
    // Loop-Trace: createJob gibt { id, header } zurueck — erster Job pro Scope.
    closeDb();

    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, [path.join(ROOT, "ui", "worker.mjs"), "--state"], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, FALSIFY_HOME: h.tmp },
    });
    assert.equal(r.status, 0, `--state exit 0 (stderr: ${r.stderr})`);
    const out = String(r.stdout);
    assert.match(out, /^IDLE$/m, "kein Worker -> IDLE");
    // Maschinenlesbare Zeile fuer Agents/Skripte.
    assert.match(out, /^PROGRESSION jobs=5 tasks=2 errorsCaught=3 releases=2 /m, "PROGRESSION-Zaehler maschinenlesbar");
    // Der Ein-Satz-Anker (User-Wortlaut).
    assert.match(out, /^ANCHOR Ohne FalsifyMe haettest du 3 Fehler in 2 Tasks /m, "ANCHOR-Satz mit echten Zahlen");
    assert.match(out, /widerlegt/, "Anker nennt die Widerlegung");
  } finally {
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

test("falsify scope trace: GAP-Loop je Runde aus der Queue abgeleitet (UI-116, read-only)", async () => {
  // Integrationstest ueber die echte CLI-Oberflaeche (cli/main.mjs scope trace)
  // mit isoliertem FALSIFY_HOME + Seed-Daten: 2 Runden (RESEARCH -> PLAN),
  // inkl. Intent, Befund, Wellen-Dimension und offenem Loop-Ausgang.
  const h = withTempHome();
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, addFinding, updateScopeAfterReview } = await mod("artifacts/scopes.mjs");
    const { createJob, jobDone } = await mod("artifacts/jobs.mjs");
    const db = openDb();
    const s = createScope(db, "Task mit Loop-Verlauf");
    createJob(db, { scopeId: s.id, payload: "p", wave: "scan", mode: "plan", agentIntent: "Erste Annahme: nur Header lesen" });
    createJob(db, { scopeId: s.id, payload: "p", wave: "plan", mode: "plan", agentIntent: "Zweite Annahme: Evidenz pruefen" });
    const ids = db.prepare("SELECT id FROM jobs ORDER BY created_at").all().map((r) => r.id);
    jobDone(db, ids[0], "RESEARCH", null);
    jobDone(db, ids[1], "PLAN", null);
    addFinding(db, { scopeId: s.id, jobId: ids[0], round: 1, wave: "scan", mode: "plan", befund: "Runde 1: Recherche noetig", content: "c", verdict: "RESEARCH" });
    addFinding(db, { scopeId: s.id, jobId: ids[1], round: 2, wave: "plan", mode: "plan", befund: "Runde 2: Gate-Format lueckig", content: "c", verdict: "PLAN" });
    updateScopeAfterReview(db, s.id, "PLAN", "Runde 2: Gate-Format lueckig", null, null, null);
    closeDb();

    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, [path.join(ROOT, "cli", "main.mjs"), "scope", "trace", s.id], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, FALSIFY_HOME: h.tmp },
    });
    assert.equal(r.status, 0, `scope trace exit 0 (stderr: ${r.stderr})`);
    const out = String(r.stdout);
    assert.match(out, /^LOOP-TRACE /m, "Trace-Kopf");
    assert.match(out, /Jobs: 2 · Findings: 2/, "Zaehler aus der Queue");
    assert.match(out, /Welle scan · DONE RESEARCH/, "Runde 1 mit Welle + Verdict");
    assert.match(out, /Welle plan · DONE PLAN/, "Runde 2 mit Welle + Verdict");
    assert.match(out, /Intent: Erste Annahme: nur Header lesen/, "USER-AGENT-Intent je Runde sichtbar");
    assert.match(out, /Befund: Runde 2: Gate-Format lueckig/, "Befund je Runde sichtbar");
    assert.match(out, /Loop-Ausgang: OFFEN/, "ehrlicher Loop-Ausgang bei offenem Scope");

    // Read-only: zweiter Lauf liefert identischen Output (keine Persistenz).
    const r2 = spawnSync(process.execPath, [path.join(ROOT, "cli", "main.mjs"), "scope", "trace", s.id], {
      encoding: "utf8", timeout: 30000, env: { ...process.env, FALSIFY_HOME: h.tmp },
    });
    assert.equal(String(r2.stdout), out, "trace ist eine reine Ableitung (deterministisch)");
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});
