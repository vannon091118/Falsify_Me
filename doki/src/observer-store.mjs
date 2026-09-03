import { resolve } from 'node:path';
import { openDokiDb } from './db.mjs';
import { createHash } from 'node:crypto';

const now = () => new Date().toISOString();
const clone = (value) => structuredClone(value);
const json = (value) => JSON.stringify(value);
const digest = (value) => createHash('sha256').update(json(value)).digest('hex');

export const OBSERVATION_COLUMNS = Object.freeze([
  'id', 'source_event_id', 'session_id', 'job_id', 'seq', 'source', 'event_type',
  'observed_text', 'observed_at', 'event',
]);

function normalizeObservation(observation) {
  if (!observation?.id) throw new Error('DOKI observation requires id');
  const event = clone(observation);
  return {
    id: String(event.id),
    sourceEventId: String(event.source_event_id ?? event.event_id ?? event.id),
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
  return {
    readCursor: () => cursor,
    hasObservation: (id) => observations.has(id),
    appendObservation: (observation) => {
      if (observations.has(observation.id)) return false;
      observations.set(observation.id, clone(observation));
      cursor = observation.id;
      return true;
    },
    list: () => [...observations.values()].map(clone),
    close: () => {},
  };
}

export function createPersistentStore({ path, db } = {}) {
  if (!db && !path) throw new Error('DOKI persistent store requires db or path');
  const ownedDb = db ?? openDokiDb(resolve(path));
  const observationExists = ownedDb.prepare('SELECT 1 FROM observer_observations WHERE observation_id = ?');
  const insertObservation = ownedDb.prepare(`
    INSERT INTO observer_observations(
      observation_id, source_event_id, session_id, job_id, seq, source, event_type,
      event_json, observed_text, observed_at, observation_digest
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `);
  const readCursorStmt = ownedDb.prepare('SELECT cursor_id, cursor_seq, cursor_digest FROM observation_cursor WHERE id=1');
  const writeCursorStmt = ownedDb.prepare(`
    INSERT INTO observation_cursor(id,cursor_id,cursor_seq,cursor_digest,updated_at)
    VALUES(1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET cursor_id=excluded.cursor_id,
      cursor_seq=excluded.cursor_seq,cursor_digest=excluded.cursor_digest,updated_at=excluded.updated_at
  `);

  return {
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
