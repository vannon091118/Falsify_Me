#!/usr/bin/env node
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildSkillManifest,
  readSkillManifest,
  skillManifestPath,
  validateSkillVersionTransition,
  writeSkillManifest,
} from "./core/skill-version.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();
const coreDir = path.join(home, ".Falsify_Core");
const privateDir = path.join(home, ".Falsify_Private");
const agentsDir = path.join(home, ".agents");
const skillsDir = path.join(agentsDir, "skills");
const args = new Set(process.argv.slice(2));
const noDesktop = args.has("--no-desktop");

const copyTree = async (src, dst) => {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (["node_modules", ".git", ".Falsify_Core", ".Falsify_Private", "falsifyme-falsiflow.md"].includes(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else await fs.copyFile(from, to);
  }
};

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// npm robust starten: Bevorzugt npm-cli.js üBER node (umgeht .cmd-Spawn-
// Probleme auf Windows, z.B. spawnSync("npm.cmd") -> EINVAL in manchen
// Agent-/CI-Sessions). Der Fallback läuft über den normalen npm-Aufruf.
const npmCliCandidates = [
  process.env.npm_execpath, // gesetzt bei "npm run install:user"
  process.platform === "win32"
    ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    : null,
];
const npmCli = npmCliCandidates.find((c) => c && existsSync(c));
// Keys aus der env KORREKT entfernen (sie auf undefined zu setzen, wirft auf
// Windows EINVAL beim Spawn eines Kindprozesses).
const npmEnv = { ...process.env };
delete npmEnv.npm_config_ignore_scripts;
delete npmEnv.npm_config_allow_scripts;
const runNpm = (args) => {
  const opts = { cwd: coreDir, stdio: "inherit", env: npmEnv };
  if (npmCli) execFileSync(process.execPath, [npmCli, ...args], opts);
  else execFileSync(npm, args, opts);
};
const nextSkillManifest = buildSkillManifest({ sourceRoot: root });
const previousManifestFile = skillManifestPath(coreDir);
if (existsSync(previousManifestFile)) {
  const previousSkillManifest = readSkillManifest(previousManifestFile);
  const transition = validateSkillVersionTransition({
    previousManifest: previousSkillManifest,
    nextManifest: nextSkillManifest,
  });
  if (!transition.ok) throw new Error(`Installation abgebrochen: ${transition.reason}`);
}

await fs.mkdir(coreDir, { recursive: true });
await fs.mkdir(privateDir, { recursive: true });
await fs.mkdir(path.join(privateDir, "logs"), { recursive: true });
await copyTree(root, coreDir);
runNpm(["install", "--omit=dev", "--no-audit", "--no-fund"]);

await writeSkillManifest({ sourceRoot: root, coreDir, packageVersion: nextSkillManifest.packageVersion });
await fs.writeFile(path.join(coreDir, "install-location.json"), JSON.stringify({
  coreDir,
  privateDir,
  skillsDir,
  packageVersion: nextSkillManifest.packageVersion,
  installedAt: new Date().toISOString(),
}, null, 2));
await fs.mkdir(skillsDir, { recursive: true });
await copyTree(path.join(root, "skills"), path.join(skillsDir, "falsifyme"));
// FalsiFlow-Session-Skill: eigener Skill-Ordner mit SKILL.md, damit
// /falsifyme-falsiflow direkt nach der Installation funktioniert. Der
// Session-Workflow nutzt NUR aufgeloeste Pfade (~/.Falsify_Core, siehe
// skills/falsifyme-falsiflow.md) – keine hartkodierten Benutzerpfade.
const falsiflowSkillDir = path.join(skillsDir, "falsifyme-falsiflow");
await fs.mkdir(falsiflowSkillDir, { recursive: true });
await fs.copyFile(path.join(root, "skills", "falsifyme-falsiflow.md"), path.join(falsiflowSkillDir, "SKILL.md"));
// Self-Install-Skill: weist den Coding-Agenten an, sich selbst den
// ausfuehrbaren FalsifyMe-Skill nach ~/.agents/skills/ einzurichten.
const selfinstallSkillDir = path.join(skillsDir, "falsifyme-selfinstall");
await fs.mkdir(selfinstallSkillDir, { recursive: true });
await fs.copyFile(path.join(root, "skills", "falsifyme-selfinstall.md"), path.join(selfinstallSkillDir, "SKILL.md"));

if (!noDesktop && process.platform === "win32") {
  const desktop = path.join(home, "Desktop");
  await fs.mkdir(desktop, { recursive: true });
  const cmd = path.join(coreDir, "START-FALSIFYME.cmd");
  // ASCII-only + CRLF: cmd.exe vertraegt keine UTF-8-Umlaute und moechte CRLF.
  // Kein bash-Shim (cli\falsify ist ein Bash-Skript!) - direkt node aufrufen.
  const launcher = [
    "@echo off",
    "rem ---------------------------------------------",
    "rem  FALSIFYME - Desktop-Start (FalsifyMe.lnk)",
    "rem  Prueft Node.js, initialisiert FALSIFY_HOME und",
    "rem  startet den Worker-DOCK (echte Jobs aus der SQLite-Queue,",
    "rem  live visualisiert in der Terminal-UI). KEIN Demo-Modus.",
    "rem  Bei Fehlern bleibt dieses Fenster OFFEN (kein Blinken).",
    "rem ---------------------------------------------",
    "setlocal",
    "cd /d \"%~dp0\"",
    "",
    "where node >nul 2>nul",
    "if errorlevel 1 goto :no-node",
    "",
    "rem Node.js >= 22.5 (package.json engines) - sonst klare Meldung statt Blink",
    "node -e \"const m=/^v?(\\d+)\\.(\\d+)/.exec(process.version);if(!m||+m[1]<22||(+m[1]===22&&+m[2]<5))process.exit(1)\"",
    "if errorlevel 1 goto :old-node",
    "",
    "node cli\\main.mjs ensure-home",
    "if errorlevel 1 goto :fail",
    "",
    "echo Starte FalsifyMe-Dock (Fenster 1) ...",
    "start \"FalsifyMe-Dock\" ui\\start-dock.cmd 1",
    "exit /b 0",
    "",
    ":no-node",
    "echo.",
    "echo  FEHLER: Node.js wurde nicht gefunden.",
    "echo  Bitte Node.js >= 22.5 installieren, z.B. https://nodejs.org",
    "goto :fail",
    "",
    ":old-node",
    "echo.",
    "echo  FEHLER: Node.js ist zu alt fuer FalsifyMe (mindestens 22.5 noetig).",
    "for /f \"delims=\" %%v in ('node --version 2^>nul') do echo  Installiert: %%v",
    "echo  Bitte Node.js aktualisieren: https://nodejs.org",
    "goto :fail",
    "",
    ":fail",
    "echo.",
    "echo  FEHLER - siehe Meldung oben. Fenster bleibt offen.",
    "pause",
    "exit /b 1",
    "",
  ].join("\r\n");
  await fs.writeFile(cmd, launcher, "utf8");
  const icon = path.join(coreDir, "falsify.ico");
  const makeShortcut = (name, targetPath) => {
    const ps = `$w=New-Object -ComObject WScript.Shell;$l=$w.CreateShortcut('${path.join(desktop, name).replaceAll("'", "''")}');$l.TargetPath='${targetPath.replaceAll("'", "''")}';$l.WorkingDirectory='${coreDir.replaceAll("'", "''")}';$l.IconLocation='${icon.replaceAll("'", "''")},0';$l.Save()`;
    execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { stdio: "inherit" });
  };
  // README-Dokumentierte Icons: Start (TUI) + Test (kompletter Verifikationslauf).
  makeShortcut("FalsifyMe.lnk", cmd);
  makeShortcut("FalsifyMe-TUI-Test.lnk", path.join(coreDir, "ui", "TEST-TUI.cmd"));
}
console.log(`FalsifyMe installiert: ${coreDir}`);
console.log(`Private Daten: ${privateDir}`);
console.log(`Agent-Skills: ${path.join(skillsDir, "falsifyme")}`);
console.log(`FalsiFlow-Skill: ${falsiflowSkillDir}`);
console.log(`Self-Install-Skill: ${selfinstallSkillDir}`);
if (process.platform === "win32") console.log(`Desktop-Icons: ${noDesktop ? "übersprungen" : "FalsifyMe.lnk + FalsifyMe-TUI-Test.lnk"}`);
