#!/usr/bin/env node
// FalsifyMe 2.0 · ui/tui.mjs – Kompositions-Wurzel der Terminal-UI
// -----------------------------------------------------------------------------
// Verdrahtet die Bausteine (pure Domain + I/O + Views) ZU EINER Einheit:
// PROCESS -> STREAM -> EVENTS -> STATE -> RENDER.
// - Plain-Modus (kein TTY): gleiche Pipeline, strukturierte Statistik statt TUI.
// - TTY-Modus: Alt-Screen, Scheduler, Resize, Ink-App.
// Reine Beobachtung: User-Input existiert NICHT (ausser Q/STRG-C = Schliessen/
// Abbrechen + [T] Ansichtswechsel). Jobs kommen von aussen (Agents/Worker)
// und belegen bis zu 3 Fenster-Slots im EINEN Terminal-Prozess (pid).
// KEINE Produktlogik: Events kommen ueber applyEvent herein, nichts anderes.
// -----------------------------------------------------------------------------
import React from "react";
import { EventEmitter } from "node:events";
import { render as inkRender } from "ink";
import {
  createUiState, STATE_LABEL, STATE_COLOR, ANIMATED, ACTIVITY_STALE_MS,
  activeSlotOf, busySlots, globalIdle, SLOT_TERMINAL,
} from "./tui/state.mjs";
import { apply, tick } from "./tui/events.mjs";
import { createMetrics } from "./tui/metrics.mjs";
import { createField, step, render as renderField, setLabels } from "./tui/particles.mjs";
import { createScheduler } from "./tui/scheduler.mjs";
import { createResize } from "./tui/resize.mjs";
import * as boot from "./tui/boot.mjs";
import * as findings from "./tui/findings.mjs";
import * as progress from "./tui/progress.mjs";
import * as verdict from "./tui/verdict.mjs";
import * as terminal from "./tui/terminal.mjs";
import App from "./tui/views/App.mjs";

const h = React.createElement;

// Fallback-stdin fuer TUI ohne Konsole (z.B. gefuettert via Pipe): Ink
// verlangt setRawMode-faehige Streams, sonst wirft es "Raw mode is not
// supported". Dieser Stream ist ein TTY-faehiger Stummel - Input kommt nie an.
const fakeStdin = (options) => {
  const s = options?.stdin;
  if (s) return s;
  if (process.stdin.isTTY) return process.stdin;
  const stub = new EventEmitter();
  stub.isTTY = true;
  stub.setRawMode = () => stub;
  stub.setEncoding = () => {};
  stub.pause = () => {};
  stub.resume = () => {};
  stub.read = () => null;
  return stub;
};

const DEFAULT_DIMS = () => {
  let cols = process.stdout.columns || 80;
  let rows = process.stdout.rows || 24;
  // Achtung Windows: getWindowSize() liefert hier die PUFFER-Groesse der
  // klassischen Konsole statt der Fenstergroesse und darf NICHT uebernommen
  // werden (fuehrte zu daueraftem "TERMINAL ZU KLEIN", unabhaengig von der
  // tatsaechlichen Fenstergroesse). process.stdout.columns/rows folgen dem
  // resize-Event (feuert zuverlaessig in Windows Terminal/PowerShell-Konsolen;
  // klassische cmd-Konsolen: bekanntes node#13197 - dort ist Live-Resize
  // eingeschraenkt, die Initialgroesse stimmt aber immer).
  if (!cols || !rows) {
    try {
      const [r, c] = process.stdout.getWindowSize();
      if (!cols && c) cols = c;
      if (!rows && r) rows = r;
    } catch { /* kein TTY */ }
  }
  return { cols, rows };
};

const slotLabel = (s) => (s.state === "IDLE" ? "BEREIT" : STATE_LABEL[s.state]);

const overlayFor = (state) => {
  switch (state.state) {
    case "SUCCESS": {
      const v = verdict.view(state, Date.now());
      return v
        ? { lines: [` ${v.symbol}  ${v.code}  –  ${v.label} `], color: "green" }
        : { lines: [" ✓  COMPLETE "], color: "green" };
    }
    case "ERROR":
      return { lines: [" ✕  ERROR  –  FALSIFICATION FAILED "], color: "red" };
    case "TIMEOUT":
      return { lines: [" ✕  TIMEOUT  –  FALSIFICATION FAILED "], color: "red" };
    case "ABORTING":
      return { lines: [" ⏹  ABORTING … "], color: "red" };
    case "ABORTED":
      return { lines: [" ⏹  ABORTED – Q schliesst dieses Fenster "], color: "red" };
    default:
      return null;
  }
};

export const createTui = async ({ onAbort = () => {}, onExit = () => {}, options = {} } = {}) => {
  const state = createUiState();
  const metrics = createMetrics();
  // Jeder Startup beginnt mit dem visuellen Intro. Das ist UI-Lifecycle,
  // kein Job-Start und keine Produkt-/Agentensteuerung. Erst externe
  // job/state-Events belegen einen Slot.
  apply(state, { t: "boot" }, Date.now());
  const seed = options.seed ?? 7;
  // Ein Partikelfeld PRO Slot: parallele Fenster animieren unabhaengig.
  const fields = [null, createField({ seed }), createField({ seed: seed + 11 }), createField({ seed: seed + 23 })];
  const dims = DEFAULT_DIMS();
  const isTty = Boolean(process.stdout.isTTY);

  let mode = "thinking";
  let snap = null;
  let sched = null;
  let resize = null;
  let unmountFn = null;
  const subscribers = new Set();
  const labelPools = new Map();
  let lastFrameAt = metrics.startedAt;

  const rememberLabel = (label, slotIdx) => {
    if (!label) return;
    const arr = labelPools.get(slotIdx) ?? [];
    arr.unshift(String(label));
    if (arr.length > 5) arr.pop();
    labelPools.set(slotIdx, arr);
    setLabels(fields[slotIdx], arr);
  };

  // Feldgroessen je Layout: Einzelansicht volle Flaeche, Split: Panel-Innenraum.
  const fieldRowsFor = (mainRows, busy, slot) => {
    const idx = busy.findIndex((s) => s.idx === slot.idx);
    if (idx === -1) return Math.max(2, mainRows - 7);
    if (busy.length === 1) return Math.max(4, mainRows - 7);
    const n = busy.length;
    const base = Math.floor(mainRows / n);
    const extra = mainRows - base * n;
    return Math.max(2, base + (idx < extra ? 1 : 0) - 4);
  };

  const buildSnap = ({ dt, now }) => {
    tick(state, now);
    const focused = activeSlotOf(state);
    const busy = busySlots(state);
    const idleNow = globalIdle(state);
    const mainRows = Math.max(2, dims.rows - 6);

    for (const slot of state.slots) {
      const f = fields[slot.idx];
      f.cols = dims.cols;
      f.rows = fieldRowsFor(mainRows, busy, slot);
      const animated = ANIMATED.has(slot.state) && now - slot.lastActivityAt < ACTIVITY_STALE_MS;
      step(f, Math.min(250, Math.max(0, dt)), { active: animated });
    }

    const activeNow =
      !idleNow && ANIMATED.has(focused.state) && now - focused.lastActivityAt < ACTIVITY_STALE_MS;

    const bootStage = boot.stage(state, now);
    const startupIntro = bootStage.mode !== "live";
    snap = {
      state: state.state,
      stateLabel: startupIntro ? "STARTING" : idleNow ? "WARTE AUF EINGABE" : slotLabel(focused),
      stateColor: startupIntro ? STATE_COLOR.STARTING : idleNow ? "gray" : STATE_COLOR[focused.state],
      active: activeNow,
      jobId: state.jobId,
      scopeId: state.scopeId,
      windowIdx: state.activeSlotIdx,
      activeSlotIdx: state.activeSlotIdx,
      // Evil-Twin-Phase (Regel 6, UI-109): der Fokus-Slot ist in der
      // unabhaengigen Gegenpruefung -> App schaltet auf den Rot/Schwarz-
      // Kontrast-Bildschirm mit dem Roh-Text des Gegenpruefers um.
      twinActive: state.state === "VERIFYING",
      jobsStarted: state.jobsStarted,
      globalIdle: idleNow,
      slots: state.slots.map((s) => ({
        idx: s.idx,
        state: s.state,
        twinActive: s.state === "VERIFYING",
        stateLabel: slotLabel(s),
        stateColor: STATE_COLOR[s.state],
        jobId: s.jobId,
        scopeId: s.scopeId,
        verdict: verdict.view(s, now),
        files: s.files,
      })),
      slotPanels: busy.map((s) => ({
        idx: s.idx,
        fen: `FEN ${s.idx}`,
        state: s.state,
        twinActive: s.state === "VERIFYING",
        stateLabel: slotLabel(s),
        stateColor: STATE_COLOR[s.state],
        jobId: s.jobId,
        scopeId: s.scopeId,
        verdict: verdict.view(s, now),
        findings: findings.countersView(s, now),
        phases: progress.phasesView(s),
        activePhase: progress.activePhase(s),
        files: s.files,
        activity: s.activity,
        files: s.files,
        filesList: s.filesList,
        particles: renderField(fields[s.idx]),
      })),
      boot: bootStage,
      // Progression-Statistik (User-Anker, stats-Event des Workers) –
      // globale Gesamtzahlen; der Idle-Screen zeigt sie als persistenten
      // Anker („X Fehler in Y Tasks, Z Jobs nötig“).
      stats: state.stats,
      // Optionaler, echter Selftest: nur sichtbar, wenn ein externer
      // Worker selftest-Events mit echten Pruefungen liefert; nie kuenstlich.
      testStatus: state.testStatus ?? null,
      testSteps: state.testSteps ?? null,
      testResult: state.testResult ?? null,
      mode,
      dims: { cols: dims.cols, rows: dims.rows },
      now,
      dt,
      particles: { cells: renderField(fields[focused.idx]) },
      findings: findings.countersView(focused, now),
      phases: progress.phasesView(focused),
      activePhase: progress.activePhase(focused),
      activity: focused.activity,
      lastEvents: focused.events.toArray().slice(-10),
      // Roh-Output des LLM/der Pipeline (Ring, begrenzt) — fuer den
      // t-Toggle „Thinking sichtbar machen“ (OutputView).
      output: focused.output.toArray().slice(-60),
      verdict: verdict.view(focused, now),
      files: focused.files,
      filesList: focused.filesList,
      overlay: overlayFor(state),
      metrics: {
        spark: metrics.sparkline(),
        linesPerSec: metrics.linesPerSec(),
        frames: metrics.frames,
        maxFrameMs: metrics.maxFrameMs,
        rssPeak: metrics.rssPeak,
        lines: metrics.lines,
      },
    };
    return snap;
  };

  // EINZIGE Event-Tuer in die UI. Kein Rendern pro Chunk - nur Takt setzen.
  const applyEvent = (evt) => {
    const ok = apply(state, evt);
    if (ok) metrics.noteEvent();
    if (evt?.t === "finding") metrics.noteFinding();
    if (evt?.t === "activity") rememberLabel(evt.label, evt.slot ?? evt.window ?? state.activeSlotIdx);
    if (isTty && sched) sched.requestNow();
    return ok;
  };

  // Optimierter Roh-Zeilenpfad (kein Event-Objekt pro Zeile - Flut-sicher).
  const noteLine = (line) => {
    metrics.noteLine();
    activeSlotOf(state).output.push(line);
  };

  const emit = (action) => {
    if (action === "toggle") {
      mode = mode === "thinking" ? "reasoning" : "thinking";
      if (isTty && sched) sched.requestNow();
    } else if (action === "abort") {
      onAbort();
    }
  };

  const cleanup = () => {
    if (unmountFn) {
      try { unmountFn(); } catch { /* egal */ }
      unmountFn = null;
    }
    sched?.stop();
    resize?.stop();
    if (isTty) {
      try { terminal.exit(); } catch { /* egal */ }
    }
  };

  const finish = (code = 0) => {
    cleanup();
    onExit(code);
  };

  if (!isTty) {
    // Plain-Modus: gleiche Pipeline, kein Ink, keine ANSI.
    // Sanfter Mess-Ticker (4 Hz aktiv / 1 Hz idle) simuliert das FPS-Regime
    // der TUI und misst die Snapshot-Bauzeit unter Last (headless Perf-Test).
    let plainTimer = null;
    const plainTick = () => {
      const t0 = performance.now();
      buildSnap({ dt: 0, now: Date.now() });
      metrics.noteFrame(Math.round(performance.now() - t0));
      const busy = busySlots(state).length > 0;
      plainTimer = setTimeout(plainTick, busy ? 250 : 1000);
    };
    plainTimer = setTimeout(plainTick, 250);
    const finishPlain = (code = 0) => {
      if (plainTimer !== null) clearTimeout(plainTimer);
      onExit(code);
    };
    return {
      plain: true,
      state,
      metrics,
      dims,
      applyEvent,
      noteLine,
      getSnap: () => buildSnap({ dt: 16, now: Date.now() }),
      finish: finishPlain,
    };
  }

  // ---- TTY-Modus ----
  terminal.enter();
  sched = createScheduler({
    activeFps: 15,
    idleFps: 1,
    onFrame: (f) => {
      const s = buildSnap(f);
      // FPS-Regime: 15 FPS bei Arbeit, 6 FPS Warte-Screen (sanfte Animation),
      // 1 FPS nur bei komplett statischen Momenten.
      sched.setRates({ activeFps: s.globalIdle ? 6 : 15 });
      sched.setActive(true);
      const interval = s.now - lastFrameAt;
      lastFrameAt = s.now;
      metrics.noteFrame(interval);
      for (const cb of subscribers) cb(s);
    },
  });

  resize = createResize({
    getSize: () => DEFAULT_DIMS(),
    onResize: (s) => {
      dims.cols = s.cols;
      dims.rows = s.rows;
      terminal.setTitle(`FALSIFYME · ${dims.cols}x${dims.rows}`);
      sched.requestNow();
    },
    intervalMs: 400,
    debounceMs: 50,
  });

  const subscribe = (cb) => {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  };

  const app = inkRender(
    h(App, {
      getSnapshot: () => (snap !== null ? snap : buildSnap({ dt: 16, now: Date.now() })),
      subscribe,
      emit,
    }),
    {
      stdout: process.stdout,
      stdin: fakeStdin(options),
      exitOnCtrlC: false,
    },
  );
  unmountFn = () => app.unmount();

  sched.start();
  resize.start();

  return {
    plain: false,
    state,
    metrics,
    dims,
    applyEvent,
    noteLine,
    getSnap: () => snap,
    finish,
    isAborting: () => state.state === "ABORTING",
  };
};