// Bootstrap-Modul: Kompositionswurzel (Einstiegspunkt).
// Reihenfolge: installieren -> PREFLIGHT (Skills + Anchor + Key VOR jeder
// Instruction) -> Instructions schreiben -> Dock starten -> Protokoll.
//
// ROOT-Vertrag (Review-Fehler 2):
//   `packageRoot` = FalsifyMe-Paketverzeichnis -> NUR fuer runInstall()/CORE.
//   `projectRoot` = Zielprojekt (cwd des Bootstrap-Aufrufs) -> fuer die
//   Instruction-Datei (AGENTS.md / FALSIFYME-WORKFLOW.md) und {{ROOT}} in
//   allen Templates.
//
// UI-147 (Preflight): die „dangling-warnings-Klasse“ wird strukturell
// unmöglich — KEINE Instruction wird geschrieben, deren referenzierte Pfade
// (Agent-Skills, Projekt-Anker) oder deren Laufzeit-Vorbedingung (API-Key)
// nicht VORHER repariert/geprüft sind. Früher reparierte writeInstruction
// die Skills ERST beim Schreiben (Warnung, wenn die Quelle fehlte), und der
// API-Key wurde NACH Instruction+Dock geprüft. Jetzt: erst reparieren,
// dann schreiben.
import path from "node:path";
import { existsSync } from "node:fs";
import { detectAgent } from "./detect.mjs";
import { runInstall, readInstallLocation } from "./install.mjs";
import { writeInstruction, ensureAgentSkillsInstalled } from "./instructions.mjs";
import { startDock } from "./dock.mjs";
import { openDb, closeDb } from "../../artifacts/db.mjs";
import { bindAnchor } from "../../artifacts/projects.mjs";
import { initAnchor } from "../../core/identity.mjs";

/**
 * PREFLIGHT (UI-147): stellt VOR jeder Instruction-Write die drei
 * Vorbedingungen her/prueft sie — in Abhaengigkeitsreihenfolge:
 *   1. Skills    — repariert fehlende ~/.agents/skills aus dem Paket-Root
 *                  (idempotent, EINE Quelle: ensureAgentSkillsInstalled).
 *                  Fehlt die Quelle (npm-global ohne Checkout), ist eine
 *                  Instruction, die auf leere Pfade verweist, ein Defekt
 *                  -> fail-closed VOR dem Schreiben.
 *   2. Anker     — initAnchor + bindAnchor (Projekt-Identitaet, die der
 *                  Anchor-Mechanismus der Instructions voraussetzt).
 *   3. API-Key   — geprueft/erklärt (interaktiv: Onboarding-Dialog; headless:
 *                  Anleitung). Kein stiller Abschluss ohne Key.
 * Dry-run: keinerlei Side-Effekte (Aufrufer reicht dryRun:true durch).
 */
export async function runPreflight({ root, homeDir, targetRoot, dryRun = false, interactive = false, skipDock = false }) {
  if (dryRun) {
    return {
      ok: true, dryRun: true,
      skills: { ok: true, dryRun: true, repaired: false },
      anchor: { ok: true, dryRun: true },
      key: { configured: false, mode: "dry-run" },
    };
  }

  // 1) Agent-Skills reparieren (fehlende Anlage aus dem Paket-Root nachziehen).
  const skills = await ensureAgentSkillsInstalled({ homeDir, packageRoot: root });
  if (!skills.ok) {
    return { ok: false, failed: "skills", skills, anchor: null, key: null, error: skills.error };
  }

  // 2) Projekt-Anker (Identitaet) initiieren + an die Queue binden.
  const anchor = initAnchor(targetRoot);
  if (!anchor.ok) return { ok: false, failed: "anchor", skills, anchor, error: anchor.message };
  const db = openDb();
  try { bindAnchor(db, anchor, targetRoot); }
  catch (error) { closeDb(); return { ok: false, failed: "anchor", skills, anchor, error: error.message }; }
  closeDb();

  // 3) API-Key pruefen (fehlt er, erklaert/repariert der Dialog — kein
  //    stiller Abschluss; ohne Key startet weiterhin kein Job, Exit 3).
  const { ensureApiKeyAtBootstrap } = await import("./apikey.mjs");
  const key = await ensureApiKeyAtBootstrap({ interactive, skipDock });

  return { ok: true, skills, anchor, key };
}

export async function runBootstrap({ root, projectRoot, homeDir, dryRun = false, skipDock = false, noDesktop = false, mode = "optional", reichweite = "projekt", interactive = Boolean(process.stdin?.isTTY) } = {}) {
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

  // 2. Agent-Detektion (Kontext fuer die Preflight-Ausgaben)
  const agent = detectAgent(process.env, process.platform);
  console.log(`Agent erkannt: ${agent.label}`);
  console.log(`Zielprojekt: ${targetRoot}`);

  // 3. PREFLIGHT (UI-147): Skills + Anker + API-Key VOR jeder Instruction-
  //    Write — die dangling-warnings-Klasse existiert damit nicht mehr:
  //    writeInstruction findet die Skills VOR, schreibt also ohne Warnung;
  //    ein nicht reparierbarer Zustand bricht VOR dem Schreiben ab, und der
  //    Key-Dialog/Key-Guide laeuft ebenfalls VOR der Instruction (kein
  //    Abschluss, der erst NACH dem Schreiben einen fehlenden Key meldet).
  //    Der Key wird hier GENAU EINMAL geprueft — kein zweiter
  //    ensureApiKeyAtBootstrap-Aufruf spaeter (kein Doppel-Dialog).
  const preflight = await runPreflight({ root, homeDir, targetRoot, dryRun, interactive, skipDock });
  if (!preflight.ok) {
    return { ok: false, stage: `preflight-${preflight.failed}`, ...preflight, install };
  }

  // 4. Persistente Instruction-Datei (Enforcement-Teil). Ein Dry-Run darf
  //    keinerlei Installation-, Projekt- oder Home-Dateien schreiben.
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
        // Skills hat der Preflight bereits repariert/verifiziert — write-
        // Instruction repariert nicht erneut (idempotent, aber kein zweiter
        // Quellen-Zugriff noetig). Findet sie Skills wider Erwarten nicht,
        // warnt sie weiterhin ehrlich (Direktaufruf-Kompatibilitaet).
        repairSkills: false,
      });

  // 5. Sichtbares Dock (UI-139: dry-run ist side-effect-frei – AUCH das Dock.
  //     startDock kennt kein dryRun und wuerde auf installierten Maschinen mit
  //     gestopptem Worker ein echtes Start-Process-Fenster spawnen.)
  const dock = skipDock
    ? { ok: true, skipped: true }
    : dryRun
      ? { ok: true, skipped: true, skippedBecause: "dry-run" }
      : await startDock({ coreDir: installLocation.coreDir });

  // 6. Workflow-Protokoll. Skills- und Key-Wahrheit kommen aus dem Preflight
  //    (EINE Quelle): das Instruction-Objekt wird mit der Preflight-Reparatur-
  //    Aussage angereichert — schrieb der Preflight die Skills NACH, meldet
  //    die Summary sonst nie NACHINSTALLIERT (writeInstruction findet die
  //    Marker ja schon vor). Der Key ist preflight.key (dry-run ehrlich
  //    configured:false statt eines erfundenen configured:true).
  const instruction = dryRun
    ? written
    : {
        ...written,
        skillsInstalled: preflight.skills?.ok === true,
        skillsRepaired: Boolean(preflight.skills?.repaired),
      };

  return {
    ok: true,
    agent,
    projectRoot: targetRoot,
    instruction,
    skills: preflight.skills,
    dock,
    install,
    key: preflight.key,
  };
}
