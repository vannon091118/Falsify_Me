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
  if (v === "PLAN") return "plan";
  // ASK (Aufgaben unklar) UND unbekannte/leere Verdicts (z. B. UNBEKANNT):
  // bewegen die Phase NICHT – nur echte Verdicts dürfen den Zustand ändern.
  return null;
}

/** Legt einen Scope an. header = User-Input 1:1 (HEADER des Prompts). */
export function createScope(db, header, { checkoutId = null } = {}) {
  const id = genId("scope");
  const now = nowIso();
  db.prepare(
    "INSERT INTO scopes(id, checkout_id, header, status, phase, created_at, updated_at) VALUES(?, ?, ?, 'active', 'plan', ?, ?)"
  ).run(id, checkoutId, header, now, now);
  return { id, header, checkoutId };
}

export function getScope(db, id) {
  return db.prepare("SELECT * FROM scopes WHERE id = ?").get(id);
}

/**
 * UI-127 (Ticket-Workflow, 2026-09-03): Scope-Zuordnung bestimmt AUSSCHLIESSLICH
 * FalsifyMe – der Agent liefert nur das Ticket (= HEADER, User-Input 1:1) und
 * niemals eine Scope-ID. Auflösung deterministisch über (checkout_id, header):
 *  - 0 aktive Scopes mit exakt diesem HEADER  → { kind: "new" }        (Auto-Anlage)
 *  - 1 aktiver Scope                          → { kind: "continue", scope }
 *  - >=2 aktive Scopes (identisches Ticket,   → { kind: "ambiguous", scopes }
 *    parallele offene Läufe)                    (fail-closed, nie raten)
 * Terminale Scopes (hardened/done) zählen NICHT: ein abgeschlossenes Ticket
 * startet bei identischer Einreichung bewusst frisch (kein Phantom-Reopen).
 * Byte-identischer Vergleich (SQL =) – dieselbe 1:1-Disziplin wie der
 * HEADER-Digest; keine Normalisierung, keine Fuzzy-Logik.
 */
export function resolveScopeForCheckout(db, checkoutId, header) {
  const rows = db.prepare(
    "SELECT * FROM scopes WHERE checkout_id = ? AND header = ? AND status = 'active' ORDER BY created_at DESC"
  ).all(checkoutId, header);
  if (!rows.length) return { kind: "new" };
  if (rows.length === 1) return { kind: "continue", scope: rows[0] };
  return { kind: "ambiguous", scopes: rows };
}

export function listScopes(db, { onlyActive = true } = {}) {
  // 'hardened' und 'done' gelten als abgeschlossen; onlyActive zeigt nur
  // laufende ('active') Scopes.
  const sql = onlyActive
    ? "SELECT * FROM scopes WHERE status = 'active' ORDER BY created_at DESC"
    : "SELECT * FROM scopes ORDER BY created_at DESC";
  return db.prepare(sql).all();
}

/**
 * Nach einem Review: Phase + letzter Gesamtbefund + Sub-Prompt aktualisieren.
 * Etage-2-Härtung (UI-081, 2026-09-01): Ein Scope gilt erst als "hardened",
 * wenn ein WRITE-Verdict mit 0 offenen Widersprüchen kommt (Challenge bestanden).
 * - PLAN/RESEARCH: open_conflicts +1, Status active (GAP offen)
 * - WRITE:         open_conflicts = 0, Status hardened, hardened_at gesetzt
 * - ASK:           Aufgabe mehrdeutig – kein Fortschritt, kein neuer Widerspruch;
 *                  Phase + Konfliktzähler bleiben, Status active (nicht gehärtet)
 * - sonst (UNBEKANNT): Zähler/Status unverändert
 *
 * UI-094 (dynamische Whitelist-Nachforderung): researchAdditions (string[]
 * oder null) werden bei RESEARCH persistiert (kommagetrennt), bei WRITE
 * geleert, sonst unverändert gelassen — nur echte Verdicts schreiben den
 * Zustand.
 */
export function updateScopeAfterReview(db, scopeId, verdict, befund, subPrompt, divergence, researchAdditions) {
  const v = String(verdict || "").toUpperCase();
  const cur = getScope(db, scopeId) || {};
  const phase = v === "ASK" ? (cur.phase || "plan") : (verdictToPhase(v) || cur.phase || "plan");
  // Whitelist-Nachforderung (UI-094): RESEARCH setzt, WRITE leert.
  if (v === "RESEARCH") {
    const add = Array.isArray(researchAdditions) && researchAdditions.length ? researchAdditions.join(",") : null;
    db.prepare("UPDATE scopes SET research_additions = ? WHERE id = ?").run(add, scopeId);
  } else if (v === "WRITE") {
    db.prepare("UPDATE scopes SET research_additions = NULL WHERE id = ?").run(scopeId);
  }
  // GAP-Erfassung (Divergenz-Loop): Der Gap ist offen, solange das
  // Falsifikations-Ergebnis die Ausgangsbehauptung des USER AGENT nicht freigibt (PLAN/RESEARCH/ASK).
  // Mit WRITE ist der Gap geschlossen (last_gap = null).
  const gap = v === "WRITE" ? null : (befund || null);
  // Loop-Anker (UI-107): last_divergence wird bei deklarierter Divergenz
  // gesetzt, bei SCOPE-KONFORM geleert (Anker geschlossen), bei fehlender
  // Sektion unveraendert gelassen (keine Aussage — kein Schluss).
  if (divergence !== undefined) {
    db.prepare("UPDATE scopes SET last_divergence = ? WHERE id = ?").run(divergence, scopeId);
  }
  let openConflicts = Number(cur.open_conflicts || 0);
  let status = cur.status || "active";
  let hardenedAt = cur.hardened_at || null;
  if (v === "WRITE") {
    openConflicts = 0;
    status = "hardened";
    hardenedAt = nowIso();
  } else if (v === "PLAN" || v === "RESEARCH") {
    openConflicts += 1;
    status = "active";
    hardenedAt = null;
  } else if (v === "ASK") {
    status = "active";
    hardenedAt = null;
  }
  db.prepare(
    "UPDATE scopes SET phase = ?, last_befund = ?, sub_prompt = ?, last_gap = ?, status = ?, open_conflicts = ?, hardened_at = ?, updated_at = ? WHERE id = ?"
  ).run(phase, befund ?? null, subPrompt ?? null, gap, status, openConflicts, hardenedAt, nowIso(), scopeId);
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

export function addFinding(db, { scopeId, jobId, round, wave = null, mode, befund, content, verdict }) {
  db.prepare(
    "INSERT INTO findings(scope_id, job_id, round, wave, mode, befund, content, verdict, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(scopeId, jobId, round, wave ?? null, mode ?? null, befund ?? null, content ?? null, verdict ?? null, nowIso());
}

export function getFindings(db, scopeId) {
  return db.prepare(
    "SELECT * FROM findings WHERE scope_id = ? ORDER BY round ASC, id ASC"
  ).all(scopeId);
}

/** Artefakt-Ansicht (für CLI/prompt) – nur Daten des EIGENEN Scopes. */
export function artifactView(scope, findings) {
  const lines = [`- Phase: ${scope.phase}`];
  if (scope.last_gap) lines.push(`- GAP (offen, Divergenz USER-AGENT-Urteil vs. Falsifikation): ${scope.last_gap}`);
  else if (scope.phase === "write") lines.push("- GAP: geschlossen (WRITE-Freigabe nach Falsifikations-Challenge)");
  if (scope.last_befund) lines.push(`- Letzter Befund: ${scope.last_befund}`);
  if (scope.sub_prompt) lines.push(`- Sub-Prompt (Fallback gegen Drift): ${scope.sub_prompt}`);
  // UI-094: offene Whitelist-Nachforderung sichtbar machen (was beim naechsten
  // Submit automatisch ergaenzt wird).
  if (scope.research_additions) {
    lines.push(`- Whitelist-Nachforderung (RESEARCH, beim nächsten Submit automatisch ergänzt): ${scope.research_additions}`);
  }
  // Loop-Anker (UI-107): eine offene SCOPE-DIVERGENZ ist der Punkt, an dem
  // USER-AGENT- und Thinker-Vorschläge auseinanderliegen — sie muss im Artefakt
  // sichtbar sein (der Submit muss sie durch Scope-Präzisierung auflösen).
  if (scope.last_divergence) {
    lines.push(`- Offene Scope-Divergenz (Loop-Anker, Thinker vs. USER-AGENT-Intent — vor dem nächsten Submit präzisieren): ${scope.last_divergence}`);
  }
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
