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
export const ANIMATED = new Set(["STARTING", "LOADING", "CLAIMING", "THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERIFYING", "VERDICT"]);
export const STATE_LABEL = Object.freeze({ IDLE:"WARTE AUF EINGABE", STARTING:"STARTING", LOADING:"LOADING", CLAIMING:"CLAIMING", THINKING:"THINKING", TOOL_ACTIVITY:"TOOL ACTIVITY", FINDINGS:"FINDINGS", VERIFYING:"VERIFYING", VERDICT:"VERDICT", SUCCESS:"COMPLETE", ERROR:"ERROR", TIMEOUT:"TIMEOUT", ABORTING:"ABORTING", ABORTED:"ABORTED" });
export const STATE_COLOR = Object.freeze({ IDLE:"gray", STARTING:"yellow", LOADING:"yellow", CLAIMING:"cyan", THINKING:"blue", TOOL_ACTIVITY:"cyan", FINDINGS:"magenta", VERIFYING:"red", VERDICT:"magenta", SUCCESS:"green", ERROR:"red", TIMEOUT:"red", ABORTING:"red", ABORTED:"red" });
export const ALLOWED = Object.freeze({
  IDLE:["STARTING","ERROR","TIMEOUT","ABORTING","ABORTED","VERDICT"], STARTING:["LOADING","CLAIMING","THINKING","TOOL_ACTIVITY","FINDINGS","VERIFYING","VERDICT","IDLE","ERROR","TIMEOUT","ABORTING","ABORTED"],
  LOADING:["CLAIMING","THINKING","TOOL_ACTIVITY","FINDINGS","VERIFYING","VERDICT","IDLE","ERROR","TIMEOUT","ABORTING","ABORTED"], CLAIMING:["LOADING","THINKING","TOOL_ACTIVITY","FINDINGS","VERIFYING","VERDICT","IDLE","ERROR","TIMEOUT","ABORTING","ABORTED"],
  THINKING:["THINKING","TOOL_ACTIVITY","FINDINGS","VERIFYING","VERDICT","IDLE","ERROR","TIMEOUT","ABORTING","ABORTED"], TOOL_ACTIVITY:["THINKING","TOOL_ACTIVITY","FINDINGS","VERIFYING","VERDICT","IDLE","ERROR","TIMEOUT","ABORTING","ABORTED"],
  FINDINGS:["THINKING","TOOL_ACTIVITY","FINDINGS","VERIFYING","VERDICT","IDLE","ERROR","TIMEOUT","ABORTING","ABORTED"], VERIFYING:["THINKING","TOOL_ACTIVITY","FINDINGS","VERDICT","IDLE","ERROR","TIMEOUT","ABORTING","ABORTED"],
  VERDICT:["SUCCESS","THINKING","IDLE","ERROR","TIMEOUT","ABORTING","ABORTED"], SUCCESS:["STARTING","IDLE","ERROR","TIMEOUT","ABORTING","ABORTED"], ERROR:["STARTING","IDLE","ABORTING","ABORTED"], TIMEOUT:["STARTING","IDLE","ERROR","ABORTING","ABORTED"], ABORTING:["ABORTED","ERROR","IDLE"], ABORTED:["STARTING","IDLE"],
});
export const canTransition = (from,to) => ALLOWED[from]?.includes(to) ?? false;
export const ACTIVITY_STALE_MS = 12000;
export const isActive = (state,now=Date.now()) => ANIMATED.has(state.state) && now-state.lastActivityAt < ACTIVITY_STALE_MS;
export const MAX_SLOTS = 3;
export const SLOT_TERMINAL = new Set(["IDLE","SUCCESS","ERROR","TIMEOUT","ABORTED"]);

const makeSlot = (idx) => ({ idx,state:"IDLE",jobId:null,scopeId:null,verdict:null,bootAt:0,lastActivityAt:0,findings:freshFindings(),phases:createPhases(),activity:null,model:null,loopState:null,doki:null,files:0,filesList:[],events:createRing(80),output:createRing(200) });
export const slotsOf = (state) => state.slots;
export const activeSlotOf = (state) => state.slots[state.activeSlotIdx-1] ?? state.slots[0];
export const anyBusy = (state) => state.slots.some((s)=>!SLOT_TERMINAL.has(s.state));
export const globalIdle = (state) => !anyBusy(state);
export const busySlots = (state) => state.slots.filter((s)=>!SLOT_TERMINAL.has(s.state));
export const createUiState = () => {
  const slots=[makeSlot(1),makeSlot(2),makeSlot(3)];
  return { state:"IDLE",activeSlotIdx:1,slots,jobId:null,scopeId:null,verdict:null,bootAt:0,jobsStarted:0,lastActivityAt:0,findings:slots[0].findings,phases:slots[0].phases,activity:null,model:null,loopState:null,doki:null,files:0,filesList:[],events:slots[0].events,output:slots[0].output,testStatus:null,testSteps:null,testResult:null,stats:null };
};
export const LOOP_LABEL = Object.freeze({ WRITE_AUTHORIZED:"LOOP: FREIGABE (WRITE_AUTHORIZED)",WAITING_FOR_AGENT:"LOOP: WARTE AUF WRITER (WAITING_FOR_AGENT)",WRITE_IN_PROGRESS:"LOOP: WRITER AKTIV (WRITE_IN_PROGRESS)",CHANGE_CAPTURED:"LOOP: ÄNDERUNG ERFASST (CHANGE_CAPTURED)",RE_REVIEW_QUEUED:"LOOP: RE-REVIEW EINGEREICHT (RE_REVIEW_QUEUED)",RE_REVIEW_RUNNING:"LOOP: RE-REVIEW LÄUFT (RE_REVIEW_RUNNING)",DONE:"LOOP: ABGESCHLOSSEN (DONE)",LOOP_BLOCKED:"LOOP: GEBLOCKT (LOOP_BLOCKED)",ABORTED:"LOOP: ABGEBROCHEN (ABORTED)",ERROR:"LOOP: FEHLER (ERROR)" });
export const LOOP_COLOR = Object.freeze({ WRITE_AUTHORIZED:"green",WAITING_FOR_AGENT:"yellow",WRITE_IN_PROGRESS:"yellow",CHANGE_CAPTURED:"magenta",RE_REVIEW_QUEUED:"cyan",RE_REVIEW_RUNNING:"cyan",DONE:"green",LOOP_BLOCKED:"red",ABORTED:"red",ERROR:"red" });
export const loopLabelOf = (s) => s?.loopState ? LOOP_LABEL[s.loopState] ?? null : null;
export const shortId = (s) => { if(!s) return null; const clean=String(s).replace(/[^a-zA-Z0-9]/g,"").toUpperCase(); return clean.slice(-4)||null; };