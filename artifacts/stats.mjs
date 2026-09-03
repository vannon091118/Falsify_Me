// FalsifyMe · artifacts/stats.mjs – Progression-Statistik (read-only)
// -----------------------------------------------------------------------------
// EINE Verantwortung: aus der EINZIGEN Persistenzquelle (SQLite-Queue,
// Regel 3) die GESAMTSTATISTIK ableiten – der persistente User-Anker
// „Ohne FalsifyMe haettest du X Fehler in Y Tasks durchgewunken, dafuer
// waren Z Jobs noetig“. KEIN Schreiben, KEIN zweites Speichersystem.
// Alle Zahlen sind Ableitungen der Queue (jobs/findings/scopes/rate_limit),
// nichts wird erfunden oder aus der Luft gegriffen.
// -----------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { falsifyHome } from "./db.mjs";

const n = (v) => Number(v) || 0;

// Identifier-Allowlist (nodejs-best-practices-Audit 2026-09-03): SQLite kann
// Tabellen-/Spaltennamen NICHT als Parameter binden — die Interpolation in
// countBy/rowsPerTable war zwar bislang nur mit hardcodierten Konstanten
// aufgerufen, aber die Sicherheit war KONVENTION, nicht mechanisch erzwungen.
// Jede Abweichung fail-fast hier (eine Stelle, fail-closed statt stiller
// SQL-Injektionsfläche).
const ALLOWED_TABLES = new Set(["meta", "scopes", "findings", "jobs", "rate_limit"]);
const ALLOWED_COLUMNS = new Set([
  "id", "status", "verdict", "wave", "phase", "scope_id", "window_idx", "failure_kind",
]);

function assertIdentifier(kind, value, allowed) {
  if (!allowed.has(value)) {
    throw new Error(`stats: ${kind}-Identifier nicht allowlisted: "${value}" (nur ${[...allowed].join(", ")})`);
  }
  return value;
}

/** Gruppiert eine Tabelle nach Spalte k -> { wert: anzahl } (read-only). */
function countBy(db, table, col) {
  assertIdentifier("Tabelle", table, ALLOWED_TABLES);
  assertIdentifier("Spalte", col, ALLOWED_COLUMNS);
  const rows = db.prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM ${table} GROUP BY ${col}`).all();
  const out = {};
  for (const r of rows) out[r.k ?? "(leer)"] = n(r.n);
  return out;
}

/**
 * Liest die Gesamtstatistik aus der Queue (keine Seiteneffekte).
 * Aufruf-beliebig oft; die Zahlen sind Momentaufnahmen der DB.
 */
export function collectStats(db) {
  const one = (sql) => {
    const r = db.prepare(sql).get();
    return n(r?.n);
  };

  const jobsTotal = one("SELECT COUNT(*) AS n FROM jobs");
  const jobsByStatus = countBy(db, "jobs", "status");
  const jobsByVerdict = countBy(db, "jobs", "verdict");
  // UNBEKANNT wird im STATUS getragen (jobDone: verdict NULL -> "DONE UNBEKANNT"),
  // nicht in jobs.verdict – der ehrliche Zaehler liest den Status.
  const unbekannt = one("SELECT COUNT(*) AS n FROM jobs WHERE status LIKE 'DONE UNBEKANNT%'");

  const findingsTotal = one("SELECT COUNT(*) AS n FROM findings");
  const findingsByVerdict = countBy(db, "findings", "verdict");
  const findingsByWave = countBy(db, "findings", "wave");

  const scopesTotal = one("SELECT COUNT(*) AS n FROM scopes");
  const scopesByStatus = countBy(db, "scopes", "status");
  const scopesByPhase = countBy(db, "scopes", "phase");

  // Falsifikations-Treffer: Annahmen, die widerlegt wurden und den Loop
  // zwangen, neu zu denken (findings mit PLAN/RESEARCH-Verdict).
  const errorsCaught = n(findingsByVerdict.PLAN) + n(findingsByVerdict.RESEARCH);
  // Freigaben: Jobs, die als WRITE durchgegangen sind (belastbar bestätigt).
  const releases = n(jobsByVerdict.WRITE);
  // Nachweisbare Modell-Calls: Jobs mit Verdict (mind. 1 Call) + jede
  // Evil-Twin-Gegenpruefung (wave='evil-twin' = zweiter, unabhaengiger Call).
  const jobsWithVerdict = jobsTotal - n(jobsByVerdict["(leer)"]);
  const modelCalls = jobsWithVerdict + n(findingsByWave["evil-twin"]);

  // SQLite-Nutzung: Dateigroesse + Zeilen je Tabelle („was FalsifyMe
  // gespeichert hat“ – ehrlich aus der DB abgeleitet).
  const file = path.join(falsifyHome(), "falsify.db");
  const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
  const rowsPerTable = {};
  for (const t of ["meta", "scopes", "findings", "jobs", "rate_limit"]) {
    assertIdentifier("Tabelle", t, ALLOWED_TABLES);
    try { rowsPerTable[t] = one(`SELECT COUNT(*) AS n FROM ${t}`); } catch { rowsPerTable[t] = 0; }
  }

  return {
    jobsTotal,
    jobsByStatus,
    jobsByVerdict,
    unbekannt,
    findingsTotal,
    findingsByVerdict,
    findingsByWave,
    scopesTotal,
    scopesByStatus,
    scopesByPhase,
    errorsCaught,
    releases,
    modelCalls,
    sqlite: { file, bytes, rowsPerTable },
  };
}

/** Die EIN-SATZ-Statistik – der User-Anker, den das Dock/die CLI zeigt. */
export function progressionStatement(s) {
  const one = (v, single, plural) => `${v} ${v === 1 ? single : plural}`;
  const tasks = one(s.scopesTotal, "Task", "Tasks");
  const errors = one(s.errorsCaught, "Fehler", "Fehler");
  const jobs = one(s.jobsTotal, "Job", "Jobs");
  const releases = one(s.releases, "Freigabe", "Freigaben");
  return `Ohne FalsifyMe haettest du ${errors} in ${tasks} als korrekt durchgewunken – ` +
    `FalsifyMe hat sie widerlegt (findings PLAN/RESEARCH), dein Agent musste sie selbst bestaetigen. ` +
    `Dafuer waren ${jobs} noetig, ${releases} (WRITE).`;
}
