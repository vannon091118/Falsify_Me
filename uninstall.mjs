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
//     aus ~/.bashrc / ~/.bash_profile / ~/.profile / PowerShell-Profil
//     entfernen (idempotent): dot-source „FalsifyMe-Agent-Integration“ UND
//     PATH-Einträge von `falsify install` (Marker „Falsify-CLI“)
//   - ~/.Falsify_Private (FALSIFY_HOME: .env-Keys, SQLite-Verlauf, Logs =
//     private Wissensdaten) entfernen — Key-Inhalt wird VORHER nach
//     ~/.Falsify.env.uninstall-backup gesichert, sofern Werte enthalten sind
//     (--keep-env behält FALSIFY_HOME komplett)
//   - Desktop-Icons FalsifyMe*.lnk entfernen
//   - npm-Global-Shims (falsify) entfernen, falls vorhanden
// Safteguards: --dry-run zeigt nur; --keep-env behält FALSIFY_HOME;
// --project-root <dir> entfernt zusätzlich aus dem Zielprojekt:
//   - den markierten FalsifyMe-Block aus AGENTS.md / FALSIFYME-WORKFLOW.md
//     (Bootstrap-Write, Marker FALSIFYME-BOOTSTRAP-BEGIN/END),
//   - den markierten .gitignore-Block („# >>> FalsifyMe (lokal …) <<<“),
//   - den Identitäts-Anker FalsifyME.md (checkout-lokal, nie committen).
// Ohne --project-root wird zusätzlich der cwd-Versuch gemacht (wie gehabt).
// Ziel: „als wäre FalsifyMe nie da gewesen“ – kein Marker, keine PATH-Zeile,
// kein Anker, kein Icon, kein Shim bleibt zurück.
// Idempotent: fehlende Pfade sind kein Fehler.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Test-/CI-Escape-Hatch (nur Tests): FALSIFY_UNINSTALL_HOME verlegt ALLE
// Pfade (Profile, Skills, Core, Private, Desktop) in ein isoliertes
// Verzeichnis – die echte Benutzerumgebung bleibt unberuehrt. Im Produktiv-
// betrieb nie setzen.
const homeOverride = process.env.FALSIFY_UNINSTALL_HOME;
const home = homeOverride || os.homedir();
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
const GITIGNORE_BEGIN = "# >>> FalsifyMe (lokal – nicht committen) <<<";
const GITIGNORE_END = "# <<< FalsifyMe (lokal) <<<";
const ANCHOR_FILE = "FalsifyME.md";

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

// Desktop-Icons des Bootstraps (FalsifyMe.lnk / FalsifyMe-TUI-Test.lnk).
// LUEKENGESCHLOSSEN (E2E-Befund scope1, 2026-09-01): Der Modul-Kopf versprach
// „Desktop-Icons FalsifyMe*.lnk entfernen", main() rief es nie auf – die
// Icons blieben nach der Deinstallation stehen. Der Desktop-Pfad wird wie in
// ui/tui-make-icons.ps1 bestimmt (Windows: USERPROFILE\Desktop, Fallback
// os.homedir()/Desktop). Idempotent, Dry-Run-ehrlich über logAction.
// Desktop-Pfad KONSISTENT mit ui/tui-make-icons.ps1 (E2E-Befund scope1-Runde 5,
// Versuch 4): der Bootstrap erzeugt die Icons ueber
// [Environment]::GetFolderPath("Desktop") – folgt Folder-Redirection
// (OneDrive, GPO). USERPROFILE\Desktop weicht dort ab. Fallback-Kette:
// GetFolderPath -> USERPROFILE\Desktop -> os.homedir()/Desktop.
function desktopPath() {
  // Test-/CI-Hatch: mit FALSIFY_UNINSTALL_HOME wird NIE der echte Desktop
  // angesehen (PowerShell GetFolderPath kennt die Env-Override nicht).
  if (homeOverride) return path.join(home, "Desktop");
  if (process.platform !== "win32") return path.join(home, "Desktop");
  try {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const p = String(r.stdout || "").trim();
    if (p.length > 2 && existsSync(p)) return p;
  } catch { /* egal: Fallback */ }
  return path.join(process.env.USERPROFILE || home, "Desktop");
}

async function removeDesktopIcons() {
  const desktop = desktopPath();
  if (!existsSync(desktop)) return;
  const icons = (await fs.readdir(desktop)).filter((f) => /^FalsifyMe.*\.lnk$/i.test(f));
  for (const f of icons) await removeFile(path.join(desktop, f));
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

// Marker, die FalsifyMe in Shell-/Profil-Dateien hinterlassen kann:
//  - dot-source-Zeilen der Bootstrap-Instructions („FalsifyMe-Agent-Integration“)
//  - PATH-Einträge von `falsify install` („Falsify-CLI“, cli/falsify.sh install)
// Entfernt werden ALLE Zeilen, die einen Marker enthalten (idempotent, ehrlich).
async function removeProfileMarkers() {
  const targets = [
    path.join(home, ".bashrc"),
    path.join(home, ".bash_profile"),
    path.join(home, ".profile"),
    path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
  ];
  const markers = ["FalsifyMe-Agent-Integration", "Falsify-CLI"];
  for (const file of targets) {
    if (!existsSync(file)) continue;
    const lines = (await fs.readFile(file, "utf8")).split("\n");
    const next = lines.filter((l) => !markers.some((m) => l.includes(m)));
    if (next.length === lines.length) continue;
    if (dryRun) { logAction("Marker-Zeilen entfernen", `${file} (${markers.join(" / ")})`); continue; }
    await fs.writeFile(file, next.join("\n"), "utf8");
    logAction("Marker-Zeilen entfernt", file);
  }
}

// Identitäts-Anker FalsifyME.md + markierter .gitignore-Block (UI-126,
// core/identity.mjs ensureAnchorGitIgnored). Beides ist checkout-lokal und
// muss bei der Deinstallation mit verschwinden – „als wäre FalsifyMe nie da“.
function stripGitignoreBlock(text) {
  const b = text.indexOf(GITIGNORE_BEGIN);
  const e = text.indexOf(GITIGNORE_END);
  if (b === -1 || e === -1 || e < b) return { text, changed: false };
  const before = text.slice(0, b).replace(/\s+$/, "");
  const after = text.slice(e + GITIGNORE_END.length).replace(/^\s+/, "");
  let joined = before + (after ? "\n" + after : "");
  if (joined && !joined.endsWith("\n")) joined += "\n"; // Datei-Endung wie vorher
  return { text: joined, changed: true };
}

async function cleanProjectAnchor(dir) {
  if (!dir || !existsSync(dir)) return;
  const anchor = path.join(dir, ANCHOR_FILE);
  if (existsSync(anchor)) await removeFile(anchor);
  const gitignore = path.join(dir, ".gitignore");
  if (!existsSync(gitignore)) return;
  const source = await fs.readFile(gitignore, "utf8");
  const { text, changed } = stripGitignoreBlock(source);
  if (!changed) return;
  if (dryRun) { logAction("FalsifyMe-Block aus .gitignore entfernen", gitignore); return; }
  await fs.writeFile(gitignore, text, "utf8");
  logAction("FalsifyMe-Block aus .gitignore entfernt", gitignore);
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
  if (homeOverride) return; // Test-/CI-Hatch: nie echte globale Shims anfassen
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
  await cleanProjectAnchor(projectRoot);
  await cleanProjectAnchor(process.cwd());
  for (const d of skillDirs) await removeDir(d);
  for (const f of instructionFiles) await removeFile(f);
  await removeProfileMarkers();
  await removeDir(coreDir);
  await removeNpmShims();
  await removeDesktopIcons();
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
    : `Deinstallation abgeschlossen: ${removed} Element(e) entfernt${removed ? "" : " (nichts zu tun)"}. FalsifyMe ist vollständig rückabgewickelt – als wäre es nie da gewesen (Ausnahme: der Key-Backup unter ${envBackup}, falls Keys gesetzt waren).`);
  if (existsSync(envBackup)) console.log(`Hinweis: API-Keys liegen gesichert unter ${envBackup} (nur dort, nicht gelöscht).`);
}

main().catch((e) => { console.error(`uninstall fehlgeschlagen: ${e.message}`); process.exit(1); });