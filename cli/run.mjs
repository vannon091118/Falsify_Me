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
// Persistenz: SQLite (WAL) in FALSIFY_HOME (~/.Falsify) – EINZIGE Quelle.
// FalsifyMe schreibt NIE ins Projekt (read-only bleibt).
//
// Exit-Code: 0 = VERDICT WRITE (Freigabe) · 1 = PLAN/RESEARCH (Loop)
//            2 = Konfig-Fehler · 3 = API-Fehler/kein Verdict
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, closeDb, falsifyHome } from "../artifacts/db.mjs";
import { createJob, getJob, jobFilesList, jobDone, jobToRunning } from "../artifacts/jobs.mjs";
import { getScope, updateScopeAfterReview, addFinding, getFindings, nextRound } from "../artifacts/scopes.mjs";
import { loadApiKey, keyEnvFile, keyNames } from "../core/keys.mjs";
import { loadConfig } from "../core/config.mjs";
import { enforceRateLimit } from "../core/ratelimit.mjs";
import { SYSTEM_DE, SYSTEM_EN, buildUserContent } from "../core/prompt.mjs";
import { parseVerdict, parseBefund, parseSubPrompt } from "../core/verdict.mjs";
import { runAgent } from "../core/agent.mjs";

// Provider-neutrale Konfiguration (Env → ~/.Falsify/config.json → Defaults).
const CFG = loadConfig();

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
  console.log(`FalsifyMe 2.0 – Falsifizierungs-Agent (OpenAI-kompatibel · ${CFG.model})

Verwendung:
  node cli/run.mjs "Plan-Text..." [Optionen]
  node cli/run.mjs --plan-file plan.txt --diff-file diff.patch --root .
  node cli/run.mjs --submit --scope <scope-id> --plan-file plan.txt --root <dir> --files "a.js,b.js"

Optionen:
  --plan-file <pfad>   Iterations-Text (Plan/Recherche/Umsetzung) aus Datei lesen
  --diff-file <pfad>   Diff der geplanten/umgesetzten Änderung aus Datei lesen
  --root <dir>         Arbeitsverzeichnis für den Agent-Datenzugriff (Default: cwd)
  --files <liste>      Zugriffs-Whitelist (kommagetrennt, relativ zu --root) – PFLICHT bei --submit
  --scope <id>         Scope-ID (HEADER = User-Input 1:1 aus dem Scope-Artefakt)
  --model <id>         Modell-ID (Default: ${CFG.model})
  --lang de|en         Sprache der Kritik (Default: ${CFG.lang})
  --max-rpm <n>        Rate-Limit (Default: ${CFG.maxRpm})
  --no-wait            Rate-Limit-Wartezeit überspringen
  --submit             Job für die Worker-Fenster einreichen (kein API-Call) –
                       Agents muessen danach MIT falsify wait <id> blockierend
                       auf das Verdict warten (falsify submit blockt standardmaessig)
  --job-id <id>        Job aus der SQLite-Warteschlange laden (vom Worker genutzt)
  -h, --help           Diese Hilfe

Provider/Ziel (Env oder ~/.Falsify/config.json):
  FALSIFY_API_BASE     z. B. https://integrate.api.nvidia.com/v1 (NVIDIA NIM),
                       https://api.openai.com/v1 (OpenAI), http://localhost:11434/v1 (Ollama)
  FALSIFY_MODEL        Modell-ID (Default: ${CFG.model})
  FALSIFY_API_KEY_ENV  Key-Namen, kommagetrennt (Default: ${CFG.keyEnvNames.join(",")})

Exit-Codes: 0=WRITE (Freigabe)  1=PLAN/RESEARCH (nicht freigegeben, Loop)
            2=Konfig-Fehler  3=API-Fehler/kein Verdict`);
}

async function runMain() {

let planText = "";
let planFile = null;
let diffFile = null;
let model = CFG.model;
let lang = CFG.lang;
let maxRpm = CFG.maxRpm;
let noWait = false;
let submitMode = false;
let jobId = null;
let rootArg = null;
let filesArg = null;
let scopeArg = null;

const positional = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => { const v = args[++i]; if (v === undefined) { console.error(`FEHLER: ${a} braucht einen Wert`); process.exit(2); } return v; };
  switch (a) {
    case "-h": case "--help": usage(); process.exit(0);
    case "--plan-file": planFile = next(); break;
    case "--diff-file": diffFile = next(); break;
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

// ── Submit-Modus: Job-ROW in SQLite anlegen (kein API-Call) ─────────────────
if (submitMode) {
  if (!planText) {
    console.error(red("FEHLER: Kein Plan übergeben. Nutze ein Argument, --plan-file oder stdin."));
    usage();
    closeDb();
    process.exit(2);
  }
  const filesList = (filesArg || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!filesList.length) {
    console.error(red('FEHLER: --files ist Pflicht beim Einreichen (kommagetrennte Dateiliste relativ zu --root), z. B.: --files "app.js,lib/auth.js"'));
    closeDb();
    process.exit(2);
  }
  let scope = null;
  if (scopeArg) {
    scope = getScope(db, scopeArg);
    if (!scope) {
      console.error(red(`FEHLER: Scope nicht gefunden: ${scopeArg} (falsify scope new "<user-input>")`));
      closeDb();
      process.exit(2);
    }
  }
  const root = path.resolve(rootArg || process.cwd());
  const id = createJob(db, {
    scopeId: scope ? scope.id : null,
    payload: planText,
    diffText: diffText || null,
    root,
    files: filesList.join(","),
    mode: scope ? scope.phase : "plan",   // PLAN ist immer Init – danach lenkt das Verdict
  });
  console.log(`JOB_ID=${id}`);
  if (scope) console.log(`Scope: ${scope.id}  (Phase: ${scope.phase})`);
  console.log(`Plan : ${planText.length} Zeichen${diffText ? ` · Diff: ${diffText.length} Zeichen` : ""}`);
  console.log(`Root : ${root}  (Agent-Datenzugriff, sandboxed)`);
  console.log(`Dateien (Whitelist): ${filesList.join(", ")}`);
  console.log(`Status: SQLite (falsify status ${id})   ·   Protokoll: falsify log ${id}`);
  console.log(`Ein Worker-Fenster (max. 3, FALSIFY_HOME=${falsifyHome()}) verarbeitet den Job live.`);
  closeDb();
  process.exit(0);
}

// ── Arbeitsverzeichnis + Zugriffs-Whitelist ─────────────────────────────────
let ROOT = path.resolve(rootArg || process.cwd());
let FILE_WHITELIST = (filesArg || "").split(",").map((s) => s.trim()).filter(Boolean);
let job = null;
let scope = null;

if (jobId) {
  job = getJob(db, jobId);
  if (!job) {
    console.error(red(`FEHLER: Job nicht gefunden in der DB: ${jobId}`));
    closeDb();
    process.exit(2);
  }
  if (job.status === "QUEUED") jobToRunning(db, jobId, null);
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
  FILE_WHITELIST = jobFilesList(job);
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
  jobId = createJob(db, {
    scopeId: scope ? scope.id : null,
    payload: planText,
    diffText: diffText || null,
    root: ROOT,
    files: FILE_WHITELIST.join(","),
    mode: scope ? scope.phase : "plan",
    status: "RUNNING",
  });
  job = getJob(db, jobId);
}

// ── UI-Start-Events (Phase 2): Job bekannt -> Slot belegen (nur FALSIFY_UI=1) ──
const phaseLabel = PHASE_LABEL[scope?.phase || job?.mode || "plan"] || "PLAN";
uiEvt({ t: "job", id: jobId, scope: scope?.id ?? null });
uiEvt({ t: "state", s: "LOADING" });
uiEvt({ t: "phase", phase: phaseLabel });
uiEvt({ t: "files", n: FILE_WHITELIST.length });

// ── API-Key aus FALSIFY_HOME/.env oder Prozessumgebung ───────────────────────
const apiKey = loadApiKey();
if (!apiKey) {
  console.error(red(`FEHLER: Kein API-Key gefunden (gesucht: ${keyNames().join(", ")}). Trage einen Key in ${keyEnvFile()} ein oder setze die passende Umgebungsvariable.`));
  console.error(dim(`Provider/Ziel: ${CFG.provider} (${CFG.apiBase}) – anpassbar via FALSIFY_API_BASE/FALSIFY_MODEL oder ${CFG.configFile}.`));
  uiEvt({ t: "state", s: "ERROR" });
  // Job sauber schliessen, damit er nicht als RUNNING hängen bleibt.
  if (jobId) jobDone(db, jobId, null, "API-Key fehlt");
  closeDb();
  process.exit(2);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  enforceRateLimit(maxRpm, noWait);

  console.log("");
  console.log(cyan(bold("◤ FalsifyMe ◢")));
  console.log(dim(`  Modell : ${model}`));
  console.log(dim(`  Provider: ${CFG.provider} (${CFG.apiBase})`));
  console.log(dim(`  Root   : ${ROOT}  (Agent-Datenzugriff)`));
  if (scope) {
    console.log(dim(`  Scope  : ${scope.id}`));
    console.log(dim(`  Phase  : ${scope.phase}  (${scope.phase === "plan" ? "PLAN-Prüfung – Init" : scope.phase === "research" ? "RESEARCH – Datenprüfung" : "WRITE-Prüfung – Review der Umsetzung"})`));
  }
  console.log(dim(`  Thinking: ${CFG.reasoningEffort} · max_tokens ${CFG.maxTokens} · temp ${CFG.temperature}`));
  console.log(dim(`  Iteration: ${planText.length} Zeichen${diffText ? ` · Diff: ${diffText.length} Zeichen` : ""}`));
  console.log(dim("  Streaming: Reasoning · Kritik · ⟳ = Agent liest Dateien"));
  console.log("");

  const systemPrompt = lang === "en" ? SYSTEM_EN : SYSTEM_DE;
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
  });

  const t0 = Date.now();
  let result;
  uiEvt({ t: "state", s: "THINKING" });
  try {
    result = await runAgent({
      systemPrompt, userContent, model, apiKey,
      apiBase: CFG.apiBase,
      maxTokens: CFG.maxTokens,
      reasoningEffort: CFG.reasoningEffort,
      maxToolRounds: CFG.maxToolRounds,
      temperature: CFG.temperature,
      timeoutMs: CFG.timeoutMs,
      root: ROOT,
      whitelist: FILE_WHITELIST,
      onTool: (info) => {
        uiEvt({ t: "state", s: "TOOL_ACTIVITY" });
        uiEvt({ t: "activity", tool: info.tool, file: info.file, label: `${info.tool}(${info.file ?? ""})` });
      },
    });
  } catch (e) {
    const timedOut = /timeout/i.test(String(e.message));
    uiEvt({ t: "state", s: timedOut ? "TIMEOUT" : "ERROR" });
    console.error(red(`\n✖ ${e.message}`));
    jobDone(db, jobId, null, e.message);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(dim(`── ${secs}s – Fehler ──`));
    console.log(dim(`Job: ${jobId}  ·  Status: ERROR (falsify status ${jobId})`));
    closeDb();
    process.exitCode = 3;
    return;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const verdict = parseVerdict(result.content);
  const befund = parseBefund(result.content);
  const subPrompt = parseSubPrompt(result.content);

  // ── UI-Befund-/End-Events (Phase 2): Review-Erkenntnis + Verdict ──────────
  // Nur echte Werte: finding nur, wenn der Review wirklich einen Befund hat;
  // progress wird NICHT erfunden (kein Prozent ohne echten Fortschritt).
  uiEvt({ t: "state", s: "FINDINGS" });
  if (befund) uiEvt({ t: "finding", severity: "discovered" });
  uiEvt({ t: "phase_done", phase: phaseLabel });

  // ── Persistenz: Job + Scope-Artefakt aktualisieren (FalsifyMe, nur eigene DB) ──
  if (scope) {
    updateScopeAfterReview(db, scope.id, verdict, befund, subPrompt);
    addFinding(db, {
      scopeId: scope.id,
      jobId,
      round: nextRound(db, scope.id),
      mode: job?.mode || scope.phase,
      befund,
      content: result.content,
      verdict: verdict || "UNBEKANNT",
    });
  }
  jobDone(db, jobId, verdict, null);

  if (subPrompt) console.log(dim(`SUBPROMPT (gespeichert): ${subPrompt.split("\n")[0]}`));

  console.log("");
  console.log(dim(`── ${secs}s · ${result.toolRounds ?? 0} Tool-Runde(n) · ${result.usage?.prompt_tokens ?? "?"} in / ${result.usage?.completion_tokens ?? "?"} out ──`));
  console.log(dim(`Job: ${jobId}`));
  if (befund) console.log(dim(`BEFUND: ${befund}`));

  if (verdict === "WRITE") {
    uiEvt({ t: "verdict", v: "WRITE" });
    uiEvt({ t: "done" });
    console.log(green(bold(`\nVERDICT: WRITE → Freigabe: READ-ONLY → WRITE`)));
    if (scope) console.log(green(`Scope ${scope.id} ist freigegeben – der Agent darf jetzt schreiben (WRITE-Loop/REVIEW-Loop).`));
    closeDb();
    process.exitCode = 0;
    return;
  }
  if (verdict === "RESEARCH" || verdict === "PLAN") {
    uiEvt({ t: "verdict", v: verdict });
    uiEvt({ t: "done" });
    const hint = verdict === "RESEARCH"
      ? "→ FalsifyMe braucht weitere Daten: read-only recherchieren, Befunde ergänzen, erneut einreichen."
      : "→ Iteration überarbeiten (Plan konkretisieren), erneut einreichen.";
    console.log(yellow(`\nVERDICT: ${verdict} – nicht freigegeben (Loop)`));
    console.log(yellow(hint));
    closeDb();
    process.exitCode = 1;
    return;
  }
  uiEvt({ t: "state", s: "ERROR" });
  console.log(yellow("\n(kein VERDICT vom Modell erkannt – bitte Kritik oben lesen)"));
  console.log(yellow("→ KEINE Zusage von FalsifyMe: Exit 3 – Agent darf NICHT weiterarbeiten."));
  closeDb();
  process.exitCode = 3;
}

  await main();
}

process.on("exit", () => { try { closeDb(); } catch { /* egal */ } });

// Nur bei direktem Aufruf ausführen (Import bleibt reiner Modul-Import).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMain();
}
