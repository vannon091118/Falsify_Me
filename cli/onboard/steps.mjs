// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/onboard/steps.mjs – der Onboarding-Ablauf
// -----------------------------------------------------------------------------
// FALSIFYME redet DIREKT mit dem Nutzer. Schritte:
//   1. Begrüßung + Ist-Zustand (Node, Installation, FALSIFY_HOME, Key gesetzt?)
//   2. Settings-Dialog: apiBase → API-Key-Name → API-Key (maskiert)
//   3. Modellkatalog laden → Nutzer waehlt eine konkrete Modell-ID
//   4. Konto-Zugriff der Auswahl mit einer Minimal-Completion pruefen
//   5. Sichtbares Dock starten (Windows; die TUI wird damit genutzt)
//   6. Abschluss: doctor-Zusammenfassung + nächste Schritte
// Modular: Prompter ist injizierbar (Tests nutzen fakePrompter aus prompts.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import path from "node:path";
import { existsSync } from "node:fs";
import {
  fetchAvailableModels,
  getRuntimeSettings,
  probeModelAccess,
  updateRuntimeSettings,
} from "../../core/settings.mjs";
import { loadApiKey, loadApiKeyForNames } from "../../core/keys.mjs";
import { isLocalApiBase } from "../../core/config.mjs";
import { enforceRateLimit } from "../../core/ratelimit.mjs";
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

/**
 * Laedt einen Modellkatalog und laesst den Nutzer eine konkrete ID waehlen.
 * `/models` ist nur ein Katalog-Nachweis; bei Remote-Endpunkten prueft eine
 * minimale Completion danach den tatsaechlichen Konto-/Entitlement-Zugriff.
 */
export async function selectModel({
  prompter,
  models = [],
  currentModel = "",
  apiBase,
  apiKey = null,
  probeModel = probeModelAccess,
  reserveRequest = () => {},
  maxAttempts = 3,
} = {}) {
  const catalog = [];
  const seen = new Set();
  for (const item of Array.isArray(models) ? models : []) {
    const id = typeof item === "string" ? item.trim() : String(item?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    catalog.push({
      id,
      ownedBy: typeof item === "object" && item ? item.ownedBy ?? item.owned_by ?? item.provider ?? null : null,
      pricing: typeof item === "object" && item ? item.pricing ?? item.cost ?? null : null,
    });
  }

  const failed = new Set();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let selected = "";
    if (catalog.length) {
      console.log(`${SAY} Katalog: ${catalog.length} Modell(e). Der Katalog beweist noch keinen Konto-Zugriff:`);
      catalog.forEach((item, index) => {
        const owner = item.ownedBy ? ` (${item.ownedBy})` : "";
        const pricing = item.pricing == null ? "" : ` · Pricing: ${JSON.stringify(item.pricing)}`;
        console.log(`${SAY}   ${index + 1}. ${item.id}${owner}${pricing}`);
      });
      const currentIndex = catalog.findIndex((item) => item.id === String(currentModel || "").trim());
      const answer = await prompter.ask(
        `${SAY} Modell aus dem Katalog waehlen (Nummer oder exakte ID)?`,
        { defaultValue: currentIndex >= 0 ? String(currentIndex + 1) : undefined },
      );
      const value = String(answer || (currentIndex >= 0 ? String(currentIndex + 1) : "")).trim();
      const index = Number(value);
      selected = Number.isInteger(index) && index >= 1 && index <= catalog.length
        ? catalog[index - 1].id
        : catalog.find((item) => item.id === value)?.id || "";
      if (!selected) {
        console.log(`${SAY} Ungueltige Auswahl. Bitte eine Katalognummer oder eine exakte Modell-ID eingeben.`);
        continue;
      }
    } else {
      selected = String(await prompter.ask(
        `${SAY} Keine Modellliste verfuegbar. Modell-ID manuell eingeben${currentModel ? ` [${currentModel}]` : ""}?`,
        { defaultValue: currentModel || undefined },
      ) || currentModel || "").trim();
      if (!selected) {
        console.log(`${SAY} Ohne Modell-ID werden keine Runtime-Settings geschrieben.`);
        continue;
      }
    }

    if (failed.has(selected)) {
      console.log(`${SAY} Dieses Modell wurde in dieser Sitzung bereits abgewiesen: ${selected}`);
      continue;
    }

    // Ohne Remote-Key kann ein Mensch die Modell-ID fuer eine spaetere
    // Einrichtung festlegen; eine Konto-Freigabe wird dabei bewusst nicht
    // behauptet. Lokale Endpunkte duerfen ohne Key direkt probiert werden.
    if (!apiKey && !isLocalApiBase(apiBase)) {
      console.log(`${SAY} Ausgewaehlt: ${selected} (Konto-Zugriff noch nicht geprueft: kein API-Key).`);
      return { model: selected, verified: false, verification: "kein API-Key" };
    }

    try {
      reserveRequest();
      await probeModel({ apiBase, apiKey, model: selected });
      console.log(`${SAY} Ausgewaehlt und Konto-Zugriff bestaetigt: ${selected}`);
      return { model: selected, verified: true, verification: "Completion-Probe" };
    } catch (error) {
      const message = String(error?.message || error);
      // Nur ein nachgewiesener Konto-/Funktions-404 rechtfertigt die Auswahl
      // einer anderen ID. 429, 5xx, Timeout und 401/403 sagen dagegen nichts
      // ueber die Modell-ID aus und duerfen keinen Modellwechsel ausloesen.
      const entitlementFailure = /function\b[\s\S]*not found for account|model[_ -]?not[_ -]?found|unknown model|model\b[\s\S]*does not exist|not entitled/i.test(message);
      if (!entitlementFailure) {
        throw new Error(`Modell-Probe nicht entscheidbar; Auswahl bleibt unveraendert (${message}).`);
      }
      failed.add(selected);
      console.log(`${SAY} Modell nicht fuer diesen Endpunkt bestaetigt: ${selected} (${message})`);
      if (attempt >= maxAttempts) {
        throw new Error(`Kein ausgewaehltes Modell konnte bestaetigt werden (${[...failed].join(", ")}).`);
      }
    }
  }

  throw new Error("Keine gueltige Modell-Auswahl erhalten.");
}

/** Fragt Endpunkt, Key und die vom Nutzer bestaetigte Modell-ID ab. */
export async function collectSettings({
  prompter,
  current,
  fetchModels = fetchAvailableModels,
  probeModel = probeModelAccess,
  reserveRequest = () => {},
} = {}) {
  const questions = [];
  const ask = prompter.ask;
  const askSecret = prompter.askSecret;

  const apiBase = (await ask(`${SAY} API-Endpunkt (OpenAI-kompatibel, z. B. https://integrate.api.nvidia.com/v1)?`, { defaultValue: current.apiBase })) || current.apiBase;
  if (apiBase !== current.apiBase) questions.push(`apiBase=${apiBase}`);

  const nameHint = String(current.apiKeyEnv || "").split(",")[0].trim() || "FALSIFY_API_KEY";
  const keyName = (await ask(`${SAY} Name des API-Keys (Env-Variable im .env)?`, { defaultValue: nameHint })) || nameHint;
  if (keyName !== nameHint) questions.push(`apiKeyName=${keyName}`);

  const apiKey = await askSecret(`${SAY} API-Key (leer = vorhandenen behalten)?`);
  if (apiKey) questions.push(`apiKey=<maskiert>`);
  const keyCandidates = [keyName, ...String(current.apiKeyEnv || "").split(",")]
    .map((name) => name.trim()).filter(Boolean);
  const probeKey = apiKey || loadApiKeyForNames([...new Set(keyCandidates)]);

  let models = [];
  if (probeKey || isLocalApiBase(apiBase)) {
    try {
      reserveRequest();
      models = await fetchModels({ apiBase, apiKey: probeKey });
    } catch (error) {
      console.log(`${SAY} Modellkatalog nicht erreichbar: ${error.message} (manuelle Nutzer-Auswahl bleibt moeglich.)`);
    }
  } else {
    console.log(`${SAY} Kein API-Key fuer den Remote-Endpunkt — Katalog wird nicht abgefragt; manuelle Nutzer-Auswahl bleibt moeglich.`);
  }
  const selected = await selectModel({
    prompter,
    models,
    currentModel: current.model,
    apiBase,
    apiKey: probeKey,
    probeModel,
    reserveRequest,
  });

  const patch = {};
  if (apiBase !== current.apiBase) patch.apiBase = apiBase;
  if (selected.model !== current.model) {
    patch.model = selected.model;
    questions.push(`model=${selected.model}${selected.verified ? "" : " (Zugriff nicht geprueft)"}`);
  }
  if (keyName !== nameHint) patch.apiKeyName = keyName;
  if (apiKey) patch.apiKey = apiKey;

  return {
    patch,
    questions,
    apiKeyEntered: Boolean(apiKey),
    model: selected.model,
    modelVerified: selected.verified,
  };
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

  const { patch, questions, apiKeyEntered } = await collectSettings({
    prompter,
    current,
    fetchModels: options.fetchModels || fetchAvailableModels,
    probeModel: options.probeModel || probeModelAccess,
    reserveRequest: options.reserveRequest || (() => enforceRateLimit(current.maxRpm, false)),
  });
  if (Object.keys(patch).length > 0) {
    updateRuntimeSettings(patch);
    console.log(`${SAY} Einstellungen geschrieben (Keys nur in FALSIFY_HOME/.env, Rechte 0600).`);
  } else {
    console.log(`${SAY} Keine Änderungen — bestehende Einstellungen bleiben aktiv.`);
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