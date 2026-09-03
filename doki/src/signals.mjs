// DOKI reiner Kern — Signal-Katalog (PLATZHALTER-ETUDE, nicht im Runtime-Pfad).
//
// Verantwortung: EINE Quelle fuer die NICHT-FIKTIVEN Signale, die der reine
// Kern konsumiert. Jede Konstante hier ist eine Abbildung eines REAL existie-
// renden Vertrags im Repo — nichts ist erfunden:
//   - FM-EVT-Eventtypen   ← ui/tui/events.mjs EVENT_TYPES (Kommentar-Vertrag,
//                           statisch im Test gegen die Quelldatei geprueft)
//   - Loop-Zustaende      ← artifacts/loops.mjs LOOP_STATES
//   - Verdict-Codes       ← ui/tui/verdict.mjs MAP (WRITE/PLAN/RESEARCH/ASK/…)
//   - Achsen              ← doki/src/ensemble-state.mjs CHARACTER_AXES
//   - Reaktivitaet        ← doki/src/narrator-catalog.mjs REACTIVITY_AXES
//   - C.A.R.E.-Stufen     ← doki/src/narrator-context.mjs CARE_STAGES
//   - Korrelation         ← doki/src/history.mjs correlation()
//
// Reine Logik: keine DB, kein fetch, kein Import von FalsifyMe-Modulen.
// Provenienz-Regel (nicht verhandelbar): DEFAULT ist keine Beobachtung. Ein
// Achsenwert, der nur vom Startzustand stammt (Charakteremotion=0, Beziehung=0.5),
// traegt provenance DEFAULT und darf nie als gelerntes Verbehalten gewertet
// oder als Impact-Evidenz benutzt werden — erst eine echte Bewegung (OBSERVED)
// hebt die Provenienz.
//
// MIRROR_V1 (Freeze-Vertrag, siehe doki/tests/mirror.test.mjs): die reinen
// Operatoren tragen gespiegelte Identifier (etats/atled/dlohserht/yaced/…),
// damit die Transfer-Semantik von FalsifyMe-Kern und DOKI-Kern strukturell
// identisch bleibt, ohne dieselben Namen zu tragen.

import { REACTIVITY_AXES } from './narrator-catalog.mjs';

export const RULE_VERSION = 'doki.signals.v1';

// ── FM-EVT-Vokabular (ui/tui/events.mjs EVENT_TYPES — Spiegel, kein Import) ──
export const FM_EVT_TYPES = Object.freeze([
  'boot', 'job', 'state', 'activity', 'finding', 'phase', 'phase_done',
  'verdict', 'output', 'files', 'done', 'focus', 'selftest', 'stats', 'model',
  'loop', 'scope_auto', 'handoff', 'doki',
]);

// Loop-Zustaende (artifacts/loops.mjs LOOP_STATES — Spiegel).
export const LOOP_STATES = Object.freeze([
  'QUEUED', 'RUNNING', 'WRITE_AUTHORIZED', 'WAITING_FOR_AGENT', 'WRITE_IN_PROGRESS',
  'CHANGE_CAPTURED', 'RE_REVIEW_QUEUED', 'RE_REVIEW_RUNNING',
  'DONE', 'LOOP_BLOCKED', 'ABORTED', 'ERROR',
]);

// Verdict-Codes (ui/tui/verdict.mjs MAP — Spiegel).
export const VERDICT_CODES = Object.freeze(['WRITE', 'PLAN', 'RESEARCH', 'ASK', 'ERROR', 'TIMEOUT']);

// Findings-Schweregrade (ui/tui/findings.mjs SEVERITIES — Spiegel).
export const FINDING_SEVERITIES = Object.freeze(['discovered', 'warning', 'critical']);

// C.A.R.E.-Stufen (doki/src/narrator-context.mjs — Spiegel).
export const CARE_STAGES = Object.freeze(['CLAIM', 'ATTACK', 'RE_EVALUATE', 'EVIDENCE']);

// Korrelationsstatus (doki/src/history.mjs correlation() — Spiegel).
export const CORRELATIONS = Object.freeze(['CONVERGENT', 'PERSPECTIVE_DIFFERENCE', 'DIVERGENCE', 'UNAVAILABLE']);

// Aleatorische Achsen (doki/src/ensemble-state.mjs CHARACTER_AXES — Spiegel).
export const CHARACTER_AXES = Object.freeze([
  'trust', 'respect', 'irritation', 'affinity',
  'competence_confidence', 'resentment', 'curiosity', 'defensiveness',
]);

// Reaktivitaets-Achsen (doki/src/narrator-catalog.mjs REACTIVITY_AXES — Spiegel).
export const REACTIVITY = REACTIVITY_AXES;

// ── Provenienz (ehrlich ueber Herkunft, keine Fiktion) ──────────────────────
export const PROVENANCE = Object.freeze({
  DEFAULT: 'DEFAULT',   // Startzustand (0 / 0.5) — nie eine Beobachtung
  OBSERVED: 'OBSERVED', // echte Bewegung an der Grenze (FM-EVT / Snapshot)
  DERIVED: 'DERIVED',   // aus OBSERVED rein abgeleitet (regelgetrieben)
});

// ── Narrative Leiter (Anti-Gimmick: Persistenz billig, Relevanz teuer) ──────
// Ein Signal wird erst prompt-eligibel, wenn es ALLE vier Stufen durchlaufen
// hat. Diese Leiter ist die harte Regel „Persistiert ≠ sinnvoll genutzt“.
export const LADDER = Object.freeze(['OBSERVED', 'PERSISTED', 'DERIVED', 'NARRATIVELY_RELEVANT']);

// Wie viele Signale duerfen den Narrator je Lauf hoechstens sehen?
// (Prompt-Relevanz ist teuer — harte Obergrenze, keine Heuristik im Prompt.)
export const PROMPT_RELEVANCE_CAP = 7;

// ── User-Ereigniskanal (definierte Quelle — NIEMALS WhatsApp/X/Discord) ─────
// Quelle existiert im Repo NOCH NICHT (Etappe 5: `doki feedback <block_id>`).
// Der Katalog dokumentiert den Vertrag ehrlich: source 'NONE' bis ein echter
// Kanal existiert; rein-fiktionelle Beschaffung ist verboten.
export const USER_ACTIONS = Object.freeze(['USER_ACTION', 'USER_MESSAGE', 'USER_FEEDBACK', 'USER_OVERRIDE', 'USER_APPROVAL', 'USER_REJECTION']);
export const USER_CHANNEL_SOURCE = 'NONE'; // ehrlich: Kanal noch nicht angebunden

// ── Grenz-Ereignis (BOUNDARY) ───────────────────────────────────────────────
// Falsify darf DOKI NUR ueber Beobachtungen erreichen — nie per Methodenruf.
// Shape = exakt das, was bridge.ingest()/observer._observations_ persistieren:
// { source_event_id, seq, event_type, observed_text, payload }
export function boundaryObservation(event) {
  const id = event?.source_event_id ?? event?.event_id ?? null;
  if (!id) throw new Error('DOKI Grenz-Ereignis braucht source_event_id (Identitaet ist Produzenten-Pflicht)');
  return Object.freeze({
    rule_version: RULE_VERSION,
    source_event_id: String(id),
    seq: Number.isInteger(event?.seq) ? event.seq : null,
    event_type: typeof event?.event_type === 'string' ? event.event_type : null,
    observed_text: typeof event?.observed_text === 'string' ? event.observed_text : null,
    payload: event?.payload ?? null,
  });
}

// ── Ereignis → Signal (deterministisch, nur echte Felder) ───────────────────
// Liefert null fuer Ereignistypen ohne narrative Ausdrucksfaehigkeit —
// ehrliches Nichtwissen statt erfundener Semantik.
export function eventSignal(obs) {
  const t = obs?.event_type;
  if (!FM_EVT_TYPES.includes(t)) return null;
  const p = obs?.payload ?? {};
  const at = (k) => (p?.[k] != null ? p[k] : obs?.[k] ?? null);

  switch (t) {
    case 'finding':
      // severity kommt echt aus dem FM-EVT (ui/tui/findings.mjs: discovered|warning|critical)
      return { kind: 'finding', severity: FINDING_SEVERITIES.includes(at('severity')) ? at('severity') : 'discovered', care: 'ATTACK', reactivity: 'bug_witnessed' };
    case 'verdict':
      // v kommt echt aus dem FM-EVT (ui/tui/verdict.mjs MAP)
      return VERDICT_CODES.includes(at('v'))
        ? { kind: 'verdict', code: at('v'), care: 'RE_EVALUATE', reactivity: null }
        : null;
    case 'loop':
      // s ist ein persistierter Loop-Zustand (UI-123-Spiegel)
      return LOOP_STATES.includes(at('s'))
        ? { kind: 'loop', state: at('s'), care: 'CLAIM', reactivity: null }
        : null;
    case 'phase':
      return typeof at('phase') === 'string'
        ? { kind: 'phase', phase: at('phase'), care: 'CLAIM', reactivity: null }
        : null;
    case 'handoff':
      return { kind: 'handoff', probes: Number.isInteger(at('probes')) ? at('probes') : null, care: 'CLAIM', reactivity: 'merge_observed' };
    case 'model':
      // who ∈ {thinker, twin} — WER denkt (UI-Traceability, echtes Feld)
      return at('who') === 'thinker' || at('who') === 'twin'
        ? { kind: 'model', who: at('who'), care: 'RE_EVALUATE', reactivity: null }
        : null;
    case 'scope_auto':
      return at('outcome') === 'new' || at('outcome') === 'continue'
        ? { kind: 'scope_auto', outcome: at('outcome'), care: 'RE_EVALUATE', reactivity: null }
        : null;
    default:
      return null; // boot/state/activity/output/files/…: beobachtet, aber kein narratives Signal
  }
}

// ── Muster-Schluessel (state_key aus phase/verdict/wave — wie verabredet) ───
// Deterministisch und pruefbar: gleiches Muster → gleicher Schluessel →
// Replay statt LLM-Call wird spaeter moeglich (Etappe 2, nicht aktiviert).
export function patternKey({ phase = null, verdict = null, wave = null } = {}) {
  const norm = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '-');
  return `p:${norm(phase)}|v:${norm(verdict)}|w:${norm(wave)}`;
}

// ── Leiter-Pruefung (pure) ───────────────────────────────────────────────────
// Ein Signal darf NUR dann eine Stufe hoch, wenn die vorherigen alle erreicht
// sind. DEFECT/Beliebigkeit ist kein Zustand — fail-closed.
export function ladderReach(current, target) {
  const from = LADDER.indexOf(current);
  const to = LADDER.indexOf(target);
  if (from < 0 || to < 0) return false;
  return to === from + 1; // genau EINE Stufe je Schrittmachung
}

export const initialState = () => Object.freeze({
  rule_version: RULE_VERSION,
  ladder: {},            // signalKey → Stufe
  relations: {},         // 'A->B' → { axis → { value, provenance } }
  seen: {},              // patternKey → visits
  last_pattern: null,
});
