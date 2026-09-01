// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · artifacts/invariants.mjs – Zustandsmodell-Konsistenz (Regel 3)
// -----------------------------------------------------------------------------
// Regel 3 (Nutzer-Vorgabe 2026-09-01): Der Workflow darf keine zweite Wahrheit
// erzeugen – Scope, Findings, Evidence, Zustand und Verdict müssen aus einem
// konsistenten Zustandsmodell stammen; keine parallelen Persistenzsysteme für
// denselben Zustand.
//
// Dieses Modul macht die Invariante PRÜFBAR (read-only): checkQueueConsistency
// prüft abgeleitete Zustände gegen ihre Quelldaten (ein Zustand, eine Quelle).
// Es schreibt NIE. Der Single-Writer-Anspruch selbst (nur artifacts/jobs.mjs +
// artifacts/scopes.mjs schreiben Job-/Scope-Zustand, Aufruf nur aus run.mjs/
// worker.mjs) wird als statischer Regressionstest in tests/invariants.test.mjs
// erzwungen.
// ─────────────────────────────────────────────────────────────────────────────
import { isWorkerAlive, workerPid } from "./jobs.mjs";

/**
 * Prüft die Konsistenz des Zustandsmodells.
 * @param {import("node:sqlite").DatabaseSync} db
 * @returns {{ ok: boolean, violations: string[] }} violations = lesbare Befunde;
 *   leere Liste = der Workflow erzeugt keine zweite Wahrheit.
 */
export function checkQueueConsistency(db) {
  const violations = [];

  // ── 1. Härtung: status=hardened verlangt 0 offene Konflikte und ein
  //      WRITE-Finding als letztes Verdict (Ableitung konsistent). ───────────
  const hardened = db.prepare("SELECT * FROM scopes WHERE status = 'hardened'").all();
  for (const s of hardened) {
    if (Number(s.open_conflicts || 0) !== 0) {
      violations.push(`scope ${s.id}: status=hardened, aber open_conflicts=${s.open_conflicts}`);
    }
    const last = db.prepare(
      "SELECT verdict FROM findings WHERE scope_id = ? ORDER BY round DESC, id DESC LIMIT 1"
    ).get(s.id);
    if (last && last.verdict !== "WRITE") {
      violations.push(`scope ${s.id}: status=hardened, aber letztes Finding-Verdict=${last.verdict}`);
    }
  }

  // ── 2. GAP-Semantik: last_gap ist der Befund bei offenem Loop (phase
  //      plan/research nach PLAN/RESEARCH/ASK), null nach WRITE. ─────────────
  for (const s of db.prepare("SELECT * FROM scopes").all()) {
    if (s.phase === "write" && s.last_gap !== null) {
      violations.push(`scope ${s.id}: phase=write, aber last_gap gesetzt (WRITE schließt den GAP)`);
    }
    if ((s.phase === "plan" || s.phase === "research") && s.last_befund && s.last_gap !== s.last_befund) {
      violations.push(`scope ${s.id}: last_gap weicht vom letzten Befund ab (${s.last_gap === null ? "null" : "…"})`);
    }
  }

  // ── 3. Orphan-RUNNING: kein RUNNING-Job darf existieren, dessen Fenster
  //      keinen lebenden Worker hat (die Wahrheit „läuft" braucht einen
  //      Prozess; das ist die einzige zulässige Quelle von RUNNING). ─────────
  for (const j of db.prepare("SELECT id, window_idx FROM jobs WHERE status = 'RUNNING'").all()) {
    const idx = Number(j.window_idx || 0);
    if (idx < 1 || !isWorkerAlive(db, idx) || workerPid(db, idx) === 0) {
      violations.push(`job ${j.id}: RUNNING, aber Fenster ${idx} hat keinen lebenden Worker (Orphan)`);
    }
  }

  // ── 4. Verdict-Quelle: jobs.verdict MUSS dem letzten Finding-Verdict des
  //      Jobs entsprechen (beide kommen aus demselben Review-Write). ─────────
  for (const j of db.prepare("SELECT id, verdict FROM jobs WHERE verdict IS NOT NULL").all()) {
    const f = db.prepare(
      "SELECT verdict FROM findings WHERE job_id = ? ORDER BY id DESC LIMIT 1"
    ).get(j.id);
    if (f && f.verdict !== j.verdict) {
      violations.push(`job ${j.id}: jobs.verdict=${j.verdict}, aber letztes Finding=${f.verdict}`);
    }
  }

  // ── 5. Findings referenzieren einen existierenden Scope (keine Waisen). ───
  const orphans = db.prepare(
    "SELECT f.id FROM findings f LEFT JOIN scopes s ON s.id = f.scope_id WHERE s.id IS NULL LIMIT 5"
  ).all();
  if (orphans.length) {
    violations.push(`findings ohne Scope: ${orphans.map((r) => r.id).join(", ")}`);
  }

  return { ok: violations.length === 0, violations };
}