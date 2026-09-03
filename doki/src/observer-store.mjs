import { resolve } from 'node:path';
import { openDokiDb } from './db.mjs';
import { createHash } from 'node:crypto';

const now = () => new Date().toISOString();
const clone = (value) => structuredClone(value);
const json = (value) => JSON.stringify(value);
const digest = (value) => createHash('sha256').update(json(value)).digest('hex');
// JS-seitiges Pendants zu SQLite julianday(): Differenz zweier ISO-Zeitstempel
// in Millisekunden (nur für Staleness-Checks; UTC-ISO Strings sind comparabel).
const msBetween = (a, b) => Date.parse(a) - Date.parse(b);

export const OBSERVATION_COLUMNS = Object.freeze([
  'id', 'source_event_id', 'session_id', 'job_id', 'seq', 'source', 'event_type',
  'observed_text', 'observed_at', 'event',
]);

function normalizeObservation(observation) {
  // Identitaet: `observation_id` (vom Observer gestempelt, kollidiert nie mit
  // einem Payload-`id` des Raw-Events) hat Vorrang vor einem top-level `id`.
  // Ohne Vorrang klaute ein FM-EVT mit eigenem `id` (job.id/handoff_id) die
  // Zeilen-Identitaet — Duplikat-Guard und Cursor verfehlten die Zeile
  // (belegt in doki/tests/falsify-contract.test.mjs).
  const rowId = observation?.observation_id ?? observation?.id;
  if (!rowId) throw new Error('DOKI observation requires id');
  const event = clone(observation);
  return {
    id: String(rowId),
    sourceEventId: String(event.source_event_id ?? event.event_id ?? rowId),
    sessionId: event.session_id ?? event.session ?? null,
    jobId: event.job_id ?? event.job ?? null,
    seq: Number.isInteger(event.seq) ? event.seq : null,
    source: event.source ?? null,
    eventType: event.event_type ?? event.type ?? null,
    observedText: event.observed_text ?? event.text ?? null,
    event,
    observedAt: event.observed_at ?? event.timestamp ?? now(),
  };
}

function toObservation(row) {
  return {
    id: row.observation_id,
    source_event_id: row.source_event_id,
    session_id: row.session_id,
    job_id: row.job_id,
    seq: row.seq,
    source: row.source,
    event_type: row.event_type,
    observed_text: row.observed_text,
    observed_at: row.observed_at,
    event: JSON.parse(row.event_json),
  };
}

export function createMemoryStore() {
  const observations = new Map();
  let cursor = null;
  const rowId = (observation) => observation?.observation_id ?? observation?.id ?? null;
  return {
    readCursor: () => cursor,
    hasObservation: (id) => observations.has(id),
    appendObservation: (observation) => {
      const id = rowId(observation);
      if (!id || observations.has(id)) return false;
      observations.set(id, clone(observation));
      cursor = id;
      return true;
    },
    list: () => [...observations.values()].map(clone),
    close: () => {},
  };
}

export function createPersistentStore({ path, db } = {}) {
  if (!db && !path) throw new Error('DOKI persistent store requires db or path');
  const ownedDb = db ?? openDokiDb(resolve(path));
  // Atomic thinker-slot claim (BEGIN IMMEDIATE serializes writers; a failed
  // INSERT inside the transaction rolls back the whole claim — check + claim
  // is ONE step, never check-then-write across an async gap).
  const readSlotStmt = ownedDb.prepare('SELECT owner, claimed_at, heartbeat_at, released_at FROM thinker_claims WHERE id=1');
  const deleteClaimStmt = ownedDb.prepare('DELETE FROM thinker_claims WHERE id=1');
  const insertClaimStmt = ownedDb.prepare('INSERT INTO thinker_claims(id, owner, claimed_at, heartbeat_at) VALUES(1,?,?,?)');
  const heartbeatStmt = ownedDb.prepare('UPDATE thinker_claims SET heartbeat_at=? WHERE id=1 AND released_at IS NULL');
  const releaseStmt = ownedDb.prepare('UPDATE thinker_claims SET released_at=?, heartbeat_at=? WHERE id=1 AND released_at IS NULL');
  const readBridgeStateStmt = ownedDb.prepare('SELECT state, narrative_boundary, slot_owner, slot_since FROM bridge_state WHERE id=1');
  const writeBridgeStateStmt = ownedDb.prepare(`
    INSERT INTO bridge_state(id,state,narrative_boundary,slot_owner,slot_since,updated_at)
    VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,
      narrative_boundary=excluded.narrative_boundary, slot_owner=excluded.slot_owner,
      slot_since=excluded.slot_since, updated_at=excluded.updated_at
  `);
  const readNarrativeBoundaryStmt = ownedDb.prepare('SELECT narrative_boundary FROM bridge_state WHERE id=1');
  const writeNarrativeBoundaryStmt = ownedDb.prepare('UPDATE bridge_state SET narrative_boundary=?, updated_at=? WHERE id=1');
  const observationExists = ownedDb.prepare('SELECT 1 FROM observer_observations WHERE observation_id = ?');
  const insertObservation = ownedDb.prepare(`
    INSERT INTO observer_observations(
      observation_id, source_event_id, session_id, job_id, seq, source, event_type,
      event_json, observed_text, observed_at, observation_digest
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `);
  // LIVE-Stream-Fortschritt (ingest_cursor) — bewusst NICHT observation_cursor:
  // der gehört der Replay-Pipeline (loop_events) allein.
  const readCursorStmt = ownedDb.prepare('SELECT cursor_id, cursor_seq, cursor_digest FROM ingest_cursor WHERE id=1');
  const writeCursorStmt = ownedDb.prepare(`
    INSERT INTO ingest_cursor(id,cursor_id,cursor_seq,cursor_digest,updated_at)
    VALUES(1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET cursor_id=excluded.cursor_id,
      cursor_seq=excluded.cursor_seq,cursor_digest=excluded.cursor_digest,updated_at=excluded.updated_at
  `);

  return {
    // ── Atomic thinker-slot reservation (coordination mechanism) ─────────
    // Returns { claimed, previousOwner? } — claimed=false is honest, not an error.
    // staleMs: a claim whose heartbeat is older is treated as abandoned
    // (crash recovery); the stale claim is released and re-claimed atomically.
    tryClaimThinkerSlot(owner, { staleMs = 120_000 } = {}) {
      const nowIso = now();
      ownedDb.exec('BEGIN IMMEDIATE');
      try {
        const existing = readSlotStmt.get();
        const stale = existing && !existing.released_at && msBetween(nowIso, existing.heartbeat_at) >= staleMs;
        // Frei = keine Zeile | released | stale Heartbeat. In allen drei
        // Faellen wird die Zeile GELOESCHT und neu eingesetzt (id=1 ist
        // Singleton — ein INSERT ohne DELETE wuerde auf die released-
        // Altzeile UNIQUE-kollidieren). Alles in EINER Transaktion.
        const free = !existing || existing.released_at != null || stale;
        if (free) {
          deleteClaimStmt.run();
          insertClaimStmt.run(owner, nowIso, nowIso);
        }
        ownedDb.exec('COMMIT');
        return { claimed: free, previousOwner: existing?.owner ?? null };
      } catch (error) {
        try { ownedDb.exec('ROLLBACK'); } catch { /* egal */ }
        throw error;
      }
    },
    heartbeatThinkerSlot() {
      return heartbeatStmt.run(now(), null).changes === 1;
    },
    releaseThinkerSlot() {
      return releaseStmt.run(now(), now()).changes === 1;
    },
    thinkerSlotOwner() {
      const row = readSlotStmt.get();
      return (row && !row.released_at) ? row.owner : null;
    },
    // ── Bridge state (persistent state machine + narrative boundary) ─────
    readBridgeState() {
      return readBridgeStateStmt.get() ?? { state: 'COLLECTING', narrative_boundary: null, slot_owner: null, slot_since: null };
    },
    writeBridgeState(state) {
      writeBridgeStateStmt.run(String(state.state), state.narrative_boundary ?? null, state.slot_owner ?? null, state.slot_since ?? null, now());
    },
    readNarrativeBoundary() {
      return readNarrativeBoundaryStmt.get()?.narrative_boundary ?? null;
    },
    writeNarrativeBoundary(observationId) {
      writeNarrativeBoundaryStmt.run(observationId, now());
    },
    readCursor() { return readCursorStmt.get()?.cursor_id ?? null; },
    hasObservation(id) { return Boolean(observationExists.get(String(id))); },
    appendObservation(observation) {
      const item = normalizeObservation(observation);
      if (this.hasObservation(item.id)) return false;
      insertObservation.run(
        item.id, item.sourceEventId, item.sessionId, item.jobId, item.seq,
        item.source, item.eventType, json(item.event), item.observedText,
        item.observedAt, digest(item.event)
      );
      writeCursorStmt.run(item.id, item.seq, digest(item), now());
      return true;
    },
    list() {
      const rows = ownedDb.prepare(`
        SELECT observation_id, source_event_id, session_id, job_id, seq, source,
               event_type, event_json, observed_text, observed_at, observation_digest
        FROM observer_observations
        ORDER BY COALESCE(seq, 9223372036854775807), observed_at, observation_id
      `).all();
      return rows.map(toObservation);
    },
    putCharacterState({ characterId, state, ruleVersion = 'doki.character/v1' }) {
      ownedDb.prepare(`INSERT INTO character_states(character_id,state_json,state_digest,rule_version,updated_at)
        VALUES(?,?,?,?,?) ON CONFLICT(character_id) DO UPDATE SET state_json=excluded.state_json,
        state_digest=excluded.state_digest,rule_version=excluded.rule_version,updated_at=excluded.updated_at`)
        .run(characterId, json(state), digest(state), ruleVersion, now());
    },
    putMemory({ memoryId, characterId, observationId = null, memoryKind, memory,
      sourceDigest = digest(memory), ruleVersion = 'doki.memory/v1' }) {
      const existing = ownedDb.prepare(`SELECT memory_id FROM character_memory
        WHERE character_id=? AND memory_kind=? AND ((observation_id=? ) OR (observation_id IS NULL AND ? IS NULL))`)
        .get(characterId, memoryKind, observationId, observationId);
      if (existing) {
        ownedDb.prepare(`UPDATE character_memory SET memory_json=?,source_digest=?,rule_version=?
          WHERE memory_id=?`).run(json(memory), sourceDigest, ruleVersion, existing.memory_id);
        return existing.memory_id;
      }
      ownedDb.prepare(`INSERT INTO character_memory(memory_id,character_id,observation_id,memory_kind,
        memory_json,source_digest,rule_version,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(memoryId, characterId, observationId, memoryKind, json(memory), sourceDigest, ruleVersion, now());
      return memoryId;
    },
    putRelationship({ fromCharacter, toCharacter, state, ruleVersion = 'doki.relationship/v1' }) {
      if (fromCharacter === toCharacter) throw new Error('DOKI relationships cannot self-reference');
      ownedDb.prepare(`INSERT INTO relationships(from_character,to_character,state_json,state_digest,rule_version,updated_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(from_character,to_character) DO UPDATE SET state_json=excluded.state_json,
        state_digest=excluded.state_digest,rule_version=excluded.rule_version,updated_at=excluded.updated_at`)
        .run(fromCharacter, toCharacter, json(state), digest(state), ruleVersion, now());
    },
    appendRelationshipEvent({ effectId, observationId, fromCharacter, toCharacter, delta, evidence,
      ruleVersion = 'doki.relationship/v1' }) {
      ownedDb.prepare(`INSERT INTO relationship_events(effect_id,observation_id,from_character,to_character,
        delta_json,evidence_json,rule_version,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(effectId, observationId, fromCharacter, toCharacter, json(delta), json(evidence), ruleVersion, now());
    },
    putThread({ threadId, state, ruleVersion = 'doki.thread/v1' }) {
      ownedDb.prepare(`INSERT INTO threads(thread_id,state_json,state_digest,rule_version,updated_at)
        VALUES(?,?,?,?,?) ON CONFLICT(thread_id) DO UPDATE SET state_json=excluded.state_json,
        state_digest=excluded.state_digest,rule_version=excluded.rule_version,updated_at=excluded.updated_at`)
        .run(threadId, json(state), digest(state), ruleVersion, now());
    },
    attachThreadObservation({ threadId, observationId, relevance, evidence }) {
      ownedDb.prepare(`INSERT INTO thread_observations(thread_id,observation_id,relevance,evidence_json)
        VALUES(?,?,?,?) ON CONFLICT(thread_id,observation_id) DO UPDATE SET relevance=excluded.relevance,evidence_json=excluded.evidence_json`)
        .run(threadId, observationId, relevance, json(evidence));
    },
    putPerspective({ characterId, topicKey, state, ruleVersion = 'doki.perspective/v1' }) {
      ownedDb.prepare(`INSERT INTO perspectives(character_id,topic_key,state_json,state_digest,rule_version,updated_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(character_id,topic_key) DO UPDATE SET state_json=excluded.state_json,
        state_digest=excluded.state_digest,rule_version=excluded.rule_version,updated_at=excluded.updated_at`)
        .run(characterId, topicKey, json(state), digest(state), ruleVersion, now());
    },
    appendBelief({ beliefId, characterId, topicKey, belief, evidence, ruleVersion = 'doki.belief/v1' }) {
      ownedDb.prepare(`INSERT OR REPLACE INTO beliefs(belief_id,character_id,topic_key,belief_json,evidence_json,rule_version,created_at)
        VALUES(?,?,?,?,?,?,?)`).run(beliefId, characterId, topicKey, json(belief), json(evidence), ruleVersion, now());
    },
    putConflict({ conflictId, conflict, ruleVersion = 'doki.conflict/v1' }) {
      ownedDb.prepare(`INSERT INTO conflicts(conflict_id,conflict_json,state_digest,rule_version,updated_at)
        VALUES(?,?,?,?,?) ON CONFLICT(conflict_id) DO UPDATE SET conflict_json=excluded.conflict_json,
        state_digest=excluded.state_digest,rule_version=excluded.rule_version,updated_at=excluded.updated_at`)
        .run(conflictId, json(conflict), digest(conflict), ruleVersion, now());
    },
    appendHistoryRun({ historyId, baseCursorId, inputDigest, ruleVersion, stateDigest }) {
      ownedDb.prepare(`INSERT INTO history_runs(history_id,base_cursor_id,input_digest,rule_version,state_digest,created_at)
        VALUES(?,?,?,?,?,?)`).run(historyId, baseCursorId, inputDigest, ruleVersion, stateDigest, now());
    },
    appendNarrativeOutput({ outputId, historyId, narratorId, promptDigest, messageText }) {
      ownedDb.prepare(`INSERT INTO narrative_outputs(output_id,history_id,narrator_id,prompt_digest,message_text,call_count,created_at)
        VALUES(?,?,?,?,?,1,?)`).run(outputId, historyId, narratorId, promptDigest, messageText, now());
    },
    db: ownedDb,
    close() { if (ownedDb !== db) ownedDb.close(); },
  };
}
