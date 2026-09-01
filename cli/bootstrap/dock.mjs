// Bootstrap-Modul: sichtbares Dock.
// Plattform-ehrlich: sichtbares Dock gibt es nur auf Windows (.cmd/PowerShell).
// Verifikation mit Retry-Poll (UI-064-Muster), kein 2s-Einzelcheck.
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function checkOnce(coreDir) {
  const r = spawnSync(process.execPath, [path.join(coreDir, "ui", "worker.mjs"), "--check"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  return (r.stdout || "").includes("RUNNING");
}

export async function startDock(installLocation, {
  platform = process.platform,
  pollSeconds = 30,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  runPowerShell = defaultPowerShell,
} = {}) {
  const coreDir = installLocation.coreDir;
  const startDockCmd = path.join(coreDir, "ui", "start-dock.cmd");

  if (checkOnce(coreDir)) {
    console.log("Dock laeuft bereits (worker --check: RUNNING)");
    return { ok: true, alreadyRunning: true };
  }

  if (platform !== "win32") {
    // Ehrlich bleiben: die Dock-Mechanik (start-dock.cmd/dock-runner.ps1) ist
    // Windows-only. Auf Linux/macOS gibt es KEIN sichtbares Dock.
    console.log("HINWEIS: Sichtbares Dock ist Windows-only (ui/start-dock.cmd + dock-runner.ps1).");
    console.log(`Auf dieser Plattform (${platform}) startet der Worker ohne sichtbares Fenster:`);
    console.log(`  node ${path.join(coreDir, "ui", "worker.mjs")}`);
    return { ok: false, unsupportedPlatform: true };
  }

  if (!existsSync(startDockCmd)) {
    return { ok: false, error: `start-dock.cmd nicht gefunden: ${startDockCmd}` };
  }

  console.log("Dock wird gestartet (Windows, sichtbares Fenster)...");
  const cmdPath = startDockCmd.replace(/\//g, "\\");
  runPowerShell(cmdPath);

  for (let waited = 0; waited < pollSeconds; waited++) {
    await sleep(1000);
    if (checkOnce(coreDir)) {
      console.log(`Dock gestartet und bestaetigt (Worker RUNNING nach ${waited + 1}s)`);
      return { ok: true, startedAfterSeconds: waited + 1 };
    }
  }
  console.warn(`Dock wurde gestartet, aber Worker nicht innerhalb von ${pollSeconds}s als RUNNING erkannt.`);
  console.warn(`Manuell pruefen: ${startDockCmd}`);
  return { ok: false, error: "Worker nicht als RUNNING erkannt (Timeout)" };
}

function defaultPowerShell(cmdPath) {
  spawnSync("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-Command",
    `Start-Process -WindowStyle Normal -FilePath 'cmd.exe' -ArgumentList '/k','"${cmdPath}"'`,
  ], { stdio: "inherit" });
}
