// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/config.mjs – externe Konfiguration (provider-neutral)
// -----------------------------------------------------------------------------
// KEINE hartkodierten Pfade/APIs: alles kommt aus (Priorität absteigend)
//   1) Env-Variablen (FALSIFY_*)
//   2) ~/.Falsify/config.json   (optional, ausserhalb des Repos)
//   3) sinnvolle Defaults (OpenAI-kompatibel; NVIDIA NIM ist nur ein Beispiel)
//
// Jeder OpenAI-kompatible Endpunkt funktioniert: NVIDIA NIM, OpenAI,
// lokal (Ollama/LM Studio), Azure OpenAI, Groq, … – nur FALSIFY_API_BASE und
// FALSIFY_MODEL (bzw. config.json) anpassen.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { falsifyHome } from "../artifacts/db.mjs";

// ── Defaults (bewusst generisch – NIM ist KEIN Pflicht-Provider) ────────────
const DEFAULTS = {
  apiBase: "https://integrate.api.nvidia.com/v1",
  model: "nvidia/nemotron-3-ultra-550b-a55b",
  apiKeyEnv: "NVIDIA_API_KEY,OPENAI_API_KEY,FALSIFY_API_KEY",
  maxTokens: 20000,
  reasoningEffort: "high",        // high | medium | low | auto | off
  maxToolRounds: 6,
  maxRpm: 40,
  lang: "de",
  temperature: 0.3,
  timeoutMs: 600000,
};

function loadConfigFile() {
  const file = path.join(falsifyHome(), "config.json");
  try { return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) }; }
  catch { return { file, data: {} }; }
}

/** Liest einen Wert: Env-Var → config.json → Default. */
function pick(envKey, fileData, fileKey, def) {
  const e = process.env[envKey];
  if (e !== undefined && e !== "") return e;
  if (fileData[fileKey] !== undefined && fileData[fileKey] !== "") return fileData[fileKey];
  return def;
}

function pickNum(envKey, fileData, fileKey, def, { min, max } = {}) {
  const raw = pick(envKey, fileData, fileKey, String(def));
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Ungültige Konfiguration: ${envKey}/${fileKey} = "${raw}" ist keine Zahl`);
  }
  if (min !== undefined && n < min) {
    throw new Error(`Ungültige Konfiguration: ${envKey}/${fileKey} = ${n} ist unter dem Minimum ${min}`);
  }
  if (max !== undefined && n > max) {
    throw new Error(`Ungültige Konfiguration: ${envKey}/${fileKey} = ${n} ist über dem Maximum ${max}`);
  }
  return n;
}

/** Provider-Label nur zur Anzeige (nie für Logik). */
export function providerLabel(apiBase) {
  const b = String(apiBase || "").toLowerCase();
  if (b.includes("api.openai.com")) return "OpenAI";
  if (b.includes("integrate.api.nvidia.com")) return "NVIDIA NIM";
  if (b.includes("localhost") || b.includes("127.0.0.1") || b.includes(":11434")) return "lokal (Ollama/LM Studio)";
  if (b) return "OpenAI-kompatibel";
  return "?";
}

/**
 * Lädt die komplette Laufzeit-Konfiguration.
 * @returns {{
 *   model:string, apiBase:string, provider:string, keyEnvNames:string[],
 *   maxTokens:number, reasoningEffort:string, maxToolRounds:number,
 *   maxRpm:number, lang:string, temperature:number, timeoutMs:number,
 *   configFile:string
 * }}
 */
export function loadConfig() {
  const { file, data } = loadConfigFile();
  const apiBase = String(pick("FALSIFY_API_BASE", data, "apiBase", DEFAULTS.apiBase)).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(apiBase)) {
    throw new Error(`Ungültige Konfiguration: FALSIFY_API_BASE/apiBase = "${apiBase}" (muss mit http:// oder https:// beginnen)`);
  }
  const lang = String(pick("FALSIFY_LANG", data, "lang", DEFAULTS.lang)).toLowerCase();
  const reasoningEffort = String(pick("FALSIFY_REASONING_EFFORT", data, "reasoningEffort", DEFAULTS.reasoningEffort)).toLowerCase();
  if (!["high", "medium", "low", "auto", "off"].includes(reasoningEffort)) {
    throw new Error(`Ungültige Konfiguration: FALSIFY_REASONING_EFFORT/reasoningEffort = "${reasoningEffort}" (erlaubt: high, medium, low, auto, off)`);
  }
  if (!["de", "en"].includes(lang)) {
    throw new Error(`Ungültige Konfiguration: FALSIFY_LANG/lang = "${lang}" (erlaubt: de, en)`);
  }
  return {
    model: String(pick("FALSIFY_MODEL", data, "model", DEFAULTS.model)).trim(),
    apiBase,
    provider: String(pick("FALSIFY_PROVIDER", data, "provider", providerLabel(apiBase))).trim(),
    keyEnvNames: (() => {
      // Liste: FALSIFY_API_KEY_ENV → config.json apiKeyEnv → Default. Ein explizit
      // via `falsify settings set apiKeyName=…` gesetzter Name hat Vorrang
      // (settings.mjs löst ihn genauso auf) – sonst wäre der konfigurierte
      // Key-Name für Jobs unsichtbar („Kein API-Key gefunden“).
      const base = String(pick("FALSIFY_API_KEY_ENV", data, "apiKeyEnv", DEFAULTS.apiKeyEnv))
        .split(",").map((s) => s.trim()).filter(Boolean);
      const named = typeof data.apiKeyName === "string" && data.apiKeyName.trim()
        ? data.apiKeyName.trim()
        : null;
      return named ? [named, ...base.filter((n) => n !== named)] : base;
    })(),
    maxTokens: pickNum("FALSIFY_MAX_TOKENS", data, "maxTokens", DEFAULTS.maxTokens, { min: 256, max: 1_000_000 }),
    reasoningEffort,
    maxToolRounds: pickNum("FALSIFY_MAX_TOOL_ROUNDS", data, "maxToolRounds", DEFAULTS.maxToolRounds, { min: 1, max: 20 }),
    maxRpm: pickNum("FALSIFY_MAX_RPM", data, "maxRpm", DEFAULTS.maxRpm, { min: 1, max: 1000 }),
    lang,
    temperature: pickNum("FALSIFY_TEMPERATURE", data, "temperature", DEFAULTS.temperature, { min: 0, max: 2 }),
    timeoutMs: pickNum("FALSIFY_TIMEOUT_MS", data, "timeoutMs", DEFAULTS.timeoutMs, { min: 1000, max: 3_600_000 }),
    configFile: file,
  };
}
