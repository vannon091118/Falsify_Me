// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · artifacts/scopes.mjs – Scope + Artefakt + Findings
// -----------------------------------------------------------------------------
// 1 Scope = 1 Aufgabe. Das Artefakt (in SQLite) enthält: HEADER (User-Input
// 1:1), Phase, letzten vollständigen zusammenfassenden Befund und ALLE Befunde
// (findings) – aktualisiert von FalsifyMe nach jedem Review.
// ─────────────────────────────────────────────────────────────────────────────
import { nowIso, genId } from "./db.mjs";

export function verdictToPhase(verdict) {
  const v = String(verdict || "").toUpperCase();
  if (v === "WRITE") return "write";
  if (v === "RESEARCH") return "research";
  return "plan";
}

/** Legt einen Scope an. header = User-Input 1:1 (HEADER des Prompts). */
export function createScope(db, header) {
  const id = genId("scope");
  const now = nowIso();
  db.prepare(
    "INSERT INTO scopes(id, header, status, phase, created_at, updated_at) VALUES(?, ?, 'active', 'plan', ?, ?)"
  ).run(id, header, now, now);
  return { id, header };
}

export function getScope(db, id) {
  return db.prepare("SELECT * FROM scopes WHERE id = ?").get(id);
}

export function listScopes(db, { onlyActive = true } = {}) {
  const sql = onlyActive
    ? "SELECT * FROM scopes WHERE status = 'active' ORDER BY created_at DESC"
    : "SELECT * FROM scopes ORDER BY created_at DESC";
  return db.prepare(sql).all();
}

/** Nach einem Review: Phase + letzter Gesamtbefund + Sub-Prompt aktualisieren (FalsifyMe). */
export function updateScopeAfterReview(db, scopeId, verdict, befund, subPrompt) {
  const phase = verdictToPhase(verdict);
  // GAP-Erfassung (Divergenz-Loop): Der Gap ist offen, solange das
  // Falsifikations-Ergebnis die Coder-Annahme nicht freigibt (PLAN/RESEARCH).
  // Mit WRITE ist der Gap geschlossen (last_gap = null).
  const v = String(verdict || "").toUpperCase();
  const gap = v === "WRITE" ? null : (befund || null);
  db.prepare("UPDATE scopes SET phase = ?, last_befund = ?, sub_prompt = ?, last_gap = ?, updated_at = ? WHERE id = ?")
    .run(phase, befund ?? null, subPrompt ?? null, gap, nowIso(), scopeId);
}

export function markScopeDone(db, scopeId) {
  db.prepare("UPDATE scopes SET status = 'done', done_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), scopeId);
}

// ── Findings (Befunde/Ergebnisse je Scope) ───────────────────────────────────
export function nextRound(db, scopeId) {
  const r = db.prepare("SELECT COALESCE(MAX(round), 0) + 1 AS n FROM findings WHERE scope_id = ?").get(scopeId);
  return Number(r.n);
}

export function addFinding(db, { scopeId, jobId, round, mode, befund, content, verdict }) {
  db.prepare(
    "INSERT INTO findings(scope_id, job_id, round, mode, befund, content, verdict, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(scopeId, jobId, round, mode ?? null, befund ?? null, content ?? null, verdict ?? null, nowIso());
}

export function getFindings(db, scopeId) {
  return db.prepare(
    "SELECT * FROM findings WHERE scope_id = ? ORDER BY round ASC, id ASC"
  ).all(scopeId);
}

/** Artefakt-Ansicht (für CLI/prompt) – nur Daten des EIGENEN Scopes. */
export function artifactView(scope, findings) {
  const lines = [`- Phase: ${scope.phase}`];
  if (scope.last_gap) lines.push(`- GAP (offen, Divergenz Coder-Urteil vs. Falsifikation): ${scope.last_gap}`);
  else if (scope.phase === "write") lines.push("- GAP: geschlossen (WRITE-Freigabe nach Falsifikations-Challenge)");
  if (scope.last_befund) lines.push(`- Letzter Befund: ${scope.last_befund}`);
  if (scope.sub_prompt) lines.push(`- Sub-Prompt (Fallback gegen Drift): ${scope.sub_prompt}`);
  if (findings?.length) {
    lines.push(`- Alle Befunde (${findings.length}):`);
    for (const f of findings) {
      const b = f.befund || String(f.content || "").slice(0, 400) || "(kein Befund)";
      lines.push(`  · [Runde ${f.round} · Modus ${f.mode || "?"} · ${f.verdict || "?"}] ${b}`);
    }
  } else {
    lines.push("- Alle Befunde: (noch keine – dies ist die erste Iteration)");
  }
  return lines.join("\n");
}
