// FalsifyMe - Runtime-Settings
// Verantwortung: provider-/modell-neutrale Konfiguration ausserhalb des Repos.
// Secrets werden nur in FALSIFY_HOME/.env gespeichert und niemals ausgegeben.
import fs from "node:fs";
import path from "node:path";
import { falsifyHome } from "../artifacts/db.mjs";
import { loadConfig } from "./config.mjs";

// F-2/F-3-Fix (Live-E2E 2026-09-02): Die Evil-Twin-Diversität (config.mjs liest
// twinModel/twinApiBase/twinApiKeyEnv seit Security-Review Pkt 3/10, dazu seit
// F-3 twinReasoningEffort) war per CLI nicht konfigurierbar - `settings set
// twin*` warf „Unbekannte Runtime-Einstellung". Jetzt Teil der Runtime-
// Einstellungen, inkl. Enum-Validierung fuer twinReasoningEffort.
const CONFIG_KEYS = Object.freeze([
  "provider", "apiBase", "model", "apiKeyEnv", "maxTokens", "reasoningEffort",
  "maxToolRounds", "maxRpm", "lang", "temperature", "timeoutMs", "pricing",
  "twinModel", "twinApiBase", "twinApiKeyEnv", "twinReasoningEffort",
  "twinMaxTokens",
]);

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

function configPath() {
  return path.join(falsifyHome(), "config.json");
}

function envPath() {
  return process.env.FALSIFY_ENV || path.join(falsifyHome(), ".env");
}

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Atomar schreiben: erst in Temp-Datei, dann rename ueber das Ziel. Ein
// Leser sieht nie eine halb geschriebene Datei (Rename ist auf demselben
// Dateisystem atomar; Windows: MoveFileEx mit REPLACE_EXISTING).
function writePrivate(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch { /* Windows ACLs */ }
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs */ }
}

// ── Cross-Process-Settings-Lock (User-Ticket 2026-09-03) ──────────────────
// Zwei parallele `falsify settings set`-Aufrufe (oder Onboarding parallel zu
// einem Agenten) duerfen config.json/.env NICHT im Last-Write-Wins-Verfahren
// ueberschreiben: jeder Schreiber liest-mutiert-schreibt die GESAMTE Datei.
// Ohne Lock verliert der schnellere Schreiber still die Aenderung des anderen
// (z. B. verschobene Primaer-Key-Reihenfolge, verlorener/zertrennter Key).
// Der Lock serialisiert die Mutation ueber Prozessgrenzen; stale Locks
// (> LOCK_STALE_MS) werden uebernommen, sonst ehrlicher Abbruch statt stiller
// Korruption. Reentrant aus demselben Prozess ist nicht noetig (eine
// Mutation pro updateRuntimeSettings-Aufruf).
const LOCK_STALE_MS = 5000;
const LOCK_WAIT_MAX_MS = 10000;
const LOCK_RETRY_MS = 40;

function settingsLockPath() {
  return path.join(falsifyHome(), ".settings.lock");
}

function acquireSettingsLock() {
  const deadline = Date.now() + LOCK_WAIT_MAX_MS;
  for (;;) {
    try {
      const fd = fs.openSync(settingsLockPath(), "wx", 0o600);
      try { fs.writeFileSync(fd, String(process.pid), { encoding: "utf8" }); } catch { /* PID nur Diagnose */ }
      fs.closeSync(fd);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const st = fs.statSync(settingsLockPath());
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try { fs.unlinkSync(settingsLockPath()); } catch { /* weg */ }
          continue;
        }
      } catch { continue; } // Lock wurde zwischenzeitlich entfernt
      if (Date.now() > deadline) {
        throw new Error(`Settings-Lock haelt seit >${LOCK_STALE_MS} ms (${settingsLockPath()}) – abbrechen statt still zu ueberschreiben.`);
      }
      const until = Date.now() + LOCK_RETRY_MS;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, until - Date.now()));
    }
  }
}

function releaseSettingsLock() {
  try { fs.unlinkSync(settingsLockPath()); } catch { /* schon weg */ }
}

function withSettingsLock(fn) {
  acquireSettingsLock();
  try {
    return fn();
  } finally {
    releaseSettingsLock();
  }
}

function readEnv(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function hasEnvKey(file, name) {
  const marker = `${name}=`;
  return readEnv(file).split(/\r?\n/).some((line) => {
    if (!line.startsWith(marker)) return false;
    return line.slice(marker.length).trim().replace(/^["']|["']$/g, "").length > 0;
  });
}

function quoteEnv(value) {
  return JSON.stringify(String(value));
}

function writeEnvKey(name, value) {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) {
    throw new Error(`Ungueltiger API-Key-Name: ${name}`);
  }
  const file = envPath();
  const source = readEnv(file);
  const lines = source ? source.split(/\r?\n/) : [];
  const marker = `${name}=`;
  let replaced = false;
  const next = lines.map((line) => {
    if (line.startsWith(marker)) {
      replaced = true;
      return `${name}=${quoteEnv(value)}`;
    }
    return line;
  });
  if (!replaced) next.push(`${name}=${quoteEnv(value)}`);
  writePrivate(file, next.join("\n").replace(/\n+$/, "") + "\n");
  return file;
}

function redact(value, key = "") {
  if (value === undefined || value === null) return value;
  if (/key|secret|token|password/i.test(key)) return value ? "********" : "";
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  return value;
}

function validateString(value, key) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} muss ein nichtleerer Text sein`);
  return value.trim();
}

function validateSettings(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!CONFIG_KEYS.includes(key) && key !== "apiKey" && key !== "apiKeyName") {
      throw new Error(`Unbekannte Runtime-Einstellung: ${key}`);
    }
    if (["provider", "model", "apiKeyEnv", "apiKeyName", "twinModel", "twinApiKeyEnv"].includes(key)) out[key] = validateString(value, key);
    else if (key === "apiBase" || key === "twinApiBase") {
      const v = validateString(value, key).replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(v)) throw new Error(`${key} muss mit http:// oder https:// beginnen`);
      out[key] = v;
    } else if (key === "pricing") {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("pricing muss ein Objekt sein");
      out[key] = cloneJson(value);
    } else if (["maxTokens", "maxToolRounds", "maxRpm", "temperature", "timeoutMs"].includes(key)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${key} muss eine Zahl sein`);
      out[key] = n;
    } else if (key === "twinMaxTokens") {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${key} muss eine Zahl sein`);
      if (n < 256 || n > 1_000_000) throw new Error(`${key} muss zwischen 256 und 1000000 sein`);
      out[key] = n;
    } else if (key === "reasoningEffort" || key === "twinReasoningEffort") {
      const v = validateString(value, key).toLowerCase();
      if (!["high", "medium", "low", "auto", "off"].includes(v)) {
        throw new Error(`${key} muss eines von high|medium|low|auto|off sein`);
      }
      out[key] = v;
    } else if (key === "lang") {
      out[key] = validateString(value, key);
    } else {
      out[key] = value;
    }
  }
  if (out.apiKey !== undefined) {
    if (!out.apiKeyName) out.apiKeyName = out.apiKeyEnv || "FALSIFY_API_KEY";
  }
  return out;
}

/** Liest die effektive Konfiguration und gibt niemals den API-Key zurueck. */
export function getRuntimeSettings() {
  const cfg = loadConfig();
  const file = readJson(configPath());
  const keyName = String(file.apiKeyName || file.apiKeyEnv || process.env.FALSIFY_API_KEY_ENV || "FALSIFY_API_KEY").split(",")[0].trim();
  const twinKeyName = String(file.twinApiKeyEnv || process.env.FALSIFY_TWIN_API_KEY_ENV || "").split(",")[0].trim() || null;
  const result = {
    provider: file.provider || cfg.provider,
    apiBase: cfg.apiBase,
    model: cfg.model,
    apiKeyEnv: cfg.keyEnvNames.join(","),
    keyConfigured: Boolean(process.env[keyName]?.trim()) || hasEnvKey(envPath(), keyName),
    configFile: configPath(),
    envFile: envPath(),
  };
  // Evil-Twin-Diversität (F-2/F-3-Fix 2026-09-02): Twin-Modell/-Basis/-Key-Name
  // /-Reasoning-Effort in settings show sichtbar (Werte maskiert; Namen sind
  // keine Secrets). twinReasoningEffort ist der aufgeloeste Wert (Fallback
  // = Primaer-Effort) - die Sichtbarkeit macht die Erbschaft ehrlich.
  result.twin = {
    model: cfg.twinModel,
    apiBase: cfg.twinApiBase,
    apiKeyEnv: twinKeyName,
    reasoningEffort: cfg.twinReasoningEffort,
    // F-11: eigenes Twin-Token-Budget (Default min(Primaer,16384) — sichtbar,
    // damit die Groq-/OpenRouter-Begrenzung nicht still greift).
    maxTokens: cfg.twinMaxTokens,
    diversity: cfg.twinDiversity,
  };
  if (file.pricing !== undefined) result.pricing = redact(file.pricing);
  for (const key of ["maxTokens", "reasoningEffort", "maxToolRounds", "maxRpm", "lang", "temperature", "timeoutMs"]) {
    result[key] = cfg[key];
  }
  return result;
}

/**
 * Aktualisiert Runtime-Werte. Provider/Model/API-Base werden in config.json,
 * der Key ausschließlich in der privaten .env gespeichert.
 */
export function updateRuntimeSettings(patch = {}) {
  const normalized = validateSettings(patch);
  // Unter dem Lock: config.json NEU lesen (nicht den Stand von vor dem Lock),
  // mutieren, schreiben — und .env ebenso. Zwei parallele Aufrufe verlieren
  // sich damit nicht mehr gegenseitig (Last-Write-Wins-Fix, 2026-09-03).
  return withSettingsLock(() => {
    const file = readJson(configPath());
    const key = normalized.apiKey;
    const keyName = normalized.apiKeyName || normalized.apiKeyEnv;
    delete normalized.apiKey;
    // Der Name darf in config.json stehen; der geheime Wert bleibt ausschliesslich
    // in .env und wird nie in der Konfigurationsdatei gespeichert.
    if (keyName) normalized.apiKeyName = keyName;
    Object.assign(file, normalized);
    writePrivate(configPath(), JSON.stringify(file, null, 2) + "\n");
    if (key !== undefined) writeEnvKey(keyName || "FALSIFY_API_KEY", key);
    return getRuntimeSettings();
  });
}

function authHeaders(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/**
 * Ruft den OpenAI-kompatiblen /models-Endpunkt ab. Pricing wird nur aus der
 * Provider-Antwort (pricing/cost) oder lokaler config.json uebernommen.
 */
export async function fetchAvailableModels({ apiBase, apiKey, timeoutMs = 15000 } = {}) {
  const settings = getRuntimeSettings();
  const base = String(apiBase || settings.apiBase).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) throw new Error("apiBase muss mit http:// oder https:// beginnen");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Accept: "application/json", ...authHeaders(apiKey) },
      signal: controller.signal,
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = {}; }
    if (!res.ok) throw new Error(`Models-Abfrage HTTP ${res.status}: ${text.slice(0, 300)}`);
    const localPricing = readJson(configPath()).pricing || {};
    const rows = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
    return rows.map((item) => {
      const id = typeof item === "string" ? item : String(item.id || item.name || "");
      const pricing = item.pricing ?? item.cost ?? localPricing[id] ?? null;
      return { id, ownedBy: item.owned_by ?? item.provider ?? null, pricing };
    }).filter((item) => item.id);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prueft genau ein vom Nutzer ausgewaehltes Modell gegen den konfigurierten
 * Endpunkt. Ein erfolgreicher /models-Katalog ist nur ein Katalog-Nachweis;
 * diese minimale Completion prueft den Konto-/Entitlement-Zugriff.
 */
export async function probeModelAccess({ apiBase, apiKey, model, timeoutMs = 15000 } = {}) {
  const settings = getRuntimeSettings();
  const base = String(apiBase || settings.apiBase).replace(/\/+$/, "");
  const selected = String(model || "").trim();
  if (!/^https?:\/\//i.test(base)) throw new Error("apiBase muss mit http:// oder https:// beginnen");
  if (!selected) throw new Error("model muss ein nichtleerer Text sein");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
      body: JSON.stringify({
        model: selected,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 1,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Modell-Probe HTTP ${res.status}: ${text.slice(0, 300)}`);
    let body;
    try { body = JSON.parse(text); } catch {
      throw new Error("Modell-Probe lieferte keine gueltige JSON-Antwort");
    }
    if (!body || typeof body !== "object" || !Array.isArray(body.choices) || body.choices.length === 0) {
      throw new Error("Modell-Probe lieferte keine Completion");
    }
    return { ok: true, model: selected, providerModel: body.model || null };
  } finally {
    clearTimeout(timer);
  }
}

export const settingsPaths = () => ({ configFile: configPath(), envFile: envPath() });
export const redactSettings = redact;
