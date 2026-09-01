import { test } from "node:test";
import assert from "node:assert/strict";
import { createMetrics, sparkline } from "./metrics.mjs";

test("metrics: Zaehler und Sparkline-Lebenslauf", async () => {
  const m = createMetrics({ bucketMs: 50, buckets: 4 });
  for (let i = 0; i < 60; i++) m.noteLine();
  m.noteEvent();
  m.noteFrame(8);
  assert.equal(m.lines, 60);
  assert.equal(m.events, 1);
  assert.equal(m.frames, 1);
  assert.equal(m.lastFrameMs, 8);
  const sp = m.sparkline(); // synchroner Burst -> Angefangener Bucket wird sichtbar
  assert.ok(sp.length >= 1, `sp="${sp}"`);
  assert.match(sp, /^[ ▁▂▃▄▅▆▇]+$/);
  await new Promise((r) => setTimeout(r, 110)); // weitere Bucket-Fenster
  m.noteLine();
  const sp2 = m.sparkline();
  assert.ok(sp2.length > sp.length, `sp2="${sp2}" > sp="${sp}"`);
  assert.ok(sp2.length <= 4);
});

test("sparkline: alles 0 -> Leerzeichen", () => {
  assert.equal(sparkline([0, 0, 0]), "   ");
});

test("sparkline: Skalierung auf 7 Stufen", () => {
  const sp = sparkline([1, 2, 4, 8]);
  assert.equal(sp.length, 4);
  assert.ok(sp[3] >= sp[2]);
  assert.ok(sp[2] >= sp[1]);
  assert.ok(sp[1] >= sp[0]);
});

test("metrics: Ring wird in Buckets begrenzt", async () => {
  const m = createMetrics({ bucketMs: 10, buckets: 5 });
  for (let i = 0; i < 50; i++) {
    m.noteLine();
    await new Promise((r) => setTimeout(r, 12)); // erzwinge mehrere Bucket-Flushes
  }
  const sp = m.sparkline();
  assert.ok(sp.length <= 5);
});