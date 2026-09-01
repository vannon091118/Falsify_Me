// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/ratelimit.mjs – clientseitiges Rate-Limit, ATOMAR
// -----------------------------------------------------------------------------
// Implementierung über SQLite (EINZIGE Persistenzquelle): Eine Reservation
// wird innerhalb von BEGIN IMMEDIATE … COMMIT gesetzt (SQLite serialisiert
// Schreibtransaktionen über den WAL-Writer-Lock). Damit ist der frühere
// TOCTOU-Fehler (read last → wait → write new) beseitigt: Zwei parallele
// Worker können dieselbe Minute nicht überbuchen.
// Regressionstest: tests/security.test.mjs → "Rate-Limit parallel".
// ─────────────────────────────────────────────────────────────────────────────
import { openDb, closeDb } from "../artifacts/db.mjs";

function ensureTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS rate_limit(
    slot TEXT PRIMARY KEY,
    next_free INTEGER NOT NULL
  );`);
}

/**
 * Blockiert, bis der nächste API-Aufruf unter maxRpm liegt, und reserviert
 * ATOMAR den Slot (BEGIN IMMEDIATE). Parallel Prozesse serialisieren sich
 * über den SQLite-Schreib-Lock.
 * @param {number} maxRpm  Aufrufe pro Minute (> 0, wird vom Config-Layer validiert)
 * @param {boolean} noWait true = Reservation überspringen (interaktive Tools)
 */
export function enforceRateLimit(maxRpm, noWait = false) {
  if (noWait) return;
  const minIntervalMs = Math.max(1, Math.round(60000 / maxRpm));
  const db = openDb();
  ensureTable(db);

  for (;;) {
    let waitMs = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT next_free FROM rate_limit WHERE slot = 'api'").get();
      const now = Date.now();
      const start = row ? Math.max(row.next_free, now) : now;
      if (row && row.next_free > now) waitMs = row.next_free - now;
      db.prepare(
        "INSERT INTO rate_limit(slot, next_free) VALUES('api', ?) ON CONFLICT(slot) DO UPDATE SET next_free = excluded.next_free"
      ).run(start + minIntervalMs);
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* egal */ }
      throw e;
    }
    if (waitMs <= 0) return;
    process.stderr.write(`⏳ Rate-Limit (${maxRpm}/min): warte ${waitMs} ms …\n`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
  }
}

/** Nur für Tests: Rate-Limit-Tabelle leeren. */
export function resetRateLimit() {
  const db = openDb();
  ensureTable(db);
  db.prepare("DELETE FROM rate_limit WHERE slot = 'api'").run();
}
