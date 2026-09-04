#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/doctor.mjs – Runtime-Vertragsprüfung
// -----------------------------------------------------------------------------
// Prüft: Node-Version (engines), Konfiguration (Validierung), API-Key,
// DB-Schema inkl. sub_prompt-Migration. Kein Netzaufruf.
// Exit: 0 = alles ok · 2 = Problem gefunden
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Install-Drift (root cause 2026-09-04) ───────────────────────────────────
// Der Dock-Worker fuehrt die RUNTIME aus ~/.Falsify_Core aus (RUN_ENTRY =
// V2_DIR/cli/run.mjs); Hardening im Repo-Checkout wird erst LIVE, wenn die
// Installation synchron ist. Ohne Guard lief tagelang eine aeltere
// Gate-Logik (PRAISE-False-Positive, fehlender selfReview-Frame, fehlende
// Loop-FM-EVT-Emission) waehrend das Repo bereits gefixt war.
const INSTALL_LOCATION_FILE = path.join(os.homedir(), ".Falsify_Core", "install-location.json");
// Runtime-kritische Dateien: Aenderungen hier aendern das Verdict-/Gate-
// Verhalten des laufenden Workers; Doku/Tests sind bewusst nicht dabei.
const RUNTIME_CRITICAL = [
  "cli/run.mjs", "cli/handoff.mjs", "cli/main.mjs", "cli/jobs.mjs", "cli/scope.mjs", "cli/doctor.mjs", "cli/anchor.mjs",
  "core/prompt.mjs", "core/probes.mjs", "core/twin.mjs", "core/verdict.mjs", "core/agent.mjs",
  "core/selfreview.mjs", "core/project-context.mjs", "core/identity.mjs", "core/evidence.mjs", "core/twin-evidence.mjs",
  "artifacts/jobs.mjs", "artifacts/scopes.mjs", "artifacts/db.mjs", "artifacts/handoff.mjs", "artifacts/loopflow.mjs", "artifacts/loops.mjs",
  "ui/worker.mjs",
];

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/**
 * Reine Funktion: vergleicht die runtime-kritischen Dateien zweier Checkouts
 * (Repo vs. Installations-Core) per Content-Hash. Dateien, die im Repo fehlen
 * (z. B. alte Struktur), werden uebersprungen — nur echte Drift faellt auf.
 * @returns {string[]} relative Pfade mit abweichendem Inhalt
 */
export function installDriftFiles({ repoRoot, installRoot }) {
  const drifted = [];
  for (const rel of RUNTIME_CRITICAL) {
    const a = path.join(repoRoot, rel);
    const b = path.join(installRoot, rel);
    if (!fs.existsSync(a)) continue;
    if (!fs.existsSync(b)) { drifted.push(`${rel} (fehlt in der Installation)`); continue; }
    try {
      if (sha256File(a) !== sha256File(b)) drifted.push(rel);
    } catch { /* unlesbar → nicht als Drift zaehlen (laeuft woanders) */ }
  }
  return drifted;
}

// Marker-Dateien, die eine gültige Agent-Skill-Installation auszeichnen
// (Parität mit instructions.mjs/install.mjs: dieselben drei Varianten).
// Der Instruction-Verweis (~/.agents/skills/falsifyme) ist nur gültig, wenn
// mindestens eine dieser Dateien existiert — sonst ist die Verweis-Kette
// dangling (UI-144: Reparatur statt Warnung).
export const AGENT_SKILL_MARKERS = [
  "agent-skill-falsify.sh",
  "agent-skill-falsify.mjs",
  "agent-skill-falsify.ps1",
];

export function agentSkillsPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".agents", "skills", "falsifyme");
}

/**
 * Read-only: sind die Agent-Skill-Marker installiert? (UI-144-Abgleich)
 * homeDir injizierbar (Tests isolieren; Default echter Nutzer-Home).
 * Liefert { ok, dir, present, missing } — keine Nebeneffekte.
 */
export function checkAgentSkillMarkers(homeDir = os.homedir()) {
  const dir = agentSkillsPath(homeDir);
  const present = AGENT_SKILL_MARKERS.filter((m) => {
    try { return fs.statSync(path.join(dir, m)).isFile(); } catch { return false; }
  });
  // Verweis-Semantik (Parität instructions.mjs/UI-144): EINE der drei
  // Varianten genügt — der Skill ist als sh ODER mjs ODER ps1 nutzbar.
  const missing = AGENT_SKILL_MARKERS.filter((m) => !present.includes(m));
  return { ok: present.length > 0, dir, present, missing };
}

/**
 * Repair: dieselbe EINE Quelle wie der Bootstrap (UI-144) — kopiert die
 * Agent-Skills idempotent aus dem Paket-/Core-Root nach ~/.agents/skills.
 * NUR dieser eine Pfad; doctor repariert nicht parallel daneben.
 */
export async function repairAgentSkillMarkers({ homeDir = os.homedir(), packageRoot = ROOT } = {}) {
  const { ensureAgentSkillsInstalled } = await import("./bootstrap/instructions.mjs");
  return ensureAgentSkillsInstalled({ homeDir, packageRoot });
}

// Konfig-Datei, die den Version-Marker der ausgelieferten Skills traegt
// (Paritaet mit install.mjs/ensureAgentSkillsInstalled: wird mitkopiert).
const SKILL_CONFIG_FILE = "agent-skill-falsify.config.json";

/**
 * Read-only: Version der installierten ~/.agents-Skills (UI-148) aus der
 * mitkopierten agent-skill-falsify.config.json. homeDir injizierbar.
 * Liefert { ok, version, file } bzw. { ok:false, error } - kein Urteil ohne
 * lesbare Versions-Konfig (fail-closed fuer den doctor-Vergleich).
 */
export function agentSkillVersion(homeDir = os.homedir()) {
  const file = path.join(agentSkillsPath(homeDir), SKILL_CONFIG_FILE);
  try {
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof cfg?.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(cfg.version)) {
      return { ok: false, version: null, file, error: "Versionsfeld fehlt oder ist ungueltig" };
    }
    return { ok: true, version: cfg.version, file };
  } catch (error) {
    const reason = error?.code === "ENOENT" ? "Konfig-Datei fehlt" : error?.message || String(error);
    return { ok: false, version: null, file, error: reason };
  }
}

/**
 * Skill-Reparatur (eine Quelle, UI-144/145/148): legt fehlende
 * ~/.agents-Skills an ODER aktualisiert eine veraltete Anlage und weist den
 * Marker-/Versions-Nachweis ehrlich aus. Gemeinsam genutzt von
 * `--repair-skills` (nur Skills) und `--repair-all` (Schritt 1).
 * Liefert { ok, repaired, refreshed } — kein Prozess-Exit hier.
 */
async function runSkillRepair(homeDir) {
  const versionBefore = agentSkillVersion(homeDir);
  const result = await repairAgentSkillMarkers({ homeDir, packageRoot: ROOT });
  const after = checkAgentSkillMarkers(homeDir);
  if (!result.ok) {
    console.error(`FEHLER: Skill-Reparatur fehlgeschlagen: ${result.error}`);
    return { ok: false, error: result.error, result };
  }
  const fmtV = (v) => (v?.ok ? `v${v.version}` : "(Version unbekannt)");
  if (result.repaired && result.refreshed) {
    // UI-148: Marker waren da, aber VERALTET - die Reparatur hat die
    // Anlage ueberschreibend auf die Quell-Version gebracht.
    const versionAfter = agentSkillVersion(homeDir);
    console.log(`Agent-Skills aktualisiert: ${fmtV(versionBefore)} -> ${fmtV(versionAfter)} (veraltete Anlage ersetzt: ${after.dir})`);
  } else if (result.repaired) {
    console.log(`Agent-Skills nachinstalliert: ${after.dir}`);
  } else {
    console.log("Agent-Skills waren bereits installiert und aktuell – nichts zu reparieren.");
  }
  console.log(`Agent-Skill-Marker: ${after.present.join(", ") || "(keine)"}`);
  const verified = result.repaired
    ? "Verifiziert: doctor-Check gegen ~/.agents/skills/falsifyme ist jetzt grün (inkl. Versions-Abgleich)."
    : `Verifiziert: doctor-Check gegen ~/.agents/skills/falsifyme ist grün (Agent-Skill-Version v${versionBefore?.version || "?"} = Runtime).`;
  console.log(verified);
  return { ok: true, repaired: Boolean(result.repaired), refreshed: Boolean(result.refreshed), result };
}

/**
 * Worker-/Queue-Orphan-Reparatur (UI-150, Schritt 2/3 der repair-all-Kette):
 * killt registrierte Orphan-Worker (tote PID ODER abgelaufener Heartbeat)
 * ueber cli/worker-kill.mjs (EIN Kill-Pfad, keine eigene Queue-Schreiblogik)
 * und schliesst danach RUNNING-Waisen fail-closed (reapStaleJobs laeuft
 * immer — idempotent, schliesst auch Waisen abgemeldeter Worker).
 */
async function runWorkerRepair() {
  const { repairStaleWorkers } = await import("./worker-kill.mjs");
  const report = repairStaleWorkers();
  if (!report.registeredTotal) {
    console.log("Keine registrierten Worker – nichts zu stoppen (Queue-Orphan-Reap trotzdem gelaufen).");
  } else if (!report.stopped.length) {
    console.log(`Worker: ${report.registeredTotal} registriert, alle frisch – nichts zu stoppen.`);
  }
  for (const s of report.stopped) {
    console.log(`  ✓ Fenster ${s.idx} · ${s.name} · PID ${s.pid} gestoppt (${s.reason}), Registrierung geräumt.`);
  }
  if (report.killed || report.cleaned) {
    console.log(`Worker-Orphans: ${report.killed} Prozess(e) gestoppt, ${report.cleaned} Registrierung(en) geräumt.`);
  }
  if (report.reaped.length) {
    console.log(`♻ ${report.reaped.length} Waisen-Job(s) fail-closed geschlossen (ERROR Worker-Abbruch (Recovery)): ${report.reaped.join(", ")}`);
  }
  return report;
}

export async function runDoctor(cliArgs = []) {
  const repairAll = cliArgs.includes("--repair-all");
  // `falsify doctor --repair-skills`: ausschliesslich die Skill-Reparatur
  // (eine Verantwortung) — kein kompletter Bootstrap, keine Icons, kein
  // Core-Copy. Danach ehrlicher Nachweis gegen die Marker.
  if (cliArgs.includes("--repair-skills") && !repairAll) {
    const skill = await runSkillRepair(os.homedir());
    if (!skill.ok) process.exitCode = 3;
    return;
  }
  // `falsify doctor --repair-all` (UI-150): JEDE auto-fixbare Reparatur in
  // Abhaengigkeitsreihenfolge — 1. Skills (Datei-Anlage/Versions-Refresh),
  // 2. Worker-Orphans (stale Worker killen), 3. Queue-Orphans (Reap). Danach
  // laeuft der VOLLSTAENDIGE Standard-Pruefkoerper unten als Re-Check: was
  // verbleibt, wird als Problem gezaehlt (Exit 2), sonst Exit 0.
  if (repairAll) {
    console.log("FalsifyMe doctor --repair-all (alle auto-fixbaren Reparaturen in Abhaengigkeitsreihenfolge)\n");
    console.log("Schritt 1/2 – Agent-Skills (fehlt/veraltet -> nachinstallieren/aktualisieren):");
    await runSkillRepair(os.homedir());
    console.log("");
    console.log("Schritt 2/2 – Worker- und Queue-Orphans (stale Worker killen, Waisen fail-closed schliessen):");
    await runWorkerRepair();
    console.log("");
    console.log("──── Re-Check: der vollstaendige doctor-Pruefkoerper laeuft jetzt erneut ────");
    console.log("");
  }

  const problems = [];
  const ok = (m) => console.log(`  ✅ ${m}`);
  const bad = (m) => { problems.push(m); console.log(`  ❌ ${m}`); };

  console.log("FalsifyMe doctor – Runtime-Vertragsprüfung\n");

  // 1) Node-Version (package.json engines)
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const major = Number(process.versions.node.split(".")[0]);
  const needMajor = Number(String(pkg.engines?.node || ">=22").replace(/[^0-9.]/g, "").split(".")[0]);
  if (major >= needMajor) ok(`Node ${process.versions.node} (>= ${needMajor} gefordert)`);
  else bad(`Node ${process.versions.node} zu alt (>= ${needMajor} gefordert)`);
  // Selbst-Kenntnis (User-Test 2026-09-03): das Werkzeug nennt seine Version —
  // `falsify --version` und doctor zeigen dieselbe Quelle (package.json).
  ok(`FalsifyMe v${pkg.version}`);
  // Produktkern bleibt dependency-frei; die Terminal-UI braucht bewusst
  // ink + react (Doku: package.json). Alles andere ist unerwartet.
  const DOC_DEPS = { ink: "^7.1.1", react: "^19.2.8" };
  const unexpected = Object.keys(pkg.dependencies || {}).filter((k) => !(k in DOC_DEPS));
  if (unexpected.length) {
    bad(`unerwartete Dependencies in package.json: ${unexpected.join(", ")}`);
  } else {
    // ink/react muessen tatsaechlich aufloesbar sein (TUI startet sonst nicht).
    const missing = ["ink", "react"].filter((m) => {
      try { import.meta.resolve(m); return false; } catch { return true; }
    });
    if (missing.length) bad(`TUI-Dependencies fehlen in node_modules: ${missing.join(", ")} (npm install ausfuehren)`);
    else ok("Dependencies ok (ink + react fuer Terminal-UI; Produktkern bleibt dependency-frei)");
  }

  // 2) Konfiguration (Validierung – wirft bei ungültigen Werten)
  try {
    const { loadConfig } = await import("../core/config.mjs");
    const cfg = loadConfig();
    ok(`Config: ${cfg.provider} · ${cfg.model} · maxRpm ${cfg.maxRpm} · timeout ${cfg.timeoutMs} ms`);
    // Twin-Diversität (Pkt 3/10): Sichtbar machen, ob die Gegenprüfung
    // modellfremd läuft — sonst ist der gemeinsame Blindspot eine Grenze.
    if (cfg.twinDiversity) {
      ok(`Twin-Diversität: Gegenprüfung mit eigenem Modell (${cfg.twinModel} @ ${cfg.twinApiBase}, effort ${cfg.twinReasoningEffort}, maxTokens ${cfg.twinMaxTokens})`);
    } else {
      bad("Twin-Diversität: Gegenprüfung läuft mit dem PRIMÄRMODELL (FALSIFY_TWIN_MODEL/FALSIFY_TWIN_API_BASE nicht gesetzt) – geteilter Modell-Bias möglich (BESTAETIGT ist dann Fallprüfung, keine unabhängige Wahrheit)");
    }
  } catch (e) {
    bad(`Config: ${e.message}`);
  }

  // 3) API-Key (inkl. Herkunft — User-Ticket 2026-09-03: ein geerbter
  // Prozess-Env-Key lief Job-los durch und brach erst mit HTTP 403 im Lauf;
  // doctor muss DIESE Falle sichtbar machen, nicht nur „Key da/nicht da“).
  try {
    const { loadApiKey, keyEnvFile, keyNames } = await import("../core/keys.mjs");
    const key = loadApiKey();
    if (key) {
      let fromFile = false;
      try {
        const envContent = fs.readFileSync(keyEnvFile(), "utf8");
        fromFile = keyNames().some((n) => envContent.split(/\r?\n/).some((l) => l.startsWith(`${n}=`) && l.slice(n.length + 1).trim()));
      } catch { /* .env fehlt/unlesbar → Key kann nur aus der Prozess-Env kommen */ }
      const envName = fromFile ? null : keyNames().find((n) => process.env[n]?.trim());
      if (fromFile) ok(`API-Key gefunden (${keyEnvFile()})`);
      else if (envName) bad(`API-Key kommt aus der PROZESS-UMGEBUNG (geerbtes ${envName}), NICHT aus ${keyEnvFile()} — riskant: unsichtbar für andere Shells, kollidiert mit der .env-Verwaltung. Fix: Key in ${keyEnvFile()} eintragen und die Umgebungsvariable entfernen.`);
      else ok(`API-Key gefunden (${keyEnvFile()})`);
    } else {
      bad(`Kein API-Key (${keyEnvFile()})`);
    }
  } catch (e) {
    bad(`Key-Check fehlgeschlagen: ${e.message}`);
  }

  // 4) DB-Schema inkl. Migration
  try {
    const { openDb, closeDb } = await import("../artifacts/db.mjs");
    const db = openDb();
    const cols = db.prepare("PRAGMA table_info(scopes)").all().map((c) => c.name);
    if (cols.includes("sub_prompt")) ok("DB-Schema: scopes.sub_prompt vorhanden");
    else bad("DB-Schema: scopes.sub_prompt fehlt (Migration)");
    const jm = db.prepare("PRAGMA journal_mode").get();
    if (String(jm.journal_mode).toLowerCase() === "wal") ok("DB: WAL-Modus aktiv");
    else bad(`DB: journal_mode=${jm.journal_mode} (WAL erwartet)`);

    // 5) Zustandsmodell-Konsistenz (Regel 3 – keine zweite Wahrheit):
    // Prüft abgeleitete Zustände gegen ihre Quelldaten (hardened/conflicts,
    // last_gap/Befund, Orphan-RUNNING, jobs- vs. findings-Verdict, Waisen).
    const { checkQueueConsistency } = await import("../artifacts/invariants.mjs");
    const q = checkQueueConsistency(db);
    if (q.ok) ok("Zustandsmodell: konsistent (hardened/GAP/Verdict/Worker – eine Wahrheit)");
    else for (const v of q.violations) bad(`Zustandsmodell: ${v}`);

    // 6) Worker-Liveness (User-Test 2026-09-03): Jobs QUEUED ohne lebendes
    // Worker-Fenster ist DER Onboarding-Moment, in dem neue Nutzer
    // orientierungslos warten. Hartes Problem nur, wenn wirklich Jobs warten;
    // sonst ehrlicher Hinweis (frische Installation hat bewusst kein Fenster).
    const { listJobs } = await import("../artifacts/jobs.mjs");
    const { workerSnapshot } = await import("./workerliveness.mjs");
    const snap = workerSnapshot(db);
    const queued = listJobs(db, { status: "QUEUED" });
    if (snap.fresh.length) {
      ok(`Worker: ${snap.fresh.length} aktiv (${snap.fresh.map((w) => `${w.name || `Agent ${w.idx}`} · Fenster ${w.idx} · pid ${w.pid}`).join(" · ")}) – Hintergrund- oder Dock-Fenster zählen gleichermaßen (eine Registrierung, ein Heartbeat).`);
    } else if (snap.stale.length) {
      bad(`Worker registriert, aber Herzschlag abgelaufen (${snap.stale.map((w) => `${w.name || `Agent ${w.idx}`}, Fenster ${w.idx}`).join(", ")}) – Prozess tot oder gekillt. Orphan räumen: falsify worker kill --dry-run · Neu starten: falsify worker start 1 · Windows sichtbar: Desktop-Icon "FalsifyMe" oder ui\\start-dock.cmd 1`);
    } else if (queued.length) {      bad(`Kein Worker aktiv, aber ${queued.length} Job(s) QUEUED – sie bleiben hängen, bis ein Worker startet. Sofort starten (Hintergrund): falsify worker start 1 · Windows sichtbar: Desktop-Icon "FalsifyMe" oder ui\\start-dock.cmd 1`);
    } else {
      console.log("  ℹ️  Kein Worker aktiv (Queue leer – ein Worker wird erst beim ersten Job gebraucht. Start: falsify worker start 1 · Windows sichtbar: ui\\start-dock.cmd 1)");
    }
    closeDb();
  } catch (e) {
    bad(`DB: ${e.message}`);
  }

  // 7) Agent-Skills (~/.agents/skills/falsifyme – UI-144): die Instruction-
  // Pfade, auf die Bootstrap/Onboarding verweisen, sind nur gültig, wenn die
  // Marker-Dateien wirklich installiert sind. Fehlt die Anlage, nennt doctor
  // die EINE Reparatur-Kommandozeile (kein dangling Verweis, kein stilles
  // Ok). UI-148: vorhanden ist nicht aktuell — die installierte Skill-Version
  // wird gegen die Runtime (package.json des laufenden doctor = installierter
  // Core) verglichen; ältere ~/.agents-Skills hinter einem neueren Core sind
  // ein Drift und werden als Problem mit Reparatur-Kommando gemeldet.
  // Zusätzlich: der Startup-Skill-Check (den main.mjs für doctor überspringt)
  // wird hier sichtbar gemacht — doctor bleibt der Diagnose- und
  // Reparaturpfad, andere Befehle fail-closed.
  {
    const markers = checkAgentSkillMarkers(os.homedir());
    if (markers.ok) {
      ok(`Agent-Skills installiert (${markers.dir})`);
    } else {
      bad(`Agent-Skills fehlen unter ${markers.dir} – die Instruction verweist auf Pfade, die nicht existieren. Reparatur (eine Quelle, idempotent): falsify doctor --repair-skills`);
    }
    if (markers.ok) {
      const { compareVersions } = await import("../core/skill-version.mjs");
      const runtimeVersion = pkg.version;
      const skillVersion = agentSkillVersion(os.homedir());
      if (!skillVersion.ok) {
        bad(`Agent-Skill-Version nicht lesbar (${skillVersion.file}): ${skillVersion.error} – Reparatur (kopiert die Versions-Konfig mit): falsify doctor --repair-skills`);
      } else {
        const cmp = compareVersions(skillVersion.version, runtimeVersion);
        if (cmp === 0) {
          ok(`Agent-Skill-Version v${skillVersion.version} = Runtime v${runtimeVersion}`);
        } else if (cmp < 0) {
          bad(`Agent-Skills v${skillVersion.version} sind ÄLTER als der installierte Core v${runtimeVersion} – die referenzierten Skills koennen hinter der Runtime-Logik zurueckliegen. Aktualisierung (eine Quelle, ueberschreibt veraltete Anlage): falsify doctor --repair-skills`);
        } else {
          bad(`Agent-Skills v${skillVersion.version} sind NEUER als der laufende Core v${runtimeVersion} – den Core aktualisieren (Re-Install / node install.mjs), bevor diese Skills genutzt werden.`);
        }
      }
    }
    try {
      const { verifySkillsAtStartup, formatSkillCheck } = await import("../core/skill-version.mjs");
      const runtime = verifySkillsAtStartup({ runtimeRoot: ROOT });
      if (runtime.ok) ok(`Skill-Integrität (Runtime): ${formatSkillCheck(runtime)}`);
      else bad(`Skill-Integrität (Runtime): ${formatSkillCheck(runtime)}`);
    } catch (e) {
      bad(`Skill-Integrität (Runtime): ${e.message}`);
    }
  }

  // 8) Install-Drift (root cause 2026-09-04): laeuft doctor aus einem
  // FalsifyMe-REPO-Checkout (ROOT != Installations-Core), werden die
  // runtime-kritischen Dateien gegen den Dock-Core verglichen. Drift = der
  // laufende Worker hat eine aeltere Gate-Logik als das Repo — genau die
  // Situation, die die Session blockierte. Aus dem installierten Core heraus
  // (Normalbetrieb) ist nichts zu vergleichen → ehrlicher Hinweis.
  try {
    const installRoot = JSON.parse(fs.readFileSync(INSTALL_LOCATION_FILE, "utf8")).coreDir;
    if (installRoot && path.resolve(installRoot) !== path.resolve(ROOT)) {
      const drift = installDriftFiles({ repoRoot: ROOT, installRoot });
      if (drift.length) {
        bad(`Install-Drift: ${drift.length} runtime-kritische Datei(en) im Dock-Core (${installRoot}) weichen vom Repo ab (${drift.slice(0, 4).join(", ")}${drift.length > 4 ? ", …" : ""}) – der Worker führt eine ältere Gate-Logik. Abgleich: node install.mjs (aus dem Repo) ODER gezielt: cp <repo>/<datei> ${installRoot}/<datei>`);
      } else {
        ok(`Install-Synchronität: Repo == ${installRoot} (${RUNTIME_CRITICAL.length} runtime-kritische Dateien identisch)`);
      }
    } else {
      console.log("  ℹ️  Install-Drift: doctor läuft im installierten Core selbst – kein separates Repo zu vergleichen.");
    }
  } catch (e) {
    console.log(`  ℹ️  Install-Drift: keine install-location.json / kein Core gefunden (${e.message}) – übersprungen.`);
  }

  console.log("");
  if (problems.length) {
    console.log(`doctor: ${problems.length} Problem(e) gefunden`);
    console.log("  Hilfe: falsify onboard (interaktiver Dialog fuer Endpunkt/Modell/Key) – oder die genannten Fixes oben umsetzen.");
    process.exitCode = 2;
  } else {
    console.log("doctor: alles ok");
    console.log("  Naechster Schritt: falsify start \"<dein Auftrag 1:1>\" – Ticket binden, dann");
    console.log("  falsify submit --header \"<dein Auftrag 1:1>\" --plan-file plan.txt --root <projekt> --files \"a,b\"");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDoctor();
}
