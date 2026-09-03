import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-settings-"));
process.env.FALSIFY_HOME = home;
process.env.FALSIFY_API_KEY_ENV = "CUSTOM_PROVIDER_KEY";
const settings = await import("../core/settings.mjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Kindprozess, der einen updateRuntimeSettings-Aufruf in EIGENEM FALSIFY_HOME
// ausfuehrt (echter separater Prozess -> echter Cross-Process-Race, kein Mock).
const CHILD_SCRIPT = `
  const { updateRuntimeSettings } = await import(process.env.SETTINGS_URL);
  updateRuntimeSettings(JSON.parse(process.env.PATCH));
`;
function runSettingsChild(tmp, patch) {
  return new Promise((resolve) => {
    const env = { ...process.env, FALSIFY_HOME: tmp, SETTINGS_URL: pathToFileURL(path.join(ROOT, "core", "settings.mjs")).href, PATCH: JSON.stringify(patch) };
    delete env.FALSIFY_API_KEY_ENV; // Kind mit sauberen Default-Key-Namen starten
    const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD_SCRIPT], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ code, err }));
  });
}

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test("Runtime-Settings speichern freie Provider-/API-/Model-Werte", () => {
  const result = settings.updateRuntimeSettings({
    provider: "Acme Inference",
    apiBase: "https://example.invalid/v9",
    model: "acme/custom-model",
    apiKeyEnv: "CUSTOM_PROVIDER_KEY",
  });
  assert.equal(result.provider, "Acme Inference");
  assert.equal(result.apiBase, "https://example.invalid/v9");
  assert.equal(result.model, "acme/custom-model");
  const stored = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  assert.equal(stored.model, "acme/custom-model");
  assert.equal(stored.apiBase, "https://example.invalid/v9");
});

test("API-Key wird ausserhalb des Repos gespeichert und nicht zurueckgegeben", () => {
  const result = settings.updateRuntimeSettings({ apiKey: "super-secret-value", apiKeyName: "CUSTOM_PROVIDER_KEY" });
  assert.equal(result.apiKey, undefined);
  assert.equal(result.keyConfigured, true);
  assert.equal(result.keyConfigured, true, "Key ist in der privaten .env konfiguriert");
  assert.equal(process.env.CUSTOM_PROVIDER_KEY, undefined, "Prozess-Env bleibt unveraendert");
  const envText = fs.readFileSync(path.join(home, ".env"), "utf8");
  assert.match(envText, /CUSTOM_PROVIDER_KEY=/);
  assert.match(envText, /super-secret-value/);
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value/);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(home, ".env")).mode & 0o777, 0o600);
});

test("Models-Endpunkt liefert freie IDs und nur vorhandenes Pricing", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.url, "/v1/models");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [
      { id: "acme/fast", owned_by: "acme", pricing: { input: "0.01" } },
      { id: "acme/free", owned_by: "acme" },
    ] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const models = await settings.fetchAvailableModels({
      apiBase: `http://127.0.0.1:${port}/v1`,
      apiKey: "test-key",
    });
    assert.deepEqual(models, [
      { id: "acme/fast", ownedBy: "acme", pricing: { input: "0.01" } },
      { id: "acme/free", ownedBy: "acme", pricing: null },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Modell-Probe sendet exakt die Nutzerwahl und behandelt Konto-404 fail-closed", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
      res.writeHead(404);
      res.end();
      return;
    }
    let text = "";
    req.on("data", (chunk) => { text += chunk; });
    req.on("end", () => {
      requests.push({
        body: JSON.parse(text),
        authorization: req.headers.authorization,
      });
      const selected = requests.at(-1).body.model;
      if (selected === "account/not-entitled") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "Function not found for account" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: selected, choices: [{ message: { content: "OK" } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const apiBase = `http://127.0.0.1:${server.address().port}/v1`;
    const result = await settings.probeModelAccess({ apiBase, apiKey: "test-key", model: "account/chosen" });
    assert.deepEqual(result, { ok: true, model: "account/chosen", providerModel: "account/chosen" });
    await assert.rejects(
      () => settings.probeModelAccess({ apiBase, apiKey: "test-key", model: "account/not-entitled" }),
      /Modell-Probe HTTP 404/,
    );
    assert.deepEqual(requests.map((request) => request.body.model), ["account/chosen", "account/not-entitled"]);
    assert.deepEqual(requests.map((request) => request.authorization), ["Bearer test-key", "Bearer test-key"]);
    assert.equal(requests[0].body.max_tokens, 1);
    assert.equal(requests[0].body.temperature, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("ungültige API-Basis wird vor Netzwerkzugriff abgewiesen", async () => {
  await assert.rejects(() => settings.fetchAvailableModels({ apiBase: "not-a-url" }), /apiBase/);
});

test("F-2: settings set akzeptiert Twin-Einstellungen (twinModel/twinApiBase/twinApiKeyEnv)", () => {
  const result = settings.updateRuntimeSettings({
    twinModel: "qwen/qwen3.6-27b",
    twinApiBase: "https://api.groq.com/openai/v1",
    twinApiKeyEnv: "OPENAI_API_KEY",
  });
  assert.equal(result.twin.model, "qwen/qwen3.6-27b");
  assert.equal(result.twin.apiBase, "https://api.groq.com/openai/v1");
  assert.equal(result.twin.apiKeyEnv, "OPENAI_API_KEY");
  assert.equal(result.twin.diversity, true);
  const stored = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  assert.equal(stored.twinModel, "qwen/qwen3.6-27b");
  assert.equal(stored.twinApiBase, "https://api.groq.com/openai/v1");
  assert.equal(stored.twinApiKeyEnv, "OPENAI_API_KEY");
  // Twin-Keys sind Konfiguration, keine Secrets: .env bleibt von diesem Aufruf unberührt.
  const envText = fs.readFileSync(path.join(home, ".env"), "utf8");
  assert.doesNotMatch(envText, /qwen\/qwen3\.6-27b/);
});

test("F-2: settings show enthält die Twin-Sicht ohne Secret-Werte", () => {
  const shown = settings.getRuntimeSettings();
  assert.equal(shown.twin.model, "qwen/qwen3.6-27b");
  assert.equal(shown.twin.apiKeyEnv, "OPENAI_API_KEY");
  assert.equal(typeof shown.twin.diversity, "boolean");
  assert.doesNotMatch(JSON.stringify(shown), /openai_api_key=\w+/i);
});

test("F-2: ungültige twinApiBase wird vor Netzwerkzugriff abgewiesen", () => {
  assert.throws(
    () => settings.updateRuntimeSettings({ twinApiBase: "api.groq.com/openai/v1" }),
    /twinApiBase muss mit https?:\/\//,
  );
  assert.throws(() => settings.updateRuntimeSettings({ twinModel: "" }), /twinModel muss ein nichtleerer Text sein/);
  assert.throws(() => settings.updateRuntimeSettings({ twinApiKeyEnv: "  " }), /twinApiKeyEnv muss ein nichtleerer Text sein/);
});

test("F-3: twinReasoningEffort wird akzeptiert, enumsvalidiert und von loadConfig geladen", async () => {
  const { loadConfig } = await import("../core/config.mjs");
  assert.equal(loadConfig().twinReasoningEffort, "high", "Fallback: ohne Setzen erbt der Twin den Primaer-Effort");
  const result = settings.updateRuntimeSettings({ twinReasoningEffort: "off" });
  assert.equal(result.twin.reasoningEffort, "off");
  const stored = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  assert.equal(stored.twinReasoningEffort, "off");
  assert.equal(loadConfig().twinReasoningEffort, "off");
  // Enum-Validierung (high|medium|low|auto|off), auch gemischt-gross (normalisiert).
  const lower = settings.updateRuntimeSettings({ twinReasoningEffort: "HIGH" });
  assert.equal(lower.twin.reasoningEffort, "high");
  assert.throws(() => settings.updateRuntimeSettings({ twinReasoningEffort: "ultra" }), /twinReasoningEffort muss eines von high\|medium\|low\|auto\|off sein/);
  // config.json-Direkt-Eingriffe (Hand-Edit) werden beim Laden ehrlich abgewiesen.
  const before = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ ...before, twinReasoningEffort: "ultra" }), "utf8");
  assert.throws(() => loadConfig(), /twinReasoningEffort/);
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify(before), "utf8");
  assert.equal(loadConfig().twinReasoningEffort, "high", "Restore: valid erneut ladbar");
});

test("parallele settings-Writes verlieren keine Aenderung (Lock, Last-Write-Wins-Fix)", async () => {
  // User-Ticket 2026-09-03: Zwei GLEICHZEITIGE `settings set`-Aufrufe haben
  // sich vor dem Lock gegenseitig ueberschrieben (Last-Write-Wins auf der
  // ganzen Datei): Primaer-Key-Reihenfolge wurde verschoben, Keys verloren.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-settings-race-"));
  try {
    const [a, b] = await Promise.all([
      runSettingsChild(tmp, { apiKeyName: "PARALLEL_KEY_A", apiKey: "va-aaaa", apiBase: "https://parallel-a.invalid/v1" }),
      runSettingsChild(tmp, { apiKeyName: "PARALLEL_KEY_B", apiKey: "vb-bbbb", model: "parallel/b" }),
    ]);
    assert.equal(a.code, 0, `Kind A fehlgeschlagen: ${a.err}`);
    assert.equal(b.code, 0, `Kind B fehlgeschlagen: ${b.err}`);
    const cfg = JSON.parse(fs.readFileSync(path.join(tmp, "config.json"), "utf8"));
    assert.equal(cfg.apiBase, "https://parallel-a.invalid/v1", "apiBase von A darf nicht verloren gehen");
    assert.equal(cfg.model, "parallel/b", "model von B darf nicht verloren gehen");
    assert.ok(["PARALLEL_KEY_A", "PARALLEL_KEY_B"].includes(cfg.apiKeyName), "apiKeyName eines der beiden Writes");
    const env = fs.readFileSync(path.join(tmp, ".env"), "utf8");
    assert.ok(env.includes('PARALLEL_KEY_A="va-aaaa"'), "Key A unversehrt gespeichert");
    assert.ok(env.includes('PARALLEL_KEY_B="vb-bbbb"'), "Key B unversehrt gespeichert");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("--model kann den Runtime-Job nicht am Onboarding vorbei umschalten", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-model-override-"));
  try {
    const child = spawn(process.execPath, [path.join(ROOT, "cli", "run.mjs"), "--model", "agent/selected"], {
      cwd: ROOT,
      env: { ...process.env, FALSIFY_HOME: tmp },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 2);
    assert.match(output, /--model ist kein Agent-Override/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("F-11: twinMaxTokens wird akzeptiert, validiert und von loadConfig geladen", async () => {
  const { loadConfig } = await import("../core/config.mjs");
  // Fallback: min(Primaer, 16384) — Groq-Limit, nicht der ungekappte Primaerwert.
  assert.equal(loadConfig().twinMaxTokens, 16384, "Fallback klammert auf Groq-Limit");
  const result = settings.updateRuntimeSettings({ twinMaxTokens: 3000 });
  assert.equal(result.twin.maxTokens, 3000);
  const stored = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  assert.equal(stored.twinMaxTokens, 3000);
  assert.equal(loadConfig().twinMaxTokens, 3000);
  // Numerische Validierung (Grenzen wie maxTokens).
  assert.throws(() => settings.updateRuntimeSettings({ twinMaxTokens: 100 }), /zwischen 256 und 1000000/);
  assert.throws(() => settings.updateRuntimeSettings({ twinMaxTokens: "viel" }), /muss eine Zahl sein/);
  // config.json-Direkt-Eingriff (Hand-Edit) wird beim Laden ehrlich abgewiesen.
  const before = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ ...before, twinMaxTokens: 99 }), "utf8");
  assert.throws(() => loadConfig(), /twinMaxTokens/);
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify(before), "utf8");
  assert.equal(loadConfig().twinMaxTokens, 3000, "Restore: valid erneut ladbar");
});
