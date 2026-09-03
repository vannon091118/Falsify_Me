// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · tests/onboard.test.mjs – Onboarding-Dialog (modular)
// -----------------------------------------------------------------------------
// testet cli/onboard/steps.mjs + prompts.mjs mit injizierbarem Fake-Prompter
// und Wegwerf-FALSIFY_HOME (kein echtes TTY, kein echtes Nutzerprofil).
// Exit 0 = OK; jeder Assertion-Fehler = nicht bestanden.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakePrompter } from "../cli/onboard/prompts.mjs";
import { collectSettings, detectInstallation, runOnboard } from "../cli/onboard/steps.mjs";
import { apiKeyExplanationLines, PROVIDER_LINKS } from "../cli/onboard/explain.mjs";
import { getRuntimeSettings, updateRuntimeSettings } from "../core/settings.mjs";
import { loadConfig } from "../core/config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const savedHome = process.env.FALSIFY_HOME;

function withTempHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-onboard-"));
  process.env.FALSIFY_HOME = tmp;
  return {
    tmp,
    cleanup() {
      fs.rmSync(tmp, { recursive: true, force: true });
      if (savedHome === undefined) delete process.env.FALSIFY_HOME;
      else process.env.FALSIFY_HOME = savedHome;
    },
  };
}

test("detectInstallation: Repo-Checkout hat cli/main.mjs, Windows erkannt", () => {
  const inst = detectInstallation(os.homedir(), "win32");
  assert.ok(fs.existsSync(path.join(root, "cli", "main.mjs")), "Repo-Checkout muss cli/main.mjs enthalten");
  assert.equal(inst.isWindows, true);
});

test("collectSettings: Dialog setzt apiBase/model/apiKeyName/apiKey aus Fake-Antworten", async () => {
  const home = withTempHome();
  try {
    const prompter = fakePrompter({
      askValue: ["https://integrate.api.nvidia.com/v1", "nvidia/test", "MEIN_PROVIDER_KEY"],
      secretValue: "sk-test-123",
    });
    const current = {
      apiBase: "https://alt.example/v1",
      model: "alt/modell",
      apiKeyEnv: "NVIDIA_API_KEY,OPENAI_API_KEY",
    };
    const { patch, questions } = await collectSettings({ prompter, current });
    assert.deepEqual(Object.keys(patch).sort(), ["apiBase", "apiKey", "apiKeyName", "model"]);
    assert.equal(patch.apiBase, "https://integrate.api.nvidia.com/v1");
    assert.equal(patch.apiKey, "sk-test-123");
    assert.equal(patch.apiKeyName, "MEIN_PROVIDER_KEY");
    assert.ok(questions.includes("apiKey=<maskiert>"), "Key nie im Klartext in Fragen");
  } finally {
    home.cleanup();
  }
});

test("collectSettings: leere Antworten = Default der Runtime bleibt (keine Aenderung)", async () => {
  const home = withTempHome();
  try {
    const prompter = fakePrompter({ askValue: "", secretValue: "" });
    const current = { apiBase: "https://alt.example/v1", model: "alt/modell", apiKeyEnv: "MEIN_KEY" };
    const { patch } = await collectSettings({ prompter, current });
    assert.equal(Object.keys(patch).length, 0, "leere Eingaben muessen nichts aendern");
  } finally {
    home.cleanup();
  }
});

test("updateRuntimeSettings: Settings + Key landen in FALSIFY_HOME, Key nie im JSON/config.json", () => {
  const home = withTempHome();
  try {
    const result = updateRuntimeSettings({
      apiBase: "https://integrate.api.nvidia.com/v1",
      model: "nvidia/test",
      apiKeyName: "NVIDIA_API_KEY",
      apiKey: "geheim-123",
    });
    assert.equal(result.keyConfigured, true);
    assert.equal(JSON.stringify(result).includes("geheim-123"), false, "Key darf nie in Settings/JSON auftauchen");

    // Key liegt NUR in FALSIFY_HOME/.env, nie in config.json
    const envFile = path.join(home.tmp, ".env");
    assert.ok(fs.existsSync(envFile), ".env muss existieren");
    assert.equal(fs.readFileSync(envFile, "utf8").includes("geheim-123"), true, "Key im .env (privat, 0600)");
    const cfgFile = path.join(home.tmp, "config.json");
    assert.ok(fs.existsSync(cfgFile), "config.json muss existieren");
    assert.equal(fs.readFileSync(cfgFile, "utf8").includes("geheim-123"), false, "Key nie in config.json");

    const cfg = loadConfig();
    assert.equal(cfg.apiBase.replace(/\/+$/, ""), "https://integrate.api.nvidia.com/v1");
    assert.equal(cfg.keyEnvNames.includes("NVIDIA_API_KEY"), true);
  } finally {
    home.cleanup();
  }
});

test("getRuntimeSettings: leere .env-Vorlage -> keyConfigured=false (ehrlich)", () => {
  const home = withTempHome();
  try {
    const s = getRuntimeSettings();
    assert.equal(s.keyConfigured, false);
  } finally {
    home.cleanup();
  }
});

test("prompts.fakePrompter: confirm liefert Default bei leerer Antwort", async () => {
  const p = fakePrompter({});
  const yes = await p.confirm("Dock starten?", { defaultValue: true });
  const no = await p.confirm("Dock starten?", { defaultValue: false });
  assert.equal(yes, true);
  assert.equal(no, false);
  await p.close();
});

test("explain: Erklaerung nennt Haupt-API, optionale Evil-Twin-API und Provider-Links", () => {
  const all = apiKeyExplanationLines().join("\n");
  assert.match(all, /Haupt-API \(THINKER\/Falsifikation\)/);
  assert.match(all, /Evil-Twin-API \(optional\)/);
  assert.match(all, /twinApiBase/);
  assert.match(all, /FALSIFY_HOME\/\.env/);
  assert.ok(PROVIDER_LINKS.length >= 2, "mindestens zwei Beispiel-Anbieter");
  for (const p of PROVIDER_LINKS) {
    assert.match(p.keyUrl, /^https:\/\//, `${p.name} muss eine https-URL haben`);
  }
});

test("runOnboard: ohne API-Key wird die 2-APIs-Erklaerung + Provider-Links gedruckt", async () => {
  const home = withTempHome(); // FALSIFY_HOME: leer (kein Key)
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-onb-user-"));
  const coreMain = path.join(userHome, ".Falsify_Core", "cli", "main.mjs");
  fs.mkdirSync(path.dirname(coreMain), { recursive: true });
  fs.writeFileSync(coreMain, ""); // installiert vortaeuschen (detectInstallation)
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  try {
    const prompter = fakePrompter({}); // leere Antworten -> Defaults; kein /models
    const res = await runOnboard({ prompter, homeDir: userHome, platform: "linux", skipDock: true });
    assert.equal(res.ok, true);
    const all = logs.join("\n");
    assert.match(all, /Kein API-Key gesetzt/);
    assert.match(all, /zwei APIs nutzt/);
    assert.match(all, /Evil-Twin-API/);
    assert.match(all, /build\.nvidia\.com/);
    assert.match(all, /platform\.openai\.com\/api-keys/);
  } finally {
    console.log = origLog;
    home.cleanup();
    fs.rmSync(userHome, { recursive: true, force: true });
  }
});