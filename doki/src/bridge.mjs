// DOKI production bridge (Rev. 2, Step F/G orchestration).
//
// Verantwortung: die EINZIGE Produktions-Orchestrierung, die den DokiObserver
// anhand ECHTER FalsifyMe-Ereignisse durch seine Zustandsmaschine führt:
//
//   ingest()                        ingest()               pump() poll
//  ┌─────────┐  Thinker busy  ┌──────────────────┐  slot free  ┌──────────────┐
//  │COLLECTING│──────────────▶│WAITING_FOR_THINKER│───────────▶│PROMPT_READY   │
//  └─────────┘                │      _SLOT        │            └──────┬───────┘
//       ▲                     └──────────────────┘                    │ atomic claim
//       │                                                            ▼
//  ┌────┴────────┐                                          ┌────────────────┐
//  │OUTPUT_READY │◀── exactly 1 Thinker call ───────────────│THINKER_RUNNING │
//  └─────────────┘                                          └────────────────┘
//
// Getrennte Ebenen (Review-Vertrag, NICHT in einen Topf werfen):
//   Live Observation ≠ Replay ≠ Slot Reservation ≠ Narrative Generation
//
// - Live Observation: ingest() persistiert Jedes echte FM-EVT exactly-once in
//   observer_observations (durable), Fortschritt in ingest_cursor.
// - Replay: observation_cursor gehört der Replay-Pipeline (loop_events) —
//   bewusst GETRENNT, kein geteilter Cursor.
// - Slot Reservation: check + claim in EINER BEGIN-IMMEDIATE-Transaktion
//   (tryClaimThinkerSlot). Ein Read allein ist KEINE Reservation.
// - Narrative Generation: Kontext wird aus den DURABLE Observations
//   rekonstruiert (nicht aus dem RAM-Buffer) — Restart-sicher.
//
// Isolation (README-Vertrag): dieses Modul importiert KEIN FalsifyMe-Modul.
// Provider ({apiBase, apiKey, model}) und Slot-State (callback) werden vom
// Worker INJIZIERT — DOKI liest keine Env-Variablen und keine FalsifyMe-DB.
// Jeder DOKI-Fehler ist fail-open: der Aufrufer (Worker) fängt alles und
// läuft unverändert weiter.

import { createHash } from 'node:crypto';
import { DokiObserver, OBSERVER_STATES } from './observer.mjs';
import { buildNarratorContext } from './narrator-context.mjs';
import { compilePrompt, detectInstructionLikeData } from './prompt.mjs';
import { narrateOnce } from './thinker-orchestrator.mjs';
import { etats } from './etats.mjs';
import { patternKey } from './signals.mjs';
import { selectBlocks } from './blocks.mjs';
import { projectEnsemble, accumulateEtats } from './ensemble-state.mjs';
import { digestJson } from './hash.mjs';

export const BRIDGE_RULE_VERSION = 'doki.bridge.v1';
export { OBSERVER_STATES as BRIDGE_STATES };

// callModel(body, model): das AUFGELOESTE Modell kommt als 2. Argument —
// jeder Caller (Default-Fetch wie injizierter Test-Call) sieht dieselbe Wahrheit.
const defaultCallModel = (provider) => async (body, model) => {
  const useModel = model ?? provider.model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('DOKI-BRIDGE-TIMEOUT')), provider.timeoutMs ?? 60_000);
  try {
    const response = await fetch(`${String(provider.apiBase).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: useModel, messages: [{ role: 'user', content: body }], max_tokens: 600, temperature: 0 }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('DOKI-Call lieferte keine Message');
    return { text: text.trim(), model: useModel };
  } finally { clearTimeout(timer); }
};

/** Content-stable identity for events WITHOUT a producer id. Identical
 *  event content dedupes across sidecars and restarts; distinct events get
 *  distinct identities. seq is NEVER part of the identity. */
export function fmEvtSourceId(event) {
  const stable = JSON.stringify(event, Object.keys(event).sort());
  return `fmevt_${createHash('sha256').update(stable).digest('hex').slice(0, 24)}`;
}

/** Deterministic ordering of durable observations for context reconstruction
 *  (seq where present, then observed_at, then id — canonical code-unit order). */
function sortObservations(list) {
  return [...list].sort((a, b) =>
    ((a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER))
    || (String(a.observed_at ?? '') < String(b.observed_at ?? '') ? -1 : String(a.observed_at ?? '') > String(b.observed_at ?? '') ? 1 : 0)
    || (String(a.id) < String(b.id) ? -1 : 1));
}

export function createBridge({
  store,
  provider,                 // { apiBase, apiKey, model, timeoutMs? } — FalsifyMe-Wahrheit, injiziert
  slotState,                // () => 'BUSY' | 'FREE' — Worker liest seine eigene Queue
  callModel = defaultCallModel(provider ?? {}),
  owner = `doki-bridge:${process.pid}`,
  onEvent = () => {},       // ({ status, narrator, contextDigest, buffered }) — Worker → TUI
  claimStaleMs = 120_000,
  // Provider-Ausfall-Cooldown (Audit-Fix 2026-09-03): Abstand zwischen
  // pump()-Versuchen nach einem Fehler. Der Worker pollt pump() im 1-s-
  // Idle-Takt; ohne Cooldown wuerde ein kranker Provider (Observations
  // bleiben bei Fehlern liegen, Grenze unverrueckt) sekundlich neu geclaimt
  // + angerufen — Retry-Sturm auf einen downed Endpoint.
  errorCooldownMs = 30_000,
  // Rotation-Vertrag (DOKI-Blocker 6): currentModel wird JEDE PUMP-Runde neu
  // aufgeloest — das ist der idle-time model switch: solange der Thinker
  // idelt, liest der Worker FALSIFYMEs EINZIGE Modellwahrheit (config.json /
  // loadConfig) neu und injiziert das CURRENT konfigurierte Thinker-Modell.
  // DOKI haelt keine eigene GREEN/RED-Architektur und keine eigene
  // Rotation-Entscheidung — die Umschaltung geschieht in FalsifyMe (settings
  // set model=…), DOKI folgt nur der Wahrheit. Default: eingefrorenes
  // provider.model ( Rueckwaerts-Kompatibilitaet, Tests).
  currentModel = null,      // () => string | null — Worker liest FalsifyMe-Config neu
}) {
  if (!store) throw new Error('DOKI bridge requires a store');
  if (typeof slotState !== 'function') throw new Error('DOKI bridge requires slotState()');
  const observer = new DokiObserver({ store });
  const call = typeof callModel === 'function' ? callModel : defaultCallModel(provider ?? {});

  // Crash recovery (fail-open): eine in TPROMPT/THINKER abgebrochene Runde
  // wird NICHT fortgesetzt — die Observations sind durable, die Grenze nicht
  // gerückt, der nächste pump() baut den Kontext neu. Ein frischer Slot-Claim
  // eines abgestürzten Besitzers läuft über den Stale-Takeover (claimStaleMs).
  const persisted = store.readBridgeState();
  if (['PROMPT_READY', 'THINKER_RUNNING', 'OUTPUT_READY'].includes(persisted.state)) {
    store.writeBridgeState({ state: 'COLLECTING', narrative_boundary: persisted.narrative_boundary, slot_owner: null, slot_since: null });
  }
  observer.state = store.readBridgeState().state;

  let pumping = false;
  let claimHeartbeat = null;
  let lastErrorAt = 0;        // Cooldown-Anker: Zeitstempel des letzten Fehlversuchs
  let cursorWhenIdle = null;  // Idle-Short-Circuit: Cursor beim letzten Leer-Scan

  const emit = () => {
    try { onEvent({ status: observer.state, narrator: 'NARRATOR_15', contextDigest: store.readCursor(), buffered: observer.buffered }); } catch { /* Anzeige, nie kritisch */ }
  };

  /** EVENT INPUT: exactly-once durable Ingestion eines echten FM-EVT. */
  function ingest(event) {
    try {
      // Vokabular-Bruecke (UI-137-Abgleich 2026-09-03): FalsifyMe spricht im
      // FM-EVT-Stream den Schluessel `t` (t:'job', t:'finding', t:'loop',
      // t:'handoff', t:'scope_auto' …), DOKI beobachtet `event_type`. OHNE
      // die Bruecke landen Live-Events mit event_type=NULL in den durable
      // Observations — die C.A.R.E.-Logik (CLAIM/ATTACK auf 'job'/'finding')
      // und jede Typ-Sichtbarkeit der Loop-/Handoff-Events waere blind.
      // Reihenfolge: Identitaet ZUERST aus dem ROH-Event stampen (stabil
      // ueber Sidecars/Restarts), DANN t->event_type mappen — die Mapping-
      // Erweiterung darf die Content-Identitaet nicht veraendern.
      const withIdentity = {
        ...event,
        source_event_id: event?.source_event_id ?? fmEvtSourceId(event),
        source: event?.source ?? 'falsify-fmevt',
        event_type: event?.event_type ?? event?.type ?? event?.t ?? null,
      };
      const result = observer.ingest(withIdentity);
      if (result.accepted && observer.state === 'COLLECTING' && slotState() === 'BUSY') {
        observer.waitForThinkerSlot();
        store.writeBridgeState({ state: observer.state, narrative_boundary: store.readNarrativeBoundary(), slot_owner: null, slot_since: null });
      }
      emit();
      return result;
    } catch (error) {
      onEvent({ status: 'FALLBACK', narrator: null, contextDigest: null, buffered: 0, error: String(error?.message || error) });
      return { accepted: false, duplicate: false, error: String(error?.message || error) };
    }
  }

  /** SLOT STATE CHECK / IDLE CHECK:.pollt den REALEN Zustand. Kein fixed
   *  sleep als Fertigkeits-Proxy — der Poll prüft die tatsächliche Queue. */
  async function pump() {
    if (pumping) return { pumped: false, reason: 'IN_FLIGHT' };
    pumping = true;
    try {
      if (observer.state !== 'COLLECTING' && observer.state !== 'WAITING_FOR_THINKER_SLOT') {
        return { pumped: false, reason: `STATE_${observer.state}` };
      }
      // Provider-Ausfall-Cooldown (Audit-Fix 2026-09-03): nach einem Fehler
      // ist der naechste Versuch erst nach errorCooldownMs erlaubt — sonst
      // feuert der 1-s-Idle-Poll einen sekundlichen Retry-Sturm auf einen
      // kranken Endpoint (Observations bleiben bei Fehlern durabel liegen).
      // Neue Events warten hoechstens die Cooldown-Dauer; kein Call im Cooldown.
      if (lastErrorAt && Date.now() - lastErrorAt < errorCooldownMs) {
        return { pumped: false, reason: 'ERROR_COOLDOWN' };
      }
      // Idle-Short-Circuit (Audit-Fix 2026-09-03): Cursor unveraendert seit
      // dem letzten Leer-Scan → nichts Neues, kein Voll-Scan. Der alte Pfad
      // lud bei JEDEM Idle-Tick die komplette Observationstabelle und
      // JSON.parse'd jede event_json-Zeile, nur um pending=[] festzustellen
      // (liest store.readNarrativeBoundary/store.list() erst NACH diesem
      // Guard). cursorWhenIdle wird NUR bei leerem pending gesetzt — nach
      // einem Fehler oder bei Slot-Belegung bleibt er stale und der naechste
      // Tick prüft/schreibt erneut (kein Ueberspringen offener Arbeit).
      const cursorNow = store.readCursor();
      if (cursorNow === cursorWhenIdle) {
        return { pumped: false, reason: 'NO_NEW_OBSERVATIONS' };
      }
      // Keine neuen Observations seit der narrativen Grenze → kein Call.
      const boundary = store.readNarrativeBoundary();
      const all = sortObservations(store.list());
      const startIdx = boundary ? all.findIndex((o) => o.id === boundary) + 1 : 0;
      if (startIdx < 0) return { pumped: false, reason: 'BOUNDARY_UNKNOWN' };
      const pending = all.slice(startIdx);
      if (!pending.length) { cursorWhenIdle = cursorNow; return { pumped: false, reason: 'NO_NEW_OBSERVATIONS' }; }
      // Thinker belegt → ehrlich warten (Warten ist ein ZUSTAND, kein Timer).
      if (slotState() === 'BUSY') {
        if (observer.state !== 'WAITING_FOR_THINKER_SLOT') {
          observer.waitForThinkerSlot();
          store.writeBridgeState({ state: observer.state, narrative_boundary: boundary, slot_owner: null, slot_since: null });
          emit();
        }
        return { pumped: false, reason: 'SLOT_BUSY' };
      }
      // ATOMARE Reservation: check + claim in EINER Transaktion. claimed=false
      // ist ehrlich (anderer Besitzer), kein Fehler.
      const claim = store.tryClaimThinkerSlot(owner, { staleMs: claimStaleMs });
      if (!claim.claimed) return { pumped: false, reason: 'CLAIM_LOST' };
      claimHeartbeat = setInterval(() => { try { store.heartbeatThinkerSlot(); } catch { /* egal */ } }, 15_000);
      try {
        observer.markPromptReady(null);
        store.writeBridgeState({ state: 'PROMPT_READY', narrative_boundary: boundary, slot_owner: owner, slot_since: new Date().toISOString() });
        emit();

        // Narrative-Kontext aus DURABLE Observations (Restart-sicher, nicht RAM).
        const evidence = pending.map((o) => ({ id: o.id, source_event_id: o.source_event_id, event_type: o.event_type, text: o.observed_text, at: o.observed_at }));
        const care = {
          CLAIM: pending.find((o) => o.event_type === 'job')?.observed_text ?? null,
          ATTACK: pending.filter((o) => o.event_type === 'finding').map((o) => o.observed_text),
          RE_EVALUATE: { observations: pending.length, last: pending.at(-1)?.observed_text ?? null },
          EVIDENCE: evidence.map((e) => e.id),
        };
        const stateKey = patternKey({
          phase: 'bridge',
          verdict: null,
          wave: null,
        });
        const candidateBlocks = evidence.map((e, idx) => ({
          block_id: `obs-${e.id ?? idx}`,
          anchor_ok: Boolean(e.source_event_id),
          state_key: stateKey,
          primitive: e.event_type === 'finding' ? 'CONTRADICTION' : 'CLAIM',
          character: e.event_type === 'finding' ? 'Buffy' : 'Thinker',
        }));
        const selected = selectBlocks(candidateBlocks, stateKey).slice(0, 7);
        const relevantCharacters = [...new Set(selected.map((b) => b.block.character).filter(Boolean))];
        if (relevantCharacters.length === 0) relevantCharacters.push('Buffy', 'Thinker');

        // ── Akkumulierter etats-State (Etappe 1) ────────────────────────────
        // Alle pending-Observations als geordnete Event-Liste akkumulieren.
        const accumulationEvents = pending.map((o, idx) => ({
          t: o.event_type ?? 'loop',
          event_type: o.event_type ?? 'loop',
          id: o.source_event_id ?? o.id ?? `bridge-evt-${idx}`,
          seq: o.seq ?? idx,
          phase: 'bridge',
          v: null,
          wave: null,
          text: o.observed_text ?? null,
        }));
        const accumulatedState = accumulateEtats(accumulationEvents, { ladder: () => 'NARRATIVELY_RELEVANT' });
        const ensemble = projectEnsemble(accumulatedState);


        const narratorContext = buildNarratorContext({
          observed: { observations: evidence, cursor: store.readCursor() },
          report: { phase: 'bridge', from_state: 'COLLECTING', to_state: 'OUTPUT_READY' },
          history: { refs: evidence.map((e) => e.id) },
          ensemble,
          relevance: relevantCharacters,
          care,
          evidence,
        });
        const snapshotLike = { loop_event: { payload: evidence.map((e) => e.text).join('\n') }, scope: {}, findings: [] };
        const prompt = compilePrompt({ phase: 'bridge', from_state: 'COLLECTING', to_state: 'OUTPUT_READY' }, snapshotLike, { refs: evidence.map((e) => e.id) }, { narratorContext });
        if (detectInstructionLikeData(snapshotLike)) {
          throw new Error('instruction-like Daten erkannt — DOKI ruft den Thinker nicht');
        }

        observer.markThinkerRunning();
        store.writeBridgeState({ state: 'THINKER_RUNNING', narrative_boundary: boundary, slot_owner: owner, slot_since: null });
        emit();
        // Idle-time model switch (Blocker 6): JEDE Pump-Runde loest das
        // CURRENT konfigurierte Thinker-Modell neu auf (FalsifyMe-Wahrheit,
        // vom Worker injiziert) und gibt es als 2. Argument an den Call.
        // Fail-open: Lesefehler/null → eingefrorenes provider.model.
        let effectiveModel = provider?.model ?? null;
        if (typeof currentModel === 'function') {
          try {
            const m = currentModel();
            if (m && typeof m === 'string' && m.trim()) effectiveModel = m.trim();
          } catch { /* Config-Lesefehler: eingefrorenes Modell bleibt */ }
        }
        // EXACTLY ONE call (narrateOnce erzwingt den Vertrag strukturell).
        const result = await narrateOnce({ prompt: prompt.body, callThinker: (body) => call(body, effectiveModel) });
        const message = observer.markOutputReady(result.text);
        store.writeBridgeState({ state: 'OUTPUT_READY', narrative_boundary: boundary, slot_owner: owner, slot_since: null });
        store.writeNarrativeBoundary(pending.at(-1).id);

        const outputId = digestJson({ boundary, promptDigest: prompt.promptDigest, stateKey });
        // Etappe 2: historyId aus echtem patternKey des letzten Events (statt generischem 'bridge').
        const lastEvt = pending.at(-1);
        const outputHistoryId = patternKey({
          phase: lastEvt?.event_type ?? 'bridge',
          verdict: null,
          wave: null,
        });
        try {
          store.appendNarrativeOutput({
            outputId,
            historyId: outputHistoryId,
            narratorId: 'NARRATOR_15',
            promptDigest: prompt.promptDigest,
            messageText: result.text,
          });
        } catch (writeErr) {
          // fail-open: DOKI-Fehler sind präsentationsseitig — aber diagnostizierbar
          try { onEvent({ status: 'FALLBACK', narrator: null, contextDigest: null, buffered: observer.buffered, error: `narrative_outputs write: ${String(writeErr?.message || writeErr)}` }); } catch { /* egal */ }
        }

        emit();
        return { pumped: true, status: result.status, message, observations: pending.length, narrator: narratorContext.narrator, contextDigest: narratorContext.contextDigest };
      } finally {
        if (claimHeartbeat) { clearInterval(claimHeartbeat); claimHeartbeat = null; }
        store.releaseThinkerSlot();
        observer.resumeCollection();
        store.writeBridgeState({ state: 'COLLECTING', narrative_boundary: store.readNarrativeBoundary(), slot_owner: null, slot_since: null });
        emit();
      }
    } catch (error) {
      // Fail-open: DOKI-Fehler sind präsentationsseitig. Slot wird im finally
      // freigegeben; die Observations bleiben durable, die Grenze ungerückt —
      // derselbe Kontext wird beim nächsten pump() erneut aufgebaut.
      lastErrorAt = Date.now(); // Cooldown starten: kein Sekunden-Retry-Sturm
      try { onEvent({ status: 'FALLBACK', narrator: null, contextDigest: null, buffered: observer.buffered, error: String(error?.message || error) }); } catch { /* egal */ }
      return { pumped: false, reason: 'ERROR', error: String(error?.message || error) };
    } finally {
      pumping = false;
    }
  }

  function stop() {
    try { if (claimHeartbeat) { clearInterval(claimHeartbeat); claimHeartbeat = null; } } catch { /* egal */ }
    try { store.releaseThinkerSlot(); } catch { /* egal */ }
  }

  emit();
  return { observer, store, ingest, pump, stop, snapshot: () => observer.snapshot(), owner };
}
