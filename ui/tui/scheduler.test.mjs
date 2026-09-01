import { test } from "node:test";
import assert from "node:assert/strict";
import { createScheduler } from "./scheduler.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("idle-FPS: wenig Frames", async () => {
  const frames = [];
  const s = createScheduler({ activeFps: 15, idleFps: 5, onFrame: (f) => frames.push(f) });
  s.start();
  await sleep(400);
  s.stop();
  assert.ok(frames.length >= 1 && frames.length <= 6, `frames=${frames.length}`);
});

test("active-FPS schneller als idle-FPS", async () => {
  const frames = [];
  const s = createScheduler({ activeFps: 20, idleFps: 2, onFrame: (f) => frames.push(f) });
  s.start();
  await sleep(150);
  s.setActive(true);
  await sleep(300);
  s.setActive(false);
  await sleep(150);
  s.stop();
  assert.ok(frames.length >= 4, `frames=${frames.length}`);
});

test("requestNow: sofortiger Frame + Coalescing", async () => {
  let n = 0;
  const s = createScheduler({ activeFps: 1, idleFps: 1, onFrame: () => { n += 1; } });
  s.start();
  await sleep(50);
  const before = n;
  s.requestNow();
  s.requestNow();
  s.requestNow(); // koalesziert
  await sleep(80);
  assert.equal(n, before + 1, "3 requests -> 1 Frame");
  s.stop();
});

test("stop beendet Frames", async () => {
  let n = 0;
  const s = createScheduler({ onFrame: () => { n += 1; } });
  s.start();
  await sleep(80);
  s.stop();
  const after = n;
  await sleep(150);
  assert.equal(n, after, "keine Frames nach stop");
});

test("onFrame erhaelt dt und now", async () => {
  let got = null;
  const s = createScheduler({ idleFps: 10, onFrame: (f) => { got = f; } });
  s.start();
  await sleep(150);
  s.stop();
  assert.ok(got, "Frame kam");
  assert.ok(got.dt >= 0 && got.now > 0);
});