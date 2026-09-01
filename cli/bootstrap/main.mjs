// Bootstrap-Modul: Kompositionswurzel (Einstiegspunkt).
// Reihenfolge: installieren -> Instructions schreiben -> Dock starten -> Protokoll.
//
// ROOT-Vertrag (Review-Fehler 2):
//   `packageRoot` = FalsifyMe-Paketverzeichnis -> NUR fuer runInstall()/CORE.
//   `projectRoot` = Zielprojekt (cwd des Bootstrap-Aufrufs) -> fuer die
//   Instruction-Datei (AGENTS.md / FALSIFYME-WORKFLOW.md) und {{ROOT}} in
//   allen Templates.
import path from "node:path";
import { existsSync } from "node:fs";
import { detectAgent } from "./detect.mjs";
import { runInstall, readInstallLocation } from "./install.mjs";
import { writeInstruction } from "./instructions.mjs";
import { startDock } from "./dock.mjs";

export async function runBootstrap({ root, projectRoot, homeDir, dryRun = false, skipDock = false, noDesktop = false, mode = "optional", reichweite = "projekt" } = {}) {
  // 1. Installation (existierendes install.mjs aus dem Paket-Root)
  //    noDesktop:true unterdrueckt Desktop-Icons (Agent-/Headless-Kontext);
  //    Default (false) = volle Installation inkl. Icons, wie node install.mjs.
  //    Bereits installiert (install-location.json vorhanden) -> Kopie
  //    ueberspringen: kein zweiter Verteilweg, keine Doppelkopie.
  let install;
  if (!dryRun && existsSync(path.join(homeDir, ".Falsify_Core", "install-location.json"))) {
    console.log("Bereits installiert (install-location.json) - Kopie uebersprungen.");
    install = { ok: true, existing: true, skipped: true };
  } else {
    install = runInstall({ root, dryRun, noDesktop });
    if (!install.ok) return { ok: false, stage: "install", ...install };
  }

  const installLocation = dryRun
    ? { coreDir: path.join(homeDir, ".Falsify_Core"), privateDir: path.join(homeDir, ".Falsify_Private") }
    : readInstallLocation(homeDir);

  // Zielprojekt-Root: explizit oder cwd des Aufrufs (npm-global-Installation:
  // der User ruft `falsify bootstrap` IM Projekt auf -> cwd ist das Projekt).
  const targetRoot = projectRoot || process.cwd();

  // 2. Agent-Detektion
  const agent = detectAgent(process.env, process.platform);
  console.log(`Agent erkannt: ${agent.label}`);
  console.log(`Zielprojekt: ${targetRoot}`);

  // 3. Persistente Instruction-Datei (Enforcement-Teil). Ein Dry-Run darf
  // keinerlei Installation-, Projekt- oder Home-Dateien schreiben.
  const written = dryRun
    ? {
        target: "(dry-run)",
        skillsDir: "(dry-run)",
        falsiflowSkillDir: "(dry-run)",
        skillsInstalled: false,
        merged: false,
        loader: { kind: "(dry-run)", registered: false },
        loaderRegistered: false,
      }
    : await writeInstruction(agent, {
        root: targetRoot,
        homeDir,
        coreDir: installLocation.coreDir,
        mode,
        reichweite,
      });

  // 4. Sichtbares Dock
  const dock = skipDock ? { ok: true, skipped: true } : await startDock({ coreDir: installLocation.coreDir });

  // 5. Workflow-Protokoll
  return {
    ok: true,
    agent,
    projectRoot: targetRoot,
    instruction: written,
    dock,
    install,
  };
}
