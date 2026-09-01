// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/scope.mjs – Scope-Befehle (new | show | list)
// -----------------------------------------------------------------------------
// Scope-Artefakt liegt in SQLite (artifacts/scopes.mjs). HEADER = User-Input
// 1:1 – PLAN ist immer die Init-Aktion eines Scopes.
// ─────────────────────────────────────────────────────────────────────────────
import { openDb, closeDb } from "../artifacts/db.mjs";
import { createScope, getScope, listScopes, getFindings } from "../artifacts/scopes.mjs";
import { fail, truncate } from "./util.mjs";

export function runScope(args) {
  const sub = args[0];
  if (sub === "new") return scopeNew(args.slice(1));
  if (sub === "show") return scopeShow(args.slice(1));
  if (sub === "list") return scopeList(args.slice(1));
  fail("Verwendung: falsify scope new|show|list …");
}

// ── scope new "<user-input>" ────────────────────────────────────────────────
function scopeNew(rest) {
  if (!rest.length) fail('Verwendung: falsify scope new "<user-input>" – der Text wird 1:1 zum HEADER');
  const header = rest.join(" ").trim();
  if (!header) fail("User-Input darf nicht leer sein.");
  const db = openDb();
  const scope = createScope(db, header);
  console.log(`SCOPE_ID=${scope.id}`);
  console.log(`HEADER (1:1): ${scope.header}`);
  console.log("Phase: plan  ·  PLAN ist immer die Init-Aktion eines Scopes.");
  closeDb();
}

// ── scope show <id> [--full] ────────────────────────────────────────────────
function scopeShow(rest) {
  const id = rest[0];
  if (!id) fail("Verwendung: falsify scope show <scope-id>");
  const full = rest.includes("--full");
  const db = openDb();
  const scope = getScope(db, id);
  if (!scope) fail(`Scope nicht gefunden: ${id}`);
  console.log(`Scope-ID: ${scope.id}`);
  console.log(`Status: ${scope.status}`);
  console.log(`Phase: ${scope.phase}`);
  console.log(`HEADER (1:1): ${scope.header}`);
  if (scope.last_befund) console.log(`Letzter Befund: ${scope.last_befund}`);
  if (scope.sub_prompt) console.log(`Sub-Prompt (Modell-Update, Fallback gegen Drift):\n${scope.sub_prompt}`);
  // UI-094: offene Whitelist-Nachforderung sichtbar (was beim naechsten Submit automatisch ergaenzt wird).
  if (scope.research_additions) console.log(`Whitelist-Nachforderung (RESEARCH, beim naechsten Submit automatisch ergaenzt): ${scope.research_additions}`);
  console.log(`Angelegt: ${scope.created_at}`);
  if (scope.done_at) console.log(`Abgeschlossen: ${scope.done_at}`);
  const findings = getFindings(db, scope.id);
  console.log(`\nBefunde (${findings.length}):`);
  if (!findings.length) {
    console.log("(noch keine – dies ist der Scope-Start)");
  }
  for (const f of findings) {
    console.log(`\n[Runde ${f.round} · Modus ${f.mode || "?"} · Verdict ${f.verdict || "?"} · ${f.created_at}]`);
    if (f.befund) console.log(`BEFUND: ${f.befund}`);
    if (full && f.content) console.log(f.content);
  }
  closeDb();
}

// ── scope list [--all] ──────────────────────────────────────────────────────
function scopeList(rest) {
  const onlyActive = !rest.includes("--all");
  const db = openDb();
  const scopes = listScopes(db, { onlyActive });
  if (!scopes.length) {
    console.log(onlyActive ? "(keine aktiven Scopes)" : "(keine Scopes)");
    closeDb();
    return;
  }
  for (const s of scopes) {
    console.log(`${s.id}  [${s.status} · phase ${s.phase}]  ${truncate(s.header, 70)}  (${s.updated_at})`);
  }
  closeDb();
}
