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
import { verdictToPhase } from "./scopes.mjs";
import { checkProjectConsistency } from "./projects.mjs";

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
    if (!last) {
      // Härtung ohne EINZIGES Finding: die Härtung hätte keine Quelle
      // (vorher übersprang if (last && …) genau diese Blindstelle).
      violations.push(`scope ${s.id}: status=hardened, aber kein einziges Finding vorhanden`);
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
    // Phase vs. letztes Finding-Verdict: echte Verdicts (PLAN/RESEARCH/WRITE)
    // bewegen die Phase — eine abgeleitete Phase ohne passendes letztes Verdict
    // ist eine zweite Wahrheit (Blindstelle: vorher wurde die Achse nie
    // verglichen). ASK/UNBEKANNT/null bewegen die Phase bewusst nicht.
    const lastV = db.prepare(
      "SELECT verdict FROM findings WHERE scope_id = ? ORDER BY round DESC, id DESC LIMIT 1"
    ).get(s.id);
    const expectedPhase = lastV ? verdictToPhase(lastV.verdict) : null;
    if (expectedPhase && s.phase !== expectedPhase) {
      violations.push(`scope ${s.id}: phase=${s.phase}, aber letztes Finding-Verdict=${lastV.verdict} (erwartet ${expectedPhase})`);
    }
  }

  // ── 3. Orphan-RUNNING: kein RUNNING-Job darf existieren, dessen Fenster
  //      keinen lebenden Worker hat (die Wahrheit „läuft" braucht einen
  //      Prozess; das ist die einzige zulässige Quelle von RUNNING). Fenster 0
  //      = Direkt-Run (falsify run --job-id) registriert sich selbst mit
  //      Heartbeat — ein lebender Direkt-Lauf ist KEIN Orphan, ein toter wird
  //      geflaggt und von reapStaleJobs aufgeräumt (Asymmetrie-Fix). ─────────
  for (const j of db.prepare("SELECT id, window_idx FROM jobs WHERE status = 'RUNNING'").all()) {
    const idx = Number(j.window_idx ?? 0);
    if (!isWorkerAlive(db, idx) || workerPid(db, idx) === 0) {
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

  // ── 6. jobs.status kodiert das Verdict: 'DONE <VERDICT>' muss zu
  //      jobs.verdict passen (UNBEKANNT = verdict NULL/UNBEKANNT). Vorher nur
  //      verdict-vs-Finding geprüft und nur wenn verdict IS NOT NULL. ────────
  for (const j of db.prepare("SELECT id, status, verdict FROM jobs WHERE status LIKE 'DONE %'").all()) {
    const suffix = String(j.status).slice(5);
    if (suffix === "UNBEKANNT") {
      if (j.verdict !== null && j.verdict !== "UNBEKANNT") {
        violations.push(`job ${j.id}: status=${j.status}, aber verdict=${j.verdict} (inkonsistent)`);
      }
    } else if (j.verdict !== suffix) {
      violations.push(`job ${j.id}: status=${j.status}, aber verdict=${String(j.verdict)}(inkonsistent)`);
    }
  }
  for (const j of db.prepare("SELECT id, status, verdict FROM jobs WHERE verdict IS NOT NULL AND status NOT LIKE 'DONE %' AND status NOT LIKE 'ERROR %'").all()) {
    violations.push(`job ${j.id}: verdict=${j.verdict} gesetzt, aber status=${j.status} (verdict ohne Statusquelle)`);
  }

  // ── 7. Projekt-/Checkout-Identität: Binding-Wahrheit bleibt in SQLite,
  //      niemals in scopes/jobs oder einer zweiten Queue. ───────────────────
  const project = checkProjectConsistency(db);
  violations.push(...project.violations);

  return { ok: violations.length === 0, violations };
}

/**
 * Enforcement-Variante für den Betriebsloop (Regel-3-Rig): Wirft bei jeder
 * Inkonsistenz — keine stille zweite Wahrheit. Aufrufer: cli/run.mjs
 * (submit + nach Review-Commit), ui/worker.mjs (nach Claim) + falsify doctor
 * nutzt weiterhin checkQueueConsistency (read-only, ohne Wurf).
 * @throws {Error} bei Verletzungen
 */
export function enforceQueueConsistency(db) {
  const { violations } = checkQueueConsistency(db);
  if (violations.length) {
    throw new Error("Zustandsmodell inkonsistent (Regel 3: keine zweite Wahrheit):\n- " + violations.join("\n- "));
  }
}