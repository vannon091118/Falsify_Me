import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepo, scanSource } from "../scripts/check-sql-identifiers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("SQL guard: repository has no unguarded interpolated identifiers", () => {
  assert.deepEqual(scanRepo(ROOT), []);
});

test("SQL guard: rejects identifier interpolation without an allowlisted guard", () => {
  const source = [
    "function load(db, table, value) {",
    "  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(value);",
    "}",
  ].join("\n");
  const violations = scanSource(source, "fixture.mjs");
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 2);
  assert.match(violations[0].message, /table/);
});

test("SQL guard: accepts an identifier checked by an ALLOWED_* Set", () => {
  const source = [
    "const ALLOWED_TABLES = new Set(['users']);",
    "function load(db, table) {",
    "  assertSqlIdentifier(table, ALLOWED_TABLES);",
    "  return db.prepare(`SELECT * FROM ${table}`).all();",
    "}",
  ].join("\n");
  assert.deepEqual(scanSource(source, "guarded.mjs"), []);
});

test("SQL guard: values, comments, strings, and placeholder lists are not identifiers", () => {
  const source = [
    "function load(db, value, marks) {",
    "  // db.prepare(`SELECT * FROM ${notCode}`);",
    "  const text = \"db.prepare(`SELECT * FROM ${notCode}`)\";",
    "  return db.prepare(`SELECT * FROM users WHERE name = ${value} AND id IN (${marks})`).all();",
    "}",
  ].join("\n");
  assert.deepEqual(scanSource(source, "values.mjs"), []);
});

test("SQL guard: scanRepo covers nested source files but skips node_modules and .git", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-sql-"));
  try {
    fs.mkdirSync(path.join(root, "nested"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "ignored"), { recursive: true });
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    const unsafe = "db.prepare(`SELECT * FROM ${table}`);";
    fs.writeFileSync(path.join(root, "nested", "unsafe.mjs"), unsafe);
    fs.writeFileSync(path.join(root, "node_modules", "ignored", "unsafe.mjs"), unsafe);
    fs.writeFileSync(path.join(root, ".git", "unsafe.mjs"), unsafe);
    const violations = scanRepo(root);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, "nested/unsafe.mjs");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
