import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function cli(args, env = {}) {
  return spawnSync(process.execPath, [path.join(ROOT, "cli", "run.mjs"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30000,
  });
}

function foreignProject() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-foreign-"));
  fs.mkdirSync(path.join(target, "src"));
  fs.writeFileSync(path.join(target, "src", "app.js"), "export const app = true;\n");
  fs.writeFileSync(path.join(target, "secret.txt"), "private\n");
  return target;
}

test("foreign root without files fails closed with deterministic diagnostic", () => {
  const target = foreignProject();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-home-"));
  try {
    const result = cli(["run", "--root", target, "--plan-file", path.join(target, "plan.txt")], { FALSIFY_HOME: home });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /--files.*foreign|Fremdprojekt.*--files/i);
    assert.match(`${result.stdout}\n${result.stderr}`, /Zugriff.*leer|kein.*Zugriff/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("foreign files are resolved inside target and prompt reports foreign context", () => {
  const target = foreignProject();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-home-"));
  const plan = path.join(target, "plan.txt");
  fs.writeFileSync(plan, "Prüfe app");
  try {
    const result = cli(["run", "--submit", "--root", target, "--files", "src/app.js", "--plan-file", plan], { FALSIFY_HOME: home });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Root : .*falsify-foreign-/);
    assert.match(result.stdout, /Dateien \(Whitelist\): src\/app\.js/);
    assert.doesNotMatch(result.stdout, /Self-Review|AGENTS\.md|WIRING\.md|ui\/PLAN\.md/);
    assert.equal(fs.existsSync(path.join(target, "falsify.db")), false);
    assert.equal(fs.existsSync(path.join(target, "logs")), false);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("foreign tools reject escaping paths and expose only allowed files", async () => {
  const target = foreignProject();
  try {
    const { makeTools } = await import("../core/tools.mjs");
    const tools = makeTools(target, ["src/app.js"]);
    assert.match(tools.execTool("read_file", { path: "src/app.js" }), /export const app/);
    assert.throws(() => tools.execTool("read_file", { path: "../secret.txt" }), /außerhalb|Whitelist/i);
    assert.doesNotMatch(tools.execTool("list_dir", { path: "." }), /secret\.txt/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
