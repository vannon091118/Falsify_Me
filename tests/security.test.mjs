import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const toolModule = new URL("../core/tools.mjs", import.meta.url).href;
const rateModule = new URL("../core/ratelimit.mjs", import.meta.url).href;
const configModule = new URL("../core/config.mjs", import.meta.url).href;
const cleanup = [];
test.after(() => { for (const fn of cleanup.splice(0)) { try { fn(); } catch {} } });

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-sec-"));
  const root = path.join(base, "root");
  const outside = path.join(base, "outside");
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, "allowed.js"), "allowed\n");
  fs.writeFileSync(path.join(root, "sub", "nested.js"), "nested\n");
  fs.writeFileSync(path.join(root, "forbidden.js"), "forbidden\n");
  fs.writeFileSync(path.join(outside, "secret.txt"), "SECRET\n");
  cleanup.push(() => fs.rmSync(base, { recursive: true, force: true }));
  return { root, outside };
}

async function tools(root, whitelist) {
  const { makeTools } = await import(toolModule);
  return makeTools(root, whitelist);
}

test("read_file blocks symlink escape", async () => {
  const { root, outside } = fixture();
  fs.rmSync(path.join(root, "allowed.js"));
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "allowed.js"));
  const api = await tools(root, ["allowed.js"]);
  assert.throws(() => api.execTool("read_file", { path: "allowed.js" }), /außerhalb|Symlink/i);
});

test("read_file blocks traversal and absolute paths", async () => {
  const { root, outside } = fixture();
  const api = await tools(root, ["allowed.js"]);
  assert.throws(() => api.execTool("read_file", { path: "../outside/secret.txt" }), /außerhalb/i);
  assert.throws(() => api.execTool("read_file", { path: path.join(outside, "secret.txt") }), /außerhalb/i);
  assert.throws(() => api.execTool("read_file", { path: "sub/../../outside/secret.txt" }), /außerhalb/i);
});

test("list_dir blocks directories with no whitelisted descendant", async () => {
  const { root, outside } = fixture();
  fs.mkdirSync(path.join(root, "other"));
  fs.writeFileSync(path.join(root, "other", "hidden.js"), "hidden\n");
  const api = await tools(root, ["sub/nested.js"]);
  assert.ok(api.execTool("list_dir", { path: "." }).includes("sub/"));
  assert.throws(() => api.execTool("list_dir", { path: "other" }), /Whitelist/i);
  fs.rmSync(path.join(root, "sub"), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(root, "sub"));
  assert.throws(() => api.execTool("list_dir", { path: "sub" }), /außerhalb|Symlink/i);
});

test("list_dir zeigt NUR freigegebene Namen (Regel 4: keine Namen-Leaks)", async () => {
  const { root } = fixture();
  fs.writeFileSync(path.join(root, "forbidden.js"), "x\n");
  fs.writeFileSync(path.join(root, "secret.db"), "x\n");
  fs.mkdirSync(path.join(root, "fremd"));
  fs.writeFileSync(path.join(root, "fremd", "data.txt"), "x\n");
  const api = await tools(root, ["allowed.js", "sub/nested.js"]);

  // Root: nur freigegebene Datei + Vorfahr-Ordner – keine fremden Namen.
  const rootList = api.execTool("list_dir", { path: "." });
  assert.ok(rootList.includes("allowed.js"), "whitelisted Datei sichtbar");
  assert.ok(rootList.includes("sub/"), "Vorfahr-Ordner freigegebener Datei sichtbar");
  assert.ok(!rootList.includes("forbidden.js"), "nicht freigegebene Datei unsichtbar");
  assert.ok(!rootList.includes("secret.db"), "NICHT freigegebener Name leaket nicht");
  assert.ok(!rootList.includes("fremd"), "fremder Ordner ohne freigegebene Nachkommen unsichtbar");

  // Unterordner: nur die freigegebene Datei darin.
  const subList = api.execTool("list_dir", { path: "sub" });
  assert.ok(subList.includes("nested.js"));
  assert.ok(!subList.includes("secret.db"));

  // Ordner ohne freigegebene Nachkommen bleibt gesperrt.
  assert.throws(() => api.execTool("list_dir", { path: "fremd" }), /Whitelist/i);
});

test("read_file and glob enforce whitelist", async () => {
  const { root } = fixture();
  const api = await tools(root, ["allowed.js", "sub/nested.js"]);
  assert.equal(api.execTool("read_file", { path: "allowed.js" }), "allowed\n");
  assert.equal(api.execTool("read_file", { path: "sub/nested.js" }), "nested\n");
  assert.throws(() => api.execTool("read_file", { path: "forbidden.js" }), /Whitelist/i);
  assert.deepEqual(api.execTool("glob", { pattern: "**/*.js" }).split("\n").sort(), ["allowed.js", "sub/nested.js"]);
});

test("rate-limit reservations are serialized across real processes", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-rl-"));
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
  const script = path.join(home, "child.mjs");
  // Intervall 1000 ms (maxRpm 60): der zweite Kindprozess startet GARANTIERT
  // in die noch aktive Reservation des ersten und muss echte Warte-Schleifen
  // durchlaufen — der alte Livelock-Pfad (Reservation im Warte-Fall
  // weiterschreiben) wird so deterministisch betreten statt timing-abhaengig.
  fs.writeFileSync(script, `import { enforceRateLimit } from ${JSON.stringify(rateModule)}; enforceRateLimit(60);\n`);
  const env = { ...process.env, FALSIFY_HOME: home };
  const first = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  const t0 = Date.now();
  const second = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  const elapsed = Date.now() - t0;
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stderr, /Rate-Limit|^$/);
  // Livelock-Guard: Warte-Schleifen muessen terminieren; 5 s sind fuer
  // ~1 s Wartezeit + Prozess-Start zweimal grosszuegig (alter Bug: endlos).
  assert.ok(elapsed < 5000, `zweiter Kindprozess dauerte ${elapsed} ms — Livelock?`);
});

test("config rejects invalid values and accepts valid overrides", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-cfg-"));
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
  const original = { ...process.env };
  process.env.FALSIFY_HOME = home;
  const { loadConfig } = await import(configModule);
  for (const [key, value] of [
    ["FALSIFY_MAX_RPM", "0"], ["FALSIFY_MAX_TOKENS", "-2"],
    ["FALSIFY_TIMEOUT_MS", "-1"], ["FALSIFY_TEMPERATURE", "99"],
    ["FALSIFY_API_BASE", "not-a-url"], ["FALSIFY_LANG", "fr"],
  ]) {
    process.env[key] = value;
    assert.throws(() => loadConfig(), /Ungültige Konfiguration/, `${key}=${value}`);
    delete process.env[key];
  }
  process.env.FALSIFY_API_BASE = "https://api.openai.com/v1";
  process.env.FALSIFY_MODEL = "gpt-4o";
  const cfg = loadConfig();
  assert.equal(cfg.provider, "OpenAI");
  assert.equal(cfg.model, "gpt-4o");
  process.env = original;
});
