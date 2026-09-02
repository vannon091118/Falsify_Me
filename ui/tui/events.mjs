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
  "verdict", "output", "files", "done", "focus", "selftest", "stats", "model",
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
  state.model = target.model;
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
      target.model = null;
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
      // Echter Startup-Selftest-Fortschritt (ui/README-tui.md, Spec: Boot &
      // Selftest). Der Worker emit-t
      // strukturierte Steps mit echtem Ergebnis (ok: true/false), sobald er
      // die jeweilige Pruefung durchgefuehrt hat. Keine Fake-Ergebnisse: ein
      // Step ist nur dann ok=true, wenn die echte Pruefung bestanden wurde.
      // status (String): kurzes Label fuer die aktuelle Phase (kompatibel).
      // step (Objekt): { name, ok, detail? } - eine echte Einzelpruefung.
      // steps (Array): komplette Step-Liste am Ende (ok/ok-fail-Report).
      if (typeof evt.status === "string") {
        state.testStatus = evt.status.slice(0, 48);
      } else if ("status" in evt) {
        // Ungueltiger Status (kein String) -> kein Fake, aber ehrlich null.
        state.testStatus = null;
      }
      if (evt.step && typeof evt.step === "object") {
        state.testSteps = state.testSteps ?? [];
        // Schritt ersetzen (gleicher Name) statt endlos anhaengen.
        const name = String(evt.step.name || "?").slice(0, 16);
        const ok = evt.step.ok === true;
        const detail = typeof evt.step.detail === "string" ? evt.step.detail.slice(0, 60) : null;
        const idx = state.testSteps.findIndex((s) => s.name === name);
        const entry = { name, ok, detail, ts: now };
        if (idx >= 0) state.testSteps[idx] = entry;
        else state.testSteps.push(entry);
        // testStatus spiegelt den neuesten Schritt
        state.testStatus = `${name}${ok ? " ✓" : " ✕"}`.slice(0, 48);
      }
      // testResult: finales Ergebnis (pass/fail) - nur vom Worker gesetzt,
      // wenn der Selftest wirklich abgeschlossen ist.
      if (evt.result === "pass" || evt.result === "fail") {
        state.testResult = evt.result;
      }
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
      // UI-Traceability (E2E-Befund 2026-09-02): WER denkt (Thinker vs.
      // Evil Twin) und MIT WELCHEM MODELL - ohne das ist die Gegenpruefung
      // von der Erstpruefung nicht unterscheidbar. Teil-Updates erlaubt
      // (z.B. nur who-Wechsel); ein who ohne passendes Modell ist ungueltig
      // (kein Fake-State).
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
      // Erzwingt den Zustands-Cue VERDICT (Verdict ist ein Terminal-Signal,
      // keine User-Entscheidung - nur echte Codes kommen hier an).
      verdict.applyTo(slotOf(state, evt), evt.v, now);
      refreshGlobal(state, now);
      return true;
    case "output": {
      slotOf(state, evt).output.push(typeof evt.line === "string" ? evt.line : "");
      return true;
    }
    case "stats": {
      // Progression-Statistik (User-Anker): GESAMT-Zahlen aus der Queue,
      // vom Worker beim Idle-/Start-Zustand geliefert. Global (uebergreifend),
      // kein Slot-Bezug - eine Statistik fuer die ganze lokale FalsifyMe-DB.
      if (evt.data && typeof evt.data === "object") state.stats = evt.data;
      return true;
    }
    case "files": {
      const slot = slotOf(state, evt);
      slot.files = Number(evt.n) || 0;
      // Echte Scan-Dateien (run.mjs-Whitelist) im Fenster sichtbar machen;
      // additiv und begrenzt - ohne list bleibt alles beim alten Verhalten.
      if (Array.isArray(evt.list)) slot.filesList = evt.list.slice(0, 20);
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
// Global: Boot-Intro ohne Job endet ehrlich im Warte-Zustand — ABER nur,
// wenn der echte Selftest abgeschlossen ist (testResult pass/fail). Laeuft
// der Selftest noch (Steps vorhanden, aber kein Ergebnis), bleibt das
// Boot-Intro aktiv, damit der Benutzer den echten Fortschritt sieht
// (ui/README-tui.md, Spec: Boot & Selftest).
export const tick = (state, now = Date.now()) => {
  for (const slot of state.slots) {
    if (slot.state === "STARTING" && now - slot.bootAt >= SOFT_CAP_MS) {
      setState(slot, "IDLE", now);
    }
  }
  if (state.jobsStarted === 0 && state.state === "STARTING" && now - state.bootAt >= SOFT_CAP_MS) {
    // Selftest noch am Laufen (Steps da, aber kein Ergebnis)? Boot halten.
    // Selftest fehlgeschlagen (testResult=fail)? Boot im Fehlerzustand
    // halten — NICHT in den normalen Idle fallen (ui/README-tui.md, Spec §6.6).
    const selftestRunning = Array.isArray(state.testSteps) && state.testSteps.length > 0 && state.testResult == null;
    const selftestFailed = state.testResult === "fail";
    if (!selftestRunning && !selftestFailed) {
      state.state = "IDLE";
    }
  }
  refreshGlobal(state, now);
};