// FalsifyMe TUI - UI-Zustandsspeicher
// Verantwortung: Zustandsdefinitionen, erlaubte Uebergaenge, initiale Struktur.
// Mutationen AUSSCHLIESSLICH ueber events.mjs (apply/tick/focusSlot) -> Domain-Helfer.
// Pure, kein I/O, keine React-Imports.
import { createRing } from "./ring.mjs";
import { createPhases } from "./progress.mjs";
import { fresh as freshFindings } from "./findings.mjs";

export const STATES = Object.freeze([
  "IDLE", "STARTING", "LOADING", "CLAIMING", "THINKING", "TOOL_ACTIVITY",
  "FINDINGS", "VERIFYING", "VERDICT", "SUCCESS", "ERROR", "TIMEOUT", "ABORTING", "ABORTED",
]);

// Zustaende, deren Animation "aktive Arbeit" signalisiert.
export const ANIMATED = new Set(["STARTING", "LOADING", "CLAIMING", "THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERIFYING", "VERDICT"]);

// Darstellungs-Vokabular (Label + Farbe) fuer Header/Statuszeile/Footer.
export const STATE_LABEL = Object.freeze({
  IDLE: "WARTE AUF EINGABE",
  STARTING: "STARTING",
  LOADING: "LOADING",
  CLAIMING: "CLAIMING",
  THINKING: "THINKING",
  TOOL_ACTIVITY: "TOOL ACTIVITY",
  FINDINGS: "FINDINGS",
  VERIFYING: "VERIFYING",
  VERDICT: "VERDICT",
  SUCCESS: "COMPLETE",
  ERROR: "ERROR",
  TIMEOUT: "TIMEOUT",
  ABORTING: "ABORTING",
  ABORTED: "ABORTED",
});

export const STATE_COLOR = Object.freeze({
  IDLE: "gray",
  STARTING: "yellow",
  LOADING: "yellow",
  CLAIMING: "cyan",
  THINKING: "blue",
  TOOL_ACTIVITY: "cyan",
  FINDINGS: "magenta",
  VERIFYING: "red",   // Evil-Twin-Gegenpruefung (Regel 6): Rot/Schwarz-Kontrast-Bildschirm
  VERDICT: "magenta",
  SUCCESS: "green",
  ERROR: "red",
  TIMEOUT: "red",
  ABORTING: "red",
  ABORTED: "red",
});

// Erlaubte Uebergaenge. Alle aktiven Zustaende duerfen in Abbruch-/Abschluss-Zustaende.
export const ALLOWED = Object.freeze({
  IDLE: ["STARTING", "ERROR", "TIMEOUT", "ABORTING", "ABORTED", "VERDICT"],
  STARTING: ["LOADING", "CLAIMING", "THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERIFYING", "VERDICT", "IDLE", "ERROR", "TIMEOUT", "ABORTING", "ABORTED"],
  LOADING: ["CLAIMING", "THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERIFYING", "VERDICT", "IDLE", "ERROR", "TIMEOUT", "ABORTING", "ABORTED"],
  CLAIMING: ["LOADING", "THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERIFYING", "VERDICT", "IDLE", "ERROR", "TIMEOUT", "ABORTING", "ABORTED"],
  THINKING: ["THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERIFYING", "VERDICT", "IDLE", "ERROR", "TIMEOUT", "ABORTING", "ABORTED"],
  TOOL_ACTIVITY: ["THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERIFYING", "VERDICT", "IDLE", "ERROR", "TIMEOUT", "ABORTING", "ABORTED"],
  FINDINGS: ["THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERIFYING", "VERDICT", "IDLE", "ERROR", "TIMEOUT", "ABORTING", "ABORTED"],
  VERIFYING: ["THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERDICT", "IDLE", "ERROR", "TIMEOUT", "ABORTING", "ABORTED"],
  VERDICT: ["SUCCESS", "THINKING", "IDLE", "ERROR", "TIMEOUT", "ABORTING", "ABORTED"],
  SUCCESS: ["STARTING", "IDLE", "ERROR", "TIMEOUT", "ABORTING", "ABORTED"],
  ERROR: ["STARTING", "IDLE", "ABORTING", "ABORTED"],
  TIMEOUT: ["STARTING", "IDLE", "ERROR", "ABORTING", "ABORTED"],
  ABORTING: ["ABORTED", "ERROR", "IDLE"],
  ABORTED: ["STARTING", "IDLE"],
});

export const canTransition = (from, to) => ALLOWED[from]?.includes(to) ?? false;

// Aktivitaets-Heuristik: "arbeitet der Prozess wirklich?"
// Aktiv gilt nur, wenn der Zustand aktiv ist UND in letzter Zeit echte
// Aktivitaets-Events eingetroffen sind. Kein Fake-"Denken" bei Haengern.
export const ACTIVITY_STALE_MS = 12000;

export const isActive = (state, now = Date.now()) =>
  ANIMATED.has(state.state) && now - state.lastActivityAt < ACTIVITY_STALE_MS;

// ---- 3 Fenster-Slots innerhalb des EINEN Terminal-Prozesses (pid) ----
export const MAX_SLOTS = 3;

// Endzustaende eines Slots: danach ist er wieder frei (= "kein Job aktiv").
export const SLOT_TERMINAL = new Set(["IDLE", "SUCCESS", "ERROR", "TIMEOUT", "ABORTED"]);

const makeSlot = (idx) => ({
  idx,
  state: "IDLE",
  jobId: null,
  scopeId: null,
  verdict: null, // { code, at } | null
  bootAt: 0,
  lastActivityAt: 0,
  findings: freshFindings(),
  phases: createPhases(),
  activity: null, // { label, tool, file } | null
  model: null,    // { thinker, twin, who: "thinker"|"twin" } | null (UI-Traceability)
  files: 0,
  filesList: [], // echte Scan-Dateien (files-Event mit list)
  events: createRing(80),  // strukturierte Aktivitaets-Events des Slots
  output: createRing(200), // begrenzte Roh-Output-Zeilen des Slots
});

export const slotsOf = (state) => state.slots;

// Fokus-Slot: Events ohne Slot-Angabe und die Hauptansicht wirken hier.
export const activeSlotOf = (state) => state.slots[state.activeSlotIdx - 1] ?? state.slots[0];

// Arbeitet irgendein Slot? (STARTING..VERDICT/ABORTING = beschaeftigt)
export const anyBusy = (state) => state.slots.some((s) => !SLOT_TERMINAL.has(s.state));

// Kein Slot beschaeftigt -> globaler Warte-/Idle-Zustand (WARTE AUF EINGABE).
export const globalIdle = (state) => !anyBusy(state);

export const busySlots = (state) => state.slots.filter((s) => !SLOT_TERMINAL.has(s.state));

export const createUiState = () => {
  const slots = [makeSlot(1), makeSlot(2), makeSlot(3)];
  return {
    // Top-Level-Felder sind SPIEGEL des aktiven Slots (refreshGlobal in events.mjs);
    // bootAt/jobsStarted sind global (Boot-Intro laeuft einmal pro TUI-Lauf).
    state: "IDLE",
    activeSlotIdx: 1,
    slots,
    jobId: null,
    scopeId: null,
    verdict: null,
    bootAt: 0,
    jobsStarted: 0,
    lastActivityAt: 0,
    findings: slots[0].findings,
    phases: slots[0].phases,
    activity: null,
    model: null,
    files: 0,
    filesList: [],
    events: slots[0].events,
    output: slots[0].output,
    // Selftest-Felder (Spec §6): nur aus echten selftest-Events vom Worker.
    // testStatus = aktuelles Label; testSteps = echte Checklist;
    // testResult = pass/fail (Endzustand). Nie kuenstlich gesetzt.
    testStatus: null,
    testSteps: null,
    testResult: null,
    // Progression-Statistik (User-Anker): GESAMT-Zahlen aus der Queue,
    // vom Worker per stats-Event geliefert (global, read-only Anzeige).
    stats: null,
  };
};

export const shortId = (s) => {
  if (!s) return null;
  const clean = String(s).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  // LETZTE 4 Zeichen, nicht die ersten: jede echte ID beginnt mit dem
  // geteilten Praefix ("job-"/"scope-") -> slice(0,4) ergab fuer ALLE Jobs
  // "JOB1" (Dock-Screenshot-Befund 2026-09-01: zwei Fenster ununterscheidbar).
  // Der Zufalls-Suffix hinten ist der unterscheidende Teil.
  return clean.slice(-4) || null;
};