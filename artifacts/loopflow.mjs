// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · artifacts/loopflow.mjs – ÜBERGANGS-DIENST (advanceLoop)
// -----------------------------------------------------------------------------
// Verbindet den Job-Lebenszyklus (artifacts/jobs.mjs) mit der Loop-
// Zustandsmaschine (artifacts/loops.mjs) OHNE Importzyklus:
//
//   job lifecycle (jobs.mjs)
//          ↓
//   transition service (dieses Modul)
//          ↓
//   loop state (loops.mjs)
//
// advanceLoop ist die EINZIGE Kopplung zwischen einem RUNTIME-Ereignis des
// Jobs und einem Loop-Zustandswechsel. Die drei fachlichen Ereignisse:
//
//   · claim    – ein Job wird tatsächlich von der Queue übernommen
//                (RE_REVIEW_QUEUED → RE_REVIEW_RUNNING; Erstlauf bleibt unberührt)
//   · finalize – ein Job bekommt seinen finalen Verdict persistiert
//                (RE_REVIEW_RUNNING + finaler NICHT-WRITE-Verdict → DONE;
//                 WRITE lässt den Loop offen — der Handoff schiebt weiter)
//   · error    – ein Job wird mit Fehler finalisiert
//                (jeder Nicht-Terminal-Zustand → ERROR)
//
// Transaktions-agnostisch: Der Aufrufer (claimNextJob/jobDone) besitzt die
// Transaktionsgrenze, damit status- und loop_state-Wechsel EINE atomare
// Einheit sind — nie status=RUNNING/ERROR bei loop_state=RE_REVIEW_QUEUED.
// Idempotent: Wiederholte Ereignisse (Retry/Re-Claim/Re-Delivery) erzeugen
// keine zweite Transition und überschreiben keinen terminalen Zustand (SEC-004).
// ─────────────────────────────────────────────────────────────────────────────
import { applyTransition, isTerminal } from "./loops.mjs";

/**
 * @param {object} opts
 * @param {string} opts.event  "claim" | "finalize" | "error"
 * @param {string|null} opts.verdict  nur bei event="finalize" relevant
 * @param {number|null} opts.windowIdx nur bei event="claim"
 * @param {string|null} opts.scopeId
 * @returns {{ok:true, from, to}|{ok:true, skipped:true, reason}|{ok:false, reason}}
 *          Wirft bei illegalen Übergängen (Aufrufer rollt die Transaktion zurück).
 */
export function advanceLoop(db, jobId, { event, verdict = null, windowIdx = null, scopeId = null } = {}) {
  const row = db.prepare("SELECT loop_state, status FROM jobs WHERE id = ?").get(jobId);
  if (!row) return { ok: false, reason: "Job nicht gefunden" };
  const from = row.loop_state || "QUEUED";
  // Terminal-Guard: ein terminaler Loop-Zustand ist unumkehrbar — kein
  // Ereignis (auch kein Retry) darf ihn je wieder öffnen oder überschreiben.
  if (isTerminal(from)) return { ok: true, skipped: true, reason: `terminal (${from})` };

  let toState = null;
  let eventType = null;
  let payload = null;
  if (event === "claim") {
    if (from !== "RE_REVIEW_QUEUED") {
      // Kein wartender Re-Review: Erstlauf (QUEUED) oder bereits laufender
      // Loop — hier gibt es nichts kausal fortzuschreiben (kein Phantom-State).
      return { ok: true, skipped: true, reason: "kein wartender Re-Review" };
    }
    toState = "RE_REVIEW_RUNNING";
    eventType = "claim_start";
    payload = { window_idx: windowIdx };
  } else if (event === "finalize") {
    if (String(verdict || "").toUpperCase() === "WRITE") {
      // WRITE lässt den Loop bewusst offen (Handoff → WRITE_AUTHORIZED folgt
      // im Handoff-Pfad) — kein DONE, keine weitere Transition hier.
      return { ok: true, skipped: true, reason: "WRITE lässt den Loop offen" };
    }
    if (from !== "RE_REVIEW_RUNNING") {
      // Erstlauf-PLAN/-RESEARCH bleibt Loop-offen (Scope active, erneuter
      // Submit erwartet) — kein vorzeitiges DONE.
      return { ok: true, skipped: true, reason: "kein laufender Re-Review" };
    }
    // G: DONE erst NACH dem persistierten finalen Verdict. Solange der Job
    // noch läuft (status=RUNNING), ist KEIN Abschluss bewiesen — diese Prüfung
    // macht die Kausalität unabhängig vom Aufrufzeitpunkt beweisbar.
    if (!String(row.status || "").startsWith("DONE")) {
      return { ok: true, skipped: true, reason: "Job ist noch nicht final" };
    }
    toState = "DONE";
    eventType = "loop_done";
    payload = { verdict: String(verdict || "") };
  } else if (event === "error") {
    toState = "ERROR";
    eventType = "loop_error";
    payload = { job_status: String(row.status || "").slice(0, 200) };
  } else {
    return { ok: false, reason: `Unbekanntes Loop-Ereignis: ${event}` };
  }

  // Persistieren (fail-closed: illegaler Übergang wirft → Aufrufer rollbackt
  // die ganze Transaktion, es bleibt kein halber Zustand zurück).
  const result = applyTransition(db, jobId, toState, { eventType, payload, scopeId });
  return { ok: true, ...result };
}

/**
 * Handoff-Emission: bindet handoff_id UND die WRITE_AUTHORIZED-Transition in
 * EINER Transaktion (Korrelation + Lifecycle-Wechsel atomar). Läuft über die
 * Transitionstabelle (kein Raw-Update): QUEUED (Erstlauf) oder
 * RE_REVIEW_RUNNING (Re-Review-WRITE) → WRITE_AUTHORIZED; ein terminaler Loop
 * wird nie überschrieben (SEC-004 — applyTransition wirft, Transaktion rollt
 * zurück, handoff_id bleibt ungesetzt). Dieses Modul besitzt die Transaktion
 * (anders als advanceLoop), weil handoff_id + loop_state EINE Einheit sind.
 *
 * @returns {{ok:true, from, to}|{ok:false, reason}}
 */
export function markWriteAuthorized(db, jobId, { handoffId, changeDigest = null, scopeId = null } = {}) {
  if (!handoffId) return { ok: false, reason: "handoff_id fehlt" };
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = applyTransition(db, jobId, "WRITE_AUTHORIZED", {
      eventType: "handoff_emitted", handoffId, changeDigest, scopeId,
      payload: { handoff_id: handoffId },
    });
    db.prepare("UPDATE jobs SET handoff_id = ? WHERE id = ?").run(handoffId, jobId);
    db.exec("COMMIT");
    return { ok: true, ...result };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* egal */ }
    return { ok: false, reason: e.message };
  }
}