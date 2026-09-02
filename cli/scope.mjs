// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/scope.mjs – Scope-Befehle (new | show | list)
// -----------------------------------------------------------------------------
// Scope-Artefakt liegt in SQLite (artifacts/scopes.mjs). HEADER = User-Input
// 1:1 – PLAN ist immer die Init-Aktion eines Scopes.
// ─────────────────────────────────────────────────────────────────────────────
import { openDb, closeDb } from "../artifacts/db.mjs";
import { createScope, getScope, listScopes, getFindings } from "../artifacts/scopes.mjs";
import { listJobs } from "../artifacts/jobs.mjs";
import { fail, truncate } from "./util.mjs";

export function runScope(args) {
  const sub = args[0];
  if (sub === "new") return scopeNew(args.slice(1));
  if (sub === "show") return scopeShow(args.slice(1));
  if (sub === "list") return scopeList(args.slice(1));
  if (sub === "trace") return scopeTrace(args.slice(1));
  fail("Verwendung: falsify scope new|show|list|trace …");
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
  // Loop-Anker (UI-107): offene Scope-Divergenz sichtbar (der Punkt, an dem
  // Coder- und Thinker-Vorschlaege auseinanderliegen — vor dem naechsten
  // Submit durch Scope-Praezisierung aufzuloesen).
  if (scope.last_divergence) console.log(`Offene Scope-Divergenz (Loop-Anker, Thinker vs. Coder-Intent — vor dem naechsten Submit praezisieren): ${scope.last_divergence}`);
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

// ── scope trace <id> ────────────────────────────────────────────────────────
// Der GAP-Loop auf einen Blick: je Runde die Einreichung (Welle, Intent), der
// finale Verdict, die Findings und das Loop-Ergebnis. Rein abgeleitet aus der
// Queue (Regel 3: eine Wahrheit) – read-only, keine zweite Persistenz.
function scopeTrace(rest) {
  const id = rest[0];
  if (!id) fail("Verwendung: falsify scope trace <scope-id>");
  const db = openDb();
  const scope = getScope(db, id);
  if (!scope) fail(`Scope nicht gefunden: ${id}`);
  const jobs = listJobs(db).filter((j) => j.scope_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const findings = getFindings(db, id);
  const byJob = new Map(findings.map((f) => [f.job_id, f]));

  console.log(`LOOP-TRACE ${id}`);
  console.log(`HEADER: ${truncate(scope.header, 90)}`);
  console.log(`Status: ${scope.status} · Phase: ${scope.phase} · Jobs: ${jobs.length} · Findings: ${findings.length} · Offene Konflikte: ${scope.open_conflicts}`);
  if (scope.last_divergence) console.log(`Offene Divergenz (Loop-Anker): ${truncate(scope.last_divergence, 100)}`);
  console.log("");

  if (!jobs.length) {
    console.log("(keine Jobs – der Loop hat noch nicht begonnen)");
    closeDb();
    return;
  }

  const finished = jobs.filter((j) => /^(DONE|ERROR)/.test(j.status)).length;
  for (const j of jobs) {
    const dur = j.started_at && j.done_at
      ? ` · ${Math.max(0, Math.round((new Date(j.done_at) - new Date(j.started_at)) / 1000))}s`
      : "";
    const f = byJob.get(j.id);
    console.log(`[${j.created_at}] ${j.id} · Welle ${j.wave || "?"} · ${j.status}${j.verdict ? ` (${j.verdict})` : ""}${dur}`);
    if (j.agent_intent) console.log(`  Intent: ${truncate(j.agent_intent, 120)}`);
    if (f?.befund) console.log(`  Befund: ${truncate(f.befund, 160)}`);
    if (j.error) console.log(`  Fehler: ${truncate(j.error, 160)}`);
  }

  // Loop-Ausgang: was der Verdict-Verlauf über den Gap sagt.
  console.log("");
  if (scope.status === "hardened" || scope.status === "done") {
    console.log(`Loop-Ausgang: GESCHLOSSEN — ${scope.hardened_at ? `gehaertet ${scope.hardened_at}` : "abgeschlossen"} (WRITE nach bestandener Falsifikation).`);
  } else if (scope.last_divergence) {
    console.log("Loop-Ausgang: OFFEN — Divergenz-Anker gesetzt; naechster Submit muss --agent-intent tragen und den Scope praezisieren.");
  } else {
    console.log(`Loop-Ausgang: OFFEN — Phase ${scope.phase}, ${finished}/${jobs.length} Jobs abgeschlossen; naechste Iteration einreichen (falsify run --submit).`);
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
