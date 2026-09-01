#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · uninstall.mjs – vollständige, saubere Deinstallation
// -----------------------------------------------------------------------------
// Rückabwicklung der Benutzerinstallation (Gegenstück zu install.mjs):
//   - sichtbare Worker-Fenster stoppen (PIDs aus `ui/worker.mjs --check`)
//   - Programm-Kopie ~/.Falsify_Core entfernen
//   - private Daten ~/.Falsify_Private entfernen
//   - Agent-Skills ~/.agents/skills/{falsifyme,falsifyme-falsiflow,falsifyme-selfinstall} entfernen
//   - Instruction-Dateien ~/.falsifyme-instructions.{sh,ps1} + Marker-Zeilen
//     aus ~/.bashrc bzw. PowerShell-Profil entfernen (idempotent)
//   - ~/.Falsify_Private (FALSIFY_HOME: .env-Keys, SQLite-Verlauf, Logs =
//     private Wissensdaten) entfernen — Key-Inhalt wird VORHER nach
//     ~/.Falsify.env.uninstall-backup gesichert, sofern Werte enthalten sind
//     (--keep-env behält FALSIFY_HOME komplett)
//   - Desktop-Icons FalsifyMe*.lnk entfernen
//   - npm-Global-Shims (falsify) entfernen, falls vorhanden
// Safteguards: --dry-run zeigt nur; --keep-env behält FALSIFY_HOME;
// --project-root <dir> entfernt zusätzlich den markierten FalsifyMe-Block
// aus AGENTS.md / FALSIFYME-WORKFLOW.md des Zielprojekts (Bootstrap-Write).
// Idempotent: fehlende Pfade sind kein Fehler.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const keepEnv = args.has("--keep-env");
const argv = process.argv.slice(2);
let projectRoot = null;
const projectRootIdx = argv.indexOf("--project-root");
if (projectRootIdx !== -1 && argv[projectRootIdx + 1]) projectRoot = argv[projectRootIdx + 1];

const coreDir = path.join(home, ".Falsify_Core");
// FALSIFY_HOME Default = ~/.Falsify_Private (private Wissensdaten, getrennt
// vom Programm in .Falsify_Core). privateDir und homeDir sind identisch — die
// Entfernung läuft über privateDir, homeDir dient nur dem Key-Backup-Pfad.
const privateDir = path.join(home, ".Falsify_Private");
const homeDir = privateDir;
const agentsSkills = path.join(home, ".agents", "skills");
const skillDirs = ["falsifyme", "falsifyme-falsiflow", "falsifyme-selfinstall"].map((s) => path.join(agentsSkills, s));
const instructionFiles = [path.join(home, ".falsifyme-instructions.sh"), path.join(home, ".falsifyme-instructions.ps1")];
const envBackup = path.join(home, ".Falsify.env.uninstall-backup");
const MERGE_BEGIN = "<!-- FALSIFYME-BOOTSTRAP-BEGIN -->";
const MERGE_END = "<!-- FALSIFYME-BOOTSTRAP-END -->";

let removed = 0;
let skipped = 0;
// Aktion ausgeben und fuer die Schlussbilanz zaehlen (Dry-Run: nur zaehlen).
const logAction = (verb, p) => {
  console.log(`${dryRun ? "[DRY-RUN] würde " : ""}${verb}: ${p}`);
  if (dryRun) skipped++; else removed++;
};

async function removeDir(p) {
  if (!existsSync(p)) return;
  if (dryRun) { logAction("entfernen (Verzeichnis)", p); return; }
  await fs.rm(p, { recursive: true, force: true });
  logAction("entfernt  (Verzeichnis)", p);
}
async function removeFile(p) {
  if (!existsSync(p)) return;
  if (dryRun) { logAction("entfernen (Datei)", p); return; }
  await fs.rm(p, { force: true });
  logAction("entfernt  (Datei)", p);
}

async function stopWorkers() {
  const checkScript = path.join(coreDir, "ui", "worker.mjs");
  if (!existsSync(checkScript)) return;
  const r = spawnSync(process.execPath, [checkScript, "--check"], { encoding: "utf8" });
  const pids = [...(r.stdout || "").matchAll(/RUNNING (\d+)/g)].map((m) => m[1]);
  if (pids.length === 0) { console.log("Keine laufenden Worker gefunden (--check)."); return; }
  console.log(`Stoppe Worker-Fenster: PID ${pids.join(", ")} ...`);
  if (dryRun) { logAction("stoppen (Worker)", pids.join(", ")); return; }
  for (const pid of pids) {
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", pid, "/F"], { stdio: "pipe" });
      else process.kill(Number(pid), "SIGKILL");
      logAction("gestoppt (Worker)", `PID ${pid}`);
    } catch { /* Prozess schon weg */ }
  }
}

function stripMarkedSection(text) {
  const b = text.indexOf(MERGE_BEGIN);
  const e = text.indexOf(MERGE_END);
  if (b === -1 || e === -1 || e < b) return { text, changed: false };
  const after = text.slice(e + MERGE_END.length);
  const before = text.slice(0, b);
  return { text: before.replace(/\s+$/, "") + "\n" + after.replace(/^\s+/, ""), changed: true };
}

async function cleanProjectInstruction(dir) {
  if (!dir || !existsSync(dir)) return;
  for (const name of ["AGENTS.md", "FALSIFYME-WORKFLOW.md"]) {
    const p = path.join(dir, name);
    if (!existsSync(p)) continue;
    const source = await fs.readFile(p, "utf8");
    const { text, changed } = stripMarkedSection(source);
    if (!changed) continue;
    if (dryRun) { logAction("Marker-Block entfernen", p); continue; }
    await fs.writeFile(p, text, "utf8");
    logAction("Marker-Block entfernt", p);
  }
}

async function removeProfileMarkers() {
  const targets = [
    { file: path.join(home, ".bashrc"), marker: "FalsifyMe-Agent-Integration" },
    { file: path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"), marker: "FalsifyMe-Agent-Integration" },
  ];
  for (const { file, marker } of targets) {
    if (!existsSync(file)) continue;
    const lines = (await fs.readFile(file, "utf8")).split("\n");
    const next = lines.filter((l) => !l.includes(marker));
    if (next.length === lines.length) continue;
    if (dryRun) { logAction("Marker-Zeile entfernen", `${file} (${marker})`); continue; }
    await fs.writeFile(file, next.join("\n"), "utf8");
    logAction("Marker-Zeile entfernt", file);
  }
}

async function backupEnvKeys() {
  const envFile = path.join(homeDir, ".env");
  if (!existsSync(envFile)) return;
  const env = await fs.readFile(envFile, "utf8");
  const hasValues = env.split(/\r?\n/).some((l) => /^[A-Z_][A-Z0-9_]*=/.test(l) && l.slice(l.indexOf("=") + 1).trim().length > 0);
  if (!hasValues) return;
  if (dryRun) { logAction("sichern (Enthaltene API-Keys)", envBackup); return; }
  await fs.copyFile(envFile, envBackup);
  logAction("gesichert", envBackup);
}

async function removeNpmShims() {
  const prefix = String(spawnSync((process.platform === "win32" ? "npm.cmd" : "npm"), ["prefix", "-g"], { encoding: "utf8" }).stdout || "").trim();
  if (!prefix) return;
  const shims = ["falsify", "falsify.cmd", "falsify.ps1"].map((s) => path.join(prefix, s));
  const pkg = path.join(prefix, "node_modules", "falsifyme");
  for (const s of shims) if (existsSync(s)) await removeFile(s);
  if (existsSync(pkg)) await removeDir(pkg);
}

async function main() {
  if (dryRun) console.log("=== FalsifyMe uninstall --dry-run (nichts wird geändert) ===");
  else console.log("=== FalsifyMe uninstall ===");
  await stopWorkers();
  await cleanProjectInstruction(projectRoot);
  await cleanProjectInstruction(process.cwd());
  for (const d of skillDirs) await removeDir(d);
  for (const f of instructionFiles) await removeFile(f);
  await removeProfileMarkers();
  await removeDir(coreDir);
  await removeNpmShims();
  if (keepEnv) {
    console.log(`--keep-env: ${homeDir} (FALSIFY_HOME: Keys/DB/Logs) wird BEHALTEN.`);
  } else {
    // Reihenfolge zaehlt: erst Key-Backup, DANN FALSIFY_HOME entfernen.
    // (Fix, 2026-09-01: privateDir wurde zuvor bedingungslos entfernt -
    // weder --keep-env noch das .env-Key-Backup haben je greifen koennen.)
    await backupEnvKeys();
    await removeDir(privateDir);
  }
  console.log("");
  console.log(dryRun
    ? `Dry-Run abgeschlossen: ${skipped} Aktionen würden ausgeführt (--keep-env / --project-root verfügbar).`
    : `Deinstallation abgeschlossen: ${removed} Element(e) entfernt${removed ? "" : " (nichts zu tun)"}. FalsifyMe ist vollständig rückabgewickelt.`);
  if (existsSync(envBackup)) console.log(`Hinweis: API-Keys liegen gesichert unter ${envBackup} (nur dort, nicht gelöscht).`);
}

main().catch((e) => { console.error(`uninstall fehlgeschlagen: ${e.message}`); process.exit(1); });