// FalsifyMe TUI - Tests fuer den Demo-Agenten (echtes Kind, echter Stream)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createParser } from "./tui/parser.mjs";

const AGENT = fileURLToPath(new URL("./demo-agent.mjs", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runAgent = (env) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [AGENT], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    const events = [];
    const lines = [];
    const parser = createParser({ onEvent: (e) => events.push(e), onLine: (l) => lines.push(l) });
    child.stdout.on("data", (c) => parser.feed(c.toString()));
    child.stdout.on("end", () => parser.flush());
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("close", (code) => resolve({ code, events, lines, stderr }));
  });

test("demo-agent: write-Szenario liefert komplette Lebenszyklus-Events", async () => {
  const { code, events } = await runAgent({ FM_SCENARIO: "write", FM_FAST: "1" });
  assert.equal(code, 0);
  const types = events.map((e) => e.t);
  assert.ok(types.includes("job"), "job-Event");
  assert.ok(types.includes("state"));
  assert.ok(types.includes("activity"));
  assert.ok(types.includes("finding"));
  assert.ok(types.includes("phase"));
  assert.ok(types.includes("verdict"));
  assert.ok(types.includes("done"));
  const verdicts = events.filter((e) => e.t === "verdict");
  assert.equal(verdicts[0].v, "WRITE");
  const states = events.filter((e) => e.t === "state").map((e) => e.s);
  assert.ok(states.includes("THINKING") && states.includes("TOOL_ACTIVITY") && states.includes("FINDINGS"));
});

test("demo-agent: plan/research/timeout/error Szenarien", async () => {
  const plan = await runAgent({ FM_SCENARIO: "plan", FM_FAST: "1" });
  assert.equal(plan.code, 0);
  assert.equal(plan.events.filter((e) => e.t === "verdict")[0].v, "PLAN");

  const research = await runAgent({ FM_SCENARIO: "research", FM_FAST: "1" });
  assert.equal(research.code, 0);
  assert.equal(research.events.filter((e) => e.t === "verdict")[0].v, "RESEARCH");

  const timeout = await runAgent({ FM_SCENARIO: "timeout", FM_FAST: "1" });
  assert.equal(timeout.code, 3);
  assert.ok(timeout.events.some((e) => e.t === "state" && e.s === "TIMEOUT"));

  const error = await runAgent({ FM_SCENARIO: "error", FM_FAST: "1" });
  assert.equal(error.code, 3);
  assert.ok(error.events.some((e) => e.t === "state" && e.s === "ERROR"));
});

test("demo-agent: --stress emittiert grosse Zeilenmengen ohne Event-Schaden", async () => {
  const child = spawn(process.execPath, [AGENT, "--stress"], {
    env: { ...process.env, FM_SCENARIO: "write", FM_FAST: "1", FM_MAX_LINES: "3000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let events = 0;
  let lines = 0;
  const parser = createParser({ onEvent: () => events++, onLine: () => lines++ });
  child.stdout.on("data", (c) => parser.feed(c.toString()));
  child.stdout.on("end", () => parser.flush());
  const code = await new Promise((res) => child.on("close", res));
  assert.equal(code, 0);
  assert.ok(lines > 800, `Flut-Zeilen: ${lines}`);
  assert.ok(events > 10, `Events: ${events}`);
});

test("demo-agent: SIGTERM beendet sofort (fuer Kill-Test relevant)", async () => {
  const child = spawn(process.execPath, [AGENT], { env: { ...process.env, FM_SCENARIO: "write" }, stdio: ["ignore", "pipe", "pipe"] });
  await sleep(300);
  const t0 = Date.now();
  child.kill("SIGTERM");
  const code = await new Promise((res) => child.on("close", res));
  const elapsed = Date.now() - t0;
  // Windows: kill() = harter Abbruch (code null); POSIX: 130 via Signal-Handler.
  assert.ok(code === 130 || code === null, `code=${code}`);
  assert.ok(elapsed < 1500, `Exit nach ${elapsed}ms`);
  try {
    process.kill(child.pid, 0);
    assert.fail("Prozess lebt noch");
  } catch (e) {
    assert.ok(e.code === "ESRCH", "Prozess wirklich tot");
  }
});