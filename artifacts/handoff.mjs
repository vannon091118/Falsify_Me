// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · artifacts/handoff.mjs – Handoff-Orchestrierung (completeHandoff)
// -----------------------------------------------------------------------------
// Konsumiert die Loop-Zustandsmaschine (artifacts/loops.mjs) und die EINZIGE
// Job-/Queue-Quelle (artifacts/jobs.mjs:createJob) — bewusst als EIGENES Modul
// neben der reinen Zustandsmaschine, damit zwischen jobs.mjs und loops.mjs
// kein Importzyklus entsteht:
//
//   loops.mjs (Zustand, rein)  ←  loopflow.mjs (Übergangs-Dienst)
//          ↑                          ↑
//          └─────────────┬────────────┘
//                 handoff.mjs (Orchestrierung: validiert den externen
//                 Write-Report, vollzieht die Parent-Übergänge, erzeugt
//                 GENAU EIN Re-Review-Child via jobs.createJob)
//
// TASK-012 + TASK-014: Transaktionale Handoff-Completion. Validiert
// Korrelation + Change, persistiert das externe Change-Ereignis, vollzieht die
// Loop-Übergänge und erzeugt GENAU EINEN Child-Job für das Re-Review. Alles
// innerhalb EINER BEGIN-IMMEDIATE-Transaktion; Duplikate liefern das
// bestehende semantische Ergebnis ohne zweite Transition oder zweites Child.
//
// SEC-004 (Terminal-Immutabilität): JEDER Terminal-Pfad hier (ABORTED,
// LOOP_BLOCKED via NO_CHANGE/Loop-Limit) prüft zuerst, ob der Parent-Loop
// bereits terminal ist — ein terminaler Zustand wird NIE überschrieben, auch
// nicht durch eine spätere Re-Delivery mit anderem handoff_id.
// ─────────────────────────────────────────────────────────────────────────────
import { applyTransition, transitionLoop, recordLoopEvent, isTerminal } from "./loops.mjs";
import { createJob } from "./jobs.mjs";

/** Idempotenz-Schlüssel: existiert bereits ein Event mit derselben Signatur? */
function eventIdemKey(db, { handoffId, changeDigest, scopeId, eventType }) {
  return db.prepare(
    "SELECT id FROM loop_events WHERE event_type = ? AND handoff_id IS ? AND change_digest IS ? AND scope_id IS ? LIMIT 1"
  ).get(eventType, handoffId, changeDigest, scopeId);
}

/**
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
    // SEC-004: ein bereits terminaler Loop (DONE/ERROR/LOOP_BLOCKED/ABORTED)
    // wird durch eine spätere ABORTED-Re-Delivery NICHT überschrieben.
    const cur = db.prepare("SELECT loop_state FROM jobs WHERE id = ?").get(report.job_id);
    if (isTerminal(cur?.loop_state || "QUEUED")) {
      return { ok: false, reasons: [`Loop ist bereits terminal (${cur.loop_state}) — ABORTED-Re-Delivery ignoriert (SEC-004)`] };
    }
    const t = transitionLoop(db, report.job_id, "ABORTED", { eventType: "write_aborted", payload: { writer_id: report.writer_id } });
    return { ok: false, reasons: [t.ok ? "Writer hat den Auftrag abgebrochen (ABORTED)" : `ABORTED-Transition fehlgeschlagen: ${t.reason}`] };
  }
  if (String(report.write_status || "").toUpperCase() === "NO_CHANGE") {
    // RISK-007/TEST-009: No-Change erzeugt keine Arbeit, ehrliche Blockade.
    // SEC-004: terminaler Loop bleibt unangetastet (kein LOOP_BLOCKED über
    // einem DONE/ABORTED/ERROR/LOOP_BLOCKED).
    const cur = db.prepare("SELECT loop_state FROM jobs WHERE id = ?").get(report.job_id);
    if (isTerminal(cur?.loop_state || "QUEUED")) {
      return { ok: false, reasons: [`Loop ist bereits terminal (${cur.loop_state}) — NO_CHANGE-Re-Delivery ignoriert (SEC-004)`] };
    }
    // Legal vorlaufen (WRITE_AUTHORIZED→WAITING_FOR_AGENT→WRITE_IN_PROGRESS),
    // dann terminal LOOP_BLOCKED — keine Transition umgeht das Zustandsmodell.
    for (const state of ["WAITING_FOR_AGENT", "WRITE_IN_PROGRESS"]) {
      const curState = db.prepare("SELECT loop_state FROM jobs WHERE id = ?").get(report.job_id);
      if ((curState?.loop_state || "QUEUED") === state) continue;
      transitionLoop(db, report.job_id, state, { eventType: "no_change_pre", payload: null });
    }
    transitionLoop(db, report.job_id, "LOOP_BLOCKED", { eventType: "no_change", payload: { writer_id: report.writer_id } });
    return { ok: false, reasons: ["Writer meldet NO_CHANGE — kein Re-Review ohne echte Änderung (Loop geblockt)"] };
  }
  if (reasons.length) return { ok: false, reasons };

  const scopeId = report.scope_id ?? null;
  const changeDigest = changeComparison.diff_digest;
  // Fast-Path-Prüfung (spart die Transaktion bei bekannten Duplikaten) — die
  // verbindliche Prüfung läuft ERNEUT INNERHALB der Transaktion unten, sonst
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
    // Verbindliche Idempotenz-Prüfung INNERHALB der Transaktion (serialisiert
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
      // Loop-Limit → terminal LOOP_BLOCKED, aber NUR über die legale
      // Transitionstabelle und NIE über einem bereits terminalen Zustand
      // (SEC-004: DONE/ABORTED/ERROR/LOOP_BLOCKED bleiben unverändert).
      const curState = parent.loop_state || "QUEUED";
      if (isTerminal(curState)) {
        db.exec("COMMIT");
        return { ok: false, reasons: [`Parent-Loop ist bereits terminal (${curState}) — keine Zustandsänderung (SEC-004)`] };
      }
      applyTransition(db, report.job_id, "LOOP_BLOCKED", {
        eventType: "loop_limit",
        handoffId: handoff.handoff_id, changeDigest, scopeId,
        payload: { loop_count: parent.loop_count },
      });
      db.exec("COMMIT");
      return { ok: false, reasons: [`Loop-Limit erreicht (${parent.loop_count}/${parent.max_loop_count}) — terminale LOOP_BLOCKED`] };
    }
    // Übergänge: den Parent legal durch die Zwischenzustände führen
    // (WRITE_AUTHORIZED → WAITING_FOR_AGENT → WRITE_IN_PROGRESS), dann
    // CHANGE_CAPTURED → RE_REVIEW_QUEUED. Alles in derselben Transaktion wie
    // die Job-Erzeugung; die Events tragen die Idempotenz-Signatur
    // (handoff_id, change_digest, scope_id), an der wiederholte Reports
    // erkannt werden, bevor eine zweite Transition/Child-Erzeugung passieren
    // kann. Der Parent wird durch den gesamten WRITE-Gang bis RE_REVIEW_QUEUED
    // geführt. Er darf dabei NICHT DONE werden — nur RE_REVIEW_RUNNING (→ DONE)
    // im Re-Review oder LOOP_BLOCKED/ABORTED/ERROR schließt ihn.
    const CHAIN = ["WAITING_FOR_AGENT", "WRITE_IN_PROGRESS", "CHANGE_CAPTURED"];
    for (let i = 0; i < CHAIN.length; i++) {
      const state = CHAIN[i];
      const cur = db.prepare("SELECT loop_state FROM jobs WHERE id = ?").get(report.job_id);
      const curState = cur?.loop_state || "QUEUED";
      const curIdx = CHAIN.indexOf(curState);
      // Bereits in oder hinter dem aktuellen Schritt → überspringen (legal
      // weiterlaufen; Out-of-Order-Re-Delivery darf keinen illegalen Rückwärts-
      // Übergang erzwingen). RE_REVIEW_QUEUED liegt hinter der Kette.
      const atOrPast = curIdx >= 0 ? curIdx >= i : curState === "RE_REVIEW_QUEUED";
      if (atOrPast) continue;
      applyTransition(db, report.job_id, state, {
        eventType: state === "CHANGE_CAPTURED" ? "change_captured" : state === "WAITING_FOR_AGENT" ? "agent_wait" : "write_in_progress",
        payload: state === "CHANGE_CAPTURED" ? { changed_files: changeComparison.changed_files } : null,
        handoffId: handoff.handoff_id, changeDigest, scopeId,
      });
    }
    const curFinal = db.prepare("SELECT loop_state FROM jobs WHERE id = ?").get(report.job_id);
    if ((curFinal?.loop_state || "QUEUED") !== "RE_REVIEW_QUEUED") {
      applyTransition(db, report.job_id, "RE_REVIEW_QUEUED", { eventType: "re_review_queued", handoffId: handoff.handoff_id, changeDigest, scopeId });
    }
    // GENAU EIN Child-Job über die einzige Queue-Quelle (RISK-001).
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
      // Child startet im Loop in RE_REVIEW_QUEUED; die Re-Review-Ausführung
      // wird erst beim tatsächlichen Claim zu RE_REVIEW_RUNNING (siehe
      // advanceLoop in artifacts/loopflow.mjs). Das verhindert, dass der
      // Loop-State hinter dem Job-Status herhinkt.
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