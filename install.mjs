#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
    if (["node_modules", ".git", ".Falsify_Core", ".Falsify_Private"].includes(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else await fs.copyFile(from, to);
  }
};

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmPath = process.platform === "win32" ? process.env.npm_execpath : null;
const npmEnv = { ...process.env, npm_config_ignore_scripts: undefined, npm_config_allow_scripts: undefined };
await fs.mkdir(coreDir, { recursive: true });
await fs.mkdir(privateDir, { recursive: true });
await fs.mkdir(path.join(privateDir, "logs"), { recursive: true });
await copyTree(root, coreDir);
if (npmPath) execFileSync(process.execPath, [npmPath, "install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: coreDir, stdio: "inherit", env: npmEnv });
else execFileSync(npm, ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: coreDir, stdio: "inherit", env: npmEnv });

await fs.writeFile(path.join(coreDir, "install-location.json"), JSON.stringify({ coreDir, privateDir, installedAt: new Date().toISOString() }, null, 2));
await fs.mkdir(skillsDir, { recursive: true });
await copyTree(path.join(root, "skills"), path.join(skillsDir, "falsifyme"));

if (!noDesktop && process.platform === "win32") {
  const desktop = path.join(home, "Desktop");
  await fs.mkdir(desktop, { recursive: true });
  const cmd = path.join(coreDir, "START-FALSIFYME.cmd");
  await fs.writeFile(cmd, `@echo off\r\ncd /d "%~dp0"\r\ncall cli\\falsify ensure-home\r\n`, "utf8");
  const ps = `$w=New-Object -ComObject WScript.Shell;$l=$w.CreateShortcut('${path.join(desktop, "FalsifyMe.lnk").replaceAll("'", "''")}');$l.TargetPath='${cmd.replaceAll("'", "''")}';$l.WorkingDirectory='${coreDir.replaceAll("'", "''")}';$l.IconLocation='${path.join(coreDir, "falsify.ico").replaceAll("'", "''")},0';$l.Save()`;
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { stdio: "inherit" });
}
console.log(`FalsifyMe installiert: ${coreDir}`);
console.log(`Private Daten: ${privateDir}`);
console.log(`Agent-Skills: ${path.join(skillsDir, "falsifyme")}`);
if (process.platform === "win32") console.log(`Desktop-Icon: ${noDesktop ? "übersprungen" : "FalsifyMe.lnk"}`);
