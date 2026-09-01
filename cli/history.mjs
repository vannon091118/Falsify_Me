// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/history.mjs – Befund-Historie aus der DB
// -----------------------------------------------------------------------------
// Lese-Zugriff auf findings (nur der eigenen Scopes – die DB wird nie geleert).
// ─────────────────────────────────────────────────────────────────────────────
import { openDb, closeDb } from "../artifacts/db.mjs";
import { truncate } from "./util.mjs";

export function runHistory(rest) {
  const n = rest[0] === "--last" ? Number(rest[1] || 60) : 60;
  const db = openDb();
  const findings = db.prepare(
    "SELECT f.*, s.header FROM findings f JOIN scopes s ON s.id = f.scope_id ORDER BY f.id DESC LIMIT ?"
  ).all(n).reverse();
  if (!findings.length) {
    console.log("(noch keine Befunde in der DB – führe einen Scope-Lauf aus)");
    closeDb();
    return;
  }
  for (const f of findings) {
    console.log(`## ${f.created_at} · ${f.scope_id} · Verdict: ${f.verdict || "UNBEKANNT"}`);
    console.log(`- Scope-Header: ${truncate(f.header, 120)}`);
    console.log(`- Job: ${f.job_id} · Modus: ${f.mode || "?"} · Runde: ${f.round}`);
    if (f.befund) console.log(`- BEFUND: ${truncate(f.befund, 200)}`);
    console.log("");
  }
  closeDb();
}
