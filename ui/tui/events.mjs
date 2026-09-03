// FalsifyMe TUI - Event-Verarbeitung
// Verantwortung: Event-Contract + EINZIGER State-Writer (apply) + Zeit-Tick.
// Events sind pro SLOT geroutet (evt.slot bzw. evt.window, sonst Fokus-Slot):
// 3 Fenster-Slots koennen parallel laufen, sichtbar im EINEN Terminal (pid).
// Business-Logik (Verdict, Jobs, Scope) bleibt ausserhalb der UI.
// Pure, kein I/O.
import { canTransition, shortId, MAX_SLOTS, SLOT_TERMINAL, activeSlotOf, globalIdle, LOOP_LABEL, loopLabelOf } from "./state.mjs";
import * as findings from "./findings.mjs";
import * as progress from "./progress.mjs";
import * as verdict from "./verdict.mjs";

export const SOFT_CAP_MS = 2500;

export const EVENT_TYPES = Object.freeze([
  "boot", "job", "state", "activity", "finding", "phase", "phase_done",
  "verdict", "output", "files", "done", "focus", "selftest", "stats", "model", "loop", "doki",
]);

const slotOf = (state, evt) => {
  const n = Number(evt?.slot ?? evt?.window);
  if (Number.isInteger(n) && n >= 1 && n <= MAX_SLOTS) return state.slots[n - 1];
  return activeSlotOf(state);
};

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
  state.model = target.model;
  state.loopState = target.loopState ?? null;
  state.files = target.files;
  state.events = target.events;
  state.output = target.output;
  state.doki = target.doki ?? null;
};

const setState = (slot, s, now) => {
  if (!canTransition(slot.state, s)) return false;
  slot.state = s;
  slot.lastActivityAt = now;
  slot.events.push({ t: "state", s, ts: now });
  return true;
};

export const focusSlot = (state, n, now = Date.now()) => {
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) return false;
  state.activeSlotIdx = n;
  return true;
};

export const apply = (state, evt, now = Date.now()) => {
  if (!evt || typeof evt !== "object" || typeof evt.t !== "string") return false;
  switch (evt.t) {
    case "boot": {
      state.state = "STARTING";
      state.bootAt = now;
      state.lastActivityAt = now;
      state.events.push({ t: "boot", ts: now });
      return true;
    }
    case "job": {
      const free = state.slots.find((s) => SLOT_TERMINAL.has(s.state));
      const slot = slotOf(state, evt);
      const target = SLOT_TERMINAL.has(slot.state) ? slot : (free ?? slot);
      target.jobId = shortId(evt.id) ?? target.jobId;
      if (evt.scope !== undefined && evt.scope !== null && evt.scope !== "") target.scopeId = shortId(evt.scope);
      findings.reset(target);
      progress.reset(target);
      target.verdict = null;
      target.activity = null;
      target.model = null;
      target.loopState = null;
      target.doki = null;
      target.files = 0;
      target.state = "STARTING";
      target.bootAt = now;
      target.lastActivityAt = now;
      target.events.push({ t: "job", id: target.jobId, scope: target.scopeId, ts: now });
      state.jobsStarted += 1;
      state.activeSlotIdx = target.idx;
      refreshGlobal(state, now);
      return true;
    }
    case "selftest": {
      if (typeof evt.status === "string") state.testStatus = evt.status.slice(0, 48);
      else if ("status" in evt) state.testStatus = null;
      if (evt.step && typeof evt.step === "object") {
        state.testSteps = state.testSteps ?? [];
        const name = String(evt.step.name || "?").slice(0, 16);
        const ok = evt.step.ok === true;
        const detail = typeof evt.step.detail === "string" ? evt.step.detail.slice(0, 60) : null;
        const idx = state.testSteps.findIndex((s) => s.name === name);
        const entry = { name, ok, detail, ts: now };
        if (idx >= 0) state.testSteps[idx] = entry;
        else state.testSteps.push(entry);
        state.testStatus = `${name}${ok ? " ✓" : " ✕"}`.slice(0, 48);
      }
      if (evt.result === "pass" || evt.result === "fail") state.testResult = evt.result;
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
    case "model": {
      const slot = slotOf(state, evt);
      const prev = slot.model ?? { thinker: null, twin: null, who: null };
      const thinker = typeof evt.thinker === "string" && evt.thinker.trim() ? evt.thinker.trim().slice(0, 80) : prev.thinker;
      const twin = typeof evt.twin === "string" && evt.twin.trim() ? evt.twin.trim().slice(0, 80) : prev.twin;
      const who = evt.who === "thinker" || evt.who === "twin" ? evt.who : prev.who;
      if (who === "twin" && !twin) return false;
      if (who === "thinker" && !thinker) return false;
      if (!who || (!thinker && !twin)) return false;
      slot.model = { thinker, twin, who };
      slot.events.push({ t: "model", thinker, twin, who, ts: now });
      refreshGlobal(state, now);
      return true;
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
      verdict.applyTo(slotOf(state, evt), evt.v, now);
      refreshGlobal(state, now);
      return true;
    case "output": {
      slotOf(state, evt).output.push(typeof evt.line === "string" ? evt.line : "");
      return true;
    }
    case "doki": {
      const slot = slotOf(state, evt);
      slot.doki = {
        narrator: typeof evt.narrator === "string" ? evt.narrator.slice(0, 32) : null,
        mood: typeof evt.mood === "string" ? evt.mood.slice(0, 32) : null,
        body: typeof evt.body === "string" ? evt.body.slice(0, 4000) : "",
        mode: typeof evt.mode === "string" ? evt.mode.slice(0, 32) : null,
        renderPath: typeof evt.renderPath === "string" ? evt.renderPath.slice(0, 48) : null,
        ts: now,
      };
      slot.output.push(`DOKI · ${slot.doki.narrator ?? "Narrator"}${slot.doki.mood ? ` · ${slot.doki.mood}` : ""}: ${slot.doki.body}`);
      slot.events.push({ t: "doki", narrator: slot.doki.narrator, mood: slot.doki.mood, ts: now });
      refreshGlobal(state, now);
      return true;
    }
    case "loop": {
      const slot = slotOf(state, evt);
      const known = LOOP_LABEL[evt.s];
      slot.loopState = known ? evt.s : null;
      slot.events.push({ t: "loop", s: slot.loopState, ts: now });
      refreshGlobal(state, now);
      return true;
    }
    case "stats": {
      if (evt.data && typeof evt.data === "object") state.stats = evt.data;
      return true;
    }
    case "files": {
      const slot = slotOf(state, evt);
      slot.files = Number(evt.n) || 0;
      if (Array.isArray(evt.list)) slot.filesList = evt.list.slice(0, 20);
      refreshGlobal(state, now);
      return true;
    }
    case "done": {
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

export const tick = (state, now = Date.now()) => {
  for (const slot of state.slots) {
    if (slot.state === "STARTING" && now - slot.bootAt >= SOFT_CAP_MS) setState(slot, "IDLE", now);
  }
  if (state.jobsStarted === 0 && state.state === "STARTING" && now - state.bootAt >= SOFT_CAP_MS) {
    const selftestRunning = Array.isArray(state.testSteps) && state.testSteps.length > 0 && state.testResult == null;
    const selftestFailed = state.testResult === "fail";
    if (!selftestRunning && !selftestFailed) state.state = "IDLE";
  }
  refreshGlobal(state, now);
};
