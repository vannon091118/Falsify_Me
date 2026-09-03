// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · artifacts/loops.mjs – Loop-ZUSTANDSMASCHINE (rein, keine
// Job-/Queue-Abhängigkeit)
// -----------------------------------------------------------------------------
// EIN Zustandsmodell für den Produktions-Loop:
//   QUEUED → RUNNING → WRITE_AUTHORIZED → WAITING_FOR_AGENT →
//   WRITE_IN_PROGRESS → CHANGE_CAPTURED → RE_REVIEW_QUEUED →
//   RE_REVIEW_RUNNING → DONE  |  LOOP_BLOCKED | ABORTED | ERROR
//
// Invarianten:
// · Dieses Modul besitzt NUR den Loop-Protokollzustand (loop_state) und dessen
//   legale Übergänge. Es importiert KEIN artifacts/jobs.mjs — die ausführbare
//   Queue (jobs.status) gehört jobs.mjs, die Kopplung der beiden Zustände
//   läuft über den Übergangs-Dienst artifacts/loopflow.mjs (Richtung:
//   Job-Lebenszyklus → Übergangs-Dienst → Loop-Zustand, kein Zyklus).
// · Terminale Zustände (DONE, LOOP_BLOCKED, ABORTED, ERROR) sind
//   unumkehrbar (SEC-004) — applyTransition/transitionLoop verweigern jede
//   Transition AUS einem terminalen Zustand (kein stilles Überschreiben).
// · Übergänge sind atomar (BEGIN IMMEDIATE) und idempotent für denselben
//   (handoff_id, change_digest, scope_id)-Schlüssel (TASK-014, siehe
//   artifacts/handoff.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { nowIso, genId } from "./db.mjs";

export const LOOP_STATES = Object.freeze([
  "QUEUED", "RUNNING", "WRITE_AUTHORIZED", "WAITING_FOR_AGENT", "WRITE_IN_PROGRESS",
  "CHANGE_CAPTURED", "RE_REVIEW_QUEUED", "RE_REVIEW_RUNNING",
  "DONE", "LOOP_BLOCKED", "ABORTED", "ERROR",
]);

const TERMINAL_LOOP_STATES = Object.freeze(["DONE", "LOOP_BLOCKED", "ABORTED", "ERROR"]);

// Legalisierte Übergänge (alles andere fail-closed). WRITE_AUTHORIZED darf
// direkt auf LOOP_BLOCKED (Loop-Limit ohne zwischengeschalteten Writer-Schritt)
// — die Transitionstabelle ist die Wahrheit; der Loop-Limit-Pfad in
// artifacts/handoff.mjs geht NUR über diese Tabelle (kein rohes UPDATE).
const TRANSITIONS = Object.freeze({
  // QUEUED → WRITE_AUTHORIZED: der FIRST-RUN-Handoff-Pfad. Erstlauf-Jobs
  // bleiben im Loop-Protokoll auf QUEUED (Claim-/finalize-Advance überspringen
  // Nicht-Re-Reviews bewusst — kein Phantom-State), die Handoff-Emission
  // (markWriteAuthorized in loopflow.mjs) ist ihre ERSTE echte Loop-Transition.
  "QUEUED": ["RUNNING", "WRITE_AUTHORIZED", "ERROR", "ABORTED"],
  "RUNNING": ["WRITE_AUTHORIZED", "ERROR", "ABORTED"],
  "WRITE_AUTHORIZED": ["WAITING_FOR_AGENT", "LOOP_BLOCKED", "ERROR", "ABORTED"],
  "WAITING_FOR_AGENT": ["WRITE_IN_PROGRESS", "LOOP_BLOCKED", "ERROR", "ABORTED"],
  "WRITE_IN_PROGRESS": ["CHANGE_CAPTURED", "LOOP_BLOCKED", "ERROR", "ABORTED"],
  "CHANGE_CAPTURED": ["RE_REVIEW_QUEUED", "LOOP_BLOCKED", "ERROR", "ABORTED"],
  // LOOP_BLOCKED ist von JEDEM offenen Zustand aus erreichbar, den
  // completeHandoff beobachten kann (WRITE_AUTHORIZED nach der Handoff-
  // Emission, RE_REVIEW_QUEUED bei Re-Delivery nach früheren Completions,
  // sowie WAITING_FOR_AGENT/WRITE_IN_PROGRESS/CHANGE_CAPTURED): Loop-Limit
  // = „der Loop kann nicht weiterlaufen“ — terminal, aber NIE über einem
  // bereits terminalen Zustand (SEC-004).
  "RE_REVIEW_QUEUED": ["RE_REVIEW_RUNNING", "LOOP_BLOCKED", "ERROR", "ABORTED"],
  "RE_REVIEW_RUNNING": ["DONE", "WRITE_AUTHORIZED", "ERROR", "ABORTED"],
  // Terminale Zustände haben keine Übergänge.
  "DONE": [], "LOOP_BLOCKED": [], "ABORTED": [], "ERROR": [],
});

export function isTerminal(state) {
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
 * Transaktionsgrenze (transitionLoop einzeln, completeHandoff als Ganzes,
 * advanceLoop im Claim-/Finalisierungs-Pfad). Wirft bei illegalen Übergängen
 * und bei terminalem Ausgangszustand (kein stiller Verlust, kein Überschreiben
 * eines terminalen Zustands — SEC-004).
 */
export function applyTransition(db, jobId, toState, { eventType = "transition", payload = null, handoffId = null, changeDigest = null, scopeId = null } = {}) {
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
 * Atomarer, valider Übergang. Illegaler Übergang, terminales Ausgangs-Zurück-
 * schreiben oder fehlende Zeile fail-closed (returns { ok:false, reason }).
 */
export function transitionLoop(db, jobId, toState, { eventType = "transition", payload = null, handoffId = null, changeDigest = null, scopeId = null } = {}) {
  if (!LOOP_STATES.includes(toState)) return { ok: false, reason: `Unbekannter Loop-Zustand: ${toState}` };
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = applyTransition(db, jobId, toState, { eventType, payload, handoffId, changeDigest, scopeId });
    db.exec("COMMIT");
    return { ok: true, ...result };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* egal */ }
    return { ok: false, reason: e.message };
  }
}