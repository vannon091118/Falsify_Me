import { test } from "node:test";
import assert from "node:assert/strict";
import { createRing } from "./ring.mjs";

test("Ring: push + toArray in Einfuege-Reihenfolge", () => {
  const r = createRing(3);
  r.push(1); r.push(2); r.push(3);
  assert.deepEqual(r.toArray(), [1, 2, 3]);
  assert.equal(r.length, 3);
});

test("Ring: ueberschreibt aelteste Eintraege", () => {
  const r = createRing(3);
  for (let i = 1; i <= 5; i++) r.push(i);
  assert.deepEqual(r.toArray(), [3, 4, 5]);
  assert.equal(r.length, 3);
  assert.equal(r.at(0), 3);
  assert.equal(r.at(2), 5);
  assert.equal(r.last(), 5);
});

test("Ring: at() ausserhalb -> undefined; clear() leert", () => {
  const r = createRing(2);
  r.push("a");
  assert.equal(r.at(1), undefined);
  assert.equal(r.at(-1), undefined);
  r.clear();
  assert.equal(r.length, 0);
  assert.deepEqual(r.toArray(), []);
});

test("Ring: bound bleibt konstant bei grosser Belegung", () => {
  const r = createRing(100);
  for (let i = 0; i < 100_000; i++) r.push(i);
  assert.equal(r.length, 100);
  assert.deepEqual(r.toArray(), Array.from({ length: 100 }, (_, i) => 99_900 + i));
});