// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/history.mjs – Verlauf & Auswirkung (UI-127)
// -----------------------------------------------------------------------------
// Beantwortet „Was ist passiert und wie hat FalsifyMe sich ausgewirkt?“:
//  - `falsify history [--last n]`            neueste Scopes mit Wirkungs-Zeile
//  - `falsify history --scope <id>`          voller Verlauf EINES Auftrags
// Reiner Lese-Zugriff auf die eigene DB (findings/scopes); nie geloescht.
// ─────────────────────────────────────────────────────────────────────────────
import { openDb, closeDb } from "../artifacts/db.mjs";
import { truncate } from "./util.mjs";

function verdictCounts(findings) {
  const counts = {};
  for (const f of findings) {
    const v = String(f.verdict || "UNBEKANNT");
    counts[v] = (counts[v] || 0) + 1;
  }
  return counts;
}

function summaryLine(counts, scope) {
  const write = counts.WRITE || 0;
  const blocked = (counts.PLAN || 0) + (counts.RESEARCH || 0);
  const other = Object.entries(counts)
    .filter(([v]) => v !== "WRITE" && v !== "PLAN" && v !== "RESEARCH")
    .map(([v, n]) => `${v}×${n}`)
    .join(" · ");
  const state = scope.status === "hardened"
    ? `HART GEMACHT (WRITE mit 0 offenen Konflikten, ${scope.hardened_at || "?"})`
    : scope.status === "done" ? `ABGESCHLOSSEN (${scope.done_at || "?"})` : "OFFEN";
  return `${state}  ·  ${write} Freigabe(n) (WRITE)  ·  ${blocked} Blockade(n) (PLAN/RESEARCH)${other ? `  ·  ${other}` : ""}`;
}

export function runHistory(rest) {
  const db = openDb();
  const scopeOnlyIndex = rest.indexOf("--scope");
  const lastIndex = rest.indexOf("--last");
  const scopeId = scopeOnlyIndex >= 0 ? rest[scopeOnlyIndex + 1] : null;
  const limit = lastIndex >= 0 ? Number(rest[lastIndex + 1] || 8) : 8;

  if (scopeId) {
    const scope = db.prepare("SELECT * FROM scopes WHERE id = ?").get(scopeId);
    if (!scope) {
      console.error(`FEHLER: Scope nicht gefunden: ${scopeId} (falsify scope list)`);
      closeDb();
      process.exit(2);
    }
    const findings = db.prepare("SELECT * FROM findings WHERE scope_id = ? ORDER BY round ASC, id ASC").all(scopeId);
    const counts = verdictCounts(findings);
    console.log(`## Auftrag ${scope.id}  ·  ${scope.status}  ·  Phase ${scope.phase || "plan"}`);
    console.log(`Ticket (HEADER 1:1): ${scope.header}`);
    console.log(`Angelegt: ${scope.created_at}  ·  zuletzt aktualisiert: ${scope.updated_at || "-"}`);
    if (!findings.length) console.log("Wirkung: noch keine Befunde – erste Iteration ausstehend.");
    else console.log(`Wirkung: ${summaryLine(counts, scope)}`);
    if (scope.status === "hardened") console.log(`Gehaertet: ${scope.hardened_at}`);
    if (scope.status === "done") console.log(`Abgeschlossen: ${scope.done_at}`);
    if (scope.open_conflicts > 0) console.log(`Offene Konflikte: ${scope.open_conflicts}`);
    if (scope.research_additions) console.log(`Whitelist-Nachforderung offen (RESEARCH, wird beim naechsten Submit automatisch ergaenzt): ${scope.research_additions}`);
    if (scope.last_divergence) console.log(`Offene Scope-Divergenz (Loop-Anker): ${scope.last_divergence}`);
    if (scope.sub_prompt) console.log(`Sub-Prompt (Fallback gegen Drift): ${truncate(scope.sub_prompt, 160)}`);
    console.log("");
    if (!findings.length) {
      console.log("(noch keine Befunde – Job eingereicht, Verdict steht aus oder erste Iteration folgt.)");
    }
    for (const f of findings) {
      console.log(`### Runde ${f.round} · ${f.created_at}  ·  ${f.verdict || "UNBEKANNT"}${f.wave ? `  ·  Welle ${f.wave}` : ""}${f.mode ? `  ·  Modus ${f.mode}` : ""}${f.job_id ? `  ·  Job ${f.job_id}` : ""}`);
      if (f.befund) console.log(`BEFUND: ${truncate(f.befund, 500)}`);
      else if (f.content) console.log(`Antwort: ${truncate(String(f.content).replace(/\s+/g, " ").trim(), 500)}`);
      console.log("");
    }
    console.log("Naechster Schritt: falsify resume --header \"...\" (gleiches Ticket) oder falsify submit mit --header.");
    closeDb();
    return;
  }

  // Liste: neueste Auftraege mit Wirkung.
  const scopes = db.prepare(
    "SELECT * FROM scopes ORDER BY created_at DESC LIMIT ?"
  ).all(limit);
  if (!scopes.length) {
    console.log("(noch keine Auftraege in der DB – erster Start: falsify start \"<Ticket>\")");
    closeDb();
    return;
  }
  console.log(`FalsifyMe-Verlauf: ${scopes.length} neueste Auftraege (was passiert ist und wie FalsifyMe sich ausgewirkt hat):`);
  console.log("");
  for (const s of scopes) {
    const findings = db.prepare("SELECT * FROM findings WHERE scope_id = ? ORDER BY round ASC, id ASC").all(s.id);
    const counts = verdictCounts(findings);
    console.log(`## ${s.created_at} · ${s.id}  ·  ${s.status === "hardened" ? "HART" : s.status === "done" ? "DONE" : "OFFEN"}`);
    console.log(`Ticket: ${truncate(s.header, 140)}`);
    console.log(`Wirkung: ${summaryLine(counts, s)}`);
    const last = findings[findings.length - 1];
    if (last && last.befund) console.log(`Letzter Befund (R${last.round}, ${last.verdict || "?"}): ${truncate(last.befund, 220)}`);
    if (s.status === "active" && s.research_additions) console.log(`Naechste Iteration braucht: ${s.research_additions}`);
    if (s.status === "active" && s.last_divergence) console.log(`Offene Divergenz: ${truncate(s.last_divergence, 140)}`);
    console.log("");
  }
  console.log("Detail eines Auftrags: falsify history --scope <id>  ·  Fortsetzen: falsify resume [--header \"<Ticket>\"]");
  closeDb();
}
