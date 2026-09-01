import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-settings-"));
process.env.FALSIFY_HOME = home;
process.env.FALSIFY_API_KEY_ENV = "CUSTOM_PROVIDER_KEY";
const settings = await import("../core/settings.mjs");

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

test("ungültige API-Basis wird vor Netzwerkzugriff abgewiesen", async () => {
  await assert.rejects(() => settings.fetchAvailableModels({ apiBase: "not-a-url" }), /apiBase/);
});
