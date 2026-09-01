// Bootstrap-Modul: Installation (ruft das EXISTIERENDE install.mjs im
// Paket-Root auf — keine zweite Runtime, keine Duplizierung).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const bootstrapDir = path.dirname(fileURLToPath(import.meta.url));
// cli/bootstrap/ -> cli/ -> Paket-Root (dort liegt install.mjs)
export const packageRoot = path.resolve(bootstrapDir, "..", "..");

// Installationspfad aus install-location.json lesen (wird von install.mjs
// geschrieben). Liefert { coreDir, privateDir, installedAt }.
export function readInstallLocation(homeDir) {
  const coreDir = path.join(homeDir, ".Falsify_Core");
  const locationPath = path.join(coreDir, "install-location.json");
  if (!existsSync(locationPath)) {
    throw new Error(`install-location.json nicht gefunden: ${locationPath}`);
  }
  return JSON.parse(readFileSync(locationPath, "utf8"));
}

export function installArgs(noDesktop = false, root = packageRoot) {
  // Explizit entscheidbar, kein stilles Sonderverhalten (Root-Cause-Fix,
  // 2026-09-01): Default = volle Installation inkl. Desktop-Icons, wie bei
  // `node install.mjs` direkt. noDesktop:true nur fuer Agent-/Headless-
  // Kontexte (analog install.mjs --no-desktop). root = das Verzeichnis, in
  // dem runInstall install.mjs validiert hat (Fix: vorher hart packageRoot).
  const args = [path.join(root, "install.mjs")];
  if (noDesktop) args.push("--no-desktop");
  return args;
}

export function runInstall({ root = packageRoot, dryRun = false, noDesktop = false } = {}) {
  const installScript = path.join(root, "install.mjs");
  if (!existsSync(installScript)) {
    return { ok: false, error: `install.mjs nicht gefunden: ${installScript}` };
  }
  if (dryRun) return { ok: true, dryRun: true, installScript };

  const result = spawnSync(process.execPath, installArgs(noDesktop, root), {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    return { ok: false, error: `Installation fehlgeschlagen (Exit ${result.status})` };
  }
  return { ok: true, installScript };
}
