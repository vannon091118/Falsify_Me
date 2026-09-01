// FalsifyMe TUI - Event-Verarbeitung
// Verantwortung: Event-Contract + EINZIGER State-Writer (apply) + Zeit-Tick.
// Events sind pro SLOT geroutet (evt.slot bzw. evt.window, sonst Fokus-Slot):
// 3 Fenster-Slots koennen parallel laufen, sichtbar im EINEN Terminal (pid).
// Business-Logik (Verdict, Jobs, Scope) bleibt ausserhalb der UI.
// Pure, kein I/O.
import { canTransition, shortId, MAX_SLOTS, SLOT_TERMINAL, activeSlotOf, globalIdle } from "./state.mjs";
import * as findings from "./findings.mjs";
import * as progress from "./progress.mjs";
import * as verdict from "./verdict.mjs";

// Nach dieser Zeit ohne ein einziges Event endet STARTING ehrlich in IDLE
// (kein kuenstliches "Denken" bei haengendem Start).
export const SOFT_CAP_MS = 2500;

export const EVENT_TYPES = Object.freeze([
  "boot", "job", "state", "activity", "finding", "phase", "phase_done",
  "verdict", "output", "files", "done", "focus", "selftest",
]);

const slotOf = (state, evt) => {
  const n = Number(evt?.slot ?? evt?.window);
  if (Number.isInteger(n) && n >= 1 && n <= MAX_SLOTS) return state.slots[n - 1];
  return activeSlotOf(state);
};

// Top-Level-Felder = Spiegel des aktiven Slots (die Views lesen nur den Spiegel).
// Solange noch gar kein Job gestartet wurde, laeuft das Boot-Intro (STARTING).
export const refreshGlobal = (state, now = Date.now()) => {
  if (state.jobsStarted === 0) return;
  const target = activeSlotOf(state);
  state.state = globalIdle(state) ? "IDLE" : target.state;
  state.jobId = target.jobId;
  state.scopeId = target.scopeId;
  state.verdict = target.verdict;
  state.lastActivityAt = target.lastActivityAt;
  state.findings = target.findings;
  state.phases = target.phases;
  state.activity = target.activity;
  state.files = target.files;
  state.events = target.events;
  state.output = target.output;
};

const setState = (slot, s, now) => {
  if (!canTransition(slot.state, s)) return false;
  slot.state = s;
  slot.lastActivityAt = now;
  slot.events.push({ t: "state", s, ts: now });
  return true;
};

// Fokus-Slot wechseln (1..3). Reine Anzeige-Sache - keine Produktlogik.
export const focusSlot = (state, n, now = Date.now()) => {
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) return false;
  state.activeSlotIdx = n;
  return true;
};

// Wendet e. Per convention: Rueckgabe false = ignoriert/ungueltig.
export const apply = (state, evt, now = Date.now()) => {
  if (!evt || typeof evt !== "object" || typeof evt.t !== "string") return false;
  switch (evt.t) {
    case "boot": {
      // Einmaliges Maschinen-Intro pro TUI-Lauf (global, nicht pro Slot).
      state.state = "STARTING";
      state.bootAt = now;
      state.lastActivityAt = now;
      state.events.push({ t: "boot", ts: now });
      return true;
    }
    case "job": {
      // Neuer Job von aussen (Agent/Worker): belegt einen freien Slot.
      const free = state.slots.find((s) => SLOT_TERMINAL.has(s.state));
      const slot = slotOf(state, evt);
      const target = SLOT_TERMINAL.has(slot.state) ? slot : (free ?? slot);
      target.jobId = shortId(evt.id) ?? target.jobId;
      if (evt.scope !== undefined && evt.scope !== null && evt.scope !== "") target.scopeId = shortId(evt.scope);
      // Frischer Job: slotbezogene Anzeigen zuruecksetzen (Output-Ring bleibt begrenzt bestehen).
      findings.reset(target);
      progress.reset(target);
      target.verdict = null;
      target.activity = null;
      target.files = 0;
      target.state = "STARTING";
      target.bootAt = now;
      target.lastActivityAt = now;
      target.events.push({ t: "job", id: target.jobId, scope: target.scopeId, ts: now });
      state.jobsStarted += 1;
      // Fokus folgt dem neuesten Job: der Beobachter sieht, was passiert.
      state.activeSlotIdx = target.idx;
      refreshGlobal(state, now);
      return true;
    }
    case "selftest": {
      // Kleiner echter Teststatus für das Startup-Intro; keine eigene Logik.
      state.testStatus = typeof evt.status === "string" ? evt.status.slice(0, 32) : null;
      return true;
    }
    case "focus": {
      const ok = focusSlot(state, evt.slot ?? evt.n, now);
      refreshGlobal(state, now);
      return ok;
    }
    case "state": {
      const slot = slotOf(state, evt);
      const ok = setState(slot, evt.s, now);
      refreshGlobal(state, now);
      return ok;
    }
    case "activity": {
      const slot = slotOf(state, evt);
      slot.activity = { label: evt.label ?? null, tool: evt.tool ?? null, file: evt.file ?? null };
      slot.lastActivityAt = now;
      slot.events.push({ t: "activity", label: evt.label ?? null, tool: evt.tool ?? null, file: evt.file ?? null, ts: now });
      refreshGlobal(state, now);
      return true;
    }
    case "finding": {
      const slot = slotOf(state, evt);
      findings.bump(slot, evt.severity, now);
      slot.events.push({ t: "finding", severity: evt.severity ?? "discovered", ts: now });
      refreshGlobal(state, now);
      return true;
    }
    case "phase": {
      const slot = slotOf(state, evt);
      const ok = progress.setPhase(slot, evt.phase, evt.progress, now);
      refreshGlobal(state, now);
      return ok;
    }
    case "phase_done": {
      const slot = slotOf(state, evt);
      const ok = progress.setPhaseDone(slot, evt.phase, now);
      refreshGlobal(state, now);
      return ok;
    }
    case "verdict":
      // Erzwingt den Zustands-Cue VERDICT (Verdict ist ein Terminal-Signal,
      // keine User-Entscheidung - nur echte Codes kommen hier an).
      verdict.applyTo(slotOf(state, evt), evt.v, now);
      refreshGlobal(state, now);
      return true;
    case "output": {
      slotOf(state, evt).output.push(typeof evt.line === "string" ? evt.line : "");
      return true;
    }
    case "files": {
      const slot = slotOf(state, evt);
      slot.files = Number(evt.n) || 0;
      refreshGlobal(state, now);
      return true;
    }
    case "done": {
      // Job-Ende: WRITE-Verdict fuehrt zu SUCCESS, sonst ehrlich zum Warten.
      const slot = slotOf(state, evt);
      const v = slot.verdict?.code;
      const target = v === "WRITE" ? "SUCCESS" : "IDLE";
      const ok = setState(slot, target, now);
      slot.events.push({ t: "done", verdict: v ?? null, ts: now });
      refreshGlobal(state, now);
      return ok;
    }
    default:
      return false;
  }
};

// Zeit-Tick: temporale Uebergaenge, die nicht von Events abhaengen.
// Pro Slot: STARTING ohne Folge-Events endet ehrlich in IDLE.
// Global: Boot-Intro ohne Job endet ehrlich im Warte-Zustand.
export const tick = (state, now = Date.now()) => {
  for (const slot of state.slots) {
    if (slot.state === "STARTING" && now - slot.bootAt >= SOFT_CAP_MS) {
      setState(slot, "IDLE", now);
    }
  }
  if (state.jobsStarted === 0 && state.state === "STARTING" && now - state.bootAt >= SOFT_CAP_MS) {
    state.state = "IDLE";
  }
  refreshGlobal(state, now);
};