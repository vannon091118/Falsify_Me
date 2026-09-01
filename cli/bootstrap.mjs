#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe Bootstrap · cli/bootstrap.mjs (duenner Einstiegspunkt)
// -----------------------------------------------------------------------------
// Aufgerufen als Antwort auf: "INSTALLIER BITTE https://github.com/vannon091118/Falsify_Me"
// Logik liegt modular in cli/bootstrap/ (detect/install/instructions/dock/main).
//
// ROOT-Vertrag: packageRoot (diese Datei liegt im FalsifyMe-Paket) ist nur
// die Installationsquelle; Zielprojekt fuer Instructions/{{ROOT}} ist die
// cwd des Aufrufs (oder --project-root).
//
// Modus-Entscheid (UI-075, keine stille Gate-Aktivierung):
//   Vor dem Schreiben der Instruction-Datei wird Reichweite (projekt/global/aus)
//   und Betriebsmodus (PFLICHT/optional) festgelegt und als Kopfzeile
//   (FALSIFYME-MODUS) in der Instruction dokumentiert. Ohne --mode-Flag:
//   interaktiv (TTY) ueber den Prompter aus cli/onboard/prompts.mjs, sonst
//   Default `optional` + explizite Warnung. PFLICHT entsteht NIE still.
// ─────────────────────────────────────────────────────────────────────────────
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runBootstrap } from "./bootstrap/main.mjs";
import { packageRoot } from "./bootstrap/install.mjs";

const REICHWEITEN = new Set(["projekt", "global", "aus"]);

/** Parst die Bootstrap-Flags (pure, testbar). */
export function bootstrapFlags(argv = []) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const val = (name) => {
    // --name=wert und --name wert gleichermaßen akzeptieren
    const eq = argv.find((a) => a.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
  };
  let projectRoot = val("--project-root");
  let mode = val("--mode");
  let reichweite = val("--reichweite");
  if (mode !== undefined) {
    const m = String(mode).toLowerCase();
    if (m === "pflich" || m === "pflicht") mode = "PFLICHT";
    else if (m === "optional") mode = "optional";
    else throw new Error(`Ungueltiger --mode: ${mode} (erlaubt: PFLICHT | optional)`);
  }
  if (reichweite !== undefined) {
    const r = String(reichweite).toLowerCase();
    if (!REICHWEITEN.has(r)) throw new Error(`Ungueltige --reichweite: ${reichweite} (erlaubt: projekt | global | aus)`);
    reichweite = r;
  }
  return {
    dryRun: flags.has("--dry-run"),
    skipDock: flags.has("--skip-dock"),
    noDesktop: flags.has("--no-desktop"),
    projectRoot,
    mode,
    reichweite,
  };
}

/**
 * Wendet die Pflicht-Modusentscheidung auf geparste Flags an (UI-075,
 * nie still): Flags gewinnen; sonst interaktiv (TTY); sonst Default
 * optional + Warnung. Dry-Run: kein Dialog, Modus nur protokolliert.
 * Gemeinsamer Pfad fuer BEIDE CLI-Einstiege (bootstrap.mjs + main.mjs),
 * damit kein Einstieg den Entscheid umgehen kann.
 */
export async function applyModeDecision(flags) {
  if (flags.dryRun) {
    return { ...flags, mode: flags.mode || "optional", reichweite: flags.reichweite || "projekt" };
  }
  const decision = await resolveModeDecision({ mode: flags.mode, reichweite: flags.reichweite });
  return { ...flags, mode: decision.mode, reichweite: decision.reichweite };
}

/**
 * Legt den Modus-Entscheid fest (nie still): explizite Flags gewinnen;
 * sonst interaktiv (TTY) via Prompter; sonst Default optional + Warnung.
 */
export async function resolveModeDecision({ mode, reichweite, isTTY = Boolean(process.stdin.isTTY) }) {
  if (mode) {
    return { mode, reichweite: reichweite || "projekt", interactive: false, explicit: true };
  }
  if (isTTY) {
    const { defaultPrompter } = await import("./onboard/prompts.mjs");
    const prompter = defaultPrompter();
    try {
      const scope = await prompter.ask(
        "FALSIFYME ▸ Reichweite der Integration? (projekt = nur dieses Projekt · global = alle Projekte · aus = nur Werkzeug)",
        { defaultValue: "projekt" },
      );
      const r = String(scope || "projekt").trim().toLowerCase();
      const reichweiteFinal = REICHWEITEN.has(r) ? r : "projekt";
      const pflich = await prompter.confirm(
        "FALSIFYME ▸ Betriebsmodus PFLICHT aktivieren? (PFLICHT = letztes Git-Check-Gate vor Write/Commit · optional = Empfehlung ohne Enforcement)",
        { defaultValue: false },
      );
      const modeFinal = pflich ? "PFLICHT" : "optional";
      console.log(`FALSIFYME-MODUS: ${reichweiteFinal} · ${modeFinal} (im Instruction-Kopf dokumentiert)`);
      return { mode: modeFinal, reichweite: reichweiteFinal, interactive: true, explicit: true };
    } finally {
      prompter.close();
    }
  }
  console.warn("WARNUNG: Kein --mode angegeben und kein Terminal – FalsifyMe ist damit Empfehlung, KEIN Pflicht-Gate (Modus wird als 'optional' dokumentiert).");
  console.warn("Fuer ein Pflicht-Gate: falsify bootstrap --mode=PFLICHT --reichweite=projekt|global");
  return { mode: "optional", reichweite: reichweite || "projekt", interactive: false, explicit: false };
}

async function main() {
  const argv = process.argv.slice(2);
  let flags;
  try {
    flags = bootstrapFlags(argv);
  } catch (e) {
    console.error(`FEHLER: ${e.message}`);
    process.exit(2);
  }
  flags = await applyModeDecision(flags);

  try {
    const result = await runBootstrap({
      root: packageRoot,
      homeDir: os.homedir(),
      ...flags,
    });

    if (!result.ok) {
      console.error(`Bootstrap fehlgeschlagen in Stage "${result.stage}": ${result.error}`);
      process.exit(1);
    }

    const { agent, instruction, dock, projectRoot: targetRoot } = result;
    console.log("");
    console.log("=".repeat(60));
    console.log("  FALSIFYME WORKFLOW AKTIV - Bootstrap abgeschlossen");
    console.log("=".repeat(60));
    console.log(`  Agent        : ${agent.label}`);
    console.log(`  Zielprojekt  : ${targetRoot}`);
    console.log(`  Modus        : ${flags.reichweite} · ${flags.mode}${flags.mode !== "PFLICHT" ? " (Empfehlung, kein Pflicht-Gate)" : " (PFLICHT = letztes Git-Check-Gate)"}`);
    if (instruction && instruction.target && !flags.dryRun) {
      console.log(`  Instruction  : ${instruction.target}`);
    }
    if (dock && dock.ok) {
      console.log(dock.alreadyRunning ? "  Dock         : laeuft bereits (RUNNING)" : "  Dock         : gestartet und bestaetigt");
    } else if (dock && dock.unsupportedPlatform) {
      console.log("  Dock         : Windows-only – headless Worker: node ui/worker.mjs");
    } else if (dock && dock.skipped) {
      console.log("  Dock         : uebersprungen (--skip-dock)");
    } else if (dock) {
      console.log(`  Dock         : nicht bestaetigt (${dock.error || "unbekannt"}) – manuell: ui/start-dock.cmd`);
    }
    console.log("");
    console.log("  Naechste Schritte: falsify onboard (Key-Dialog) · falsify scope new \"<auftrag>\" · falsify submit …");
    console.log("");
  } catch (e) {
    console.error(`Bootstrap fehlgeschlagen: ${e?.message || e}`);
    process.exit(3);
  }
}

// Einstiegserkennung wie in allen Entries (run.mjs/main.mjs): fileURLToPath-
// Vergleich statt String-HTTP-URL-Bastel. Fix, 2026-09-01: die vorherige
// Bedingung ("file://" + Pfad ohne fuehrenden Slash) traf auf Windows nie zu
// - `falsify bootstrap` (falsify.sh -> dieses Skript) war still ein No-Op.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
