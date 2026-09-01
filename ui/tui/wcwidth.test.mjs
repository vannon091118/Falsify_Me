import { test } from "node:test";
import assert from "node:assert/strict";
import { charWidth, strWidth, padEnd, truncate, fill } from "./wcwidth.mjs";

test("charWidth: ASCII 1, CJK 2, combining 0, control 0", () => {
  assert.equal(charWidth("a"), 1);
  assert.equal(charWidth("中"), 2);
  assert.equal(charWidth("界"), 2);
  assert.equal(charWidth("\u0301"), 0); // combining acute
  assert.equal(charWidth("\n"), 0);
  assert.equal(charWidth("\t"), 0);
});

test("strWidth summiert Breiten", () => {
  assert.equal(strWidth("a中b"), 4);
  assert.equal(strWidth(""), 0);
  assert.equal(strWidth("FALSIFYME"), 9);
});

test("padEnd fuellt nur bis zur Breite", () => {
  assert.equal(padEnd("ab", 4), "ab  ");
  assert.equal(padEnd("abc", 2), "abc"); // nie kuerzen
  assert.equal(padEnd("a中", 4), "a中 "); // Sprache ist Breite 3
});

test("truncate kuerzt breitenbewusst mit Ellipsis", () => {
  assert.equal(truncate("hello world", 5), "hell…"); // Budget 4 + Ellipsis
  assert.equal(truncate("hello", 10), "hello");
  assert.equal(truncate("a中b", 3), "a…");
  assert.equal(truncate("abc", 1), "…");
  assert.equal(truncate("abc", 0), "");
});

test("fill fuellt exakte Breite (Box-Zeichen sind width 1, CJK width 2)", () => {
  assert.equal(strWidth(fill("━", 7)), 7);
  assert.equal(strWidth(fill("中", 3)), 2); // 2er-Breite: nie ueber Ziel
  assert.equal(strWidth(fill("中", 4)), 4);
  assert.equal(fill("█", 0), "");
});

test("fill mit veraenderlicher Laenge erreicht nie mehr als width", () => {
  for (let w = 1; w <= 20; w++) {
    assert.ok(strWidth(fill("⬛", w)) <= w, `width=${w}`);
  }
});