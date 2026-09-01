#!/usr/bin/env node
// FalsifyMe 2.0 · ui/tui-demo.mjs – Demo-Komposition (UI PHASE 1)
// -----------------------------------------------------------------------------
// Reine Beobachtung: OHNE Flags startet die TUI im WARTE-AUF-EINGABE-Modus
// (animiert, fest) und wartet auf Jobs von aussen. Jobs kommen ueber
//   - stdin-JSONL (gepipet): { "t":"job","id":"…","slot":1 }, Events: {t,…}
//     -> Externe Agents/Worker koennen die TUI so direkt fuettern (Phase 2 wiring).
// Flags:
//   --auto             Demo-Timeline: Jobs starten zeitversetzt auf Slots 1..3
//                      (max. 3 parallel im EINEN Terminal-pid) - fuer Tests/Demo.
//   --plain            keine TUI; strukturierte Statistik (headless/tests)
//   --stress           Output-Flut im Agenten + Messung
//   --fast             Szenarien-Zeit skaliert
//   --scenarios=list   kommaseparierte Sequenz (Default: write,plan,research,timeout,error)
//   --abort-after=ms   Abbruch automatisch ausloesen (Kill-Test headless)
//   --seed=N           deterministischer Partikel-Seed
// Q / STRG-C: laeuft ein Job -> ABORT aller Slots (echtes Kill + PID-Verifikation);
// sonst (WARTE/GESTOPPT) schliesst Q das Beobachtungsfenster.
// -----------------------------------------------------------------------------
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createTui } from "./tui.mjs";
import { createAbort, isDead } from "./tui/abort.mjs";
import { createParser } from "./tui/parser.mjs";

const AGENT = fileURLToPath(new URL("./demo-agent.mjs", import.meta.url));

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const eq = args.find((a) => a.startsWith(f + "="));
  if (eq !== undefined) return eq.slice(f.length + 1);
  const i = args.indexOf(f);
  return i === -1 ? d : args[i + 1];
};

const PLAIN = has("--plain");
const AUTO = has("--auto");
const STRESS = has("--stress");
const FAST = has("--fast");
const SEED = Number(val("--seed", "7"));
const ABORT_AFTER = Number(val("--abort-after", "0"));
const RAW_SCENARIOS = (val("--scenarios", "") || val("--scenario", "all")).split(",");
const ALL_SCENARIOS = RAW_SCENARIOS.includes("all") ? ["write", "plan", "research", "timeout", "error"] : RAW_SCENARIOS;

// stdin ist eine Pipe -> externe Agents fuettern die TUI; dann kein Tastatur-Input.
// Nur im UI-Kontext (stdout-TTY): headless (--plain) faehrt immer die Timeline,
// sonst wuerde ein offener stdin-Eingang den Lauf blockieren.
const FEED = !PLAIN && !process.stdin.isTTY;

let ui = null;
let abortResult = null;
let closedByUs = false;
let uiPass = false;
let exiting = false;
let fedCount = 0;
const kids = new Map(); // slot -> { child, pid, done }
const startTs = Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const summary = () => {
  const m = ui?.metrics;
  const dur = ((Date.now() - startTs) / 1000).toFixed(1);
  const fps = m?.frames && Number(dur) > 0 ? (m.frames / Math.max(0.01, Number(dur))).toFixed(1) : "0";
  const rssNow = process.memoryUsage().rss;
  const rssPeak = Math.max(m?.rssPeak || 0, rssNow);
  const deadAll = [...kids.values()].every((k) => isDead(k.pid));
  return [
    "FALSIFYME-UI PLAIN RUN",
    `scenarios: ${ALL_SCENARIOS.join(", ")}`,
    `lines: ${m?.lines ?? 0} · events: ${m?.events ?? 0} · findings: ${m?.findings ?? 0}`,
    `frames: ${m?.frames ?? 0} · maxFrameMs: ${m?.maxFrameMs ?? 0} · renderFps: ${fps}`,
    `rssPeak: ${Math.round(rssPeak / 1048576)}MB · duration: ${dur}s · lines/s: ${m ? m.linesPerSec() : 0}`,
    `abort: ${abortResult ?? "none"}${abortResult !== null ? ` · pidsDead: ${deadAll}` : ""}`,
    `UI: ${uiPass ? "PASS" : "FAIL"}`,
  ].join("\n");
};

// ---- Agenten-Kind fuer einen Slot spawnen; Stream -> UI (Slot hart verankert) ----
const startChild = (slot, scn) => {
  const child = spawn(
    process.execPath,
    [AGENT, ...(STRESS ? ["--stress"] : [])],
    { env: { ...process.env, FM_SCENARIO: scn, FM_SLOT: String(slot), FM_FAST: FAST ? "1" : "0" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  const entry = { child, pid: child.pid, scn, done: false };
  kids.set(slot, entry);

  const parser = createParser({
    onEvent: (evt) => ui.applyEvent({ ...evt, slot }),
    onLine: (line) => ui.noteLine(line),
  });
  child.stdout.on("data", (chunk) => parser.feed(chunk.toString()));
  child.stdout.on("end", () => parser.flush());
  child.stderr.on("data", () => {}); // Demo-Stderr wird nicht in die UI gespiegelt
  child.on("close", () => {
    entry.done = true;
  });
  return entry;
};

const busyKids = () => [...kids.values()].filter((k) => !k.done);

// ---- Auto-Timeline: zeitversetzte Jobs auf Slots 1..3 (max. 3 parallel) ----
const runTimeline = async () => {
  const next = (() => {
    let i = 0;
    return () => ALL_SCENARIOS[i++ % ALL_SCENARIOS.length];
  })();
  const s = (t) => Math.round((t * (FAST ? 0.35 : 1)) * 1000);
  const jobs = [
    { t: 0, slot: 1 },
    { t: 5, slot: 2 },
    { t: 10, slot: 3 }, // ab hier 3 Fenster parallel im einen Terminal
    { t: 16, slot: 1 },
    { t: 24, slot: 2 },
  ];
  let last = 0;
  for (const j of jobs) {
    await sleep(s(j.t - last));
    last = j.t;
    if (exiting) return;
    startChild(j.slot, next());
  }
  // Alle Kinder abwarten (Endzustaende -> Slots frei -> WARTE-Modus).
  const deadline = Date.now() + 90000;
  while (!exiting && Date.now() < deadline && busyKids().length > 0) {
    await sleep(500);
  }
  if (exiting) return;
  uiPass = true;
  if (PLAIN || ui.plain) {
    console.log(summary());
    process.exit(0);
  }
  // TTY: bleibt offen im WARTE-AUF-EINGABE-Modus; Q schliesst.
};

// ---- Abort: alle laufenden Slots wirklich killen; sonst Fenster schliessen ----
const abortFlow = async () => {
  if (exiting) return;
  const busy = busyKids();
  if (busy.length === 0) {
    // Nichts laeuft (WARTE/GESTOPPT/COMPLETE): Beobachtungsfenster schliessen.
    if (!PLAIN) ui.finish(0);
    else process.exit(0);
    return;
  }
  // SOFORT blocken: sonst raeumt ein Kind-close die Timeline ab, bevor der
  // Abort abgeschlossen ist (Race zwischen Promise-Resolves).
  exiting = true;
  closedByUs = true;
  for (const [slot] of kids) ui.applyEvent({ t: "state", s: "ABORTING", slot });
  const results = await Promise.all(
    busy.map((k) => createAbort({ child: k.child, killDelayMs: 2000 }).request()),
  );
  abortResult = results.every((r) => r === "ABORTED") ? "ABORTED" : "PARTIAL";
  for (const [slot] of kids) {
    ui.applyEvent({ t: "state", s: abortResult === "ABORTED" ? "ABORTED" : "ERROR", slot });
  }
  uiPass = abortResult === "ABORTED"; // sauberer Abort = erfolgreiche Phase
  if (PLAIN) {
    console.log(summary());
    process.exit(abortResult === "ABORTED" ? 0 : 1);
  }
  // TUI: alle Slots ABORTED -> WARTE-Screen (FEN zeigt GESTOPPT); Q schliesst.
};

// ---- stdin-JSONL-Feeder: externe Agents/Worker speisen Events in die UI ----
const feedFromStdin = async () => {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;
    try {
      const evt = JSON.parse(trimmed);
      if (evt && typeof evt.t === "string") {
        ui.applyEvent({ ...evt, slot: evt.slot ?? evt.window ?? 1 });
        fedCount += 1;
      }
    } catch {
      /* unlesbare Zeile ignorieren */
    }
  }
  // Pipe zu: TUI bleibt im WARTE-Modus offen (Agent kann neu verbinden).
};

const main = async () => {
  const stdinForInk = FEED
    ? new EventEmitter() // kein Tastatur-Input bei gefuetterter UI
    : process.stdin;
  // isTTY=true: Ink verlangt einen raw-mode-faehigen Stream, sonst "Raw mode
  // is not supported". Echte Daten kommen auf diesem Stummel nie an.
  stdinForInk.isTTY = true;
  stdinForInk.setRawMode = () => stdinForInk;
  stdinForInk.setEncoding = () => {};
  stdinForInk.pause = () => {};
  stdinForInk.resume = () => {};
  stdinForInk.read = () => null;

  ui = await createTui({
    onAbort: () => abortFlow().catch(() => {}),
    onExit: (code) => process.exit(code), // Fenster wirklich schliessen (Q/STRG-C)
    options: { seed: SEED, stdin: stdinForInk },
  });

  // Headless (kein stdout-TTY): IMMER Plain-Verhalten (Statistik + Exit) -
  // nie haengen bleiben. Tastatur gibt es dort nicht.
  const PLAIN_RUN = PLAIN || ui.plain;
  if (PLAIN_RUN && !PLAIN) {
    console.error("Hinweis: kein TTY erkannt - Plain-Modus (Statistik).");
  }

  if (ABORT_AFTER > 0) setTimeout(() => abortFlow().catch(() => {}), ABORT_AFTER);
  process.on("SIGINT", () => abortFlow().catch(() => {}));
  process.on("SIGTERM", () => abortFlow().catch(() => {}));
  process.on("exit", () => {
    // Laufende Kinder werden beim Prozessende beendet. Normale Q/SIGINT-
    // Pfade rufen vorher ui.finish() auf und verlassen Alt-Screen/Ink sauber.
    for (const { child } of kids.values()) {
      if (child && !child.killed) {
        try { child.kill(); } catch { /* egal */ }
      }
    }
  });

  if (FEED) {
    if (PLAIN_RUN) {
      // Headless-Feeder-Test: Events von aussen, dann Statistik + Exit.
      await feedFromStdin();
      uiPass = fedCount > 0;
      console.log(summary());
      process.exit(uiPass ? 0 : 1);
    } else {
      feedFromStdin().catch(() => {});
    }
  } else if (AUTO || PLAIN_RUN) {
    await runTimeline();
  }
  // Default (TTY ohne Flags): WARTE AUF EINGABE - Jobs nur von aussen (stdin-Pipe).
  await new Promise(() => {}); // TUI bleibt offen; Q/STRG-C beendet
};

main().catch((e) => {
  console.error("tui-demo crash:", e);
  process.exit(1);
});