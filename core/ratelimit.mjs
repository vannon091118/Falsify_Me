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
  // Fail-closed (Produktionsbeweis 2026-09-03): ein nicht-finitiver oder
  // nicht-positiver maxRpm wuerde 60000/0=Infinity als next_free persistieren
  // und jeden nachfolgenden Lauf dauerhaft blockieren — laut scheitern statt
  // die Rate-Limit-Tabelle still zu vergiften.
  if (!Number.isFinite(maxRpm) || maxRpm <= 0) {
    throw new Error(`Ungültiger maxRpm (${maxRpm}) – Rate-Limit kann nicht berechnet werden.`);
  }
  const minIntervalMs = Math.max(1, Math.round(60000 / maxRpm));
  const db = openDb();
  ensureTable(db);

  for (;;) {
    let waitMs = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT next_free FROM rate_limit WHERE slot = 'api'").get();
      const now = Date.now();
      // Vergiftete Zeile (nicht-finitiver next_free, z.B. Infinity aus einem
      // frueheren maxRpm=null-Defekt) blockiert nie: als frei behandeln und
      // im selben Schritt ueberschreiben (Heilung statt Dauer-Hang).
      if (row && Number.isFinite(row.next_free) && row.next_free > now) {
        // Slot belegt: NUR warten. Die Reservation wird dabei NICHT
        // weitergeschrieben — ein Schreiben im Warte-Fall liesse den
        // Wartenden bei der naechsten Runde seine EIGENE Zukunft lesen und
        // sie weiter ausdehnen (Livelock, WAL-Wachstum; Lauf-2026-09-01).
        waitMs = row.next_free - now;
      } else {
        // Slot frei: genau EINMAL reservieren (naechster freier Slot).
        db.prepare(
          "INSERT INTO rate_limit(slot, next_free) VALUES('api', ?) ON CONFLICT(slot) DO UPDATE SET next_free = excluded.next_free"
        ).run(now + minIntervalMs);
      }
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
