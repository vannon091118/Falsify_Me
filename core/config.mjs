// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/config.mjs – externe Konfiguration (provider-neutral)
// -----------------------------------------------------------------------------
// KEINE hartkodierten Pfade/APIs: alles kommt aus (Priorität absteigend)
//   1) Env-Variablen (FALSIFY_*)
//   2) FALSIFY_HOME/config.json (optional, ausserhalb des Repos;
//      Default-Home: ~/.Falsify_Private)
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
  twinMaxTokens: 16384, // F-11: Twin-Default, siehe loadConfig
  reasoningEffort: "high",        // high | medium | low | auto | off
  maxToolRounds: 14,
  maxRpm: 40,
  lang: "de",
  temperature: 0.3,
  timeoutMs: 180000,
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
  // Twin-Diversität (Security-Review Pkt 3/10): Der Evil Twin kann ein EIGENES
  // Modell/eigene API-Base bekommen (FALSIFY_TWIN_MODEL / FALSIFY_TWIN_API_BASE /
  // FALSIFY_TWIN_API_KEY_ENV bzw. config.json twinModel/twinApiBase/twinApiKeyEnv).
  // Ohne Konfiguration läuft er mit dem Primärmodell — dann ist BESTAETIGT eine
  // Prüfung des Falls, keine unabhängige Wahrheit (gleiche Modellfamilie,
  // gleiche Biases). Die Konfiguration macht die Diversität WÄHLBAR, die
  // Warnung macht ihren Verzicht SICHTBAR — nie still.
  const model = String(pick("FALSIFY_MODEL", data, "model", DEFAULTS.model)).trim();
  const twinModel = String(pick("FALSIFY_TWIN_MODEL", data, "twinModel", "")).trim();
  const twinApiBase = String(pick("FALSIFY_TWIN_API_BASE", data, "twinApiBase", "")).replace(/\/+$/, "");
  if (twinApiBase && !/^https?:\/\//.test(twinApiBase)) {
    throw new Error(`Ungültige Konfiguration: FALSIFY_TWIN_API_BASE/twinApiBase = "${twinApiBase}" (muss mit http:// oder https:// beginnen)`);
  }
  const twinApiKeyEnv = String(pick("FALSIFY_TWIN_API_KEY_ENV", data, "twinApiKeyEnv", "")).trim();
  // F-3-Fix (Live-E2E 2026-09-02): Der Twin erbte den reasoningEffort des
  // Primaermodells - Groq lehnt `reasoning_effort=high` mit HTTP 400 ab
  // (live belegt), damit war eine Twin-Freigabe (BESTAETIGT) mit Groq-Twin
  // bei high strukturell unmoeglich. Jetzt eigener Wert twinReasoningEffort
  // (FALSIFY_TWIN_REASONING_EFFORT / config.json twinReasoningEffort),
  // gleiche Enum-Validierung wie beim Primaerwert, Fallback = Primaerwert.
  const maxTokens = pickNum("FALSIFY_MAX_TOKENS", data, "maxTokens", DEFAULTS.maxTokens, { min: 256, max: 1_000_000 });
  const twinReasoningEffort = String(pick("FALSIFY_TWIN_REASONING_EFFORT", data, "twinReasoningEffort", "")).toLowerCase();
  if (twinReasoningEffort && !["high", "medium", "low", "auto", "off"].includes(twinReasoningEffort)) {
    throw new Error(`Ungueltige Konfiguration: FALSIFY_TWIN_REASONING_EFFORT/twinReasoningEffort = "${twinReasoningEffort}" (erlaubt: high, medium, low, auto, off)`);
  }
  return {
    model,
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
    maxTokens: maxTokens,
    reasoningEffort,
    maxToolRounds: pickNum("FALSIFY_MAX_TOOL_ROUNDS", data, "maxToolRounds", DEFAULTS.maxToolRounds, { min: 1, max: 20 }),
    maxRpm: pickNum("FALSIFY_MAX_RPM", data, "maxRpm", DEFAULTS.maxRpm, { min: 1, max: 1000 }),
    lang,
    temperature: pickNum("FALSIFY_TEMPERATURE", data, "temperature", DEFAULTS.temperature, { min: 0, max: 2 }),
    timeoutMs: pickNum("FALSIFY_TIMEOUT_MS", data, "timeoutMs", DEFAULTS.timeoutMs, { min: 1000, max: 3_600_000 }),
    // Twin: Fallback = Primärmodell (ehrlich: dann gibt es KEINE Modell-Diversität).
    twinModel: twinModel || model,
    twinApiBase: twinApiBase || apiBase,
    // F-3: eigener Twin-Effort; bewusst NICHT auf „high" zurueckfallen, sondern
    // auf den konfigurierten Primaerwert (Nutzerentscheidung bleibt sichtbar).
    twinReasoningEffort: twinReasoningEffort || reasoningEffort,
    // F-11: eigener Twin-Token-Budget. Default = min(Primaerwert, 16384),
    // weil Groq (qwen/qwen3.6-27b) > 16384 mit 400 ablehnt — der geerbte
    // Primaerwert (bis 1e6) wuerde jede Groq-Twin-Freigabe unmöglich machen.
    // (OpenRouter-Free-Tier liegt teils noch niedriger — dann per CLI setzen.)
    twinMaxTokens: pickNum("FALSIFY_TWIN_MAX_TOKENS", data, "twinMaxTokens", Math.min(maxTokens, 16384), { min: 256, max: 1_000_000 }),
    twinApiKeyEnv: twinApiKeyEnv ? [twinApiKeyEnv, ...(() => {
      const base = String(pick("FALSIFY_API_KEY_ENV", data, "apiKeyEnv", DEFAULTS.apiKeyEnv))
        .split(",").map((s) => s.trim()).filter(Boolean);
      const named = typeof data.apiKeyName === "string" && data.apiKeyName.trim()
        ? data.apiKeyName.trim()
        : null;
      return named ? [named, ...base.filter((n) => n !== named)] : base;
    })()] : undefined,
    twinDiversity: Boolean(twinModel) && twinModel !== model,
    configFile: file,
  };
}
