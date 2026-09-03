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
import { validateAnchorForRoot } from "../core/identity.mjs";
import { assertAnchorBinding } from "../artifacts/projects.mjs";

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
  const rootIndex = rest.indexOf("--root");
  const root = rootIndex >= 0 && rest[rootIndex + 1] ? rest[rootIndex + 1] : process.cwd();
  const headerArgs = rootIndex >= 0 ? rest.slice(0, rootIndex) : rest;
  const header = headerArgs.join(" ").trim();
  if (!header) fail("User-Input darf nicht leer sein.");
  const db = openDb();
  const anchor = validateAnchorForRoot(root);
  if (!anchor.ok) fail(`Projektanker fehlt/ist ungueltig: ${anchor.message} (falsify anchor init --root "${root}")`);
  let binding;
  try { binding = assertAnchorBinding(db, anchor); }
  catch (error) { fail(error.message); }
  const scope = createScope(db, header, { checkoutId: binding.checkout_id });
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
  // USER-AGENT- und Thinker-Vorschlaege auseinanderliegen — vor dem naechsten
  // Submit durch Scope-Praezisierung aufzuloesen).
  if (scope.last_divergence) console.log(`Offene Scope-Divergenz (Loop-Anker, Thinker vs. USER-AGENT-Intent — vor dem naechsten Submit praezisieren): ${scope.last_divergence}`);
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
function scopeTraceRationale(job, finding) {
  const verdict = job?.verdict || (job?.status?.startsWith("DONE ") ? job.status.slice(5) : null);
  const detail = finding?.befund || job?.error;
  const suffix = detail ? ` (${truncate(detail, 140)})` : "";
  if (job?.status?.startsWith("ERROR")) return `→ diese Runde endete mit einem Fehler; ein Verdict ist nicht belastbar${suffix}`;
  if (!finding) return "→ diese Runde hat keine eindeutige Begründung in den gespeicherten Daten";
  if (verdict === "RESEARCH") return `→ diese Runde blieb bei RESEARCH, weil weitere Daten oder Dateien benötigt werden${suffix}`;
  if (verdict === "PLAN") return `→ diese Runde blieb bei PLAN, weil die Umsetzung noch nicht freigegeben ist${suffix}`;
  if (verdict === "ASK") return `→ diese Runde blieb bei ASK, weil die Aufgabe noch mehrdeutig ist${suffix}`;
  if (verdict === "WRITE") return "→ diese Runde erreichte WRITE, weil die gespeicherte Prüfung die Freigabe trägt";
  return "→ diese Runde hat keine eindeutige Begründung in den gespeicherten Daten";
}

function scopeTraceClosing(scope, jobs, findings) {
  if (scope.status === "hardened" || scope.status === "done") {
    return `Loop-Ausgang: GESCHLOSSEN — der Scope ist gehärtet; Nächster Schritt: die freigegebene Änderung umsetzen.`;
  }
  if (scope.last_divergence) {
    return `Loop-Ausgang: OFFEN — die Scope-Divergenz hält den Loop offen; Nächster Schritt: den Divergenz-Anker präzisieren und erneut einreichen.`;
  }
  const lastFinding = findings.at(-1);
  const lastVerdict = lastFinding?.verdict || scope.phase?.toUpperCase();
  if (lastVerdict === "RESEARCH") {
    return "Loop-Ausgang: OFFEN — die letzte Runde verlangt weitere Daten; Nächster Schritt: die fehlenden Dateien oder Informationen beschaffen und erneut einreichen.";
  }
  if (lastVerdict === "PLAN") {
    const why = lastFinding?.befund ? ` Grund: ${truncate(lastFinding.befund, 140)}.` : " Der genaue Grund ist aus den gespeicherten Daten nicht eindeutig ableitbar.";
    return `Loop-Ausgang: OFFEN — die letzte Planung ist nicht freigegeben.${why} Nächster Schritt: Plan und Evidenz überarbeiten und erneut einreichen.`;
  }
  if (lastVerdict === "ASK") {
    return "Loop-Ausgang: OFFEN — die Aufgabe ist mehrdeutig; Nächster Schritt: Rückfrage klären und denselben Scope erneut einreichen.";
  }
  const finished = jobs.filter((j) => /^(DONE|ERROR)/.test(j.status)).length;
  return `Loop-Ausgang: OFFEN — die Ursache ist aus den gespeicherten Daten nicht eindeutig ableitbar; Nächster Schritt: den letzten Befund prüfen und den Scope erneut einreichen (${finished}/${jobs.length} Jobs abgeschlossen).`;
}

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
    console.log(`  ${scopeTraceRationale(j, f)}`);
  }

  console.log("");
  console.log(scopeTraceClosing(scope, jobs, findings));
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
