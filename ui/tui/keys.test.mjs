import { test } from "node:test";
import assert from "node:assert/strict";
import { mapKey } from "./keys.mjs";

test("q/Q -> abort", () => {
  assert.equal(mapKey({ input: "q" }), "abort");
  assert.equal(mapKey({ input: "Q" }), "abort");
});

test("Ctrl-C (byte) -> abort", () => {
  assert.equal(mapKey({ input: "\x03" }), "abort");
});

test("Ctrl-C (key-Form) -> abort", () => {
  assert.equal(mapKey({ input: "c", key: { ctrl: true, name: "c" } }), "abort");
  assert.equal(mapKey({ input: "\x03", key: { ctrl: true, name: "c" } }), "abort");
});

test("t/T -> toggle", () => {
  assert.equal(mapKey({ input: "t" }), "toggle");
  assert.equal(mapKey({ input: "T" }), "toggle");
});

test("andere Tasten -> null", () => {
  assert.equal(mapKey({ input: "x" }), null);
  assert.equal(mapKey({ input: "\x1b" }), null); // ESC ist KEIN Abort (nur Q/Strg-C laut Spez)
  assert.equal(mapKey({}), null);
});