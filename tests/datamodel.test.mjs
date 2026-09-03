// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/datamodel.test.mjs – Etage-2-Datenmodell (UI-079..083)
// -----------------------------------------------------------------------------
// Deckt ab: Schema-Migration (neue Spalten auf Bestands-DB), Intake-Felder
// (agent_intent/affected/wave) auf createJob, atomare Claim-Affinität
// (setWorkerScope in der Claim-Transaktion), Worker-Start-Recovery
// (reapStaleJobs), Härtungs-Zustandsmaschine (hardened/open_conflicts/ASK)
// und das vierte Verdict (parseVerdict/exitCodeOf).
// Alles läuft gegen Wegwerf-FALSIFY_HOME.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-dm-"));
  process.env.FALSIFY_HOME = tmp;
  return {
    tmp,
    // Windows: node:sqlite gibt das Datei-Handle beim close() nicht immer
    // synchron frei – deshalb closeDb vorab + Retry beim Verzeichnis-Löschen.
    async cleanup() {
      try { (await mod("artifacts/db.mjs")).closeDb(); } catch { /* egal */ }
      for (let i = 0; i < 10; i++) {
        try { fs.rmSync(tmp, { recursive: true, force: true }); break; }
        catch (e) { if (i === 9) throw e; await new Promise((r) => setTimeout(r, 60)); }
      }
      if (savedHome === undefined) delete process.env.FALSIFY_HOME;
      else process.env.FALSIFY_HOME = savedHome;
    },
  };
}

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

test("Migration: Bestands-DB bekommt die Etage-2-Spalten ohne Datenverlust", async () => {
  const env = withTempHome();
  try {
    // Altes Schema (Version 1/2) manuell anlegen – ohne die neuen Spalten.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(env.tmp, "falsify.db"));
    db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE scopes(id TEXT PRIMARY KEY, header TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        phase TEXT NOT NULL DEFAULT 'plan', last_befund TEXT, sub_prompt TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, done_at TEXT, last_gap TEXT);
      CREATE TABLE findings(id INTEGER PRIMARY KEY AUTOINCREMENT, scope_id TEXT NOT NULL, job_id TEXT,
        round INTEGER NOT NULL, mode TEXT, befund TEXT, content TEXT, verdict TEXT, created_at TEXT NOT NULL);
      CREATE TABLE jobs(id TEXT PRIMARY KEY, scope_id TEXT, payload TEXT, diff_text TEXT, root TEXT,
        files TEXT, mode TEXT, status TEXT NOT NULL DEFAULT 'QUEUED', verdict TEXT, window_idx INTEGER,
        error TEXT, created_at TEXT NOT NULL, started_at TEXT, done_at TEXT, abort_requested INTEGER DEFAULT 0);
      INSERT INTO scopes(id, header, created_at, updated_at) VALUES('scope-alt', 'Alter Scope', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO jobs(id, scope_id, payload, status, created_at) VALUES('job-alt', 'scope-alt', 'Plan', 'DONE WRITE', '2026-01-01T00:00:00Z');`);
    db.close();

    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const migrated = openDb();
    const ALLOWED_SCHEMA_TABLES = new Set(["jobs", "scopes", "findings"]);
    const assertSqlIdentifier = (value) => {
      if (!ALLOWED_SCHEMA_TABLES.has(value)) throw new Error(`Unbekannte Schema-Tabelle: ${value}`);
      return value;
    };
    const cols = (s) => migrated.prepare(`PRAGMA table_info(${assertSqlIdentifier(s)})`).all().map((c) => c.name);
    for (const c of ["agent_intent", "affected", "wave"]) assert.ok(cols("jobs").includes(c), `jobs.${c}`);
    for (const c of ["open_conflicts", "hardened_at"]) assert.ok(cols("scopes").includes(c), `scopes.${c}`);
    assert.ok(cols("findings").includes("wave"), "findings.wave");
    // Daten unversehrt:
    assert.equal(migrated.prepare("SELECT status FROM jobs WHERE id='job-alt'").get().status, "DONE WRITE");
    assert.equal(migrated.prepare("SELECT open_conflicts FROM scopes WHERE id='scope-alt'").get().open_conflicts, 0);
    closeDb();
  } finally {
    await env.cleanup();
  }
});

test("createJob: Intake-Felder (agent_intent, affected, wave) werden persistiert", async () => {
  const env = withTempHome();
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createJob, getJob, jobFilesList } = await mod("artifacts/jobs.mjs");
    const db = openDb();
    const id = createJob(db, {
      scopeId: null, payload: "Plan", root: ROOT, files: "a.js,b.js",
      agentIntent: "Ich baue eine Queue.", affected: "a.js",
      wave: "plan", mode: "plan",
    });
    const job = getJob(db, id);
    assert.equal(job.agent_intent, "Ich baue eine Queue.");
    assert.equal(job.affected, "a.js");
    assert.equal(job.wave, "plan");
    assert.deepEqual(jobFilesList(job), ["a.js", "b.js"]);
    closeDb();
  } finally {
    await env.cleanup();
  }
});

test("claimNextJob: Scope-Affinität wird ATOMAR in der Claim-Transaktion gesetzt", async () => {
  const env = withTempHome();
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const jobsMod = await mod("artifacts/jobs.mjs");
    const { createScope } = await mod("artifacts/scopes.mjs");
    const db = openDb();
    const s1 = createScope(db, "Scope eins");
    const s2 = createScope(db, "Scope zwei");
    // Worker 1 verarbeitet gerade Scope 1 -> Affinität existiert.
    jobsMod.setWorkerScope(db, 1, s1.id);
    const j1 = jobsMod.createJob(db, { scopeId: s1.id, payload: "P", root: ROOT, files: "a.js", mode: "plan" });
    const j2 = jobsMod.createJob(db, { scopeId: s2.id, payload: "P", root: ROOT, files: "a.js", mode: "plan" });
    // Affinität: Worker 1 bekommt zuerst s1-Job, obwohl s2-Job jünger.
    const claimed = jobsMod.claimNextJob(db, 1);
    assert.equal(claimed.id, j1);
    // setWorkerScope NIE separat aufgerufen – der Claim hat die Affinität gesetzt:
    assert.equal(jobsMod.workerScope(db, 1), s1.id);
    // Nächster Claim desselben Workers: kein s1-Job mehr -> Fallback auf s2.
    const claimed2 = jobsMod.claimNextJob(db, 1);
    assert.equal(claimed2.id, j2);
    assert.equal(jobsMod.workerScope(db, 1), s2.id);
    closeDb();
  } finally {
    await env.cleanup();
  }
});

test("reapStaleJobs: verwaiste RUNNING-Jobs (toter Worker) werden als ERROR geschlossen", async () => {
  const env = withTempHome();
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const jobsMod = await mod("artifacts/jobs.mjs");
    const db = openDb();
    const orphan = jobsMod.createJob(db, { payload: "P", root: ROOT, files: "a.js", mode: "plan", status: "RUNNING" });
    // Waisen-Fenster 1 simuliert: registriert mit PID einer toten Nummer.
    db.prepare("UPDATE jobs SET window_idx = 1 WHERE id = ?").run(orphan);
    jobsMod.registerWorker(db, 1, 9_999_999);
    // Lebender Worker (dieser Prozess) in Fenster 2 – dessen RUNNING-Job bleibt.
    const liveJob = jobsMod.createJob(db, { payload: "P", root: ROOT, files: "a.js", mode: "plan", status: "RUNNING" });
    db.prepare("UPDATE jobs SET window_idx = 2 WHERE id = ?").run(liveJob);
    jobsMod.registerWorker(db, 2, process.pid);
    jobsMod.heartbeatWorker(db, 2);

    const reaped = jobsMod.reapStaleJobs(db);
    assert.ok(reaped.includes(orphan), "Waisen-Job muss geschlossen werden");
    assert.ok(!reaped.includes(liveJob), "Job des lebenden Workers bleibt");
    const o = jobsMod.getJob(db, orphan);
    assert.match(o.status, /^ERROR Worker-Abbruch \(Recovery\)/);
    closeDb();
  } finally {
    await env.cleanup();
  }
});

test("updateScopeAfterReview: Härtungs-Zustandsmaschine (active -> hardened, ASK bleibt offen)", async () => {
  const env = withTempHome();
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const db = openDb();
    const s = scopes.createScope(db, "Task");
    scopes.updateScopeAfterReview(db, s.id, "PLAN", "Plan hat Lücken", "sub");
    let row = scopes.getScope(db, s.id);
    assert.equal(row.status, "active");
    assert.equal(row.open_conflicts, 1);
    assert.equal(row.phase, "plan");
    assert.equal(row.hardened_at, null);

    scopes.updateScopeAfterReview(db, s.id, "RESEARCH", "Daten fehlen", null);
    row = scopes.getScope(db, s.id);
    assert.equal(row.open_conflicts, 2);

    // ASK: Aufgaben-Mehrdeutigkeit – Phase bleibt, Konflikte bleiben, nicht gehärtet.
    scopes.updateScopeAfterReview(db, s.id, "ASK", "Was ist gemeint?", null);
    row = scopes.getScope(db, s.id);
    assert.equal(row.phase, "research");
    assert.equal(row.status, "active");
    assert.equal(row.open_conflicts, 2);
    assert.equal(row.hardened_at, null);

    // WRITE mit Challenge: gehärtet, Konflikte 0, last_gap null.
    scopes.updateScopeAfterReview(db, s.id, "WRITE", "Alles gut nach Challenge", null);
    row = scopes.getScope(db, s.id);
    assert.equal(row.status, "hardened");
    assert.equal(row.open_conflicts, 0);
    assert.equal(row.last_gap, null);
    assert.ok(row.hardened_at);

    // Erneuter PLAN nach Härtung: zurück zu active (nicht mehr gehärtet).
    scopes.updateScopeAfterReview(db, s.id, "PLAN", "Doch ein Befund", null);
    row = scopes.getScope(db, s.id);
    assert.equal(row.status, "active");
    assert.equal(row.hardened_at, null);
    closeDb();
  } finally {
    await env.cleanup();
  }
});

test("ASK als vierter Verdict-Ausgang: parseVerdict, exitCodeOf, findingSeverity", async () => {
  const env = withTempHome();
  try {
    const v = await mod("core/verdict.mjs");
    assert.equal(v.parseVerdict("Kritik…\nVERDICT: ASK\n"), "ASK");
    assert.equal(v.parseVerdict("BEFUND: unklar\nVERDICT: ask"), "ASK");
    assert.equal(v.exitCodeOf("WRITE"), 0);
    assert.equal(v.exitCodeOf("PLAN"), 1);
    assert.equal(v.exitCodeOf("RESEARCH"), 1);
    assert.equal(v.exitCodeOf("ASK"), 5);
    assert.equal(v.exitCodeOf(null), 3);
    assert.equal(v.exitCodeOf("UNBEKANNT"), 3);
    assert.equal(v.findingSeverity("ASK"), "warning");
    // enforceWriteChallenge betrifft nur WRITE – ASK geht unverändert durch.
    assert.equal(v.enforceWriteChallenge("nix", "ASK"), "ASK");
  } finally {
    await env.cleanup();
  }
});

test("buildUserContent: Agent-Verständnis als eigene Sektion (Divergenz-Prüfpunkt)", async () => {
  const env = withTempHome();
  try {
    const { buildUserContent } = await mod("core/prompt.mjs");
    const out = buildUserContent({
      header: "Baue eine Queue",
      phase: "plan",
      planText: "Mein Plan",
      root: ROOT,
      whitelist: ["a.js"],
      agentIntent: "Ich baue ein Logging-System.",
      affected: ["a.js", "b.js"],
    });
    assert.match(out, /## Agent-Verständnis/);
    assert.match(out, /Ich baue ein Logging-System\./);
    assert.match(out, /## Betroffene Daten/);
    assert.match(out, /a\.js, b\.js/);
    // Ohne agentIntent keine Sektion:
    const out2 = buildUserContent({ header: "H", phase: "plan", planText: "P", root: ROOT });
    assert.ok(!out2.includes("Agent-Verständnis"));
  } finally {
    await env.cleanup();
  }
});