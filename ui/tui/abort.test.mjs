import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createAbort, isDead } from "./abort.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("isDead: lebende und tote PIDs", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},1000)"]);
  await sleep(50);
  assert.equal(isDead(child.pid), false, "Kind lebt");
  child.kill();
  await new Promise((res) => child.once("close", res));
  assert.equal(isDead(child.pid), true, "Kind tot -> ESRCH");
});

test("request: killt echtes Kind und verifiziert ABORTED", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  await sleep(50);
  const progress = [];
  const ab = createAbort({ child, killDelayMs: 500, onProgress: (p) => progress.push(p) });
  const res = await ab.request();
  assert.equal(res, "ABORTED");
  assert.deepEqual(progress, ["ABORTING", "ABORTED"]);
  assert.equal(isDead(child.pid), true, "kein weiterlaufender Child-Prozess");
});

test("request ist idempotent", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  await sleep(50);
  const ab = createAbort({ child, killDelayMs: 200 });
  assert.equal(await ab.request(), "ABORTED");
  assert.equal(await ab.request(), "ALREADY");
});

test("request ohne child -> ERROR statt Fake-Erfolg", async () => {
  const ab = createAbort({ killDelayMs: 50 });
  const res = await ab.request();
  assert.equal(res, "ERROR");
});