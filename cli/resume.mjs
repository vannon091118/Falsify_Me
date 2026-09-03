// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/resume.mjs – `falsify resume` (UI-127)
// -----------------------------------------------------------------------------
// „/falsi resume": den letzten offenen Auftrag wieder aufnehmen – OHNE Scope-ID.
// - Ohne --header: zeigt die offenen Scopes des Checkouts (neueste zuerst) mit
//   Zustand und dem fertigen Fortsetzungs-Befehl (submit mit --header).
// - Mit --header: zeigt Zustand des Tickets (Fortsetzung) oder meldet ehrlich,
//   dass kein offener Scope existiert (dann: falsify start).
// Es wird NIE ein Job angelegt und nie ein Verdict behauptet – reiner Kontext.
// ─────────────────────────────────────────────────────────────────────────────
import path from "node:path";
import { openDb, closeDb } from "../artifacts/db.mjs";
import { resolveScopeForCheckout } from "../artifacts/scopes.mjs";
import { validateAnchorForRoot } from "../core/identity.mjs";
import { assertAnchorBinding } from "../artifacts/projects.mjs";
import { fail } from "./util.mjs";

const MAX_LISTED = 6;

function parseArgs(rest) {
  const flags = { root: process.cwd(), header: null, all: false };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--root") { flags.root = rest[++i] ?? flags.root; }
    else if (rest[i] === "--header") { flags.header = rest[++i] ?? null; }
    else if (rest[i] === "--all") { flags.all = true; }
    else if (rest[i] === "-h" || rest[i] === "--help") { console.log("Verwendung: falsify resume [--header \"<Ticket>\"] [--all] [--root <dir>]"); process.exit(0); }
    else { fail(`Unbekannte Option: ${rest[i]} (falsify resume [--header \"<Ticket>\"] [--all])`); }
  }
  flags.root = path.resolve(flags.root);
  return flags;
}

function bindCheckout(db, root) {
  const anchor = validateAnchorForRoot(root);
  if (!anchor.ok) fail(`Projektanker fehlt/ungueltig: ${anchor.message} (falsify anchor init --root "${root}")`);
  let binding;
  try { binding = assertAnchorBinding(db, anchor); }
  catch (error) { fail(error.message); }
  return binding.checkout_id;
}

function lastVerdicts(db, scopeId) {
  // Anzahl Verdicts je Art + Zeitpunkt des letzten Findings (aus findings).
  const rows = db.prepare(
    "SELECT verdict, COUNT(*) AS n FROM findings WHERE scope_id = ? AND verdict IS NOT NULL GROUP BY verdict"
  ).all(scopeId);
  const counts = {};
  for (const r of rows) counts[String(r.verdict)] = Number(r.n);
  const last = db.prepare("SELECT MAX(created_at) AS at FROM findings WHERE scope_id = ?").get(scopeId);
  return { counts, lastAt: last?.at || null };
}

function verdictSummary(counts) {
  const parts = Object.entries(counts).map(([v, n]) => `${v}×${n}`);
  return parts.length ? parts.join(" · ") : "noch kein Verdict";
}

function printScopeState(db, scope) {
  const { counts, lastAt } = lastVerdicts(db, scope.id);
  console.log(`Scope: ${scope.id}  ·  ${scope.status}${scope.status === "hardened" ? ` (gehaertet ${scope.hardened_at || "?"})` : ""}${scope.status === "done" ? ` (done ${scope.done_at || "?"})` : ""}`);
  console.log(`Ticket (HEADER 1:1): ${scope.header}`);
  console.log(`Phase: ${scope.phase || "plan"}  ·  offene Konflikte: ${Number(scope.open_conflicts || 0)}  ·  letzte Aktivitaet: ${scope.updated_at || lastAt || scope.created_at}`);
  console.log(`Verdicts: ${verdictSummary(counts)}`);
  if (scope.research_additions) console.log(`Whitelist-Nachforderung offen (RESEARCH): ${scope.research_additions}`);
  if (scope.last_divergence) console.log(`Offene Scope-Divergenz (Loop-Anker): ${scope.last_divergence}`);
  if (scope.last_befund) console.log(`Letzter Befund: ${String(scope.last_befund).slice(0, 240)}`);
}

function resubmitCommand(scope, root) {
  return `  falsify submit --header "${scope.header}" --plan-file plan.txt --root "${root}" --files "datei1,datei2"`;
}

export function runResume(rest) {
  const flags = parseArgs(rest);
  const db = openDb();
  const checkoutId = bindCheckout(db, flags.root);

  if (flags.header !== null) {
    const header = String(flags.header).trim();
    if (!header) fail("--header darf nicht leer sein (Ticket = User-Input 1:1).");
    const resolved = resolveScopeForCheckout(db, checkoutId, header);
    if (resolved.kind === "new") {
      console.log(`Kein offener Scope mit diesem Ticket. Neu starten:`);
      console.log(`  falsify start "${header}" --root "${flags.root}"`);
      closeDb();
      return;
    }
    if (resolved.kind === "ambiguous") {
      console.error("FEHLER: Mehrere offene Scopes mit identischem Ticket:");
      for (const s of resolved.scopes) console.error(`  · ${s.id}`);
      console.error("Aufloesung: falsify scope show <id> (Scope abschliessen) oder Ticket praezisieren.");
      closeDb();
      process.exit(2);
    }
    const scope = resolved.scope;
    printScopeState(db, scope);
    if (scope.status === "active") {
      console.log("");
      console.log("Fortsetzen (gleiches Ticket, Scope bestimmt FalsifyMe):");
      console.log(resubmitCommand(scope, flags.root));
    }
    closeDb();
    return;
  }

  // Ohne --header: offene Scopes des Checkouts anzeigen (Resume = letzten
  // offenen Auftrag wieder aufnehmen). Terminale (hardened/done) nur mit --all.
  const statusFilter = flags.all ? "" : "AND status = 'active'";
  const scopes = db.prepare(
    `SELECT * FROM scopes WHERE checkout_id = ? ${statusFilter} ORDER BY updated_at DESC LIMIT ?`
  ).all(checkoutId, MAX_LISTED);
  if (!scopes.length) {
    console.log(flags.all
      ? `Keine Scopes fuer diesen Checkout. Neuer Auftrag: falsify start "<Ticket>" --root "${flags.root}"`
      : `Kein offener Scope fuer diesen Checkout. Neuer Auftrag: falsify start "<Ticket>" --root "${flags.root}"  (alle inkl. abgeschlossener: falsify resume --all)`);
    closeDb();
    return;
  }
  console.log(`Offene Auftraege dieses Projekts (${scopes.length} angezeigt, neueste zuerst; Scope-Zuordnung bestimmt FalsifyMe):`);
  console.log("");
  for (const scope of scopes) {
    console.log(`## ${scope.status === "active" ? "OFFEN" : scope.status.toUpperCase()} · ${scope.updated_at || scope.created_at}`);
    printScopeState(db, scope);
    if (scope.status === "active") {
      console.log("Fortsetzen:");
      console.log(resubmitCommand(scope, flags.root));
    }
    console.log("");
  }
  console.log("Einzelnen Auftrag anzeigen: falsify history --scope <id>  ·  Ticket direkt fortsetzen: falsify resume --header \"<Ticket>\"");
  closeDb();
}
