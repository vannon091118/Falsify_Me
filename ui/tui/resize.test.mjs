import { test } from "node:test";
import assert from "node:assert/strict";
import { createResize } from "./resize.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("erkennt Groessenwechsel nach Debounce", async () => {
  let size = { cols: 80, rows: 24 };
  const calls = [];
  const r = createResize({ getSize: () => size, onResize: (s) => calls.push(s), intervalMs: 20, debounceMs: 20 });
  r.start();
  await sleep(60);
  assert.equal(calls.length, 0, "kein Change ohne Aenderung");
  size = { cols: 100, rows: 30 };
  await sleep(80);
  assert.equal(calls.length, 1, "genau ein Change");
  assert.deepEqual(calls[0], { cols: 100, rows: 30 });
  r.stop();
});

test("Resize-Spam -> Coalescing (EIN Call)", async () => {
  let size = { cols: 80, rows: 24 };
  const calls = [];
  const r = createResize({ getSize: () => size, onResize: (s) => calls.push(s), intervalMs: 15, debounceMs: 30 });
  r.start();
  await sleep(50);
  for (let i = 0; i < 10; i++) {
    size = { cols: 80 + i, rows: 24 };
    await sleep(8); // schneller als Debounce -> koalesziert
  }
  await sleep(80);
  assert.equal(calls.length, 1, `Spam -> 1 Call (war ${calls.length})`);
  assert.equal(calls[0].cols, 89);
  r.stop();
});

test("size liefert aktuelle Dimension", async () => {
  const r = createResize({ getSize: () => ({ cols: 42, rows: 10 }), intervalMs: 500 });
  r.start();
  assert.deepEqual(r.size, { cols: 42, rows: 10 });
  r.stop();
});

test("stop beendet Polling", async () => {
  let size = { cols: 80, rows: 24 };
  const calls = [];
  const r = createResize({ getSize: () => size, onResize: (s) => calls.push(s), intervalMs: 10, debounceMs: 5 });
  r.start();
  await sleep(40);
  r.stop();
  size = { cols: 50, rows: 20 };
  await sleep(60);
  assert.equal(calls.length, 0, "nach stop keine Calls");
});