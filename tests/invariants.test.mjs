// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/invariants.test.mjs – Regel 3 (keine zweite Wahrheit)
// -----------------------------------------------------------------------------
// 1) STATISCH: Der Single-Writer-Anspruch als Regressionstest — ALLE
//    benannten Schreibfunktionen des Zustandsmodells (jobs.mjs + scopes.mjs:
//    createJob/jobToRunning/jobDone/setJobAbort/clearJobAbort/claimNextJob/
//    reapStaleJobs/registerWorker/unregisterWorker/heartbeatWorker/
//    setWorkerScope/createScope/updateScopeAfterReview/markScopeDone/
//    addFinding) dürfen in Produktionscode NUR aus ihren Heimatmodulen und
//    den bekannten Orchestrierern aufgerufen werden (cli/run.mjs,
//    ui/worker.mjs, cli/jobs.mjs [abort], cli/scope.mjs [new]). Ein neuer
//    Schreibpfad bricht diesen Test — keine zweite Wahrheit, die still entsteht.
//    HINWEIS (Audit-Befund 7, 2026-09-01): Der Test scannt bewusst nur die
//    benannten Zustands-Writer, KEINEN raw db.exec/db.prepare. core/ratelimit.mjs
//    schreibt via db.exec direkt in seine EIGENE rate_limit-Tabelle — eine
//    dokumentierte, separate Write-Domain (Rate-Limit-Reservierungen), kein
//    funktionaler Verstoß gegen die eine Zustands-Wahrheit (AGENTS.md: „nur
//    core/ratelimit.mjs schreibt direkt, aber in eine eigene Tabelle“).
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
  // cli/start.mjs: Ticket-Einstieg (UI-127) — legt den Scope ausschliesslich
  // via artifacts/scopes.mjs:createScope an (Auto-Anlage bei neuem Ticket),
  // wie cli/scope.mjs (scope new); keine eigene Queue/INSERT.
  "cli/start.mjs",
  // artifacts/handoff.mjs: Handoff-Orchestrator (TASK-012) — erzeugt
  // Re-Review-Jobs AUSSCHLIESSLICH via jobs.mjs:createJob (keine eigene
  // Queue/INSERT, RISK-003); der statische Scan prüft das hier mit.
  // artifacts/loops.mjs ist die REINE Zustandsmaschine und ruft keine
  // benannten Writer auf (kein Eintrag nötig).
  "artifacts/handoff.mjs",
]);

/** Alle *.mjs des Repos ausser tests/ + node_modules + .git (ganzer Baum). */
function prodSources() {
  const out = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      if (f === "node_modules" || f === ".git" || f === "tests") continue;
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (f.endsWith(".mjs")) {
        out.push(path.relative(ROOT, p).replace(/\\/g, "/"));
      }
    }
  };
  walk(ROOT);
  return out.sort();
}

/**
 * Entfernt Kommentare + String-Literale, BEVOR nach Writer-Aufrufen gesucht
 * wird: eine Erwähnung in Doku-Kommentaren oder Strings ist KEIN Aufruf
 * (der alte Scan war dafür blind — gegenteilig: false positive).
 */
function stripCommentsAndStrings(src) {
  return String(src)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}

test("STATISCH: Writer nur aus Heimatmodulen + Orchestrierern (GANZER Baum, Kommentar-/String-bereinigt)", async () => {
  const violations = [];
  for (const file of prodSources()) {
    const abs = path.join(ROOT, file);
    const src = stripCommentsAndStrings(fs.readFileSync(abs, "utf8"));
    for (const w of WRITERS) {
      // Qualifier-empfindlich: auch `jobs.jobDone(...)` (Namespace-Import)
      // ist ein Aufruf — der alte Scan war für Mitglied-Aufrufe blind.
      if (new RegExp(`(?:[\\w$]+\\.\\s*)*\\b${w}`).test(src) && !ALLOWED_CALLERS.has(file)) {
        violations.push(`${file} ruft Writer ${w.replace("\\(", "()")} auf`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

/**
 * Freeze-Vertrag (a37fc42, M2-Vorbehalt dauerhaft erzwungen): loop_state-
 * DATEN-Writes duerfen in Produktion NUR in der zentralen Engine
 * (artifacts/loops.mjs applyTransition) sowie als Initial-Zustand NEUER Jobs
 * (QUEUED bei Submit in cli/run.mjs, RE_REVIEW_QUEUED beim Child in
 * artifacts/handoff.mjs) stehen. Jeder andere UPDATE/INSERT auf loop_state
 * bricht den Test — kein Seiteneingang an der Transition-Engine vorbei.
 * Kommentare werden entfernt, String-Literale (die SQL) BLEIBEN sichtbar —
 * genau umgekehrt wie beim Writer-Scan oben, weil die SQL-Writes in Strings
 * stehen. Nicht-vakuös: exakt die 4 bekannten Schreibstellen muessen gefunden
 * werden (zaehlt 0 = Regex kaputt = FAIL).
 */
test("STATISCH: loop_state-DATENWrites nur ueber Engine + Job-Initialisierung (Freeze-Vertrag)", () => {
  // Rohe Zeilen, kein Kommentar-Stripping noetig: genau 4 Produktions-
  // Zeilen enthalten loop_state UND (UPDATE|INSERT) — am Freeze (a37fc42)
  // per Scan verifiziert. Nur diese vier sind zulaessig.
  const writes = [];
  const violations = [];
  for (const file of prodSources()) {
    const abs = path.join(ROOT, file);
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/\bloop_state\b/.test(line) || !/\b(UPDATE|INSERT)\b/.test(line)) continue;
      writes.push(`${file}:${i + 1}`);
      const ok =
        file === "artifacts/loops.mjs" || // zentrale Transition-Engine
        (file === "artifacts/handoff.mjs" && /'RE_REVIEW_QUEUED'/.test(line)) || // Child-Initial
        (file === "cli/run.mjs" && /'QUEUED'/.test(line)); // Submit-Initial
      if (!ok) violations.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  }
  assert.equal(writes.length, 4, `Genau die 4 bekannten Schreibstellen muessen gefunden werden (nicht-vakuoer Scan): ${writes.join(", ")}`);
  assert.deepEqual(violations, []);
});

test("STATISCH: Der Scan-Mechanismus erkennt neue Aufrufer selbst (Selbstzertifizierung)", () => {
  // Fixture-Lauf: jobToRunning-Aufruf bleibt sichtbar; Erwähnungen in
  // Kommentar, Block-Kommentar und String zählen NICHT als Aufruf.
  const src = stripCommentsAndStrings(
    "// jobDone(db, x);\n/* jobDone(db, x); */\nconst s = 'claimNextJob(db)';\n" +
      "jobToRunning(db, id, 1);\njobs.jobDone(db);"
  );
  assert.match(src, /jobToRunning\(/);
  assert.doesNotMatch(src, /claimNextJob\(/);
  // Mitglied-Aufruf (jobs.jobDone) MUSS entdeckt werden — genau die Lücke,
  // über die ein neuer Aufrufer bisher unbemerkt schreiben konnte:
  assert.match(src, /(?:[\w$]+\.\s*)*\bjobDone\(/);
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

test("DYNAMISCH: Direkt-Run (Fenster 0) ist kein Orphan, wenn er lebt (Asymmetrie-Fix)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-inv-"));
  process.env.FALSIFY_HOME = home;
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createJob, registerWorker, heartbeatWorker } = await mod("artifacts/jobs.mjs");
    const { checkQueueConsistency } = await mod("artifacts/invariants.mjs");
    const db = openDb();
    const j = createJob(db, { scopeId: null, payload: "P", root: ROOT, files: "a.js", mode: "plan", status: "RUNNING" });
    // Fenster-0-Waisen ohne Liveness: Orphan.
    let q = checkQueueConsistency(db);
    assert.match(q.violations.join("\n"), /RUNNING, aber Fenster 0 hat keinen lebenden Worker/);
    // Direkt-Run registriert sich selbst (startet den Prozess) + Heartbeat:
    assert.equal(checkQueueConsistency(db).ok, false);
    registerWorker(db, 0, process.pid);
    heartbeatWorker(db, 0);
    const live = checkQueueConsistency(db);
    assert.deepEqual(
      live.violations.filter((v) => /Fenster 0/.test(v)),
      [],
      "lebender Direkt-Run ist kein Orphan"
    );
    closeDb();
  } finally {
    process.env.FALSIFY_HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("DYNAMISCH: reapStaleJobs raeumt gecrashte Fenster-0-Waisen auf (Direkt-Run-Recovery)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-inv-"));
  process.env.FALSIFY_HOME = home;
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createJob, registerWorker } = await mod("artifacts/jobs.mjs");
    const { reapStaleJobs } = await mod("artifacts/jobs.mjs");
    const db = openDb();
    const j = createJob(db, { scopeId: null, payload: "P", root: ROOT, files: "a.js", mode: "plan", status: "RUNNING" });
    registerWorker(db, 0, 9_999_999); // toter Prozess → Herzschlag-„Zeuge" tot
    const reaped = reapStaleJobs(db, 3);
    assert.ok(reaped.includes(j), `Fenster-0-Waise geschlossen (${reaped.join(",")})`);
    const row = db.prepare("SELECT status FROM jobs WHERE id = ?").get(j);
    assert.match(String(row.status), /^ERROR Worker-Abbruch \(Recovery\)/);
    closeDb();
  } finally {
    process.env.FALSIFY_HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("DYNAMISCH: neue Checker-Blindstellen sind geschlossen (Phase, hardened-ohne-Finding, Status)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-inv-"));
  process.env.FALSIFY_HOME = home;
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, updateScopeAfterReview, addFinding } = await mod("artifacts/scopes.mjs");
    const { createJob, jobDone } = await mod("artifacts/jobs.mjs");
    const { checkQueueConsistency } = await mod("artifacts/invariants.mjs");
    const db = openDb();

    // (a) Phase manipuliert: letztes Finding PLAN, aber phase=write.
    const s1 = createScope(db, "T1");
    const j1 = createJob(db, { scopeId: s1.id, payload: "P", root: ROOT, files: "a.js", mode: "plan" });
    updateScopeAfterReview(db, s1.id, "PLAN", "Lücken", null);
    addFinding(db, { scopeId: s1.id, jobId: j1, round: 1, mode: "plan", befund: "Lücken", content: "x", verdict: "PLAN" });
    jobDone(db, j1, "PLAN", null);
    db.prepare("UPDATE scopes SET phase = 'write' WHERE id = ?").run(s1.id);

    // (b) hardened ohne EINZIGES Finding.
    const s2 = createScope(db, "T2");
    db.prepare("UPDATE scopes SET status = 'hardened' WHERE id = ?").run(s2.id);

    // (c) status 'DONE WRITE', aber verdict PLAN.
    const j3 = createJob(db, { scopeId: null, payload: "P", root: ROOT, files: "a.js", mode: "plan" });
    jobDone(db, j3, "WRITE", null);
    db.prepare("UPDATE jobs SET verdict = 'PLAN' WHERE id = ?").run(j3);

    const joined = checkQueueConsistency(db).violations.join("\n");
    assert.match(joined, /phase=write, aber letztes Finding-Verdict=PLAN/, "Phase-vs-Finding-Blindstelle");
    assert.match(joined, /status=hardened, aber kein einziges Finding/, "hardened-ohne-Finding-Blindstelle");
    assert.match(joined, /status=DONE WRITE, aber verdict=PLAN/, "DONE-Status-vs-verdict-Blindstelle");

    // (d) 'DONE UNBEKANNT' mit verdict NULL ist konsistent (kein Fake-Befund).
    const j4 = createJob(db, { scopeId: null, payload: "P", root: ROOT, files: "a.js", mode: "plan" });
    jobDone(db, j4, null, null);
    const q4 = checkQueueConsistency(db);
    assert.equal(q4.violations.filter((v) => v.includes(j4)).length, 0);
    closeDb();
  } finally {
    process.env.FALSIFY_HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("DYNAMISCH: enforceQueueConsistency wirft bei Verletzung, schweigt bei Konsistenz", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-inv-"));
  process.env.FALSIFY_HOME = home;
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createJob, jobDone } = await mod("artifacts/jobs.mjs");
    const { enforceQueueConsistency } = await mod("artifacts/invariants.mjs");
    const db = openDb();
    const j = createJob(db, { scopeId: null, payload: "P", root: ROOT, files: "a.js", mode: "plan" });
    jobDone(db, j, "WRITE", null);
    enforceQueueConsistency(db); // konsistent → kein Wurf
    db.prepare("UPDATE jobs SET verdict = 'PLAN' WHERE id = ?").run(j);
    assert.throws(() => enforceQueueConsistency(db), /Zustandsmodell inkonsistent/);
    closeDb();
  } finally {
    process.env.FALSIFY_HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}