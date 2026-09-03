// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · artifacts/loops.mjs – persistente Loop-Zustände + Übergänge
// -----------------------------------------------------------------------------
// EIN Zustandsmodell für den Produktions-Loop:
//   QUEUED → RUNNING → WRITE_AUTHORIZED → WAITING_FOR_AGENT →
//   WRITE_IN_PROGRESS → CHANGE_CAPTURED → RE_REVIEW_QUEUED →
//   RE_REVIEW_RUNNING → DONE  |  LOOP_BLOCKED | ABORTED | ERROR
//
// Invarianten:
// · Die jobs-Tabelle bleibt die EINZIGE ausführbare Queue (RISK-003): dieses
//   Modul erzeugt ausführbare Jobs NUR via artifacts/jobs.mjs:createJob.
// · Übergänge sind atomar (BEGIN IMMEDIATE) und idempotent für denselben
//   (handoff_id, change_digest, scope_id)-Schlüssel (TASK-014).
// · Terminale Zustände (DONE, LOOP_BLOCKED, ABORTED, ERROR) sind
//   unumkehrbar (SEC-004) — ein Retry/Restart/Re-Delivery kann sie nie
//   wieder öffnen.
// ─────────────────────────────────────────────────────────────────────────────
import { nowIso, genId } from "./db.mjs";
import { createJob } from "./jobs.mjs";

export const LOOP_STATES = Object.freeze([
  "QUEUED", "RUNNING", "WRITE_AUTHORIZED", "WAITING_FOR_AGENT", "WRITE_IN_PROGRESS",
  "CHANGE_CAPTURED", "RE_REVIEW_QUEUED", "RE_REVIEW_RUNNING",
  "DONE", "LOOP_BLOCKED", "ABORTED", "ERROR",
]);

const TERMINAL_LOOP_STATES = Object.freeze(["DONE", "LOOP_BLOCKED", "ABORTED", "ERROR"]);

// Legalisierte Übergänge (alles andere fail-closed).
const TRANSITIONS = Object.freeze({
  "QUEUED": ["RUNNING", "ERROR", "ABORTED"],
  "RUNNING": ["WRITE_AUTHORIZED", "ERROR", "ABORTED"],
  "WRITE_AUTHORIZED": ["WAITING_FOR_AGENT", "ERROR", "ABORTED"],
  "WAITING_FOR_AGENT": ["WRITE_IN_PROGRESS", "LOOP_BLOCKED", "ERROR", "ABORTED"],
  "WRITE_IN_PROGRESS": ["CHANGE_CAPTURED", "LOOP_BLOCKED", "ERROR", "ABORTED"],
  "CHANGE_CAPTURED": ["RE_REVIEW_QUEUED", "LOOP_BLOCKED", "ERROR", "ABORTED"],
  "RE_REVIEW_QUEUED": ["RE_REVIEW_RUNNING", "ERROR", "ABORTED"],
  "RE_REVIEW_RUNNING": ["DONE", "WRITE_AUTHORIZED", "ERROR", "ABORTED"],
  // Terminale Zustände haben keine Übergänge.
  "DONE": [], "LOOP_BLOCKED": [], "ABORTED": [], "ERROR": [],
});

// ── ALTER-only Loop-Schema (CON-003) ─────────────────────────────────────────
export function migrateLoopSchema(db) {
  for (const sql of [
    "ALTER TABLE jobs ADD COLUMN parent_job_id TEXT",
    "ALTER TABLE jobs ADD COLUMN handoff_id TEXT",
    "ALTER TABLE jobs ADD COLUMN iteration_id TEXT",
    "ALTER TABLE jobs ADD COLUMN change_digest TEXT",
    "ALTER TABLE jobs ADD COLUMN header_digest TEXT",
    "ALTER TABLE jobs ADD COLUMN loop_state TEXT",
    "ALTER TABLE jobs ADD COLUMN review_iteration INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN loop_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN max_loop_count INTEGER NOT NULL DEFAULT 5",
  ]) {
    try { db.exec(sql); } catch { /* Spalte existiert bereits */ }
  }
  // Append-only Loop-Audit-Historie (keine zweite Queue — nur Ereignis-Log).
  db.exec(`
    CREATE TABLE IF NOT EXISTS loop_events(
      id          TEXT PRIMARY KEY,
      job_id      TEXT NOT NULL,
      scope_id    TEXT,
      handoff_id  TEXT,
      change_digest TEXT,
      event_type  TEXT NOT NULL,
      from_state  TEXT,
      to_state    TEXT,
      payload     TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_loop_events_job ON loop_events(job_id);
  `);
}

function isTerminal(state) {
  return TERMINAL_LOOP_STATES.includes(state);
}

export function getLoopState(db, jobId) {
  const r = db.prepare("SELECT loop_state FROM jobs WHERE id = ?").get(jobId);
  return r ? (r.loop_state || "QUEUED") : null;
}

/** Append-only Audit-Eintrag (nie gelöscht, nie überschrieben). */
export function recordLoopEvent(db, { jobId, scopeId = null, handoffId = null, changeDigest = null, eventType, fromState = null, toState = null, payload = null }) {
  const id = genId("loop");
  db.prepare(
    "INSERT INTO loop_events(id, job_id, scope_id, handoff_id, change_digest, event_type, from_state, to_state, payload, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, jobId, scopeId ?? null, handoffId ?? null, changeDigest ?? null, eventType, fromState, toState, payload ? JSON.stringify(payload).slice(0, 4000) : null, nowIso());
  return id;
}

export function listLoopEvents(db, jobId) {
  return db.prepare("SELECT * FROM loop_events WHERE job_id = ? ORDER BY created_at ASC").all(jobId);
}

/**
 * Innere Übergangs-Logik OHNE eigene Transaktion — der Aufrufer besitzt die
 * Transaktionsgrenze (transitionLoop einzeln, completeHandoff als Ganzes).
 * Wirft bei illegalen Übergängen (kein stiller Verlust).
 */
function applyTransition(db, jobId, toState, { eventType = "transition", payload = null, handoffId = null, changeDigest = null, scopeId = null } = {}) {
  if (!LOOP_STATES.includes(toState)) throw new Error(`Unbekannter Loop-Zustand: ${toState}`);
  const row = db.prepare("SELECT loop_state, status FROM jobs WHERE id = ?").get(jobId);
  if (!row) throw new Error("Job nicht gefunden");
  const from = row.loop_state || "QUEUED";
  if (isTerminal(from)) throw new Error(`Terminaler Zustand ${from} ist unumkehrlich`);
  if (!(TRANSITIONS[from] || []).includes(toState)) throw new Error(`Illegaler Übergang ${from} → ${toState}`);
  // Job-Status vs. Loop-Zustand: der Job-Verdict bleibt IMMER unveränderlich
  // (jobDone-Immutable-Guard); der Loop läuft nach einer WRITE-Freigabe
  // bewusst WEITER (externer Writer + Re-Review). Blockiert wird nur ein
  // Weiterlauf nach ERROR oder DONE ohne WRITE — ein WRITE-Verdict ist der
  // definierte Loop-Fortsetzungs-Punkt, kein Widerspruch.
  if (!isTerminal(toState) && (String(row.status).startsWith("ERROR")
    || (String(row.status).startsWith("DONE") && !String(row.status).includes("WRITE")))) {
    throw new Error(`Job ist final ohne WRITE-Freigabe (${row.status}); Loop-Übergang verweigert`);
  }
  db.prepare("UPDATE jobs SET loop_state = ? WHERE id = ?").run(toState, jobId);
  recordLoopEvent(db, { jobId, scopeId, eventType, fromState: from, toState, payload, handoffId, changeDigest });
  return { from, to: toState };
}

/**
 * Atomarer, valider Übergang. Illegaler Übergang, terminales Ziel-Zurückschreiben
 * oder fehlende Zeile fail-closed (returns { ok:false, reason }).
 */
export function transitionLoop(db, jobId, toState, { eventType = "transition", payload = null } = {}) {
  if (!LOOP_STATES.includes(toState)) return { ok: false, reason: `Unbekannter Loop-Zustand: ${toState}` };
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = applyTransition(db, jobId, toState, { eventType, payload });
    db.exec("COMMIT");
    return { ok: true, ...result };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* egal */ }
    return { ok: false, reason: e.message };
  }
}

/** Idempotenz-Schlüssel: existiert bereits ein Event mit derselben Signatur? */
function eventIdemKey(db, { handoffId, changeDigest, scopeId, eventType }) {
  return db.prepare(
    "SELECT id FROM loop_events WHERE event_type = ? AND handoff_id IS ? AND change_digest IS ? AND scope_id IS ? LIMIT 1"
  ).get(eventType, handoffId, changeDigest, scopeId);
}

/**
 * TASK-012 + TASK-014: Transaktionale Handoff-Completion.
 * Validiert Korrelation + Change, persistiert das externe Change-Ereignis,
 * vollzieht die Loop-Übergänge und erzeugt GENAU EINEN Child-Job via
 * createJob() für das Re-Review. Alles innerhalb EINER BEGIN-IMMEDIATE-
 * Transaktion; Duplikate liefern das bestehende semantische Ergebnis ohne
 * zweite Transition oder zweites Child (Idempotenz).
 *
 * @returns {{ok:true, re_review_job_id, idempotent:boolean} | {ok:false, reasons:[]}}
 */
export function completeHandoff(db, { report, handoff, changeComparison, allowedFiles = [], reReviewJob = null }) {
  const reasons = [];
  if (!report || typeof report !== "object") return { ok: false, reasons: ["Write-Report ist kein Objekt"] };
  if (!handoff || handoff.handoff_id !== report.handoff_id) reasons.push("Handoff-/Report-Korrelation fehlgeschlagen");
  if (!changeComparison || !changeComparison.changed) reasons.push("Keine echte Repository-Änderung nachweisbar (No-Change)");
  if (changeComparison?.unauthorized_files?.length) reasons.push(`Unerlaubte Änderungen: ${changeComparison.unauthorized_files.join(", ")}`);
  if (String(report.write_status || "").toUpperCase() === "ABORTED") {
    // Ehrlicher Abbruch des externen Writers: terminale ABORTED-Transition.
    const t = transitionLoop(db, report.job_id, "ABORTED", { eventType: "write_aborted", payload: { writer_id: report.writer_id } });
    return { ok: false, reasons: [t.ok ? "Writer hat den Auftrag abgebrochen (ABORTED)" : `ABORTED-Transition fehlgeschlagen: ${t.reason}`] };
  }
  if (String(report.write_status || "").toUpperCase() === "NO_CHANGE") {
    // RISK-007/TEST-009: No-Change erzeugt keine Arbeit, ehrliche Blockade.
    // Legal vorlaufen (WRITE_AUTHORIZED→WAITING_FOR_AGENT→WRITE_IN_PROGRESS),
    // dann terminal LOOP_BLOCKED — keine Transition umgeht das Zustandsmodell.
    for (const state of ["WAITING_FOR_AGENT", "WRITE_IN_PROGRESS"]) {
      const cur = db.prepare("SELECT loop_state FROM jobs WHERE id = ?").get(report.job_id);
      if ((cur?.loop_state || "QUEUED") === state) continue;
      transitionLoop(db, report.job_id, state, { eventType: "no_change_pre", payload: null });
    }
    transitionLoop(db, report.job_id, "LOOP_BLOCKED", { eventType: "no_change", payload: { writer_id: report.writer_id } });
    return { ok: false, reasons: ["Writer meldet NO_CHANGE — kein Re-Review ohne echte Änderung (Loop geblockt)"] };
  }
  if (reasons.length) return { ok: false, reasons };

  const scopeId = report.scope_id ?? null;
  const changeDigest = changeComparison.diff_digest;
  // Fast-Path-Prüfung (spart die Transaktion bei bekannten Duplikaten) — die
  // verbindliche Prüfung läuft ERNEUT INNENHALB der Transaktion unten, sonst
  // könnten zwei gleichzeitige Completions (beide lesen hier "kein Event",
  // serialisieren auf BEGIN IMMEDIATE) je ein Child erzeugen (TASK-014-Race).
  if (eventIdemKey(db, { handoffId: handoff.handoff_id, changeDigest, scopeId, eventType: "change_captured" })) {
    const existing = db.prepare(
      "SELECT id FROM jobs WHERE handoff_id = ? AND change_digest = ? AND scope_id = ? AND parent_job_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(handoff.handoff_id, changeDigest, scopeId, report.job_id);
    return { ok: true, re_review_job_id: existing ? existing.id : null, idempotent: true };
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    // Verbindliche Idempotenz-Prüfung INNERHALB der Transaktion ( serialized
    // gegen jede concurrent Completion; siehe Kommentar am Fast-Path oben).
    if (eventIdemKey(db, { handoffId: handoff.handoff_id, changeDigest, scopeId, eventType: "change_captured" })) {
      const existing = db.prepare(
        "SELECT id FROM jobs WHERE handoff_id = ? AND change_digest = ? AND scope_id = ? AND parent_job_id = ? ORDER BY created_at DESC LIMIT 1"
      ).get(handoff.handoff_id, changeDigest, scopeId, report.job_id);
      db.exec("COMMIT");
      return { ok: true, re_review_job_id: existing ? existing.id : null, idempotent: true };
    }
    // Korrelation: Child-Job muss auf Parent, Scope, Checkout, Handoff,
    // Header-Digest, Iteration und Change-Digest rückverfolgbar bleiben.
    const parent = db.prepare("SELECT * FROM jobs WHERE id = ?").get(report.job_id);
    if (!parent) throw new Error("Parent-Job nicht gefunden");
    if (parent.loop_count >= parent.max_loop_count) {
      db.prepare("UPDATE jobs SET loop_state = 'LOOP_BLOCKED' WHERE id = ?").run(report.job_id);
      recordLoopEvent(db, { jobId: report.job_id, scopeId, handoffId: handoff.handoff_id, changeDigest, eventType: "loop_limit", fromState: parent.loop_state || "CHANGE_CAPTURED", toState: "LOOP_BLOCKED", payload: { loop_count: parent.loop_count } });
      db.exec("COMMIT");
      return { ok: false, reasons: [`Loop-Limit erreicht (${parent.loop_count}/${parent.max_loop_count}) — terminale LOOP_BLOCKED`] };
    }
    // Übergänge: den Parent legal durch die Zwischenzustände führen
    // (WRITE_AUTHORIZED → WAITING_FOR_AGENT → WRITE_IN_PROGRESS), dann
    // CHANGE_CAPTURED → RE_REVIEW_QUEUED. Alles in derselben Transaktion wie
    // die Job-Erzeugung; die Events tragen die Idempotenz-Signatur
    // (handoff_id, change_digest, scope_id), an der wiederholte Reports erkannt
    // werden, bevor eine zweite Transition/Child-Erzeugung passieren kann.
    const CHAIN = ["WAITING_FOR_AGENT", "WRITE_IN_PROGRESS", "CHANGE_CAPTURED"];
    for (let i = 0; i < CHAIN.length; i++) {
      const state = CHAIN[i];
      const cur = db.prepare("SELECT loop_state FROM jobs WHERE id = ?").get(report.job_id);
      // Bereits in oder hinter dem Schritt → überspringen (legal weiterlaufen);
      // alles vor dem aktuellen Schritt ist durch die früheren i passiert.
      if (CHAIN.indexOf(cur?.loop_state || "QUEUED") >= i) continue;
      applyTransition(db, report.job_id, state, {
        eventType: state === "CHANGE_CAPTURED" ? "change_captured" : state === "WAITING_FOR_AGENT" ? "agent_wait" : "write_in_progress",
        payload: state === "CHANGE_CAPTURED" ? { changed_files: changeComparison.changed_files } : null,
        handoffId: handoff.handoff_id, changeDigest, scopeId,
      });
    }
    applyTransition(db, report.job_id, "RE_REVIEW_QUEUED", { eventType: "re_review_queued", handoffId: handoff.handoff_id, changeDigest, scopeId });
    // GENAU EIN Child-Job über die einzige Queue-Quelle (RISK-003).
    let childJobId = null;
    if (reReviewJob) {
      childJobId = createJob(db, {
        checkoutId: report.checkout_id ?? parent.checkout_id,
        scopeId,
        payload: reReviewJob.payload ?? parent.payload,
        diffText: reReviewJob.diffText ?? changeComparison.changed_files.join("\n"),
        agentIntent: reReviewJob.agentIntent ?? null,
        affected: reReviewJob.affected ?? null,
        root: reReviewJob.root ?? parent.root,
        files: reReviewJob.files ?? (allowedFiles.join(",") || parent.files),
        mode: reReviewJob.mode ?? "write",
        runtimeConfig: reReviewJob.runtimeConfig ?? (parent.runtime_config ? JSON.parse(parent.runtime_config) : null),
        maxAttempts: reReviewJob.maxAttempts ?? parent.max_attempts ?? 2,
      });
      // Korrelations-Metadaten auf dem Child persistieren.
      db.prepare(
        "UPDATE jobs SET parent_job_id = ?, handoff_id = ?, iteration_id = ?, change_digest = ?, header_digest = ?, review_iteration = ?, loop_count = ? WHERE id = ?"
      ).run(report.job_id, handoff.handoff_id, handoff.iteration_id ?? null, changeDigest, parent.header_digest ?? null, (Number(parent.review_iteration) || 0) + 1, (Number(parent.loop_count) || 0) + 1, childJobId);
      // Child startet im Loop in RE_REVIEW_QUEUED.
      db.prepare("UPDATE jobs SET loop_state = 'RE_REVIEW_QUEUED' WHERE id = ?").run(childJobId);
      recordLoopEvent(db, { jobId: childJobId, scopeId, handoffId: handoff.handoff_id, changeDigest, eventType: "re_review_created", fromState: null, toState: "RE_REVIEW_QUEUED", payload: { parent_job_id: report.job_id } });
    }
    db.exec("COMMIT");
    return { ok: true, re_review_job_id: childJobId, idempotent: false };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* egal */ }
    return { ok: false, reasons: [`Handoff-Completion fehlgeschlagen (Transaktion zurückgerollt): ${e.message}`] };
  }
}
