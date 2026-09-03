// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/start.mjs – `falsify start "<Ticket>"` (UI-127)
// -----------------------------------------------------------------------------
// UX-Einstieg des Ticket-Workflows: Der Agent liefert NUR das Ticket (= User-
// Input 1:1). FalsifyMe bestimmt die Scope-ID automatisch (neu angelegt oder
// Fortsetzung des offenen Tickets) – der Agent verwaltet keine IDs, parst kein
// SCOPE_ID und reicht nichts zurück. `start` erzeugt KEINEN Job; es bindet das
// Ticket und zeigt den nächsten Schritt (submit mit demselben --header).
// ─────────────────────────────────────────────────────────────────────────────
import path from "node:path";
import { openDb, closeDb } from "../artifacts/db.mjs";
import { createScope, resolveScopeForCheckout } from "../artifacts/scopes.mjs";
import { validateAnchorForRoot } from "../core/identity.mjs";
import { assertAnchorBinding } from "../artifacts/projects.mjs";
import { fail } from "./util.mjs";

function rootAndArgs(rest) {
  const rootIndex = rest.indexOf("--root");
  const root = rootIndex >= 0 && rest[rootIndex + 1] ? rest[rootIndex + 1] : process.cwd();
  const args = rootIndex >= 0 ? rest.filter((_, i) => i !== rootIndex && i !== rootIndex + 1) : rest;
  return { root: path.resolve(root), args };
}

function bindCheckout(db, root) {
  const anchor = validateAnchorForRoot(root);
  if (!anchor.ok) fail(`Projektanker fehlt/ungueltig: ${anchor.message} (falsify anchor init --root "${root}")`);
  let binding;
  try { binding = assertAnchorBinding(db, anchor); }
  catch (error) { fail(error.message); }
  return binding.checkout_id;
}

export function runStart(rest) {
  const { root, args } = rootAndArgs(rest);
  const header = args.join(" ").trim();
  if (!header) fail('Verwendung: falsify start "<Ticket = User-Input 1:1>" [--root <dir>]');
  const db = openDb();
  const checkoutId = bindCheckout(db, root);
  const resolved = resolveScopeForCheckout(db, checkoutId, header);
  let scope;
  if (resolved.kind === "ambiguous") {
    console.error("FEHLER: Mehrere offene Scopes mit identischem Ticket – FalsifyMe kann nicht entscheiden. Scopes:");
    for (const s of resolved.scopes) {
      console.error(`  · ${s.id}  (angelegt ${s.created_at}, Phase ${s.phase}, ${Number(s.open_conflicts || 0)} offene Konflikte)`);
    }
    console.error("Aufloesung: falsify scope show <id> (Scope abschliessen) oder das Ticket praezisieren.");
    closeDb();
    process.exit(2);
  }
  if (resolved.kind === "new") {
    scope = createScope(db, header, { checkoutId });
    console.log(`Ticket erkannt (HEADER 1:1): ${scope.header}`);
    console.log(`Scope automatisch angelegt: ${scope.id}  (ID von FalsifyMe bestimmt – du verwaltest keine IDs.)`);
  } else {
    scope = resolved.scope;
    console.log(`Ticket erkannt (HEADER 1:1): ${scope.header}`);
    console.log(`Offenes Ticket gefunden → Fortsetzung: ${scope.id}  (Zuordnung bestimmt FalsifyMe.)`);
    if (scope.phase) console.log(`Phase: ${scope.phase}  ·  Status: ${scope.status}  ·  offene Konflikte: ${Number(scope.open_conflicts || 0)}`);
    if (scope.research_additions) console.log(`Whitelist-Nachforderung offen (RESEARCH): ${scope.research_additions}`);
    if (scope.last_divergence) console.log(`Offene Scope-Divergenz (Loop-Anker): ${scope.last_divergence}`);
    if (scope.last_befund) console.log(`Letzter Befund: ${String(scope.last_befund).slice(0, 200)}`);
  }
  console.log("");
  console.log("Naechster Schritt – Plan-Datei schreiben und mit DEMSELBEN Ticket einreichen:");
  console.log(`  falsify submit --header "${scope.header}" --plan-file plan.txt --root "${root}" --files "datei1,datei2"`);
  console.log("Die Scope-ID bestimmst du nie – FalsifyMe ordnet die Einreichung automatisch zu.");
  closeDb();
}
