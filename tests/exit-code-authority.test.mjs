import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("exitCodeOf is the single mapping for every terminal verdict", async () => {
  const { exitCodeOf } = await import("../core/verdict.mjs");
  assert.deepEqual(
    Object.fromEntries(["WRITE", "PLAN", "RESEARCH", "ASK", "UNBEKANNT", null].map((v) => [String(v), exitCodeOf(v)])),
    { WRITE: 0, PLAN: 1, RESEARCH: 1, ASK: 5, UNBEKANNT: 3, null: 3 },
  );
});

test("Bash wait delegates terminal status mapping to the Node authority", () => {
  const source = requireText(path.join(ROOT, "cli", "falsify.sh"));
  assert.doesNotMatch(source, /"DONE WRITE"\*\)\s+exit 0/);
  assert.doesNotMatch(source, /"DONE ASK"\*\)\s*[\s\S]*exit 5/);
  assert.match(source, /cli\/main\.mjs.*ping/);
});

function requireText(file) {
  return fs.readFileSync(file, "utf8");
}
