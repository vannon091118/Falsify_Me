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
// ─────────────────────────────────────────────────────────────────────────────
import os from "node:os";
import { runBootstrap } from "./bootstrap/main.mjs";
import { packageRoot } from "./bootstrap/install.mjs";
import { loadApiKey, keyNames } from "../core/keys.mjs";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const dryRun = flags.has("--dry-run");
const skipDock = flags.has("--skip-dock");

// --project-root <dir>: explizites Zielprojekt; Default = cwd des Aufrufs.
let projectRoot;
const pri = argv.indexOf("--project-root");
if (pri !== -1 && argv[pri + 1] && !argv[pri + 1].startsWith("--")) {
  projectRoot = argv[pri + 1];
}

try {
  const result = await runBootstrap({
    root: packageRoot,
    projectRoot,
    homeDir: os.homedir(),
    dryRun,
    skipDock,
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
  console.log(`   Agent:       ${agent.label}`);
  console.log(`   Zielprojekt: ${targetRoot}`);
  console.log(`   Instruction: ${instruction.target}`);
  console.log(`   Skills:      ${instruction.skillsDir}`);
  console.log(`   FalsiFlow:   ${instruction.falsiflowSkillDir}`);
  console.log(`   Dock:        ${dock.ok ? (dock.skipped ? "uebersprungen (--skip-dock)" : "RUNNING") : "NICHT bestaetigt"}`);
  console.log("");
  console.log("Workflow: Coding-Agent -> FalsifyMe -> Dock -> Verdict -> Coding-Agent");
  console.log("Bis VERDICT: WRITE bleibt der Coding-Agent READ-ONLY.");
  console.log(`Naechster Schritt: Instruction lesen (${instruction.target}) und folgen.`);

  // API-Key-Status: ohne Key endet jeder echte Job mit Exit 3 (keine Freigabe).
  let apiKey = null;
  try { apiKey = loadApiKey(); } catch { /* Konfiguration noch nicht lesbar */ }
  if (dryRun) {
    console.log("API-Key: (dry-run - nicht geprueft)");
  } else if (apiKey) {
    console.log(`API-Key: konfiguriert (${keyNames().join(", ")})`);
  } else {
    console.warn("WARNUNG: Kein API-Key konfiguriert - jeder echte Job endet mit Exit 3 (keine Freigabe).");
    console.warn("  Trage einen Key ein: falsify settings set apiKeyName=MEIN_KEY apiKey=secret");
  }
} catch (e) {
  console.error(`Bootstrap fehlgeschlagen: ${e?.message || e}`);
  process.exit(1);
}
