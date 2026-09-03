// FalsifyMe · loop_state writer freeze
// -----------------------------------------------------------------------------
// SECURITY/ARCHITECTURE FREEZE:
// `jobs.loop_state` may be written in production only by the central
// transition engine, except for initial-state creation of a NEW job.
//
// The current executable contract is intentionally narrow:
//   1. artifacts/loops.mjs::applyTransition owns transition writes.
//   2. cli/run.mjs may initialize QUEUED on a newly submitted/direct job.
//   3. artifacts/jobs.mjs::createJob may initialize a newly created job with
//      its schema/default state (no transition).
//   4. artifacts/handoff.mjs may initialize RE_REVIEW_QUEUED on the newly
//      created child inside the same completion transaction.
//
// Any new production loop_state UPDATE is a regression and must fail loudly.
// This is intentionally a source-level freeze: it protects the ownership rule
// from future refactors that accidentally add a second state writer.
//
// REPAIR (2026-09-03): as pushed, this file was escape-mangled (double
// backslashes in the regexes) and could not load (SyntaxError: Unterminated
// group); the string-stripping additionally removed the very SQL it must
// detect (the writes live inside string literals). Fix: only comments are
// stripped, string literals stay visible — same contract as the freeze block
// in tests/invariants.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ALLOWED = new Set([
  "artifacts/loops.mjs",
  "artifacts/jobs.mjs",
  "artifacts/handoff.mjs",
  "cli/run.mjs",
]);

function prodSources() {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === ".git" || name === "node_modules" || name === "tests") continue;
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      if (stat.isDirectory()) walk(file);
      else if (name.endsWith(".mjs")) out.push(path.relative(ROOT, file).replace(/\\/g, "/"));
    }
  };
  walk(ROOT);
  return out.sort();
}

/** Entfernt NUR Kommentare — String-Literale (die SQL) bleiben sichtbar. */
function stripCommentsOnly(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

test("STATIC: loop_state has no production writer outside the frozen ownership set", () => {
  const violations = [];
  const updates = /UPDATE\s+jobs\s+SET\s+loop_state\s*=|UPDATE\s+jobs\s+SET[^;\n]*\bloop_state\b/gi;
  const inserts = /INSERT\s+INTO\s+jobs\s*\([^)]*\bloop_state\b/gi;

  for (const file of prodSources()) {
    if (file === "tests/loop-state-writer-freeze.test.mjs") continue;
    const source = stripCommentsOnly(fs.readFileSync(path.join(ROOT, file), "utf8"));
    const matches = [...source.matchAll(updates), ...source.matchAll(inserts)];
    if (matches.length && !ALLOWED.has(file)) {
      violations.push(`${file}: ${matches.length} raw loop_state writer expression(s)`);
    }
  }

  assert.deepEqual(violations, []);
});

test("STATIC: the frozen ownership set is exactly the four audited production files", () => {
  assert.deepEqual([...ALLOWED].sort(), [
    "artifacts/handoff.mjs",
    "artifacts/jobs.mjs",
    "artifacts/loops.mjs",
    "cli/run.mjs",
  ]);
});