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
  maxJobAttempts: 2,
  jobRetryBackoffMs: 2000,
  webSearchEnabled: false,
  webSearchApiBase: "https://google.serper.dev",
  webSearchKeyEnv: "SERPER_API_KEY",
  webSearchDomains: "",
  webSearchMaxResults: 5,
  webSearchMinIntervalMs: 1000,
  twinWebSearchEnabled: false,
};

// These are the only fields allowed in a persisted job snapshot. Keeping the
// allowlist here makes accidental secret/reasoning additions fail closed.
const SNAPSHOT_KEYS = Object.freeze([
  "model", "apiBase", "provider", "keyEnvNames", "maxTokens", "reasoningEffort",
  "maxToolRounds", "maxRpm", "lang", "temperature", "timeoutMs",
  "maxJobAttempts", "jobRetryBackoffMs", "twinModel", "twinApiBase",
  "twinReasoningEffort", "twinMaxTokens", "twinApiKeyEnv", "twinDiversity",
  "webSearchEnabled", "webSearchApiBase", "webSearchKeyEnv", "webSearchDomains",
  "webSearchMaxResults", "webSearchMinIntervalMs", "twinWebSearchEnabled",
]);

function loadConfigFile() {
  const file = path.join(falsifyHome(), "config.json");
  try { return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) }; }
  catch { return { file, data: {} }; }
}

/** Liest einen Wert: Env-Var → config.json → Default. */
function pick(envKey, fileData, fileKey, def, overrides = {}) {
  // A persisted job snapshot is authoritative, including an intentional empty
  // value. Only an absent override falls through to process/config defaults.
  if (Object.prototype.hasOwnProperty.call(overrides, fileKey)) return overrides[fileKey];
  const e = process.env[envKey];
  if (e !== undefined && e !== "") return e;
  if (fileData[fileKey] !== undefined && fileData[fileKey] !== "") return fileData[fileKey];
  return def;
}

function pickNum(envKey, fileData, fileKey, def, { min, max } = {}, overrides = {}) {
  const raw = pick(envKey, fileData, fileKey, String(def), overrides);
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

function pickBool(envKey, fileData, fileKey, def, overrides = {}) {
  const raw = pick(envKey, fileData, fileKey, def, overrides);
  if (typeof raw === "boolean") return raw;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "ja", "on"].includes(value)) return true;
  if (["0", "false", "no", "nein", "off", ""].includes(value)) return false;
  throw new Error(`Ungültige Konfiguration: ${envKey}/${fileKey} = "${raw}" (erlaubt: true|false)`);
}

function validateUrl(value, label) {
  const url = String(value || "").replace(/\/+$/, "");
  if (url && !/^https?:\/\//i.test(url)) {
    throw new Error(`Ungültige Konfiguration: ${label} = "${url}" (muss mit http:// oder https:// beginnen)`);
  }
  return url;
}

/** Provider-Label nur zur Anzeige (nie für Logik). */
export function providerLabel(apiBase) {
  const b = String(apiBase || "").toLowerCase();
  if (b.includes("api.openai.com")) return "OpenAI";
  if (b.includes("integrate.api.nvidia.com")) return "NVIDIA NIM";
  if (isLocalApiBase(b)) return "lokal (Ollama/LM Studio)";
  if (b) return "OpenAI-kompatibel";
  return "?";
}

/**
 * Loopback-Provider wie Ollama und LM Studio akzeptieren üblicherweise keinen
 * API-Key. Remote-Endpunkte bleiben key-pflichtig; die Entscheidung ist rein
 * aus der Zieladresse abgeleitet und erteilt kein Verdict.
 */
export function isLocalApiBase(apiBase) {
  try {
    const url = new URL(String(apiBase || ""));
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function requiresApiKey(apiBase) {
  return !isLocalApiBase(apiBase);
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
export function loadConfig(overrides = {}) {
  const { file, data } = loadConfigFile();
  const apiBase = validateUrl(pick("FALSIFY_API_BASE", data, "apiBase", DEFAULTS.apiBase, overrides), "FALSIFY_API_BASE/apiBase");
  if (!apiBase) {
    throw new Error("Ungültige Konfiguration: FALSIFY_API_BASE/apiBase darf nicht leer sein");
  }
  const lang = String(pick("FALSIFY_LANG", data, "lang", DEFAULTS.lang, overrides)).toLowerCase();
  const reasoningEffort = String(pick("FALSIFY_REASONING_EFFORT", data, "reasoningEffort", DEFAULTS.reasoningEffort, overrides)).toLowerCase();
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
  const model = String(pick("FALSIFY_MODEL", data, "model", DEFAULTS.model, overrides)).trim();
  const twinModel = String(pick("FALSIFY_TWIN_MODEL", data, "twinModel", "", overrides)).trim();
  const twinApiBase = validateUrl(pick("FALSIFY_TWIN_API_BASE", data, "twinApiBase", "", overrides), "FALSIFY_TWIN_API_BASE/twinApiBase");
  const twinApiKeyEnv = String(pick("FALSIFY_TWIN_API_KEY_ENV", data, "twinApiKeyEnv", "", overrides)).trim();
  // F-3-Fix (Live-E2E 2026-09-02): Der Twin erbte den reasoningEffort des
  // Primaermodells - Groq lehnt `reasoning_effort=high` mit HTTP 400 ab
  // (live belegt), damit war eine Twin-Freigabe (BESTAETIGT) mit Groq-Twin
  // bei high strukturell unmoeglich. Jetzt eigener Wert twinReasoningEffort
  // (FALSIFY_TWIN_REASONING_EFFORT / config.json twinReasoningEffort),
  // gleiche Enum-Validierung wie beim Primaerwert, Fallback = Primaerwert.
  const maxTokens = pickNum("FALSIFY_MAX_TOKENS", data, "maxTokens", DEFAULTS.maxTokens, { min: 256, max: 1_000_000 }, overrides);
  const twinReasoningEffort = String(pick("FALSIFY_TWIN_REASONING_EFFORT", data, "twinReasoningEffort", "", overrides)).toLowerCase();
  if (twinReasoningEffort && !["high", "medium", "low", "auto", "off"].includes(twinReasoningEffort)) {
    throw new Error(`Ungueltige Konfiguration: FALSIFY_TWIN_REASONING_EFFORT/twinReasoningEffort = "${twinReasoningEffort}" (erlaubt: high, medium, low, auto, off)`);
  }
  return {
    model,
    apiBase,
    provider: String(pick("FALSIFY_PROVIDER", data, "provider", providerLabel(apiBase), overrides)).trim(),
    keyEnvNames: (() => {
      // Ein Job-Snapshot liefert bereits die aufgelöste Reihenfolge. Sie muss
      // auch dann Vorrang behalten, wenn config.json inzwischen einen anderen
      // apiKeyName enthält (kein stiller Settings-Drift zwischen Submit und Run).
      if (Array.isArray(overrides.keyEnvNames)) {
        return overrides.keyEnvNames.map((s) => String(s).trim()).filter(Boolean);
      }
      // Liste: FALSIFY_API_KEY_ENV → config.json apiKeyEnv → Default. Ein explizit
      // via `falsify settings set apiKeyName=…` gesetzter Name hat Vorrang
      // (settings.mjs löst ihn genauso auf) – sonst wäre der konfigurierte
      // Key-Name für Jobs unsichtbar („Kein API-Key gefunden“).
      const base = String(pick("FALSIFY_API_KEY_ENV", data, "apiKeyEnv", DEFAULTS.apiKeyEnv, overrides))
        .split(",").map((s) => s.trim()).filter(Boolean);
      const named = typeof data.apiKeyName === "string" && data.apiKeyName.trim()
        ? data.apiKeyName.trim()
        : null;
      return named ? [named, ...base.filter((n) => n !== named)] : base;
    })(),
    maxTokens: maxTokens,
    reasoningEffort,
    maxToolRounds: pickNum("FALSIFY_MAX_TOOL_ROUNDS", data, "maxToolRounds", DEFAULTS.maxToolRounds, { min: 1, max: 20 }, overrides),
    maxRpm: pickNum("FALSIFY_MAX_RPM", data, "maxRpm", DEFAULTS.maxRpm, { min: 1, max: 1000 }, overrides),
    lang,
    temperature: pickNum("FALSIFY_TEMPERATURE", data, "temperature", DEFAULTS.temperature, { min: 0, max: 2 }, overrides),
    timeoutMs: pickNum("FALSIFY_TIMEOUT_MS", data, "timeoutMs", DEFAULTS.timeoutMs, { min: 1000, max: 3_600_000 }, overrides),
    maxJobAttempts: pickNum("FALSIFY_MAX_JOB_ATTEMPTS", data, "maxJobAttempts", DEFAULTS.maxJobAttempts, { min: 1, max: 5 }, overrides),
    jobRetryBackoffMs: pickNum("FALSIFY_JOB_RETRY_BACKOFF_MS", data, "jobRetryBackoffMs", DEFAULTS.jobRetryBackoffMs, { min: 0, max: 3_600_000 }, overrides),
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
    twinMaxTokens: pickNum("FALSIFY_TWIN_MAX_TOKENS", data, "twinMaxTokens", Math.min(maxTokens, 16384), { min: 256, max: 1_000_000 }, overrides),
    // A snapshot with null means "no dedicated Twin key" and must not fall
    // through to current settings. This explicit branch preserves that choice.
    twinApiKeyEnv: Object.prototype.hasOwnProperty.call(overrides, "twinApiKeyEnv") && overrides.twinApiKeyEnv === null
      ? undefined
      : Array.isArray(overrides.twinApiKeyEnv)
        ? overrides.twinApiKeyEnv.map((s) => String(s).trim()).filter(Boolean)
        : (twinApiKeyEnv ? [twinApiKeyEnv, ...(() => {
          const base = String(pick("FALSIFY_API_KEY_ENV", data, "apiKeyEnv", DEFAULTS.apiKeyEnv, overrides))
            .split(",").map((s) => s.trim()).filter(Boolean);
          const named = typeof data.apiKeyName === "string" && data.apiKeyName.trim()
            ? data.apiKeyName.trim()
            : null;
          return named ? [named, ...base.filter((n) => n !== named)] : base;
        })()] : undefined),
    twinDiversity: Boolean(twinModel) && twinModel !== model,
    webSearchEnabled: pickBool("FALSIFY_WEB_SEARCH_ENABLED", data, "webSearchEnabled", DEFAULTS.webSearchEnabled, overrides),
    webSearchApiBase: validateUrl(pick("FALSIFY_WEB_SEARCH_API_BASE", data, "webSearchApiBase", DEFAULTS.webSearchApiBase, overrides), "FALSIFY_WEB_SEARCH_API_BASE"),
    webSearchKeyEnv: String(pick("FALSIFY_WEB_SEARCH_KEY_ENV", data, "webSearchKeyEnv", DEFAULTS.webSearchKeyEnv, overrides)).trim(),
    webSearchDomains: String(pick("FALSIFY_WEB_SEARCH_DOMAINS", data, "webSearchDomains", DEFAULTS.webSearchDomains, overrides)).trim(),
    webSearchMaxResults: pickNum("FALSIFY_WEB_SEARCH_MAX_RESULTS", data, "webSearchMaxResults", DEFAULTS.webSearchMaxResults, { min: 1, max: 20 }, overrides),
    webSearchMinIntervalMs: pickNum("FALSIFY_WEB_SEARCH_MIN_INTERVAL_MS", data, "webSearchMinIntervalMs", DEFAULTS.webSearchMinIntervalMs, { min: 0, max: 3_600_000 }, overrides),
    twinWebSearchEnabled: pickBool("FALSIFY_TWIN_WEB_SEARCH_ENABLED", data, "twinWebSearchEnabled", DEFAULTS.twinWebSearchEnabled, overrides),
    configFile: file,
  };
}

/**
 * Erstellt den nicht-geheimen Laufzeit-Snapshot, der in einen Job geschrieben
 * wird. API-Key-Werte und Prozess-Umgebungsvariablen sind absichtlich nicht
 * enthalten; ein späterer Settings-Wechsel kann den Job nicht umkonfigurieren.
 */
export function snapshotConfig(cfg) {
  return {
    model: cfg.model,
    apiBase: cfg.apiBase,
    provider: cfg.provider,
    keyEnvNames: [...(cfg.keyEnvNames || [])],
    maxTokens: cfg.maxTokens,
    reasoningEffort: cfg.reasoningEffort,
    maxToolRounds: cfg.maxToolRounds,
    maxRpm: cfg.maxRpm,
    lang: cfg.lang,
    temperature: cfg.temperature,
    timeoutMs: cfg.timeoutMs,
    maxJobAttempts: cfg.maxJobAttempts,
    jobRetryBackoffMs: cfg.jobRetryBackoffMs,
    twinModel: cfg.twinModel,
    twinApiBase: cfg.twinApiBase,
    twinReasoningEffort: cfg.twinReasoningEffort,
    twinMaxTokens: cfg.twinMaxTokens,
    twinApiKeyEnv: cfg.twinApiKeyEnv ? [...cfg.twinApiKeyEnv] : null,
    twinDiversity: Boolean(cfg.twinDiversity),
    webSearchEnabled: Boolean(cfg.webSearchEnabled),
    webSearchApiBase: cfg.webSearchApiBase,
    webSearchKeyEnv: cfg.webSearchKeyEnv,
    webSearchDomains: cfg.webSearchDomains,
    webSearchMaxResults: cfg.webSearchMaxResults,
    webSearchMinIntervalMs: cfg.webSearchMinIntervalMs,
    twinWebSearchEnabled: Boolean(cfg.twinWebSearchEnabled),
  };
}

/** Lädt einen gespeicherten Snapshot ohne auf spätere Env-/Datei-Werte zurückzufallen. */
export function configFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Ungültiger Job-Laufzeit-Snapshot");
  }
  const actualKeys = Object.keys(snapshot).sort();
  const expectedKeys = [...SNAPSHOT_KEYS].sort();
  const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
  const unknown = actualKeys.filter((key) => !expectedKeys.includes(key));
  if (missing.length || unknown.length) {
    throw new Error(`Ungültiger Job-Laufzeit-Snapshot (fehlend: ${missing.join(", ") || "keine"}; unbekannt: ${unknown.join(", ") || "keine"})`);
  }
  if (!Array.isArray(snapshot.keyEnvNames) || snapshot.keyEnvNames.some((name) => typeof name !== "string" || !name.trim())) {
    throw new Error("Ungültiger Job-Laufzeit-Snapshot: keyEnvNames muss eine Namensliste sein");
  }
  if (snapshot.twinApiKeyEnv !== null && (!Array.isArray(snapshot.twinApiKeyEnv) || snapshot.twinApiKeyEnv.some((name) => typeof name !== "string" || !name.trim()))) {
    throw new Error("Ungültiger Job-Laufzeit-Snapshot: twinApiKeyEnv muss null oder eine Namensliste sein");
  }

  // Every loadConfig input is explicitly supplied. The current process/env
  // configuration is therefore unable to change a queued or retried job.
  const overrides = { ...snapshot, keyEnvNames: [...snapshot.keyEnvNames] };
  overrides.twinApiKeyEnv = snapshot.twinApiKeyEnv === null ? null : [...snapshot.twinApiKeyEnv];
  const cfg = loadConfig(overrides);
  const normalized = snapshotConfig(cfg);
  for (const key of SNAPSHOT_KEYS) {
    if (JSON.stringify(normalized[key]) !== JSON.stringify(snapshot[key])) {
      throw new Error(`Job-Laufzeit-Snapshot konnte bei ${key} nicht unverändert geladen werden`);
    }
  }
  return cfg;
}
