#!/usr/bin/env node
// FalsifyMe 2.0 · ui/demo-agent.mjs – Fake-Falsifikations-Agent (DEMO)
// -----------------------------------------------------------------------------
// ECHTES Kindprozess mit ECHTEM Stream: normales stdout (teils ANSI-gefaerbt)
// + maschinenlesbare Marker-Zeilen "FM-EVT: {json}" fuer die UI.
// Szenarien: write | plan | research | error | timeout | idle
// Env: FM_SCENARIO, FM_FAST=1 (Zeit skaliert), FM_MAX_LINES (Flut-Limit)
// Flags: --stress (Output-Flut waehrend der Jobs)
// KEINE Produktlogik - reiner Demo-Stoff fuer die UI-Pipeline.
// -----------------------------------------------------------------------------
const IS_STRESS = process.argv.includes("--stress");
const SCENARIO = process.env.FM_SCENARIO || "write";
const SLOT = Number(process.env.FM_SLOT) || 1; // Fenster-Slot 1..3 im UI
const FAST = process.env.FM_FAST === "1";
const MAX_LINES = Number(process.env.FM_MAX_LINES || (IS_STRESS ? 200000 : 4000));
const T = FAST ? 0.35 : 1; // Zeit-Skalierer fuer --fast

const out = process.stdout;
const log = (s) => out.write(s + "\n");
// JEDES Event traegt seinen Fenster-Slot: bei parallelen Jobs (3 Slots im
// einen Terminal-pid) wuerden Event ohne Slot ueber den Fokus laufen und
// sich mit anderen Slots vermischen.
const evt = (o) => log("FM-EVT: " + JSON.stringify({ ...o, window: SLOT }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jit = () => 0.6 + Math.random() * 0.8;
const rnd4 = () => Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, "0");

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

const FILES = ["app.js", "lib/auth.js", "sessions.json", "plan.md", "verdict.mjs", "tools.mjs", "db.mjs", "cli/run.mjs"];
const TOOLS = [
  { tool: "read_file", file: "app.js" },
  { tool: "glob", file: "**/*.js" },
  { tool: "read_file", file: "lib/auth.js" },
  { tool: "glob", file: "**/{json,md}" },
  { tool: "read_file", file: "plan.md" },
  { tool: "list_dir", file: "src" },
  { tool: "read_file", file: "sessions.json" },
];

let noiseActive = false;
let noiseTimer = null;
let lineCount = 0;

const stopNoise = () => {
  if (noiseTimer) {
    clearInterval(noiseTimer);
    noiseTimer = null;
  }
  noiseActive = false;
};

const startNoise = (ratePerSec = 900) => {
  if (noiseActive) return;
  noiseActive = true;
  const perTick = Math.max(1, Math.floor(ratePerSec / 10));
  noiseTimer = setInterval(() => {
    for (let i = 0; i < perTick; i++) {
      if (lineCount >= MAX_LINES) {
        stopNoise();
        return;
      }
      lineCount += 1;
      const r = Math.random();
      let s = dim(`[stream] ${lineCount}: chunk ${Math.random().toString(36).slice(2, 10)}`);
      if (r > 0.85) s = green(`[stream] ${lineCount}: ok ${Math.random().toString(36).slice(2, 6)}`);
      else if (r < 0.05) s = cyan(`[stream] ${lineCount}: token ${rnd4()} delta ${Math.random().toString(36).slice(2, 8)}`);
      log(s);
    }
  }, 100);
};

const pickTools = (n) => {
  const out = [];
  const idx = new Set();
  while (idx.size < n) idx.add(Math.floor(Math.random() * TOOLS.length));
  for (const i of idx) out.push(TOOLS[i]);
  return out;
};

const findingRound = async (nCritical) => {
  evt({ t: "state", s: "FINDINGS" });
  evt({ t: "finding", severity: "discovered" });
  await sleep(200 * T);
  evt({ t: "finding", severity: "discovered" });
  evt({ t: "finding", severity: "warning" });
  await sleep(200 * T);
  if (nCritical > 0) {
    evt({ t: "finding", severity: "critical" });
    await sleep(200 * T);
  }
  evt({ t: "files", n: FILES.length + Math.floor(Math.random() * 5) });
};

const runJob = async (kind) => {
  const heartbeats = ["● ", "◐ ", "◆ "];
  evt({ t: "job", id: `job-${rnd4()}-${rnd4()}`, scope: `scope-${rnd4()}`, window: SLOT });
  if (IS_STRESS) startNoise(); // Flut laeuft von Anfang an mit
  evt({ t: "state", s: "LOADING" });
  log(cyan("FalsifyMe leitet Job ein (read-only)…"));
  await sleep(250 * T);
  evt({ t: "state", s: "CLAIMING" });
  await sleep(250 * T);
  evt({ t: "state", s: "THINKING" });
  await sleep(500 * T);

  for (const t of pickTools(3 + Math.floor(Math.random() * 2))) {
    evt({ t: "state", s: "TOOL_ACTIVITY" });
    evt({ t: "activity", tool: t.tool, file: t.file, label: `${t.tool}(${t.file})` });
    log(dim(`${heartbeats[0]} ${t.tool} ${t.file}`));
    await sleep(300 * T * jit());
    if (!IS_STRESS && Math.random() < 0.4) log(dim(`   → ${Math.random().toString(36).slice(2, 14)}`));
  }

  evt({ t: "state", s: "THINKING" });
  evt({ t: "phase", phase: "PLAN" });
  await sleep(350 * T);
  evt({ t: "phase_done", phase: "PLAN" });

  evt({ t: "phase", phase: "RESEARCH", progress: 0.25 });
  await sleep(250 * T);
  evt({ t: "phase", phase: "RESEARCH", progress: 0.55 });
  await sleep(250 * T);
  evt({ t: "phase", phase: "RESEARCH", progress: 0.8 });
  await sleep(250 * T);
  evt({ t: "phase_done", phase: "RESEARCH" });

  if (kind === "timeout") {
    evt({ t: "state", s: "TIMEOUT" });
    log(red("TIMEOUT: Agent antwortet nicht mehr (600s ueberschritten)."));
    return "TIMEOUT";
  }
  if (kind === "error") {
    evt({ t: "phase", phase: "WRITE", progress: 0.2 });
    await sleep(300 * T);
    evt({ t: "state", s: "ERROR" });
    log(red("Agent-Fehler: API nicht erreichbar (Exit 3)."));
    return "ERROR";
  }

  await findingRound(kind === "write" ? 1 : 0);

  if (kind === "write" || kind === "plan" || kind === "research") {
    evt({ t: "phase", phase: "WRITE", progress: kind === "write" ? 0.6 : null });
    await sleep(400 * T);
    evt({ t: "phase_done", phase: "WRITE" });
    if (kind === "write") {
      evt({ t: "verdict", v: "WRITE" });
    } else if (kind === "plan") {
      evt({ t: "verdict", v: "PLAN" });
    } else {
      evt({ t: "verdict", v: "RESEARCH" });
    }
    await sleep(600 * T);
    evt({ t: "done" });
    log(green(`VERDICT: ${kind.toUpperCase()} — Job abgeschlossen.`));
    await sleep(500 * T);
    return kind.toUpperCase();
  }
  return "?";
};

const main = async () => {
  const ended = await runJob(SCENARIO);
  stopNoise();
  log(`FM-DEMO-END scenario=${SCENARIO} lines=${lineCount} result=${ended}`);
  process.exit(ended === "ERROR" || ended === "TIMEOUT" ? 3 : 0);
};

process.on("SIGTERM", () => {
  stopNoise();
  process.exit(130);
});
process.on("SIGINT", () => {
  stopNoise();
  process.exit(130);
});
process.on("SIGBREAK", () => {
  stopNoise();
  process.exit(130);
});

main().catch((e) => {
  stopNoise();
  log(red(`DEMO-AGENT CRASH: ${e?.stack || e}`));
  process.exit(3);
});