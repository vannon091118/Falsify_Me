#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/run.mjs – Haupt-Einstieg (submit / run / job-Modus)
// -----------------------------------------------------------------------------
// Scope-Protokoll:
//  · CONTEXT IST IMMER NUR 1 SCOPE – jeder Job startet das Modell NEU.
//  · 1 JOB = PLAN-LOOP → WRITE-LOOP → REVIEW-LOOP bis Scope erfüllt; das LETZTE
//    Review bestimmt das Output-Verdict.
//  · 3 Modi (kontextabhängig): VERDICT: PLAN | RESEARCH | WRITE.
//    RESEARCH wird getriggert, wenn FalsifyMe weitere Daten braucht.
//  · Modus-Switch READ ONLY → WRITE entscheidet FalsifyMe am Ende (WRITE = Freigabe).
//  · HEADER = User-Input 1:1, bleibt in allen Scope-Prompts.
//  · 1 Artefakt pro Scope (SQLite): User-Input, letzter vollständiger
//    zusammenfassender Befund, ALLE Befunde – von FalsifyMe aktualisiert.
//  · NACH REVIEW endet der Modellkontext (frisches Modell je Job); die DB wird
//    NICHT geleert – Zugriff nur auf die Ergebnisse des eigenen Scopes.
//
// Persistenz: SQLite (WAL) in FALSIFY_HOME (Default ~/.Falsify_Private) –
// EINZIGE Quelle. FalsifyMe schreibt NIE ins Projekt (read-only bleibt).
//
// Exit-Code: 0 = VERDICT WRITE (Freigabe) · 1 = PLAN/RESEARCH (Loop)
//            2 = Konfig-Fehler · 3 = API-Fehler/kein Verdict
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, closeDb, falsifyHome } from "../artifacts/db.mjs";
import { createJob, getJob, jobFilesList, jobDone, claimJob, registerWorker, heartbeatWorker, reapStaleJobs, jobRuntimeConfig, classifyFailure } from "../artifacts/jobs.mjs";
import { enforceQueueConsistency } from "../artifacts/invariants.mjs";
import { getScope, updateScopeAfterReview, addFinding, getFindings, nextRound } from "../artifacts/scopes.mjs";
import { loadApiKey, loadApiKeyForNames, keyEnvFile, keyNames } from "../core/keys.mjs";
import { loadConfig, snapshotConfig, configFromSnapshot, isLocalApiBase } from "../core/config.mjs";
import { enforceRateLimit } from "../core/ratelimit.mjs";
import { SYSTEM_DE_FULL, SYSTEM_EN_FULL, buildUserContent } from "../core/prompt.mjs";
import { parseVerdict, parseBefund, parseSubPrompt, findingSeverity, parseScopeDivergence, enforceResearchContract, extractResearchAdditions, exitCodeOf } from "../core/verdict.mjs";
import { runProbeExecution } from "../core/twin.mjs";
import { parseProbeSet, validateProbeSet, splitRequirement, renderRequirementList, probeEvidenceOk, computeVerdict } from "../core/probes.mjs";
import { runAgent } from "../core/agent.mjs";
import { checkFeasibility } from "../core/feasibility.mjs";
import { resolveProjectContext, validateProjectFiles } from "../core/project-context.mjs";
import { requireProjectIdentity, assertScopeCheckout } from "../artifacts/projects.mjs";
import { snapshotRoot } from "../core/changes.mjs";
import { buildHandoff, serializeHandoff } from "../core/handoff.mjs";
import { recordLoopEvent, getLoopState } from "../artifacts/loops.mjs";
import { markWriteAuthorized } from "../artifacts/loopflow.mjs";

// TASK-005: header_digest bindet den exakten Scope-HEADER-Bytes an den Job.
// Ein geänderter/fehlender HEADER vor THINKER-Start oder Re-Review-Creation
// wird abgelehnt (fail-closed).
function headerDigest(header) {
  return header == null ? null : crypto.createHash("sha256").update(String(header), "utf8").digest("hex");
}

// ── Umsetzbarkeits-Puffer (Intent → Execution, UI-078, revidiert) ───────────
// Deterministischer read-only Pre-Check VOR dem API-Call. Er erteilt KEIN
// Verdict und schliesst KEINEN Job: blocks/findings gehen als KONTEXT an den
// Falsifikations-Agent (Thinker), der die Ausgangsbehauptungen des USER AGENT selbst gegen die
// echten Dateien falsifiziert. RESEARCH bleibt damit ein Falsifikations-Modul
// (Datenbeschaffung), nie ein Urteil des Pre-Checks. Verdict-Hoheit liegt
// ausschliesslich beim Thinker (Modellpfad).

// Provider-neutrale Konfiguration (Env → FALSIFY_HOME/config.json → Defaults).
// Delayed loading is essential for --job-id: a persisted job snapshot must
// remain runnable even when current settings drift or become invalid.
const HELP_DEFAULTS = Object.freeze({
  model: "nvidia/nemotron-3-ultra-550b-a55b",
  lang: "de",
  maxRpm: 40,
  keyEnvNames: ["NVIDIA_API_KEY", "OPENAI_API_KEY", "FALSIFY_API_KEY"],
});
let currentConfig = null;
function loadCurrentConfig() {
  if (!currentConfig) currentConfig = loadConfig();
  return currentConfig;
}
function configForHelp() {
  try { return loadCurrentConfig(); }
  catch { return HELP_DEFAULTS; }
}

// ── UI-Events (Phase 2): FM-EVT:-Marker für die Terminal-UI ──────────────────
// Nur mit FALSIFY_UI=1 ausgeben (setzt der Worker-Fenster-Starter). Ohne das
// Flag bleibt die CLI-Ausgabe unverändert (Agent-/Script-Kompatibilität).
// Jedes Event trägt sein Fenster (window = FALSIFY_WINDOW), damit parallele
// Worker-Fenster die Slots 1..3 im selben Terminal-PID korrekt füllen können.
const UI_EVTS = process.env.FALSIFY_UI === "1";
const UI_WINDOW = Number(process.env.FALSIFY_WINDOW) || 1;
const uiEvt = (o) => {
  if (!UI_EVTS) return;
  console.log("FM-EVT: " + JSON.stringify({ ...o, window: UI_WINDOW }));
};
const PHASE_LABEL = { plan: "PLAN", research: "RESEARCH", write: "WRITE" };

// ── ANSI ─────────────────────────────────────────────────────────────────────
const C = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
const bold = (s) => C(1, s);
const dim = (s) => C(2, s);
const red = (s) => C(31, s);
const green = (s) => C(32, s);
const yellow = (s) => C(33, s);
const cyan = (s) => C(36, s);

// ── CLI-Argumente ────────────────────────────────────────────────────────────
function usage() {
  const cfg = configForHelp();
  console.log(`FalsifyMe 2.0 – Falsifizierungs-Agent (OpenAI-kompatibel · ${cfg.model})

Verwendung:
  node cli/run.mjs "Plan-Text..." [Optionen]
  node cli/run.mjs --plan-file plan.txt --diff-file diff.patch --root .
  node cli/run.mjs --submit --scope <scope-id> --plan-file plan.txt --root <dir> --files "a.js,b.js"

Optionen:
  --plan-file <pfad>   Iterations-Text (Plan/Recherche/Umsetzung) aus Datei lesen
  --diff-file <pfad>   Diff der geplanten/umgesetzten Änderung aus Datei lesen
  --agent-intent <txt> Agent-eigenes Verständnis der Aufgabe (optional, Etage 2 –
                       Divergenz zum HEADER wird eigener Prüfpunkt)
  --affected <liste>   Betroffene Daten, kommagetrennt (optional)
  --root <dir>         Arbeitsverzeichnis für den Agent-Datenzugriff (Default: cwd)
  --files <liste>      Zugriffs-Whitelist (kommagetrennt, relativ zu --root) – PFLICHT bei --submit und fremdem --root
  --scope <id>         Scope-ID (HEADER = User-Input 1:1 aus dem Scope-Artefakt)
  --model <id>         Modell-ID (Default: ${cfg.model})
  --lang de|en         Sprache der Kritik (Default: ${cfg.lang})
  --max-rpm <n>        Rate-Limit (Default: ${cfg.maxRpm})
  --no-wait            Rate-Limit-Wartezeit überspringen
  --submit             Job für die Worker-Fenster einreichen (kein API-Call) –
                       Agents muessen danach MIT falsify wait <id> blockierend
                       auf das Verdict warten (falsify submit blockt standardmaessig)
  --job-id <id>        Job aus der SQLite-Warteschlange laden (vom Worker genutzt)
  -h, --help           Diese Hilfe

Provider/Ziel (Env oder FALSIFY_HOME/config.json):
  FALSIFY_API_BASE     z. B. https://integrate.api.nvidia.com/v1 (NVIDIA NIM),
                       https://api.openai.com/v1 (OpenAI), http://localhost:11434/v1 (Ollama)
  FALSIFY_MODEL        Modell-ID (Default: ${cfg.model})
  FALSIFY_API_KEY_ENV  Key-Namen, kommagetrennt (Default: ${cfg.keyEnvNames.join(",")})

Exit-Codes: 0=WRITE (Freigabe)  1=PLAN/RESEARCH (nicht freigegeben, Loop)
            2=Konfig-Fehler  3=API-Fehler/kein Verdict  5=ASK (Aufgabe mehrdeutig,
            Rückfrage an den User nötig – keine Freigabe)`);
}

async function runMain() {

// ── Crash-Guard (Rig-Review 2026-09-01, Befund 13c): ein interner Fehler
// ausserhalb der try/catch-Pfade darf NICHT als Exit 1 (= PLAN-Loop) mit
// Stack lesbar sein — er wird ehrlich als ERROR (Exit 3) geschlossen und
// der aktive Job in der Queue beendet (kein Fake-Verdict, kein RUNNING-
// Waisen bis zum naechsten Reap).
let activeJobId = null;

let planText = "";
let planFile = null;
let diffFile = null;
let model = null;
let lang = null;
let maxRpm = null;
let noWait = false;
let submitMode = false;
let jobId = null;
let rootArg = null;
let filesArg = null;
let scopeArg = null;
let agentIntent = null;
let affectedArg = null;
// Für neue Jobs wird dieser Wert beim Submit atomar eingefroren; bei der
// Ausführung ersetzt ein gespeicherter Job-Snapshot die Prozess-Konfiguration.
let runtimeConfig = null;

const positional = [];
const args = process.argv.slice(2);
const configOverrides = () => ({
  ...(model !== null ? { model } : {}),
  ...(lang !== null ? { lang } : {}),
  ...(maxRpm !== null ? { maxRpm } : {}),
});
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => { const v = args[++i]; if (v === undefined) { console.error(`FEHLER: ${a} braucht einen Wert`); process.exit(2); } return v; };
  switch (a) {
    case "-h": case "--help": usage(); process.exit(0);
    case "--plan-file": planFile = next(); break;
    case "--diff-file": diffFile = next(); break;
    case "--agent-intent": agentIntent = next(); break;
    case "--affected": affectedArg = next(); break;
    case "--model": model = next(); break;
    case "--lang": lang = next(); break;
    case "--max-rpm": maxRpm = Number(next()); break;
    case "--no-wait": noWait = true; break;
    case "--submit": submitMode = true; break;
    case "--job-id": jobId = next(); break;
    case "--root": rootArg = next(); break;
    case "--files": filesArg = next(); break;
    case "--scope": scopeArg = next(); break;
    default:
      if (a.startsWith("-")) { console.error(`Unbekannte Option: ${a}`); usage(); process.exit(2); }
      positional.push(a);
  }
}

/**
 * P0 (letztes harte Gate): mtime+Größe-Snapshot der Whitelist-Dateien. Wird
 * vor und nach der Twin-Exekution verglichen – eine während der Prüfung
 * veränderte Datei invalidate die Freigabe (Gate: Prüf-Basis unverändert).
 * Read-only; fehlende/unlesbare Dateien tragen keinen Eintrag (Konsistenz:
 * fehlt vorher UND nachher = unverändert).
 */
function whitelistSnapshot(root, whitelist) {
  const snap = new Map();
  for (const f of whitelist || []) {
    try {
      const abs = path.isAbsolute(f) ? f : path.join(root, f);
      const st = fs.statSync(abs);
      if (st.isFile()) snap.set(String(f), { mtimeMs: st.mtimeMs, size: st.size });
    } catch { /* fehlt/unlesbar – kein Eintrag */ }
  }
  return snap;
}

function readFileOrExit(p, what) {
  try { return fs.readFileSync(p, "utf8"); }
  catch (e) { console.error(red(`FEHLER: ${what} nicht lesbar (${p}): ${e.message}`)); process.exit(2); }
}

if (positional.length > 0) planText = positional.join(" ");
else if (planFile) planText = readFileOrExit(planFile, "Plan-Datei");
else if (!process.stdin.isTTY) planText = fs.readFileSync(0, "utf8");

planText = planText.trim();
let diffText = "";
if (diffFile) diffText = readFileOrExit(diffFile, "Diff-Datei").trim();

const db = openDb();
let projectIdentity = null;
let checkoutId = null;
let anchorRecords = [];

// ── Submit-Modus: Job-ROW in SQLite anlegen (kein API-Call) ─────────────────
if (submitMode) {
  if (!planText) {
    console.error(red("FEHLER: Kein Plan übergeben. Nutze ein Argument, --plan-file oder stdin."));
    usage();
    closeDb();
    process.exit(2);
  }
  const context = resolveProjectContext(rootArg, filesArg);
  const root = context.root;
  if (context.requiresFiles) {
    console.error(red(`FEHLER: Fremdprojekt ohne --files: Zugriff ist leer. --files ist für fremde --root-Projekte erforderlich.`));
    closeDb();
    process.exit(2);
  }
  let scope = null;
  let identity;
  try {
    identity = requireProjectIdentity(db, root);
  } catch (error) {
    console.error(red(`FEHLER: Projektidentität nicht verifiziert – ${error.message}`));
    closeDb();
    process.exit(2);
  }
  projectIdentity = identity;
  checkoutId = identity.checkout.checkout_id;
  anchorRecords = identity.anchor.records;
  if (scopeArg) {
    scope = getScope(db, scopeArg);
    if (!scope) {
      console.error(red(`FEHLER: Scope nicht gefunden: ${scopeArg} (falsify scope new "<user-input>")`));
      closeDb();
      process.exit(2);
    }
  }
  if (scope) {
    try { assertScopeCheckout(scope, checkoutId); }
    catch (error) {
      console.error(red(`FEHLER: Scope-/Projektidentität widerspricht sich – ${error.message}`));
      closeDb();
      process.exit(2);
    }
  }
  let filesList = context.files;
  // ── UI-094: Whitelist-Nachforderung (RESEARCH) automatisch mergen ───────
  // VOR dem --files-Pflicht-Check: Dateien, die der Thinker in der letzten
  // RESEARCH-Runde zur Falsifikation nachgefordert hat (scopes.
  // research_additions), kommen automatisch in die Whitelist. Nur Dateien,
  // die unter <root> real existieren — Fantasie-Pfade duerfen die
  // Einreichung nicht vergiften (UI-094-VERIFY: kein unbeschraenkter
  // Zugriff). Dem Agenten wird EXPLIZIT gemeldet, was ergaenzt wurde.
  const additions = scope && scope.research_additions
    ? scope.research_additions.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const addedFiles = [];
  let skippedAdditions = 0;
  for (const a of additions) {
    if (filesList.includes(a)) continue;
    let exists = false;
    try { exists = fs.existsSync(path.join(root, a)); } catch { exists = false; }
    if (exists) { filesList.push(a); addedFiles.push(a); }
    else skippedAdditions += 1;
  }
  if (addedFiles.length) {
    console.log(dim(`Whitelist automatisch ergänzt (RESEARCH-Nachforderung aus Scope ${scope.id}): ${addedFiles.join(", ")}`));
  }
  if (skippedAdditions > 0) {
    console.log(dim(`${skippedAdditions} nachgeforderte Datei(en) existieren nicht unter ${root} und wurden übersprungen.`));
  }
  // Loop-Anker (UI-107, Divisionspflicht): Der Thinker kann nur dann
  // SCOPE-KONFORM/SCOPE-DIVERGENZ deklarieren, wenn er den USER-AGENT-Intent
  // kennt — ohne --agent-intent fehlt die eine Seite der Division und ein
  // offener Anker kann nie aufgelöst werden. Deshalb: ehrliche Warnung
  // (kein stiller Ausfall), solange ein Anker offen UND kein Intent
  // mitgegeben wurde.
  if (scope && scope.last_divergence && !agentIntent) {
    console.warn(yellow(`⚠ Offener Scope-Divergenz-Anker ohne --agent-intent: der Thinker kann die Divergenz nicht gegen den USER-AGENT-Vorschlag dividieren („SCOPE-KONFORM“ wird unerreichbar). Intent der nächsten Iteration mitgeben: --agent-intent "…"\n  Offene Divergenz: ${String(scope.last_divergence).slice(0, 120)}`));
  }
  if (!filesList.length) {
    console.error(red('FEHLER: --files ist Pflicht beim Einreichen (kommagetrennte Dateiliste relativ zu --root), z. B.: --files "app.js,lib/auth.js"'));
    closeDb();
    process.exit(2);
  }
  // Self-Review-Regel (core/selfreview.mjs): kein blinder Bereich bei
  // Selbstprüfung – Kern-Komponenten automatisch ergänzen (nur existierende,
  // nur wenn <root> ein eigenes Checkout ist).
  filesList = validateProjectFiles(root, filesList);
  const selfReview = { added: context.added ?? [] };
  if (selfReview.added.length) {
    console.log(dim(`Selbstprüfung erkannt: ${selfReview.added.length} Kern-Komponenten automatisch im Prüf-Scope`));
  }
  const submittedConfig = snapshotConfig(loadConfig(configOverrides()));
  // TASK-005: HEADER-Digest + Basis-Snapshot vor der Einreichung einfrieren.
  const digest = headerDigest(scope ? scope.header : planText);
  const beforeSnapshot = snapshotRoot(root, filesList);
  const id = createJob(db, {
    checkoutId,
    scopeId: scope ? scope.id : null,
    payload: planText,
    diffText: diffText || null,
    agentIntent: agentIntent || null,
    affected: affectedArg || null,
    root,
    files: filesList.join(","),
    runtimeConfig: submittedConfig,
    maxAttempts: submittedConfig.maxJobAttempts,
    mode: scope ? scope.phase : "plan",   // PLAN ist immer Init – danach lenkt das Verdict
  });
  // Loop-Korrelation auf dem Job persistieren (TASK-010): header_digest +
  // change_digest des Basis-Zustands + Loop-Startzustand QUEUED.
  db.prepare("UPDATE jobs SET header_digest = ?, change_digest = ?, loop_state = 'QUEUED' WHERE id = ?")
    .run(digest, beforeSnapshot.digest, id);
  recordLoopEvent(db, { jobId: id, scopeId: scope ? scope.id : null, changeDigest: beforeSnapshot.digest, eventType: "submitted", toState: "QUEUED", payload: { header_digest: digest, files: filesList } });
  console.log(`JOB_ID=${id}`);
  if (scope) console.log(`Scope: ${scope.id}  (Phase: ${scope.phase})`);
  console.log(`Plan : ${planText.length} Zeichen${diffText ? ` · Diff: ${diffText.length} Zeichen` : ""}`);
  console.log(`Root : ${root}  (Agent-Datenzugriff, sandboxed)`);
  console.log(`Dateien (Whitelist): ${filesList.join(", ")}`);
  console.log(`Status: SQLite (falsify status ${id})   ·   Protokoll: falsify log ${id}`);
  console.log(`Ein Worker-Fenster (max. 3, FALSIFY_HOME=${falsifyHome()}) verarbeitet den Job live.`);

  // ── Regel-3-Enforcement (submit): erst Recovery (Waisen schliessen), dann
  //     Konsistenz erzwingen — eine kaputte Basis darf keine neuen Jobs
  //     annehmen („Regel 3 wird ERZWUNGEN" gilt jetzt auch im Betriebsloop).
  try {
    reapStaleJobs(db, 3);
    enforceQueueConsistency(db);
  } catch (e) {
    console.error(red(`FEHLER: Zustandsmodell inkonsistent – ` +
      `Erst falsify doctor ausführen (${String(e.message).split("\n")[0].slice(0, 200)})`));
    closeDb();
    process.exit(2);
  }
  closeDb();
  process.exit(0);
}

// ── Arbeitsverzeichnis + Zugriffs-Whitelist ─────────────────────────────────
let ROOT = resolveProjectContext(rootArg, filesArg).root;
// Self-Review-Regel (UI-097): bei erkannter Selbstprüfung werden die
// Prüf-Kernkomponenten automatisch ergänzt – an JEDER Stelle, die von hier
// aus startet (Direkt-Run, --job-id, --submit nutzt den gleichen Pfad vor
// createJob; rig-Review 2026-09-01: der Direkt-Run übersprang die Ergänzung).
let FILE_WHITELIST = resolveProjectContext(rootArg, filesArg).files;
if (rootArg != null && !resolveProjectContext(rootArg, filesArg).selfReview && !FILE_WHITELIST.length) {
  console.error(red("FEHLER: Fremdprojekt ohne --files: Zugriff ist leer. --files ist für fremde --root-Projekte erforderlich."));
  closeDb();
  process.exit(2);
}
FILE_WHITELIST = validateProjectFiles(ROOT, FILE_WHITELIST);
let job = null;
let scope = null;

if (jobId) {
  job = getJob(db, jobId);
  if (!job) {
    console.error(red(`FEHLER: Job nicht gefunden in der DB: ${jobId}`));
    closeDb();
    process.exit(2);
  }
  if (job.status === "QUEUED") {
    // Der --job-id-Pfad (Worker-Kind UND Direkt-Run) führt einen noch nicht
    // übernommenen Job über den EINZIGEN Claim-Übergangs-Owner (claimJob in
    // artifacts/jobs.mjs): atomar status=RUNNING + kausale Claim-Transition
    // (RE_REVIEW_QUEUED → RE_REVIEW_RUNNING), damit kein status=RUNNING mit
    // loop_state=RE_REVIEW_QUEUED persistiert wird. Bereits geclaimte Jobs
    // (status=RUNNING, Worker-Pfad) werden hier NUR ausgeführt — dieser Zweig
    // besitzt keine eigene Claim-Transition.
    db.exec("BEGIN IMMEDIATE");
    try {
      const claimed = claimJob(db, jobId, null, job.scope_id ?? null);
      if (!claimed.ok) {
        throw new Error(claimed.reason);
      }
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* egal */ }
      console.error(red(`FEHLER: Job ${jobId} konnte nicht gestartet werden: ${e.message}`));
      closeDb();
      process.exit(3);
    }
    job = getJob(db, jobId);
  }
  // Direkt-Run-Liveness (Regel-3-Rig, Asymmetrie-Fix): Jobs ohne Fenster
  // (falsify run --job-id, window_idx NULL) registrieren sich selbst als
  // Fenster-0-Worker mit Heartbeat. Ein lebender Direkt-Lauf ist damit KEIN
  // Orphan (checkQueueConsistency) und ein gecrashter wird von reapStaleJobs
  // aufgeräumt — gleiche Liveness-Semantik wie Worker-Fenster 1..3. Der
  // Prozess-Tod ent-registriert effektiv (isProcessAlive/pid).
  if (!job.window_idx) {
    try {
      registerWorker(db, 0, process.pid);
      heartbeatWorker(db, 0);
      const hb = setInterval(() => { try { heartbeatWorker(db, 0); } catch { /* egal */ } }, 5000);
      hb.unref();
    } catch { /* egal: ohne Liveness läuft der Direkt-Run trotzdem (nur ohne Orphan-Schutz) */ }
  }
  if (job.scope_id) {
    scope = getScope(db, job.scope_id);
    if (!scope) {
      console.error(red(`FEHLER: Scope nicht gefunden: ${job.scope_id}`));
      closeDb();
      process.exit(2);
    }
  }
  planText = job.payload || planText;
  diffText = job.diff_text || diffText;
  ROOT = path.resolve(job.root || ROOT);
  // TASK-005 (Executionsseite): der HEADER der gebundenen Scope-Datei muss
  // dem beim Submit eingefrorenen header_digest entsprechen — ein geänderter
  // HEADER macht den Job fail-closed ohne Modell-Call.
  {
    const scopeForDigest = job.scope_id ? getScope(db, job.scope_id) : null;
    const currentDigest = headerDigest(scopeForDigest ? scopeForDigest.header : (job.payload || planText));
    if (job.header_digest && currentDigest !== job.header_digest) {
      jobDone(db, jobId, null, "HEADER Digest stimmt nicht mehr (Scope-HEADER wurde nach der Einreichung geändert)");
      console.error(red("FEHLER: HEADER-Digest weicht ab – Job wird ohne Modell-Call abgelehnt (fail-closed)."));
      closeDb();
      process.exit(2);
    }
  }
  // Self-Review-Regel auf dem JOB-Root (nicht dem lokalen --root): deckt
  // Bestands-Jobs ab, die mit unvollständiger Whitelist erstellt wurden
  // (idempotent; die Initialisierung oben lief gegen den lokalen root).
  const jobContext = resolveProjectContext(ROOT, jobFilesList(job).join(","));
  if (jobContext.requiresFiles) {
    console.error(red("FEHLER: Fremdprojekt ohne --files: Zugriff ist leer. --files ist für fremde --root-Projekte erforderlich."));
    closeDb();
    process.exit(2);
  }
  FILE_WHITELIST = validateProjectFiles(ROOT, jobContext.files);
  try {
    // New jobs are snapshot-bound. Legacy rows without a snapshot retain an
    // explicit current-config fallback, but are never silently synthesized.
    runtimeConfig = job.runtime_config
      ? configFromSnapshot(jobRuntimeConfig(job))
      : loadConfig(configOverrides());
    model = runtimeConfig.model;
    lang = runtimeConfig.lang;
    maxRpm = runtimeConfig.maxRpm;
  } catch (error) {
    jobDone(db, jobId, null, `Ungültiger Laufzeit-Snapshot: ${error.message}`);
    console.error(red(`FEHLER: Ungültiger Laufzeit-Snapshot – ${error.message}`));
    closeDb();
    process.exit(3);
  }
  if (job.checkout_id) {
    try {
      projectIdentity = requireProjectIdentity(db, ROOT);
      checkoutId = projectIdentity.checkout.checkout_id;
      anchorRecords = projectIdentity.anchor.records;
      if (scope) assertScopeCheckout(scope, checkoutId);
      if (job.root && projectIdentity.checkout.bound_root !== projectIdentity.anchor.root) {
        throw new Error("Job-Root weicht vom gebundenen Checkout-Root ab.");
      }
    } catch (error) {
      jobDone(db, jobId, null, `Projektidentität nicht verifiziert: ${error.message}`);
      console.error(red(`FEHLER: Projektidentität nicht verifiziert – ${error.message}`));
      closeDb();
      process.exit(2);
    }
  }
} else {
  if (!planText) {
    console.error(red("FEHLER: Kein Plan übergeben. Nutze ein Argument, --plan-file oder stdin."));
    usage();
    closeDb();
    process.exit(2);
  }
  if (scopeArg) {
    scope = getScope(db, scopeArg);
    if (!scope) {
      console.error(red(`FEHLER: Scope nicht gefunden: ${scopeArg} (falsify scope new "<user-input>")`));
      closeDb();
      process.exit(2);
    }
  }
  const directIdentity = (() => {
    try { return requireProjectIdentity(db, ROOT); }
    catch (error) {
      console.error(red(`FEHLER: Projektidentität nicht verifiziert – ${error.message}`));
      closeDb();
      process.exit(2);
    }
  })();
  projectIdentity = directIdentity;
  checkoutId = directIdentity.checkout.checkout_id;
  anchorRecords = directIdentity.anchor.records;
  if (scope) {
    try { assertScopeCheckout(scope, checkoutId); }
    catch (error) {
      console.error(red(`FEHLER: Scope-/Projektidentität widerspricht sich – ${error.message}`));
      closeDb();
      process.exit(2);
    }
  }
  runtimeConfig = loadConfig(configOverrides());
  jobId = createJob(db, {
    checkoutId,
    scopeId: scope ? scope.id : null,
    payload: planText,
    diffText: diffText || null,
    agentIntent: agentIntent || null,
    affected: affectedArg || null,
    root: ROOT,
    files: FILE_WHITELIST.join(","),
    mode: scope ? scope.phase : "plan",
    status: "RUNNING",
    runtimeConfig: snapshotConfig(runtimeConfig),
    maxAttempts: runtimeConfig.maxJobAttempts,
  });
  // Loop-Korrelation auch für Direkt-Runs (TASK-005/010, gleiche Pflicht).
  db.prepare("UPDATE jobs SET header_digest = ?, change_digest = ?, loop_state = 'QUEUED' WHERE id = ?")
    .run(headerDigest(scope ? scope.header : planText), snapshotRoot(ROOT, FILE_WHITELIST).digest, jobId);
  recordLoopEvent(db, { jobId, scopeId: scope ? scope.id : null, eventType: "submitted", toState: "QUEUED", payload: { direct_run: true } });
  job = getJob(db, jobId);
}
activeJobId = jobId;
// Ab hier ist der Job-Snapshot die einzige Runtime-Konfiguration. Der Alias
// verhindert, dass spätere Refactorings versehentlich wieder CFG verwenden.
const executionConfig = runtimeConfig;
// Fix (Produktionsbeweis 2026-09-03): maxRpm wurde nur im --job-id-Zweig
// gesetzt — Direkt-Runs liessen es auf null, wodurch der Twin-Rate-Limit-
// Call (60000/null = Infinity) next_free=Infinity persistierte und jeder
// nachfolgende Lauf ewig wartete. Ein gemeinsamer Zuweisungspunkt deckt
// beide Pfade ab.
maxRpm = executionConfig.maxRpm;

// ── UI-Start-Events (Phase 2): Job bekannt -> Slot belegen (nur FALSIFY_UI=1) ──
const phaseLabel = PHASE_LABEL[scope?.phase || job?.mode || "plan"] || "PLAN";
uiEvt({ t: "job", id: jobId, scope: scope?.id ?? null });
uiEvt({ t: "state", s: "LOADING" });
uiEvt({ t: "phase", phase: phaseLabel });
uiEvt({ t: "files", n: FILE_WHITELIST.length, list: FILE_WHITELIST });

// ── API-Key aus FALSIFY_HOME/.env oder Prozessumgebung ───────────────────────
const apiKey = loadApiKeyForNames(executionConfig.keyEnvNames);
if (!apiKey && !isLocalApiBase(executionConfig.apiBase)) {
  console.error(red(`FEHLER: Kein API-Key gefunden (gesucht: ${executionConfig.keyEnvNames.join(", ")}). Trage einen Key in ${keyEnvFile()} ein oder setze die passende Umgebungsvariable.`));
  console.error(dim(`Provider/Ziel: ${executionConfig.provider} (${executionConfig.apiBase}) – anpassbar via FALSIFY_API_BASE/FALSIFY_MODEL oder ${executionConfig.configFile}.`));
  uiEvt({ t: "state", s: "ERROR" });
  // Job sauber schliessen, damit er nicht als RUNNING hängen bleibt.
  if (jobId) jobDone(db, jobId, null, "API-Key fehlt");
  closeDb();
  process.exit(2);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  enforceRateLimit(maxRpm, noWait);

  // ── Umsetzbarkeits-Puffer: read-only Validierung, KEIN Verdict ───────────
  const feasibility = checkFeasibility({
    header: scope ? scope.header : null,
    planText,
    root: ROOT,
    whitelist: FILE_WHITELIST,
    hasDiff: Boolean(diffText),
    diffText,
  });
  const feasibilityNotes = [];
  if (feasibility.blocks.length || feasibility.findings.length) {
    for (const b of feasibility.blocks) {
      feasibilityNotes.push(b);
      uiEvt({ t: "finding", severity: "warning" });
      console.warn(yellow(`⚠ Validierung: ${b}`));
    }
    for (const f of feasibility.findings) {
      feasibilityNotes.push(f.text);
      console.warn(yellow(`  Hinweis: ${f.text}`));
    }
  }

  console.log("");
  console.log(cyan(bold("◤ FalsifyMe ◢")));
  console.log(dim(`  Modell : ${model}`));
  console.log(dim(`  Provider: ${executionConfig.provider} (${executionConfig.apiBase})`));
  console.log(dim(`  Root   : ${ROOT}  (Agent-Datenzugriff)`));
  if (FILE_WHITELIST.length === 0) {
    // Direkt-Run ohne --files (auch --job-id-Lauf mit leerer Whitelist auf
    // Fremd-Root): Zugriffsrahmen ist der ganze Root — KEIN Whitelist-
    // Vertrag (Regel 4 gilt nur, wenn es eine Whitelist gibt). Self-Review-
    // Checkouts sind hier automatisch ausgeschlossen: die Kern-Ergänzung
    // macht die Liste nie leer (Evil-Twin-Rig: kosmetische Lücke geschlossen).
    console.log(dim("  Zugriff: KEIN --files → ganzer Root ist Zugriffsrahmen (kein Whitelist-Vertrag)"));
  }
  if (scope) {
    console.log(dim(`  Scope  : ${scope.id}`));
    console.log(dim(`  Phase  : ${scope.phase}  (${scope.phase === "plan" ? "PLAN-Prüfung – Init" : scope.phase === "research" ? "RESEARCH – Datenprüfung" : "WRITE-Prüfung – Review der Umsetzung"})`));
  }
  console.log(dim(`  Thinking: ${executionConfig.reasoningEffort} · max_tokens ${executionConfig.maxTokens} · temp ${executionConfig.temperature}`));
  console.log(dim(`  Iteration: ${planText.length} Zeichen${diffText ? ` · Diff: ${diffText.length} Zeichen` : ""}`));
  console.log(dim("  Streaming: Reasoning · Kritik · ⟳ = Agent liest Dateien"));
  console.log("");

  const systemPrompt = lang === "en" ? SYSTEM_EN_FULL : SYSTEM_DE_FULL;
  // UI-Traceability (E2E-Befund): die UI muss SEHEN, wer denkt und mit welchem
  // Modell - sonst ist die Gegenpruefung von der Erstpruefung nicht unterscheidbar.
  uiEvt({ t: "model", thinker: model, twin: executionConfig.twinModel, who: "thinker" });
  const findings = scope ? getFindings(db, scope.id) : [];
  const userContent = buildUserContent({
    header: scope ? scope.header : null,
    phase: scope ? scope.phase : null,
    lastBefund: scope ? scope.last_befund : null,
    findings,
    subPrompt: scope ? scope.sub_prompt : null,
    planText,
    diffText,
    root: ROOT,
    whitelist: FILE_WHITELIST,
    feasibilityNotes,
    agentIntent: job?.agent_intent || null,
    affected: (job?.affected || "").split(",").map((s) => s.trim()).filter(Boolean),
    lastDivergence: scope ? scope.last_divergence : null,
    anchorRecords,
    // P0 (Regel 1): Coverage-Anker des Probe-Sets – die Thinker-Antwort darf
    // requirement_ref nur auf diese Original-H_i-IDs beziehen (keine Paraphrase).
    requirementList: renderRequirementList(splitRequirement(scope ? scope.header : planText)),
  });

  const t0 = Date.now();
  let result;
  uiEvt({ t: "state", s: "THINKING" });
  // NVIDIA-Overload-Kompensation (2026-09-02): Überlastung/Timeout beendet den
  // Job NICHT sofort — das Modell arbeitet weiter, sobald das 40-RPM-Budget
  // wieder Platz hat (enforceRateLimit blockiert bis zum freien Slot).
  // Begrenzt durch maxJobAttempts/jobRetryBackoffMs; nicht-retrybare Fehler
  // (z. B. HTTP 401/403, Parse-Fehler) gehen direkt in den Fehlerpfad.
  const maxAttempts = Math.max(1, Number(executionConfig.maxJobAttempts) || 1);
  const backoffMs = Math.max(0, Number(executionConfig.jobRetryBackoffMs) || 0);
  const retryableOverload = (msg) => /überlastung|Überlastung|429|rate.?limit|HTTP 5\d\d|timeout|Netzwerk/i.test(msg);
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        result = await runAgent({
      systemPrompt, userContent, model, apiKey,
      apiBase: executionConfig.apiBase,
      maxTokens: executionConfig.maxTokens,
      reasoningEffort: executionConfig.reasoningEffort,
      maxToolRounds: executionConfig.maxToolRounds,
      temperature: executionConfig.temperature,
      timeoutMs: executionConfig.timeoutMs,
      root: ROOT,
      whitelist: FILE_WHITELIST,
      onTool: (info) => {
        uiEvt({ t: "state", s: "TOOL_ACTIVITY" });
        uiEvt({ t: "activity", tool: info.tool, file: info.file, label: `${info.tool}(${info.file ?? ""})` });
      },
      });
      break;
      } catch (e) {
        if (!retryableOverload(String(e.message || "")) || attempt >= maxAttempts) throw e;
        const waitMs = Math.max(1000, backoffMs * attempt);
        console.warn(yellow(`⚠ API-Überlastung (Versuch ${attempt}/${maxAttempts}) – warte ${Math.round(waitMs / 1000)}s auf freien 40-RPM-Slot, dann arbeitet das Modell weiter …`));
        uiEvt({ t: "state", s: "TIMEOUT" });
        enforceRateLimit(maxRpm, false);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  } catch (e) {
    // Timeout-Eskalation (2026-09-01): Ueberlastete Provider enden ehrlich —
    // kein Fake-Verdict, Job als ERROR mit Ursache, Exit 3, Hinweis zum
    // erneuten Einreichen. Der TIMEOUT-State im Dock zeigt die Ueberlastung.
    const msg = String(e.message || "");
    const overloaded = /überlastung|Überlastung/i.test(msg);
    const timedOut = /timeout/i.test(msg);
    uiEvt({ t: "state", s: timedOut || overloaded ? "TIMEOUT" : "ERROR" });
    if (overloaded) {
      console.error(red(`\n✖ API-Überlastung: ${msg}`));
      console.error(yellow("  Keine Freigabe, kein Fake-Verdict — Job als ERROR beendet. Bitte später erneut einreichen oder die Whitelist/den Umfang verkleinern."));
    } else {
      console.error(red(`\n✖ ${msg}`));
    }
    jobDone(db, jobId, null, msg, { failureKind: classifyFailure(e) });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(dim(`── ${secs}s – Fehler ──`));
    console.log(dim(`Job: ${jobId}  ·  Status: ERROR (falsify status ${jobId})`));
    closeDb();
    process.exitCode = 3;
    return;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const befund = parseBefund(result.content);
  const subPrompt = parseSubPrompt(result.content);

  // ── P0-Cutover (Probe-basierte WRITE-Entscheidung, Revision 5) ───────────
  // parseVerdict-WRITE ist nur KANDIDAT – die Freigabe entscheidet
  // AUSSCHLIESSLICH das deterministische Gate über das ausgeführte Probe-Set
  // (core/probes.mjs computeVerdict). Genau EIN WRITE-Pfad: ein Thinker-WRITE
  // ohne gültiges Probe-Set wird fail-closed PLAN (kein Override, keine
  // „nicht prüfbar“-Ausnahme). PLAN/RESEARCH/ASK laufen unverändert durch.
  const parsedVerdict = parseVerdict(result.content);
  let verdict = parsedVerdict;
  // Schnitt 1: Probe-Set parsen + NUR formal/strukturell validieren (die
  // alte Prosa-Evidenz-Suche enforceWriteChallenge ist ersetzt). Coverage-
  // Härte (jede H_i ≥ 1 Probe), Original-H_i-IDs ohne Paraphrase, Target in
  // Root+Whitelist, Anti-Vakuum-Minima als Müllfilter – keine Semantik.
  let probeParse = null;
  let probeValidation = null;
  if (verdict === "WRITE") {
    probeParse = parseProbeSet(result.content);
    probeValidation = probeParse.ok
      ? validateProbeSet(probeParse.probes, {
          requirementSource: scope ? scope.header : planText,
          root: ROOT,
          whitelist: FILE_WHITELIST,
        })
      : { ok: false, reasons: [], probes: [] };
    if (!probeParse.ok) {
      console.warn(yellow(`\n⚠ WRITE-Kandidat ohne lesbares Probe-Set (${probeParse.error}) – das Gate entscheidet fail-closed.`));
    } else if (!probeValidation.ok) {
      console.warn(yellow(`\n⚠ Probe-Set formal ungültig (${probeValidation.reasons.length} Grund/Gründe, u. a.: ${String(probeValidation.reasons[0]).slice(0, 120)}) – das Gate entscheidet fail-closed.`));
    }
  }
  // RESEARCH-Vertrag (2026-09-01): RESEARCH nur mit KONKRET benanntem
  // fehlenden Datum im BEFUND — pauschales „brauche mehr Infos“ wird
  // fail-closed auf PLAN heruntergestuft (kein Datensammel-Lauf ins Leere).
  if (verdict === "RESEARCH" && !enforceResearchContract(result.content, "RESEARCH")) {
    console.warn(yellow("\n⚠ RESEARCH ohne konkret benanntes fehlendes Datum (BEFUND nennt keine fehlende Datei/kein fehlendes Datum) – als PLAN behandelt. Der Loop braucht eine präzise Anfrage, keinen Datensammel-Lauf."));
    verdict = "PLAN";
  }
  // ── UI-094: Whitelist-Nachforderung (RESEARCH) ──────────────────────────
  // Der Thinker benennt konkret fehlende Dateien fuer die weitere
  // Falsifikation. Diese werden persistiert und beim naechsten Submit
  // automatisch in die Whitelist gemerged (kein manuelles Nachziehen von
  // befundrelevanten Modulen mehr — E2E-Befund 1). Nur bei echtem RESEARCH.
  let researchAdditions = null;
  if (verdict === "RESEARCH") {
    researchAdditions = extractResearchAdditions(result.content, { root: ROOT });
    if (researchAdditions.length) {
      console.log(dim(`Whitelist-Nachforderung (RESEARCH): ${researchAdditions.join(", ")} — wird beim nächsten Submit automatisch ergänzt.`));
    }
  }
  // Regel 5 (UI-103): ein formales Gate macht keine kaputte Basis grün —
  // strukturelle Blocker gehen als hartes Gate in computeVerdict ein
  // (WRITE-Kandidat + Blocker ⇒ PLAN, deterministisch im Gate).
  const structural = feasibility.blocks || [];
  if (parsedVerdict === "WRITE" && structural.length) {
    console.warn(yellow(`\n⚠ WRITE trotz struktureller Widersprüche (${structural.length}: ${structural[0]}) – das Gate behandelt dies als PLAN (Regel 5).`));
  }
  // Regel 7 (UI-107, Loop-Anker): Der Thinker deklariert das Ergebnis der
  // Gegenueberstellung der Umsetzungsvorschlaege beider Agents
  // (SCOPE-KONFORM / SCOPE-DIVERGENZ). Eine deklarierte Divergenz blockt
  // die Freigabe — der Scope muss erst an der Differenz praezisiert werden
  // (fail-closed wie Regel 5, Warnung statt stilles Downgrade).
  const anchor = parseScopeDivergence(result.content);
  if (anchor.tooShort) {
    console.warn(yellow(`⚠ SCOPE-DIVERGENZ-Begruendung ist sehr vage (<20 Zeichen: ${anchor.divergence.slice(0, 40)}) – Anker wird trotzdem gesetzt (kein stiller Verlust).`));
  }
  if (anchor.divergence) {
    console.log(dim(`Loop-Anker: SCOPE-DIVERGENZ deklariert (${anchor.divergence.slice(0, 60)}…) – Anker persistiert; das Probe-Gate behandelt eine offene Divergenz als PLAN (Regel 7).`));
  }
  // Regel 6 (UI-104, P0-Schnitt 2): WRITE braucht die unabhängige Probe-
  // Exekution durch den Evil Twin (kontextgetrennte Konversation: nur HEADER,
  // H_i-Originaltexte, Iteration/Diff + Probe-Set – nie das Erst-Reasoning).
  // Der Twin liefert je Probe ein striktes ProbeResult
  // (BESTAETIGT | WIDERSPRUCH | UNKLAR). Fail-closed: Parse-Fehler/Timeout →
  // alle Proben UNKLAR; fehlende probe_id → UNKLAR; globale Zusatzaussagen
  // ohne Autorität. Nur WRITE-Kandidaten mit FORMAL GÜLTIGEM Probe-Set kosten
  // den zweiten Modell-Call — kaputte/coverage-unvollständige Sets erreichen
  // den Twin nie (Schritt-2-Regel) und werden direkt im Gate zu PLAN.
  let twin = null;
  if (verdict === "WRITE" && !(probeParse?.ok && probeValidation?.ok)) {
    // Gate ohne Twin-Call: Probe-Set unlesbar/formal ungültig ⇒ deterministisch
    // PLAN (gleiche Gründe, die computeVerdict liefern würde).
    const gate = computeVerdict({
      parseError: probeParse?.ok ? null : (probeParse?.error ?? "Probe-Set fehlt"),
      validation: probeValidation,
      results: null,
      structuralBlocks: structural,
      divergence: anchor.divergence,
      filesUnchanged: true,
    });
    console.warn(yellow(`\n⚠ Gate: ${gate.verdict} (keine Freigabe, kein Gegenprüfungs-Call). Gründe:\n${gate.reasons.map((r) => `  · ${r}`).join("\n")}`));
    verdict = "PLAN";
  } else if (verdict === "WRITE") {
    uiEvt({ t: "state", s: "VERIFYING" });
    uiEvt({ t: "model", who: "twin" }); // Rollenwechsel sichtbar: jetzt prueft der Twin
    enforceRateLimit(maxRpm, false); // zweiter Call: Budget teilen, nie wegen Budget failen
    console.log(dim("Gegenprüfung (Evil Twin – Probe-Exekution, unabhängige Konversation) läuft …"));
    // Twin-Diversität (Pkt 3/10): eigenes Modell/eigene API-Base/ eigener Key
    // sind WÄHLBAR (FALSIFY_TWIN_*). Ohne Diversität ehrlich warnen — der
    // gemeinsame Blindspot (gleiche Modellfamilie/Biases) ist dann eine
    // bekannte, dokumentierte Grenze, kein stiller Mangel.
    const twinKey = executionConfig.twinApiKeyEnv ? loadApiKeyForNames(executionConfig.twinApiKeyEnv) : apiKey;
    if (executionConfig.twinApiKeyEnv && !twinKey) {
      throw new Error(`Twin-API-Key nicht gefunden (${executionConfig.twinApiKeyEnv.join(", ")}) – in ${keyEnvFile()} setzen oder FALSIFY_TWIN_API_KEY_ENV entfernen.`);
    }
    if (!executionConfig.twinDiversity) {
      console.warn(yellow("⚠ Gegenprüfung läuft mit dem PRIMÄRMODELL (keine Modell-Diversität konfiguriert: FALSIFY_TWIN_MODEL/FALSIFY_TWIN_API_BASE). BESTAETIGT heißt dann: der Fall hält Nachprüfung durch dieselbe Modellfamilie stand – ein geteilter Bias/Blindspot ist nicht ausgeschlossen."));
    }
    // Dateien während der Prüfung unverändert (P0, letztes harte Gate):
    // Whitelist-Snapshot VOR der Exekution, mtime+Größe danach verglichen –
    // eine während der Prüfung veränderte Basis kann keine Freigabe tragen.
    const snapshotBefore = whitelistSnapshot(ROOT, FILE_WHITELIST);
    twin = await runProbeExecution({
      probes: probeValidation.probes,
      requirementList: renderRequirementList(splitRequirement(scope ? scope.header : planText)),
      planText,
      diffText,
      header: scope ? scope.header : null,
      lang,
      model: executionConfig.twinModel,
      apiKey: twinKey,
      apiBase: executionConfig.twinApiBase,
      opts: {
        // F-11-Fix (2026-09-02): eigenes Twin-Token-Budget - der Primaerwert
        // (bis 1e6) reisst Groq (> 16384 = 400) und OpenRouter-Free-Tier
        // (402) auf. Default min(Primaer, 16384), per CLI setzbar.
        maxTokens: executionConfig.twinMaxTokens,
        // F-3-Fix (2026-09-02): eigener Twin-Effort (Fallback = Primaerwert) -
        // vorher erbte der Twin CFG.reasoningEffort; Groq lehnt high mit 400 ab.
        reasoningEffort: executionConfig.twinReasoningEffort,
        maxToolRounds: executionConfig.maxToolRounds,
        temperature: executionConfig.temperature,
        timeoutMs: executionConfig.timeoutMs,
      },
      root: ROOT,
      whitelist: FILE_WHITELIST,
      onTool: (info) => {
        uiEvt({ t: "state", s: "TOOL_ACTIVITY" });
        uiEvt({ t: "activity", tool: info.tool, file: info.file, label: `${info.tool}(${info.file ?? ""})` });
      },
    });
    // Evidence-Semantik (twinEvidenceOk + twinOwnFalsificationOk, Regel 6) –
    // pro Probe angewendet: jede BESTAETIGT-Probe braucht eigenes Lesen
    // (host-aufgezeichnete Tool-Runden) UND eine verifizierbare eigene
    // Referenz; halluzinierte Zitate failen (anchoredFileLine).
    const probeEvidenceOpts = { root: ROOT, whitelist: FILE_WHITELIST };
    const probeResults = twin.results.map((r) => ({
      ...r,
      evidenceOk: probeEvidenceOk(r, twin, probeEvidenceOpts),
    }));
    const snapshotAfter = whitelistSnapshot(ROOT, FILE_WHITELIST);
    const filesUnchanged = snapshotBefore.size === snapshotAfter.size
      && [...snapshotBefore].every(([f, st]) => {
        const after = snapshotAfter.get(f);
        return after && after.mtimeMs === st.mtimeMs && after.size === st.size;
      });
    if (!filesUnchanged) {
      console.warn(yellow("\n⚠ Whitelist-Dateien wurden während der Gegenprüfung verändert – Gate: Prüf-Basis unverändert, KEINE Freigabe."));
    }
    // Deterministisches Gate (die EINZIGE WRITE-Quelle, P0): entscheidet NUR
    // aus Resultaten + Evidence + bestehenden harten Gates (structural,
    // Divergenz-Anker, Dateien unverändert). Fail-closed: alles andere ist
    // PLAN mit Grundliste – kein „nicht prüfbar“-Ausnahme, kein Override.
    const gate = computeVerdict({
      parseError: probeParse.ok ? null : probeParse.error,
      validation: probeValidation,
      results: probeResults,
      structuralBlocks: structural,
      divergence: anchor.divergence,
      filesUnchanged,
    });
    if (gate.verdict === "WRITE") {
      console.log(green(dim(`Gegenprüfung abgeschlossen: alle ${probeResults.length} Probe(n) BESTÄTIGT mit gültiger Evidence – Freigabe durch das Gate.`)));
    } else {
      console.warn(yellow(`\n⚠ Gate: ${gate.verdict} (keine Freigabe). Gründe:\n${gate.reasons.map((r) => `  · ${r}`).join("\n")}`));
      verdict = "PLAN";
    }
  }

  // Finding-Severity echt (UI-065-Befund 3): info/warning/critical je Verdict,
  // nicht hartkodiert. progress wird NIE erfunden.
  uiEvt({ t: "model", who: "thinker" }); // nach der Gegenpruefung zurueck zum Erstpruefer-Kontext
  uiEvt({ t: "state", s: "FINDINGS" });
  if (befund) uiEvt({ t: "finding", severity: findingSeverity(verdict) });
  uiEvt({ t: "phase_done", phase: phaseLabel });

  // ── Persistenz: Job + Scope-Artefakt aktualisieren (FalsifyMe, nur eigene DB).
  //     Regel-3-Rig: EIN Review-Write = EINE Transaktion (BEGIN IMMEDIATE …
  //     COMMIT) — kein Beobachter (anderer Worker, doctor, Checker) sieht je
  //     einen Zwischenzustand, und ein Teil-Schreiben kann keine zweite Wahrheit
  //     hinterlassen. Nach dem Commit erzwingt checkQueueConsistency die
  //     Konsistenz (fail-closed: Verletzung ⇒ kein Verdict-Print, Exit 3).
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (scope) {
        // Loop-Anker: Konform schliesst den Anker (null), Divergenz setzt ihn,
        // fehlende Sektion laesst ihn unveraendert (keine Schlussfolgerung).
        updateScopeAfterReview(db, scope.id, verdict, befund, subPrompt,
          anchor.konform ? null : (anchor.divergence ?? undefined), researchAdditions);
        addFinding(db, {
          scopeId: scope.id,
          jobId,
          round: nextRound(db, scope.id),
          wave: job?.wave || "scan",
          mode: job?.mode || scope.phase,
          befund,
          content: result.content,
          verdict: verdict || "UNBEKANNT",
        });
        // Gegenprüfung als eigenes Finding mit Welle 'evil-twin' – Letztes
        // Finding trägt IMMER das final geltende Urteil (Invariante 4 bleibt
        // gültig: jobs.verdict == letztes findings.verdict). P0: der Befund
        // fasst die Probe-Resultate zusammen (Status-Verteilung), nicht ein
        // Freitext-Urteil des Twins.
        if (twin) {
          const statusCount = twin.results.reduce((acc, r) => {
            const s = String(r?.status ?? "UNBEKANNT");
            acc[s] = (acc[s] || 0) + 1;
            return acc;
          }, {});
          const summary = Object.entries(statusCount).map(([s, n]) => `${s}=${n}`).join(", ");
          addFinding(db, {
            scopeId: scope.id,
            jobId,
            round: nextRound(db, scope.id),
            wave: "evil-twin",
            mode: job?.mode || scope.phase,
            befund: `GEGENPRÜFUNG Probe-Exekution (${summary})${twin.error ? ` – ${twin.error}` : ""}`,
            content: twin.content || "",
            verdict: verdict || "UNBEKANNT",
          });
        }
      }
      jobDone(db, jobId, verdict, null);
      // Loop-Abschluss ist in jobDone eingebettet (TASK-011): der finale
      // Job-Zustandsübergang erzeugt GENAU EINE Loop-Transition — ein
      // Re-Review mit finalem NICHT-WRITE-Verdict schließt den Loop auf DONE
      // (gleiche Transaktion wie das Verdict); WRITE lässt ihn offen
      // (Handoff → WRITE_AUTHORIZED folgt unten). Kein CLI-Pfad besitzt mehr
      // die Loop-Lifecycle-Semantik.
      db.exec("COMMIT");
      if (getLoopState(db, jobId) === "DONE") uiEvt({ t: "loop", s: "DONE" });
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* egal */ }
      throw e;
    }
    enforceQueueConsistency(db);
  } catch (e) {
    console.error(red(`✖ Persistenz-/Konsistenzfehler: ${e.message}`));
    // Security-Review 2026-09-01 (Pkt 4/7): jobDone ist idempotent fail-closed —
    // falls der Review-Commit bereits finalisiert hat (Write persistiert,
    // enforceQueueConsistency warf danach), bleibt das Verdict IMMER
    // bestehen; der Fehlerpfad schreibt keinen finalen Zustand um.
    try { jobDone(db, jobId, null, `Review nicht persistent (${String(e.message).split("\n")[0].slice(0, 120)})`); } catch { /* egal */ }
    uiEvt({ t: "state", s: "ERROR" });
    uiEvt({ t: "loop", s: "ERROR" });
    closeDb();
    process.exitCode = 3;
    return;
  }

  if (subPrompt) console.log(dim(`SUBPROMPT (gespeichert): ${subPrompt.split("\n")[0]}`));

  console.log("");
  console.log(dim(`── ${secs}s · ${result.toolRounds ?? 0} Tool-Runde(n) · ${result.usage?.prompt_tokens ?? "?"} in / ${result.usage?.completion_tokens ?? "?"} out ──`));
  console.log(dim(`Job: ${jobId}`));
  if (befund) console.log(dim(`BEFUND: ${befund}`));

  if (verdict === "WRITE") {
    // TASK-007: Kanonischer v1-Handoff NUR nach bestandenem technischen Gate.
    // Modellprosa/parseVerdict allein haben diesen Pfad nie erreicht (das Gate
    // oben entscheidet). Der Handoff beschreibt die Freigabe maschinenlesbar
    // und wird als JSON persistiert (cli/log/answer lesen sie).
    try {
      const handoff = buildHandoff({
        jobId,
        scopeId: scope ? scope.id : null,
        checkoutId: checkoutId ?? null,
        iterationId: jobId,
        verdict: "WRITE",
        phase: scope ? scope.phase : (job?.mode || "write"),
        reasons: befund ? [befund] : [],
        // FIX (E2E-Befund): die Raw-Twin-Results tragen KEIN evidenceOk —
        // das wird erst durch probeEvidenceOk() berechnet (Block oben). Der
        // Handoff muss hier die EVIDENZ-PRÜFUNG reproduzieren, sonst trägt
        // jedes Probe evidenceOk=false und der eigene Validator lehnt den
        // Handoff des freigegebenen WRITE-Laufs ab (Coder-Brief unmöglich).
        probeResults: (twin?.results || []).map((r) => ({
          probe_id: r.probe_id,
          requirement_ref: probeValidation?.probes?.find?.((p) => p.id === r.probe_id)?.requirement_ref ?? null,
          status: r.status,
          evidenceOk: probeEvidenceOk(r, twin, { root: ROOT, whitelist: FILE_WHITELIST }) === true,
          reason: r.evidence || "",
        })),
        twinEvidence: twin ? {
          tool_rounds: Number(twin.toolRounds ?? 0),
          file_refs: (twin.toolEvidence || [])
            .filter((e) => e?.tool === "read_file" && e?.success === true)
            .map((e) => String(e?.file || e?.path || "")).filter(Boolean).slice(0, 50),
        } : null,
        beforeSnapshot: snapshotRoot(ROOT, FILE_WHITELIST),
        allowedFiles: FILE_WHITELIST,
      });
      const handoffPath = path.join(falsifyHome(), "logs", `handoff-${jobId}.json`);
      fs.writeFileSync(handoffPath, serializeHandoff(handoff), "utf8");
      // WRITE_AUTHORIZED über die EINZIGE Transitionstabelle (kein Raw-Update):
      // markWriteAuthorized bindet handoff_id + Loop-Übergang atomar (EINE
      // Transaktion) und verbucht das handoff_emitted-Event mit echtem
      // from_state (QUEUED beim Erstlauf, RE_REVIEW_RUNNING beim Re-Review).
      const writeAuth = markWriteAuthorized(db, jobId, {
        handoffId: handoff.handoff_id,
        changeDigest: handoff.before_snapshot?.digest ?? null,
        scopeId: scope ? scope.id : null,
      });
      if (!writeAuth.ok) throw new Error(`WRITE_AUTHORIZED-Transition fehlgeschlagen: ${writeAuth.reason}`);
      // UI-123: Loop-Zustand dem Dock spiegeln (nur Anzeige, keine UI-Wahrheit).
      uiEvt({ t: "loop", s: "WRITE_AUTHORIZED" });
      console.log(green(`HANDOFF_ID=${handoff.handoff_id}`));
      console.log(dim(`Handoff (v1, maschinenlesbar): ${handoffPath}`));
      console.log(dim(`→ Nach der Umsetzung: falsify handoff complete --file <report.json> (Re-Review wird automatisch eingereicht).`));
    } catch (e) {
      console.warn(yellow(`⚠ Handoff-Erzeugung fehlgeschlagen (${e.message}) – die WRITE-Freigabe selbst bleibt bestehen; Re-Review benötigt einen manuellen Submit.`));
    }
    uiEvt({ t: "verdict", v: "WRITE" });
    uiEvt({ t: "done" });
    // Exit-Code zentral: exitCodeOf ist die EINZIGE Quelle fuer Verdict-Exits
    // (Rig-Review 2026-09-01, Befund 13b — run.mjs setzt sie nicht mehr manuell).
    process.exitCode = exitCodeOf(verdict);
    console.log(green(bold(`\nVERDICT: WRITE → Freigabe: READ-ONLY → WRITE`)));
    if (scope) console.log(green(`Scope ${scope.id} ist freigegeben – der Agent darf jetzt schreiben (WRITE-Loop/REVIEW-Loop).`));
    if (scope) console.log(green("GAP: geschlossen – die Ausgangsbehauptung des USER AGENT hat die Falsifikations-Challenge überstanden."));
    closeDb();
    process.exitCode = 0;
    return;
  }
  if (verdict === "ASK") {
    // Etage 2 (UI-082): Aufgaben-Mehrdeutigkeit – kein Fortschritt, keine
    // Freigabe; die Phase bleibt, was sie war. Der User muss die Rückfrage
    // beantworten, dann wird neu eingereicht.
    uiEvt({ t: "verdict", v: "ASK" });
    uiEvt({ t: "done" });
    process.exitCode = exitCodeOf(verdict); // ASK = 5 (zentral, Befund 13b)
    console.log(cyan(`\nVERDICT: ASK – die Aufgabe selbst ist mehrdeutig (keine Freigabe)`));
    if (scope && befund) console.log(cyan(`Rückfrage an den User nötig: ${befund}`));
    console.log(cyan("→ Phase unverändert; nach Klärung erneut einreichen."));
    closeDb();
    process.exitCode = 5;
    return;
  }
  if (verdict === "RESEARCH" || verdict === "PLAN") {
    uiEvt({ t: "verdict", v: verdict });
    uiEvt({ t: "done" });
    process.exitCode = exitCodeOf(verdict); // PLAN/RESEARCH = 1 (zentral, Befund 13b)
    const hint = verdict === "RESEARCH"
      ? "→ FalsifyMe braucht weitere Daten (Falsifikations-Modul): read-only recherchieren, Befunde ergänzen, erneut einreichen."
      : "→ Iteration überarbeiten (Plan konkretisieren), erneut einreichen.";
    console.log(yellow(`\nVERDICT: ${verdict} – nicht freigegeben (Loop)`));
    if (scope && befund) console.log(yellow(`GAP offen (Divergenz USER-AGENT-Urteil vs. Falsifikation): ${befund}`));
    console.log(yellow(hint));
    closeDb();
    process.exitCode = 1;
    return;
  }
  uiEvt({ t: "state", s: "ERROR" });
  console.log(yellow("\n(kein VERDICT vom Modell erkannt – bitte Kritik oben lesen)"));
  console.log(yellow("→ KEINE Zusage von FalsifyMe: Exit 3 – Agent darf NICHT weiterarbeiten."));
  closeDb();
  process.exitCode = exitCodeOf(null); // kein Verdict = 3 (zentral, Befund 13b)
}

  await main();
}

process.on("exit", () => { try { closeDb(); } catch { /* egal */ } });

// Nur bei direktem Aufruf ausführen (Import bleibt reiner Modul-Import).
// Crash-Guard (Befund 13c): unhandled rejections duerfen NICHT als Exit 1
// (= PLAN laut Vertrag) mit Stack enden — ehrlicher Exit 3 + Job-Close.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMain().catch((e) => {
    const msg = String(e?.message || e).split("\n")[0].slice(0, 160);
    console.error(red(`\n✖ Interner Fehler (Exit 3, KEIN Verdict): ${msg}`));
    console.error(dim("  Ein Crash ist NICHT „PLAN, überarbeiten“ – der Job wird ehrlich als ERROR geschlossen."));
    try {
      const db = openDb();
      if (activeJobId) {
        try { jobDone(db, activeJobId, null, `Interner Fehler (${msg})`); } catch { /* egal */ }
      }
      closeDb();
    } catch { /* egal */ }
    process.exitCode = 3;
  });
}
