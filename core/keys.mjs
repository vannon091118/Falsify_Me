// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/keys.mjs – API-Key laden (provider-neutral)
// -----------------------------------------------------------------------------
// KEIN hartkodierter Key-Name/Pfad: Die Reihenfolge der Key-Namen kommt aus
// der Konfiguration (FALSIFY_API_KEY_ENV bzw. config.json, Default:
// NVIDIA_API_KEY → OPENAI_API_KEY → FALSIFY_API_KEY).
// Priorität: 1) FALSIFY_HOME/.env (bzw. FALSIFY_ENV)  2) Prozess-Env
// Keys liegen AUSSERHALB des Repos – nichts davon gehört auf GitHub.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { falsifyHome } from "../artifacts/db.mjs";
import { loadConfig } from "./config.mjs";

function readKeyFromEnvFile(file, names) {
  try {
    const env = fs.readFileSync(file, "utf8");
    const lines = env.split(/\r?\n/);
    for (const name of names) {
      // Duplikat-Schatten-Falle (Live-E2E 2026-09-02, F-1): .find() waehlte
      // die ERSTE passende Zeile - eine leere Vorlagen-Zeile (ensureFalsifyHome)
      // schattete eine spaeter befuellte Duplikat-Zeile. Jetzt gewinnt die
      // LETZTE Zeile mit nicht-leerem Wert (letzte Definition zaehlt, wie bei
      // .env-Semantik); leere Vorlagen-/Duplikat-Zeilen zaehlen nie als Wert.
      let lastFilled = null;
      for (const l of lines) {
        if (!l.startsWith(`${name}=`)) continue;
        const v = l.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
        if (v) lastFilled = v;
      }
      if (lastFilled !== null) return lastFilled;
    }
  } catch { /* Datei fehlt */ }
  return null;
}

export function keyEnvFile() {
  return process.env.FALSIFY_ENV || path.join(falsifyHome(), ".env");
}

/** Erwartete Key-Namen (z. B. NVIDIA_API_KEY, OPENAI_API_KEY, …). */
export function keyNames() {
  return loadConfig().keyEnvNames;
}

export function loadApiKey() {
  const names = keyNames();
  const fromFile = readKeyFromEnvFile(keyEnvFile(), names);
  if (fromFile) return fromFile;
  for (const name of names) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Twin-Key (Security-Review Pkt 3/10): Wenn der Evil Twin ein eigenes
 * Modell/eigene API-Base konfiguriert hat, kann er auch einen eigenen
 * API-Key-Namen bekommen (twinApiKeyEnv / FALSIFY_TWIN_API_KEY_ENV).
 * Lädt den Key nur aus diesem Namen — fällt NICHT still auf den Primärkey
 * zurück (ein falscher Endpunkt mit dem falschen Key würde nur kryptische
 * 401s erzeugen; fail-closed ist hier ehrlicher). Fällt der Aufrufer auf
 * den Primärkey zurück, muss er das selbst entscheiden (run.mjs warnt).
 */
export function loadApiKeyForNames(names) {
  const list = Array.isArray(names) ? names.filter(Boolean) : (names ? [names] : []);
  if (!list.length) return null;
  const fromFile = readKeyFromEnvFile(keyEnvFile(), list);
  if (fromFile) return fromFile;
  for (const name of list) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return null;
}
