// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/onboard/steps.mjs – der Onboarding-Ablauf
// -----------------------------------------------------------------------------
// FALSIFYME redet DIREKT mit dem Nutzer. Schritte:
//   1. Begrüßung + Ist-Zustand (Node, Installation, FALSIFY_HOME, Key gesetzt?)
//   2. Settings-Dialog: apiBase → model → apiKeyName → apiKey (maskiert)
//      (Default = aktuelle Runtime-Settings; leer = nichts ändern)
//   3. Options-Check: /models live vom konfigurierten Endpunkt abrufen
//   4. Sichtbares Dock starten (Windows; die TUI wird damit genutzt)
//   5. Abschluss: doctor-Zusammenfassung + nächste Schritte
// Modular: Prompter ist injizierbar (Tests nutzen fakePrompter aus prompts.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import path from "node:path";
import { existsSync } from "node:fs";
import {
  fetchAvailableModels,
  getRuntimeSettings,
  updateRuntimeSettings,
} from "../../core/settings.mjs";
import { keyNames, loadApiKey } from "../../core/keys.mjs";
import { falsifyHome } from "../../artifacts/db.mjs";
import { printApiKeyExplanation } from "./explain.mjs";

const SAY = "FALSIFYME ▸";
const cmd = (name, args = "") => `falsify ${name}${args ? ` ${args}` : ""}`;

/** Liefert die Installation(alts) des Onboardings (aus ~/.Falsify_Core). */
export function detectInstallation(homeDir, platform) {
  const coreDir = path.join(homeDir, ".Falsify_Core");
  const installed = existsSync(path.join(coreDir, "cli", "main.mjs"));
  return {
    coreDir,
    installed,
    platform,
    isWindows: platform === "win32",
  };
}

/** Fragt die vier Settings ab und schreibt sie per updateRuntimeSettings(). */
export async function collectSettings({ prompter, current }) {
  const questions = [];
  const ask = prompter.ask;
  const askSecret = prompter.askSecret;

  const apiBase = (await ask(`${SAY} API-Endpunkt (OpenAI-kompatibel, z. B. https://integrate.api.nvidia.com/v1)?`, { defaultValue: current.apiBase })) || current.apiBase;
  if (apiBase !== current.apiBase) questions.push(`apiBase=${apiBase}`);

  const model = (await ask(`${SAY} Modell (z. B. nvidia/nemotron-3-ultra-550b-a55b)?`, { defaultValue: current.model })) || current.model;
  if (model !== current.model) questions.push(`model=${model}`);

  const nameHint = current.apiKeyEnv.split(",")[0].trim() || "FALSIFY_API_KEY";
  const keyName = (await ask(`${SAY} Name des API-Keys (Env-Variable im .env)?`, { defaultValue: nameHint })) || nameHint;
  if (keyName !== nameHint) questions.push(`apiKeyName=${keyName}`);

  const apiKey = await askSecret(`${SAY} API-Key (leer = vorhandenen behalten)?`);
  if (apiKey) questions.push(`apiKey=<maskiert>`);

  const patch = {};
  if (apiBase !== current.apiBase) patch.apiBase = apiBase;
  if (model !== current.model) patch.model = model;
  if (keyName !== nameHint) patch.apiKeyName = keyName;
  if (apiKey) patch.apiKey = apiKey;

  return { patch, questions, apiKeyEntered: Boolean(apiKey) };
}

/** Erster Schritt: Status anzeigen (read-only, ehrlich). */
export function showStatus({ prompt, install, home }) {
  const say = (line) => console.log(`${SAY} ${line}`);
  say("Hallo — ich bin FalsifyMe, dein read-only Falsifikations-Gateway.");
  say("Ich prüfe deine Änderungen, bevor du schreibst — und ich rede jetzt direkt mit dir.");
  console.log("");
  say(`Node:             ${process.version}`);
  say(`Installation:     ${install.installed ? install.coreDir : "NICHT installiert (node install.mjs zuerst)"}`);
  say(`FALSIFY_HOME:     ${home}`);
  say(`API-Key gesetzt:  ${prompt && prompt.keyConfigured ? "ja" : "nein"}`);
  if (install.isWindows) say(`Worker-Dock:      startbar (sichtbares Fenster, TUI)`);
  console.log("");
}

/** Abschluss: Zusammenfassung der gesetzten Fragen + nächste Schritte. */
export function showSummary({ questions, apiKeyEntered, skipDock, install }) {
  const say = (line) => console.log(`${SAY} ${line}`);
  console.log("");
  say("Onboarding abgeschlossen. Gespeichert in FALSIFY_HOME:");
  for (const q of questions) say(`  • ${q}`);
  if (!apiKeyEntered) say("  • API-Key: unverändert gelassen");
  say("Nächste Schritte:");
  say(`  • ${cmd("doctor")}          – Runtime-Vertragsprüfung (Key-Status!)`);
  say(`  • ${cmd("start", '"<dein Auftrag 1:1>"')} – Auftrag starten (Ticket binden; die Scope-ID bestimmt FalsifyMe automatisch)`);
  say(`  • ${cmd("submit", "--header \"<dein Auftrag 1:1>\" --plan-file plan.txt --root <dir> --files \"a,b\"")} – prüfen lassen`);
  say(`  • ${cmd("resume")} / ${cmd("history")} – letzten offenen Auftrag wieder aufnehmen / Verlauf & Auswirkung ansehen`);
  if (skipDock) say("  • Dock: übersprungen (--skip-dock) — ui/start-dock.cmd manuell");
  else if (install.isWindows) say("  • Dock-Fenster wurde gestartet — dort siehst du deine Jobs live (TUI).");
  else say("  • Sichtbares Dock ist Windows-only; Worker: node ui/worker.mjs");
}

/** Kompositionswurzel: führt den Dialog mit injiziertem Prompter aus. */
export async function runOnboard({
  prompter,
  homeDir = process.env.USERPROFILE || process.env.HOME,
  platform = process.platform,
  skipDock = false,
  options = {},
} = {}) {
  const install = detectInstallation(homeDir, platform);
  const home = falsifyHome();
  const current = getRuntimeSettings();
  const statusPrompt = { keyConfigured: current.keyConfigured, ...options };

  showStatus({ install, home, prompt: statusPrompt });

  if (!install.installed) {
    console.log(`${SAY} Bitte zuerst installieren:`);
    console.log(`${SAY}   node install.mjs   (aus dem Repo) — danach dieses Onboarding erneut.`);
    return { ok: false, stage: "install" };
  }

  // Kein Key vorhanden -> kurz erklären, wozu FalsifyMe (bis zu) zwei APIs
  // nutzt (Hauptmodell + optionaler Evil-Twin-Anbieter) + Provider-Links.
  if (!loadApiKey()) {
    console.log("");
    console.log(`${SAY} Kein API-Key gesetzt — wozu FalsifyMe (bis zu) zwei APIs nutzt:`);
    printApiKeyExplanation();
    console.log("");
  }

  const { patch, questions, apiKeyEntered } = await collectSettings({ prompter, current });
  if (Object.keys(patch).length > 0) {
    updateRuntimeSettings(patch);
    console.log(`${SAY} Einstellungen geschrieben (Keys nur in FALSIFY_HOME/.env, Rechte 0600).`);
  } else {
    console.log(`${SAY} Keine Änderungen — bestehende Einstellungen bleiben aktiv.`);
  }

  // Live-Modelle des Endpunkts (optional, read-only)
  const wantModels = await prompter.confirm(`${SAY} Verfügbare Modelle des Endpunkts live abrufen?`, { defaultValue: false });
  if (wantModels) {
    try {
      const models = await fetchAvailableModels();
      const names = models.slice(0, 10).map((m) => m.id).join(", ");
      console.log(`${SAY} Modelle (${models.length}): ${names}${models.length > 10 ? " …" : ""}`);
    } catch (e) {
      console.log(`${SAY} Modelle nicht erreichbar: ${e.message} (Config bleibt unverändert.)`);
    }
  }

  // Sichtbares Dock (nur Windows; die TUI wird genutzt)
  let dock = { ok: false, skipped: true };
  if (!skipDock && install.isWindows) {
    const { startDock } = await import("../bootstrap/dock.mjs");
    dock = await startDock({ coreDir: install.coreDir });
    if (!dock.ok && !dock.unsupportedPlatform && !dock.alreadyRunning) {
      console.log(`${SAY} Dock-Start nicht bestätigt (${dock.error || "unbekannt"}) — ${cmd("bootstrap")} prüft erneut.`);
    }
  }

  showSummary({ questions, apiKeyEntered, skipDock, install });
  return { ok: true, dock };
}