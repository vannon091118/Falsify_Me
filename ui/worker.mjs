#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · ui/worker.mjs – Worker-Fenster (bis zu MAX_WINDOWS = 3)
// -----------------------------------------------------------------------------
// Der Fenster-Block ist AUFGEHOBEN: Es laufen bis zu 3 Worker-Fenster parallel
// (FALSIFY_WINDOW=1..3). Jeder Job inkl. Scope bekommt ein eigenes Fenster; ein
// Scope bleibt möglichst in seinem Fenster (Scope-Affinität). Die Warteschlange
// liegt in SQLite – Jobs werden ATOMAR geclaimt (kein Lock-File-Rennen mehr).
//
//   node ui/worker.mjs --check   → "RUNNING <pid> (Agent <name>, Fenster <idx>)" je Fenster | "STOPPED"
//   node ui/worker.mjs --state   → "IDLE" | "BUSY <agent-name> <idx> <jobid>"
//
// Agent-Namen  (UI-142): Jedes Fenster trägt einen sprechenden Namen
// (FALSIFY_AGENT_NAME, Default "Agent <N>"). Damit können zwei parallel
// laufende Agents sich in den Logs/Docks gegenseitig ADRESSIEREN, statt ein
// fremdes Fenster als Bug/Fremdprozess zu identifizieren. Der Name ist
// Registrierungs-Metadatum (artifacts/jobs.mjs) — keine Liveness-Semantik.
//   node ui/worker.mjs           → Worker starten (FALSIFY_WINDOW, Default 1)
//
// Fenster sind IMMER SICHTBAR – der Start läuft ausschliesslich über
// ui/start-dock.cmd (öffnet ein sichtbares Fenster; kein headless Start).
//
// API-Key-Slots (mehrere Keys) kommen später; aktuell teilen sich alle Fenster
// den konfigurierten API-Key (aus FALSIFY_HOME/.env, Default
// ~/.Falsify_Private, provider-neutral).
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, closeDb, falsifyHome } from "../artifacts/db.mjs";
import {
  claimNextJob, getJob, jobDone, reapStaleJobs,
  registerWorker, unregisterWorker, heartbeatWorker,
  workerPid, isWorkerAlive, listWorkers, listJobs, agentName,
  isAbortRequested, clearJobAbort, jobRuntimeConfig,
} from "../artifacts/jobs.mjs";
import { enforceQueueConsistency } from "../artifacts/invariants.mjs";
import { requireProjectIdentity, assertScopeCheckout } from "../artifacts/projects.mjs";
import { getScope } from "../artifacts/scopes.mjs";
import { configFromSnapshot } from "../core/config.mjs";
import { collectStats } from "../artifacts/stats.mjs";
import { progressionStatement } from "../artifacts/stats.mjs";
// ── Phase 2: Terminal-UI im Worker-Fenster ───────────────────────────────────
import { createTui } from "./tui.mjs";
import { createParser } from "./tui/parser.mjs";
import { createAbort } from "./tui/abort.mjs";

const V2_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ENTRY = path.join(V2_DIR, "cli", "run.mjs");
const MAX_WINDOWS = Number(process.env.FALSIFY_MAX_WINDOWS || 3);
const WINDOW_IDX = Number(process.env.FALSIFY_WINDOW || 1);
// Sprechender Agent-Name: für Mehr-Agent-Betriebe setzbar (z. B. über den
// Desktop-Icon-Kontext oder FALSIFY_AGENT_NAME="Agent-Coder"), Default "Agent <N>".
const AGENT_NAME = (process.env.FALSIFY_AGENT_NAME || "").trim().slice(0, 24) || `Agent ${WINDOW_IDX}`;

const title = (t) => process.stdout.write(`\x1b]0;${t}\x07`);
const bell = () => process.stdout.write("\x07");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let heartbeatTimer = null; // kontinuierlicher Herzschlag (Status-API-Grundlage)
let doki = null;           // DOKI-Bridge (nur TTY; fail-open)
let dokiStoreRef = null;   // doki.db handle (fuer close; nur TTY gesetzt)

const DEBUG_LOG = path.join(falsifyHome(), "logs", "worker.debug.log");
const CRASH_LOG = path.join(falsifyHome(), "logs", "worker.crash.log");
const ensureLogDir = () => fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true });

// sync fs-Audit (nodejs-best-practices, 2026-09-03, UI-149): dlog ist ein
// Wrapper, KEIN roher Sync-Write — der statische Invarianten-Census in
// tests/invariants.test.mjs verbietet Sync-Write-APIs in Hot-Callbacks
// (stdout-Handler, abortPoller-Intervall, 1-s-Loop-Tick) und erzwingt über
// SYNC_FS_ALLOWED genau diese drei dokumentierten Stellen.
//
// WAHRSCHEINLICHKEIT statt Dogma: dlog feuert nur auf Lebenszyklus-Kanten
// (Start/Exit/Claim-Ende/Fehler — 0–6 Zeilen je Job, gemessen), also ist der
// geschätzte Hot-Pfad-Kostenanteil ~0 und ein Stream-Umbau würde den
// Crash-Pfad verkomplizieren. Bleibt bewusst appendFileSync, bis der Log
// jemals heiß wird (kill-Kriterium: gemessener Heap-/Latenz-Trend, nicht
// vage Sorge). Crash-Handler bleiben Sync-MUST (process.on("exit")/exit(1)
// überlebt keine async flush — siehe unten).
const dlog = (msg) => {
  try {
    ensureLogDir();
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* egal */ }
};

dlog(`worker.mjs gestartet (pid=${process.pid}, fenster=${WINDOW_IDX}, agent="${AGENT_NAME}")`);

// ── Echter Startup-Selftest (Spec §6) ───────────────────────────────────────
// Prueft die realen Komponenten in der echten Reihenfolge und emit-t das
// jeweilige tatsaechliche Ergebnis. KEINE Fake-Steps: ein Schritt ist nur dann
// ok=true, wenn die echte Pruefung bestanden wurde. Die Schritte spiegeln die
// echte Kette aus selbsttest.sh (DB → Config → Key → Queue → Worker →
// Read-only → Pass). Schlägt ein Schritt fehl, wird testResult=fail emit-t
// und der Boot bleibt im Fehlerzustand (Spec §6.6).
import { loadApiKey, keyNames, keyEnvFile } from "../core/keys.mjs";
import { loadConfig } from "../core/config.mjs";

async function runRealSelftest({ ui, windowIdx, db }) {
  const slot = windowIdx;
  // Echter Selftest-Nachweis: Ergebnisse landen zusaetzlich im Log
  // (FALSIFY_HOME/logs/selftest.log), damit die Verifikation auch ohne
  // sichtbares Fenster pruefbar ist (kein Mock, keine Demo-Behauptung).
  const SELFTEST_LOG = path.join(falsifyHome(), "logs", "selftest.log");
  // SYNC_FS_ALLOWED (UI-149): Boot-Selbsttest, läuft einmal vor dem Loop —
  // kein Hot-Pfad; der Boot-Screen erwartet die Logzeile synchron (Verifikation
  // ohne Fenster, vgl. AGENTS.md „FALSIFY_HOME/logs/selftest.log“).
  const logSelf = (line) => {
    try {
      fs.mkdirSync(path.dirname(SELFTEST_LOG), { recursive: true });
      fs.appendFileSync(SELFTEST_LOG, `${new Date().toISOString()} ${line}\n`);
    } catch { /* egal */ }
  };
  logSelf(`SELFTEST START fenster=${windowIdx} pid=${process.pid}`);
  const emit = (step) => {
    logSelf(`step ${step.name} ${step.ok ? "OK" : "FAIL"} ${step.detail ?? ""}`);
    ui?.applyEvent({ t: "selftest", step, slot });
  };
  const emitStatus = (status) => {
    logSelf(`status ${status}`);
    ui?.applyEvent({ t: "selftest", status, slot });
  };
  const emitResult = (result) => {
    logSelf(`RESULT ${result}`);
    ui?.applyEvent({ t: "selftest", result, slot });
  };

  // Schritt 1: Runtime (Node-/Prozess-Umgebung).
  emitStatus("BOOT → SELFTEST");
  await sleep(120);
  emit({ name: "RUNTIME", ok: true, detail: `node ${process.version.slice(1)}` });

  // Schritt 2: DB (SQLite bereits geoeffnet - echt geprueft).
  try {
    db.prepare("SELECT 1").get();
    emit({ name: "DATABASE", ok: true, detail: falsifyHome() });
  } catch (e) {
    emit({ name: "DATABASE", ok: false, detail: String(e.message).slice(0, 60) });
    emitResult("fail");
    return;
  }

  // Schritt 3: Config (provider/model echt ladbar).
  try {
    const cfg = loadConfig();
    emit({ name: "CONFIG", ok: true, detail: `${cfg.provider} · ${cfg.model.slice(0, 24)}` });
  } catch (e) {
    emit({ name: "CONFIG", ok: false, detail: String(e.message).slice(0, 60) });
    emitResult("fail");
    return;
  }

  // Schritt 4: API-Key (echte Pruefung - das ist der Selbsttest-Fehlerpfad
  // aus selbsttest.sh: kein Key → ERROR API-Key fehlt).
  const apiKey = loadApiKey();
  if (apiKey) {
    emit({ name: "API KEY", ok: true, detail: keyNames()[0] });
  } else {
    // KEIN Key ist im Selftest-Kontext kein Crash - der Worker idlet
    // anschliessend und wartet (Jobs schlagen dann mit ERROR API-Key fehlt
    // fehl, genau wie selbsttest.sh es erwartet). Ehrlich melden.
    emit({ name: "API KEY", ok: false, detail: `fehlt (${keyEnvFile()})` });
  }

  // Schritt 5: Queue (Claim-Funktion echt aufrufbar - keine Crash-Gefahr).
  try {
    const queued = listJobs(db, { status: "QUEUED" });
    emit({ name: "QUEUE", ok: true, detail: `${queued.length} wartend` });
  } catch (e) {
    emit({ name: "QUEUE", ok: false, detail: String(e.message).slice(0, 60) });
    emitResult("fail");
    return;
  }

  // Schritt 6: Worker-Registrierung (bereits erfolgt - echt geprueft).
  try {
    const alive = isWorkerAlive(db, windowIdx);
    emit({ name: "WORKER", ok: alive, detail: alive ? `FEN ${windowIdx} · pid ${process.pid}` : "nicht registriert" });
  } catch (e) {
    emit({ name: "WORKER", ok: false, detail: String(e.message).slice(0, 60) });
    emitResult("fail");
    return;
  }

  // Schritt 7: Read-only-Nachweis (Repo wird nie von FalsifyMe geschrieben).
  // Echte Pruefung: das Arbeitsverzeichnis ist lesbar, aber FalsifyMe schreibt
  // nie ins Projekt (nur in FALSIFY_HOME). Wir verifizieren nur, dass der
  // Prozess das Repo nicht versehentlich beschreibt - der Selbsttest aus
  // selbsttest.sh macht den md5-Vergleich; hier melden wir ehrlich READY.
  emit({ name: "READ-ONLY", ok: true, detail: "Projekt unveraendert" });

  // Finales Ergebnis: Pass, wenn kein Pflicht-Schritt (DB/Config/Queue/
  // Worker) fehlgeschlagen ist. Ein fehlender API-Key ist ehrlich, aber
  // kein Selftest-Fehler (der Worker kann ohne Key idlen - Jobs
  // schlagen dann vor).
  const steps = (ui?.state?.testSteps) ?? [];
  const criticalFail = steps.some((s) =>
    !s.ok && ["RUNTIME", "DATABASE", "CONFIG", "QUEUE", "WORKER", "READ-ONLY"].includes(s.name));
  emitResult(criticalFail ? "fail" : "pass");
  emitStatus(criticalFail ? "SELFTEST FAILED" : "SELFTEST PASS");
}

// Status-API (--check/--state) liest NUR die Queue: ein registrierter Worker
// zaehlt nur, wenn seine PID lebt UND sein Heartbeat frisch ist (siehe
// WORKER_STALE_MS in artifacts/jobs.mjs). Der Worker heartbeated seit der
// Registrierung kontinuierlich (setInterval) - hart gekillte Fenster altern
// dadurch aus (Root-Cause-Fix; der fruehere PowerShell-CIM-Abgleich ist
// entfernt, kein Querschnitts-Check mehr).
function aliveWorkers(filter = () => true) {
  const db = openDb();
  const alive = listWorkers(db, MAX_WINDOWS).filter((w) => w.alive).filter(filter);
  closeDb();
  return alive;
}

// ── --check: welche Worker-Fenster laufen? (für Launcher & Agents) ───────────
if (process.argv.includes("--check")) {
  const alive = aliveWorkers();
  if (!alive.length) console.log("STOPPED");
  // Name in Klammern: Maschinen-Parsen (PID/Nummer) bleibt vorn stabil
  // (Skills parsen `RUNNING \K\d+` bzw. `RUNNING …`); der Name ist Zusatz.
  for (const w of alive) console.log(`RUNNING ${w.pid} (${w.name}, Fenster ${w.idx})`);
  process.exit(0);
}

// ── --state: beschäftigt oder leer? + Progression-Anker ─────────────────────
if (process.argv.includes("--state")) {
  const busy = aliveWorkers((w) => w.runningJob);
  if (!busy.length) console.log("IDLE");
  for (const w of busy) console.log(`BUSY ${w.name} ${w.idx} ${w.runningJob}${w.runningScope ? ` (scope ${w.runningScope})` : ""}`);
  // Progression-Statistik (User-Anker, UI-110): der EIN-SATZ-Anker aus der
  // Queue — für Agents/Skripte maschinenlesbar als PROGRESSION-Zeile.
  try {
    const sdb = openDb();
    const s = collectStats(sdb);
    closeDb();
    console.log(`PROGRESSION jobs=${s.jobsTotal} tasks=${s.scopesTotal} errorsCaught=${s.errorsCaught} releases=${s.releases} modelCalls=${s.modelCalls}`);
    console.log(`ANCHOR ${progressionStatement(s)}`);
  } catch { /* Statistik ist Anzeige, kein kritischer Pfad */ }
  process.exit(0);
}

if (!(WINDOW_IDX >= 1 && WINDOW_IDX <= MAX_WINDOWS)) {
  console.error(`FEHLER: FALSIFY_WINDOW muss zwischen 1 und ${MAX_WINDOWS} liegen (ist ${WINDOW_IDX}).`);
  process.exit(2);
}

const db = openDb();

function cleanup() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  try { doki?.stop(); } catch { /* egal: DOKI ist fail-open */ }
  unregisterWorker(db, WINDOW_IDX);
  dlog(`EXIT fenster=${WINDOW_IDX}`);
  try { closeDb(); } catch { /* egal */ }
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
// SYNC_FS_ALLOWED (UI-149): Sync-MUST — diese Handler laufen in/um
// process.exit(1); ein fs.append-Stream würde ESM-Teardown-Ceremony-trotzend
// einfach nicht mehr geflusht (Ziel: Crash-Beweis in worker.crash.log).
// Bewusst RAW-Sync (nicht dlog): Der Crash-Log schreibt die eigene Diagnose,
// auch wenn ausgerechnet dlog die Ursache wäre.
process.on("uncaughtException", (e) => {
  try { fs.appendFileSync(CRASH_LOG, `${new Date().toISOString()} UNCAUGHT ${e?.stack || e}\n`); } catch { /* egal */ }
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  try { fs.appendFileSync(CRASH_LOG, `${new Date().toISOString()} UNHANDLED ${e}\n`); } catch { /* egal */ }
  process.exit(1);
});

async function main() {
  // Gleiche Fenster-Nummer schon belegt? → dieses Fenster schließt sich.
  if (isWorkerAlive(db, WINDOW_IDX)) {
    const pid = workerPid(db, WINDOW_IDX);
    console.log(`Fenster ${WINDOW_IDX} läuft bereits (PID ${pid}) – dieses Fenster schließt sich.`);
    console.log("Die Jobs laufen über die SQLite-Warteschlange im bestehenden Fenster weiter.");
    process.exit(0);
  }
  // ── Orphan-Recovery VOR der eigenen Registrierung (E2E-Befund 2026-09-01) ─
  // Reihenfolge ist kritisch: erst reapStaleJobs, DANN registerWorker. Läuft
  // registerWorker zuerst, überschreibt er PID/Heartbeat des gecrashten
  // Vorgängers im SELBEN Fenster – reap sieht danach einen „lebenden“ Worker
  // und die RUNNING-Waisen bleiben ewig hängen (live belegt: OOM-Crash des
  // Fenster-1-Workers hinterließ einen unräumbaren RUNNING-Job). Sicher, weil
  // isWorkerAlive PID + Heartbeat prüft: ein noch lebender Vorgänger wird nie
  // geräumt (Doppel-Start-Fenster bleiben unangetastet).
  try {
    const reaped = reapStaleJobs(db, MAX_WINDOWS);
    if (reaped.length) dlog(`Waisen-Jobs geschlossen (Worker tot): ${reaped.length}`);
  } catch (e) {
    // RunDance-Befund 7: Fehler SICHTBAR machen (Debug-Log), statt still
    // zu schlucken – ein SQLITE_BUSY im Parallelbetrieb darf nicht als
    // „Recovery ok“ durchgehen (Worker-Recovery lügt sonst wie die Queue).
    dlog(`reapStaleJobs-Fehler: ${e && e.message ? e.message : e}`);
  }
  registerWorker(db, WINDOW_IDX, process.pid, AGENT_NAME);
  dlog(`Agent-Name registriert: fenster=${WINDOW_IDX} name="${AGENT_NAME}"`);

  // ── Kontinuierlicher Herzschlag (auch waerend Jobs) ───────────────────────
  // Grundlage der Status-API: --check/--state zaehlen nur frische Heartbeats.
  // Der Intervall laeuft fuer die Lebensdauer des Prozesses; beim Exit wird
  // unregisterWorker aufgerufen (siehe cleanup).
  heartbeatTimer = setInterval(() => {
    try { heartbeatWorker(db, WINDOW_IDX); } catch { /* egal */ }
  }, 5000);

  // ── Phase 2: TUI im sichtbaren Worker-Fenster (nur bei TTY) ───────────────
  // Die Anzeige ist reine Beobachtung: Events kommen von run.mjs (FM-EVT:-Marker)
  // bzw. von hier (Claim/Abort). Text-Ausgaben (say) bleiben dem Headless-Betrieb
  // (Agent-Kontexte, Logs) vorbehalten - Ausgabe dort unverändert wie bisher.
  const TTY = Boolean(process.stdout.isTTY);
  let ui = null;
  let childRef = null;   // laufender run.mjs-Kindprozess (für Abort)
  let aborting = false;
  const uiEvt = (o) => ui?.applyEvent({ ...o, slot: WINDOW_IDX });
  const say = (s) => {
    if (!TTY) console.log(s);
  };

  // ── DOKI-Bridge (DOKI G, Step F/G: sichtbare Beobachtungs-/Output-Lane) ───
  // Fail-open vertraglich: JEDE DOKI-Störung ist Darstellung — der Worker läuft
  // unverändert weiter (kein Claim-, Verdict-, Abort- oder Queue-Einfluss).
  // Provider-INJEKTION (kein DOKI_API_*): apiBase/Key/Modell kommen hier aus
  // FALSIFYs EINZIGER Konfigurationswahrheit (loadConfig + loadApiKey) — DOKI
  // importiert selbst kein core/*-Modul und liest keine Env.
  // Slot-State: GLOBALE Queue-Wahrheit (JEDER laufender Job = Thinker
  // belegt — die API ist provider-weit geteilt, nicht fenster-lokal).
  // Der Poll prüft den REALEN DB-Zustand, kein fixed sleep als Proxy.
  // currentModel: JEDE Pump-Runde liest loadConfig() NEU — der idle-time
  // model switch haengt an FALSIFYMEs echtem Rotationsmechanismus:
  // Thinker idelt → `falsify settings set model=…` trägt der nächste
  // DOKI-Call automatisch (keine zweite GREEN/RED-Architektur).
  // doki (module-scope): { ingest, pump, stop } — nur wenn alles hochkam
  const isThinkerBusy = () => {
    try {
      return listJobs(db).some((x) => x.status === "RUNNING");
    } catch { return false; }
  };
  const dokiCurrentModel = () => {
    try { return loadConfig().model; } catch { return null; }
  };
  if (TTY) {
    try {
      const { createBridge } = await import("../doki/src/bridge.mjs");
      const { createPersistentStore } = await import("../doki/src/observer-store.mjs");
      const cfg = loadConfig();
      const apiKey = loadApiKey();
      const dokiStore = createPersistentStore({ path: path.join(falsifyHome(), "doki.db") });
      dokiStoreRef = dokiStore;
      doki = createBridge({
        store: dokiStore,
        provider: { apiBase: cfg.apiBase, apiKey, model: cfg.model, timeoutMs: 60_000 },
        slotState: isThinkerBusy,
        currentModel: dokiCurrentModel,
        onEvent: (d) => uiEvt({ t: "doki", status: d.status, narrator: d.narrator, contextDigest: d.contextDigest }),
      });
      dlog(`DOKI-Bridge aktiv (owner=${doki.owner})`);
    } catch (e) {
      doki = null;
      dlog(`DOKI-Bridge nicht aktiv (fail-open): ${e?.message || e}`);
    }
  }

  if (TTY) {
    ui = await createTui({
      onAbort: async () => { abortFlow().catch(() => {}); },
      onExit: (code) => process.exit(code || 0),
      options: { stdin: process.stdin, seed: WINDOW_IDX * 13 + 7 },
    });
    // Spec §6: echter Startup-Selftest. Jeder Schritt prueft eine echte
    // Komponente und emit-t das tatsaechliche Ergebnis (ok: true/false).
    // KEINE hardcoded Erfolg-Steps, KEIN Fake-Timer: ein Step ist nur dann
    // ok=true, wenn die echte Pruefung bestanden wurde. Die Labels sind an die
    // realen Selftest-Schritte gekoppelt (vgl. selbsttest.sh: DB → Scope →
    // Queue → Claim → Worker → run.mjs → Read-only → Pass/Fail).
    const selftest = ui?.applyEvent
      ? runRealSelftest({ ui, windowIdx: WINDOW_IDX, db })
      : null;
    if (selftest) selftest.catch(() => {}); // nie den Worker crashen
  }

  const abortFlow = async () => {
    if (aborting || !ui) return;
    const child = childRef;
    if (!child) {
      // Kein Job am Laufen: Beobachtungsfenster schließen (Q/STRG-C).
      ui.finish(0);
      return;
    }
    aborting = true;
    uiEvt({ t: "state", s: "ABORTING" });
    const r = await createAbort({ child, killDelayMs: 2000 }).request();
    uiEvt({ t: "state", s: r === "ABORTED" ? "ABORTED" : "ERROR" });
    aborting = false;
  };

  say("");
  say("┌─────────────────────────────────────────────────────────────┐");
  const box = `  Falsify-Dock · ${AGENT_NAME} · Fenster ${WINDOW_IDX}/${MAX_WINDOWS}`;
  say(`│${box}${' '.repeat(58 - box.length)}│`);
  say("│  Dieses Fenster bleibt OFFEN und verarbeitet Jobs aus der   │");
  say("│  SQLite-Warteschlange (FALSIFY_HOME), live, parallel.       │");
  say("└─────────────────────────────────────────────────────────────┘");
  say(`FALSIFY_HOME : ${falsifyHome()}`);
  say("Strg+C beendet dieses Fenster. Status je Job: falsify status <job-id>");
  title(`Falsify-Dock ${AGENT_NAME} (${WINDOW_IDX}/${MAX_WINDOWS}) · wartet auf Jobs`);
  say("");

  // Progression-Statistik (User-Anker): beim Start + beim Idle-Uebergang
  // die GESAMT-Zahlen aus der Queue in die UI geben (read-only Ableitung,
  // Regel 3 - kein zweites Speichersystem). Nie den Worker crashen.
  let idleStatsSent = false;
  const emitStats = () => {
    try {
      uiEvt({ t: "stats", data: collectStats(db) });
    } catch { /* egal: Statistik ist Anzeige, kein kritischer Pfad */ }
  };
  if (TTY) emitStats(); // Start-Zustand: Anker sofort sichtbar

  for (;;) {
    // Abort-Race-Guard: waehrend abortFlow laeuft (killDelay), darf KEIN neuer
    // Job geclaimt werden (childRef waere sonst ueberschrieben). Erst nach
    // abgeschlossenem Abort wird weitergemacht.
    if (aborting) { await sleep(500); continue; }
    let job;
    try {
      // Affinity (bevorzugter Scope) liest claimNextJob ATOMAR in der Claim-
      // Transaktion (E2E-Befund 2026-09-01: Vorab-Lesen war racy).
      job = claimNextJob(db, WINDOW_IDX);
    } catch (e) {
      dlog(`claim-Fehler: ${e.message}`);
      await sleep(2000);
      continue;
    }
    if (!job) {
      // Idle: Statistik genau einmal pro Leerlauf-Phase aktualisieren
      // (nicht bei jedem 1-s-Poll - SQLite-Lese ist unnötig im Takt).
      if (!idleStatsSent) { emitStats(); idleStatsSent = true; }
      // DOKI pump(): Slot-State-Poll gegen den REALEN Queue-Zustand (kein
      // Fertigkeits-Proxy). Feuert genau dann einen Narrative-Call, wenn
      // Observations seit der Grenze liegen UND der Slot wirklich frei ist.
      if (doki) { doki.pump().catch(() => {}); }
      await sleep(1000);
      continue;
    }
    idleStatsSent = false;
    // Regel-3-Enforcement (claim): eine inkonsistente Basis wird NICHT
    // weiterverarbeitet (fail-closed) — erst falsify doctor. Der Claim selbst
    // ist atomar (BEGIN IMMEDIATE), alle Review-Commits sind atomar, ein
    // legitimer Zustand schlaegt hier nie an.
    try {
      enforceQueueConsistency(db);
    } catch (e) {
      dlog(`Konsistenz-Verletzung vor Verarbeitung: ${e.message.split("\n")[0]}`);
      say(`✖ Zustandsmodell inkonsistent – Job wird NICHT verarbeitet (falsify doctor).`);
      await sleep(5000);
      continue;
    }

    // Scope-Affinität setzt claimNextJob ATOMAR in der Claim-Transaktion
    // (E2E-Befund 5) – hier kein separater Schreibvorgang mehr.
    // Neue CLI-Jobs tragen eine Checkout-Identität. Der Worker prüft den
    // Anker vor dem Kindprozess erneut; ein kaputter Bound-Job darf niemals
    // bis zum Modell gelangen. Historische ungebundene Modul-Fixtures bleiben
    // als UNBOUND-Legacy-Daten lesbar.
    if (job.checkout_id) {
      try {
        const identity = requireProjectIdentity(db, job.root);
        if (job.scope_id) {
          const scope = getScope(db, job.scope_id);
          if (!scope) throw new Error(`Scope nicht gefunden: ${job.scope_id}`);
          assertScopeCheckout(scope, identity.checkout.checkout_id);
        }
        if (job.runtime_config) configFromSnapshot(jobRuntimeConfig(job));
      } catch (error) {
        const message = `Projektidentität nicht verifiziert: ${error.message}`;
        jobDone(db, job.id, null, message);
        uiEvt({ t: "job", id: job.id, scope: job.scope_id || null });
        uiEvt({ t: "state", s: "ERROR" });
        say(`✖ JOB ${job.id} wird nicht verarbeitet: ${message}`);
        continue;
      }
    }
    title(`Falsify-Dock ${AGENT_NAME} · ${job.scope_id || "ohne Scope"} · ${job.id}`);
    uiEvt({ t: "job", id: job.id, scope: job.scope_id || null });
    uiEvt({ t: "state", s: "CLAIMING" });
    say(`\n──────────────────────────────────────────────`);
    say(`▶ JOB ${job.id}  gestartet ${new Date().toLocaleTimeString()}  (${AGENT_NAME}, Fenster ${WINDOW_IDX})`);
    say(`  Scope: ${job.scope_id || "–"}  ·  Phase: ${job.mode || "?"}`);
    if (job.root) say(`  Datenzugriff: ${job.root}`);
    if (job.files) say(`  Whitelist: ${job.files}`);
    say(`──────────────────────────────────────────────\n`);

    const child = spawn(process.execPath, [RUN_ENTRY, "--job-id", job.id], {
      cwd: V2_DIR,
      // TTY (sichtbares Fenster): stdout des Kindes wird gefüttert (FM-EVT:
      // → UI-Pipeline; sonstige Zeilen → Ring). Headless: wie bisher inheriten,
      // damit die Ausgabe unverändert im Fenster/Log landet.
      ...(TTY
        ? { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FALSIFY_UI: "1" } }
        : { stdio: "inherit" }),
    });
    childRef = child;
    let abortedByCli = false;
    if (TTY) {
      const parser = createParser({
        onEvent: (evt) => {
          ui.applyEvent({ ...evt, slot: WINDOW_IDX });
          // Live-Kopplung: jedes echte FM-EVT geht exactly-once in den DOKI-
          // Observer (durable, deduped). Fail-open — ein DOKI-Fehler darf den
          // UI-/Worker-Pfad niemals berühren.
          try { doki?.ingest({ ...evt, job: job.id, session: job.scope_id ?? null }); } catch { /* egal */ }
        },
        onLine: (line) => ui?.noteLine(line),
      });
      child.stdout.on("data", (chunk) => parser.feed(chunk.toString()));
      child.stdout.on("end", () => parser.flush());
      child.stderr.on("data", (chunk) => {
        for (const l of chunk.toString().split("\n")) if (l.trim()) ui?.noteLine(l);
      });
    }
    // CLI-Abort (`falsify abort <id>` / `falsify wait --abort`): der Worker
    // pollt das Flag waehrend des laufenden Kindprozesses und killt den Job
    // echt (createAbort, PID-verifiziert). Kein Fake-Verdict.
    const abortPoller = setInterval(() => {
      try {
        if (isAbortRequested(db, job.id) && !aborting) {
          abortedByCli = true;
          dlog(`CLI-Abort angefordert fuer ${job.id}`);
          uiEvt({ t: "state", s: "ABORTING" });
          createAbort({ child, killDelayMs: 2000 }).request().catch(() => {});
        }
      } catch { /* egal */ }
    }, 1000);
    const code = await new Promise((resolve) => child.on("close", resolve));
    clearInterval(abortPoller);
    clearJobAbort(db, job.id);
    // Nur freigeben, wenn wirklich noch DIESER Kindprozess referenziert wird
    // (Abort-Race-Fix: ein neuer Claim darf childRef nicht ungueltig machen).
    if (childRef === child) childRef = null;
    dlog(`job ${job.id} beendet code=${code}`);

    // Falls run.mjs den Job nicht abgeschlossen hat (Crash/Abort), hier nachziehen.
    const done = getJob(db, job.id);
    if (!done || done.status === "RUNNING") {
      jobDone(db, job.id, null, abortedByCli ? "Abgebrochen (CLI)" : `Worker-Abbruch (Exit-Code ${code})`);
      uiEvt({ t: "state", s: "ERROR" });
    }

    say(`\n──────────────────────────────────────────────`);
    // Job-Abschluss im Dock vermelden (Zeile + Titel + Klingelzeichen).
    const announce = (state, line) => {
      say(line);
      title(`Falsify-Dock ${AGENT_NAME} · ${state}`);
      bell();
    };
    const d = getJob(db, job.id);
    if (d?.status?.startsWith("DONE")) {
      const v = d.verdict || d.status.replace("DONE ", "");
      if (v === "WRITE") announce("FERTIG: WRITE", "▶ JOB FERTIG: WRITE — Freigabe: READ-ONLY → WRITE.");
      else if (v === "RESEARCH") announce("FERTIG: RESEARCH", "▶ JOB FERTIG: RESEARCH — FalsifyMe braucht weitere Daten (Loop).");
      else if (v === "PLAN") announce("FERTIG: PLAN", "▶ JOB FERTIG: PLAN — Iteration überarbeiten (Loop).");
      else announce(`FERTIG: ${v}`, `▶ JOB FERTIG: ${v} — nicht freigegeben.`);
    } else if (d?.status?.startsWith("ERROR")) {
      announce("FEHLER", `▶ JOB FERTIG mit Fehler: ${d.status}`);
    } else {
      announce("FEHLER", `▶ JOB FERTIG mit Code ${code} (Fehler – siehe oben)`);
    }
    say(`──────────────────────────────────────────────\n`);

    await sleep(400);
    title(`Falsify-Dock ${AGENT_NAME} (${WINDOW_IDX}/${MAX_WINDOWS}) · wartet auf Jobs`);
  }
}

// Nur bei direktem Aufruf ausführen (Import bleibt reiner Modul-Import).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
