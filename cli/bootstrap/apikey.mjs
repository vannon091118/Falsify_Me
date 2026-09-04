// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/bootstrap/apikey.mjs – API-Key-Check im Bootstrap
// -----------------------------------------------------------------------------
// Nach der Installation prüft der Bootstrap, ob ein API-Key existiert
// (loadApiKey: beliebiger Name aus der Key-Liste, nicht nur der erste).
// Fehlt der Key, wird ehrlich erklärt, wozu FalsifyMe (bis zu) zwei APIs
// nutzt (Hauptmodell + optionaler Evil-Twin-Anbieter) und es werden die
// Online-Key-Seiten der Beispiel-Anbieter genannt.
//   • interaktiv (TTY): Key-Eingabe mit Maskierung (★ für jede Zeichen)
//     + Übergang in den Onboarding-Dialog (falsify onboard)
//   • headless (Agent): klare Anleitung für den Agenten — kein stiller Hang,
//     kein Fake-Erfolg; ohne Key startet weiterhin kein echter Job (Exit 3).
// Keys werden ausschließlich in FALSIFY_HOME/.env gespeichert, niemals im Code
// oder in Console-Output gedruckt. chmod 600 auf .env als Schutzmaßnahme.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { loadApiKey } from "../../core/keys.mjs";
import { printApiKeyExplanation } from "../onboard/explain.mjs";
import { falsifyHome } from "../../artifacts/db.mjs";

const ENV_FILE = path.join(falsifyHome(), ".env");

/** Prüft, ob .env existiert und alle bekannten Keys leere Werte haben. */
function envHasOnlyEmptyValues() {
  try {
    const content = fs.readFileSync(ENV_FILE, "utf8");
    return /^(NVIDIA_API_KEY=|OPENAI_API_KEY=|FALSIFY_API_KEY)=\s*$/m.test(content);
  } catch {
    return false; // Datei existiert nicht → nicht "nur leere Werte"
  }
}

/** Erstellt .env mit dem gegebenen Key und setzt chmod 600. */
function createEnvFile(keyName, keyValue) {
  const lines = [];
  if (keyName) lines.push(`${keyName}=${keyValue}`);
  lines.push("NVIDIA_API_KEY=");
  lines.push("OPENAI_API_KEY=");
  lines.push("FALSIFY_API_KEY=");
  const content = lines.join("\n") + "\n";
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  fs.writeFileSync(ENV_FILE, content, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(ENV_FILE, 0o600); } catch { /* Windows ACLs */ }
}

/** Maskierte API-Key-Eingabe: zeigt * für jede eingegebene Zeichen. */
export function askSecret(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY && !process.stdout.isTTY) {
      console.log(`${question} (headless-Modus: Key manuell setzen)`);
      resolve("");
      return;
    }

    const rl = require("node:readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${question} `, (answer) => {
      const masked = "*".repeat(Math.max(1, answer.length));
      process.stdout.write(`\r${masked}\n`);
      rl.close();
      resolve(answer);
    });
  });
}

/** True, wenn irgendein Key der konfigurierten Key-Namen vorhanden ist. */
export function hasApiKey() {
  try {
    return Boolean(loadApiKey());
  } catch {
    return false; // kaputte Config ist KEIN Key — ehrlich als fehlend behandeln
  }
}

/**
 * Bootstrap-API-Key-Schritt. Liefert { configured } + mode.
 * interactive=false (Agent-Shell ohne TTY): nur Anleitung, kein Dialog.
 */
export async function ensureApiKeyAtBootstrap({ interactive = false, skipDock = false } = {}) {
  if (hasApiKey()) return { configured: true, mode: "configured" };

  // Hinweis bei .env mit nur leeren Werten
  if (envHasOnlyEmptyValues()) {
    console.log("");
    console.log("=".repeat(64));
    console.log("  .env EXISTSIERT – jedoch mit leeren Werten");
    console.log("  (NVIDIA_API_KEY=/OPENAI_API_KEY=/FALSIFY_API_KEY=)");
    console.log("  API-Key wurde nicht erkannt. Bitte neuen Key eingeben.");
    console.log("=".repeat(64));
    console.log("");
  }

  console.log("");
  console.log("=".repeat(64));
  console.log("  KEIN API-KEY GEFUNDEN — ohne Key startet kein echter Job");
  console.log("=".repeat(64));
  printApiKeyExplanation();

  if (!interactive) {
    console.log("");
    console.log("Agent-Shell ohne Terminal erkannt — der interaktive Key-Dialog ist hier");
    console.log("nicht möglich. Frage den Nutzer und biete ihm diese Optionen an:");
    console.log('  • Nutzer startet im Terminal:  falsify onboard   (Dialog erklärt 1–2 APIs)');
    console.log('                               + Provider-Links)');
    console.log('  • Key direkt setzen (Agent):   falsify settings set apiBase="…"');
    console.log('                                 apiKeyName="…" apiKey="…"');
    console.log('  • Modellwahl durch Nutzer:      falsify onboard');
    console.log("");
    console.log("Ohne Key startet weiterhin kein Job — FalsifyMe erfindet kein Verdict.");
    console.log("=".repeat(64));
    return { configured: false, mode: "headless" };
  }

  // Interaktive Key-Eingabe mit Maskierung
  const key = await askSecret("Bitte den API-Key für das Hauptmodell eingeben");
  if (!key) {
    console.log("OK — Key wurde nicht angegeben. Ohne Key startet weiterhin kein Job.");
    return { configured: false, mode: "declined" };
  }

  // Key in .env schreiben (chmod 600 wird in createEnvFile gemacht)
  createEnvFile("FALSIFY_API_KEY", key);

  console.log("");
  console.log("API-Key wurde sicher in FALSIFY_HOME/.env gespeichert.");
  console.log("=".repeat(64));
  return { configured: true, mode: "key-provided" };
}