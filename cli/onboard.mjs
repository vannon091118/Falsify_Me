#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/onboard.mjs – Onboarding (duenner Einstiegspunkt)
// -----------------------------------------------------------------------------
// Aufgerufen als:  falsify onboard
// Logik liegt modular in cli/onboard/ (prompts.mjs, steps.mjs).
// FALSIFYME redet DIREKT mit dem Nutzer: API-Endpunkt, Key-Name und API-Key
// (maskiert) werden abgefragt; danach waehlt der Nutzer eine Modell-ID aus dem
// Endpunkt-Katalog, die vor dem Speichern gegen das Konto geprueft wird.
// Ohne echtes TTY bricht der Dialog ehrlich ab (Exit 2) — keine stille
// Eingabe-Schleife; Agents nutzen `falsify settings set …`.
// ─────────────────────────────────────────────────────────────────────────────
import os from "node:os";
import { defaultPrompter } from "./onboard/prompts.mjs";
import { runOnboard } from "./onboard/steps.mjs";

const USAGE = `falsify onboard — interaktive Ersteinrichtung

FALSIFYME redet direkt mit dir: API-Endpunkt, Key-Name und API-Key werden
abgefragt; danach waehlt der Nutzer eine Modell-ID aus dem Katalog und
FalsifyMe prueft den Konto-Zugriff vor dem Speichern. Einstellungen liegen in
FALSIFY_HOME (Keys nur in FALSIFY_HOME/.env, Rechte 0600, Default
~/.Falsify_Private). Danach kann optional das sichtbare Worker-Dock gestartet
werden (Windows, TUI).

Flags:
  --skip-dock   kein Dock-Start am Ende
  -h, --help    diese Hilfe

Für Agents ohne Terminal: falsify settings set apiBase=… apiKeyName=… apiKey=…

Die Modellwahl bleibt eine Nutzerentscheidung: falsify onboard im Terminal
starten; kein Agent-Override per --model.
`;

export async function runOnboardCli(args = []) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return { ok: true, help: true };
  }
  const skipDock = args.includes("--skip-dock");
  for (const a of args) {
    if (a.startsWith("--") && !["--skip-dock"].includes(a)) {
      console.error(`FEHLER: Unbekannte onboard-Option: ${a}`);
      return { ok: false, reason: `unbekannte Option ${a}` };
    }
  }
  if (!process.stdin.isTTY) {
    console.error("FEHLER: falsify onboard benötigt ein Terminal (interaktiver Dialog).");
    console.error("Für Agents: falsify settings set apiBase=\"…\" apiKeyName=\"…\" apiKey=\"…\"");
    console.error("Modellwahl: Nutzer startet `falsify onboard` im Terminal; kein Agent-Override per `--model`.");
    return { ok: false, reason: "kein TTY" };
  }
  const prompter = defaultPrompter();
  try {
    await runOnboard({ prompter, homeDir: os.homedir(), platform: process.platform, skipDock });
    return { ok: true };
  } finally {
    prompter.close();
  }
}

if (process.argv[1] === import.meta.url || import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  runOnboardCli(process.argv.slice(2)).then((r) => {
    if (r && !r.ok) process.exit(2);
  }).catch((e) => {
    console.error(`FEHLER: ${e?.message || e}`);
    process.exit(3);
  });
}