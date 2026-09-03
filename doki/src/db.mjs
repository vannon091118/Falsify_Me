import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DOKI_SCHEMA_VERSION = 2;

export function openReadOnlyFalsifyDb(path) {
  return new DatabaseSync(resolve(path), { readOnly: true, timeout: 250 });
}

function applySchemaV1(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS observations(
      update_id TEXT PRIMARY KEY, loop_event_id TEXT NOT NULL, job_id TEXT, scope_id TEXT,
      event_type TEXT, from_state TEXT, to_state TEXT, snapshot_json TEXT NOT NULL,
      snapshot_digest TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS observer_observations(
      observation_id TEXT PRIMARY KEY, source_event_id TEXT NOT NULL UNIQUE,
      session_id TEXT, job_id TEXT, seq INTEGER, source TEXT, event_type TEXT,
      event_json TEXT NOT NULL, observed_text TEXT, observed_at TEXT NOT NULL,
      observation_digest TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS observation_cursor(
      id INTEGER PRIMARY KEY CHECK(id = 1), cursor_id TEXT, cursor_seq INTEGER,
      cursor_digest TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history_runs(
      history_id TEXT PRIMARY KEY, base_cursor_id TEXT, input_digest TEXT NOT NULL,
      rule_version TEXT NOT NULL, state_digest TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS character_states(
      character_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, state_digest TEXT NOT NULL,
      rule_version TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS character_memory(
      memory_id TEXT PRIMARY KEY, character_id TEXT NOT NULL, observation_id TEXT,
      memory_kind TEXT NOT NULL, memory_json TEXT NOT NULL, source_digest TEXT NOT NULL,
      rule_version TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS relationships(
      from_character TEXT NOT NULL, to_character TEXT NOT NULL,
      state_json TEXT NOT NULL, state_digest TEXT NOT NULL, rule_version TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(from_character, to_character),
      CHECK(from_character <> to_character)
    );
    CREATE TABLE IF NOT EXISTS relationship_events(
      effect_id TEXT PRIMARY KEY, observation_id TEXT NOT NULL,
      from_character TEXT NOT NULL, to_character TEXT NOT NULL,
      delta_json TEXT NOT NULL, evidence_json TEXT NOT NULL, rule_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS threads(
      thread_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, state_digest TEXT NOT NULL,
      rule_version TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS thread_observations(
      thread_id TEXT NOT NULL, observation_id TEXT NOT NULL,
      relevance REAL NOT NULL, evidence_json TEXT NOT NULL,
      PRIMARY KEY(thread_id, observation_id)
    );
    CREATE TABLE IF NOT EXISTS perspectives(
      character_id TEXT NOT NULL, topic_key TEXT NOT NULL,
      state_json TEXT NOT NULL, state_digest TEXT NOT NULL, rule_version TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(character_id, topic_key)
    );
    CREATE TABLE IF NOT EXISTS beliefs(
      belief_id TEXT PRIMARY KEY, character_id TEXT NOT NULL, topic_key TEXT NOT NULL,
      belief_json TEXT NOT NULL, evidence_json TEXT NOT NULL, rule_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conflicts(
      conflict_id TEXT PRIMARY KEY, conflict_json TEXT NOT NULL,
      state_digest TEXT NOT NULL, rule_version TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS narrative_outputs(
      output_id TEXT PRIMARY KEY, history_id TEXT, narrator_id TEXT NOT NULL,
      prompt_digest TEXT NOT NULL, message_text TEXT NOT NULL,
      call_count INTEGER NOT NULL CHECK(call_count = 1), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS update_jobs(
      update_id TEXT PRIMARY KEY, loop_event_id TEXT UNIQUE NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, error TEXT
    );
    CREATE TABLE IF NOT EXISTS phase_reports(
      report_id TEXT PRIMARY KEY, update_id TEXT UNIQUE NOT NULL, report_json TEXT NOT NULL,
      report_digest TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gaps(
      id INTEGER PRIMARY KEY AUTOINCREMENT, update_id TEXT, job_id TEXT, kind TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS q_table(
      state_key TEXT NOT NULL, action TEXT NOT NULL, q_value REAL NOT NULL,
      visits INTEGER NOT NULL, source_event_id TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(state_key, action)
    );
    CREATE TABLE IF NOT EXISTS prompt_runs(
      prompt_id TEXT PRIMARY KEY, update_id TEXT NOT NULL, prompt_digest TEXT NOT NULL,
      report_digest TEXT NOT NULL, prompt_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dialog_messages(
      message_id TEXT PRIMARY KEY, update_id TEXT UNIQUE NOT NULL, message_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rotation_state(
      id INTEGER PRIMARY KEY CHECK(id = 1), window_key TEXT NOT NULL,
      reswitch_count INTEGER NOT NULL, call_count INTEGER NOT NULL, token_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS anomalies(
      id INTEGER PRIMARY KEY AUTOINCREMENT, update_id TEXT, kind TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_character_memory_identity
           ON character_memory(character_id, COALESCE(observation_id, ''), memory_kind);`);
}

function applySchemaV2(db) {
  // Cursor-Trennung (DOKI Rev. 2, Blocker-Fix): observation_cursor gehört der
  // REPLAY-Pipeline (loop_events-Fortschritt). Der LIVE-Stream (ingest) bekommt
  // seinen eigenen Fortschritt in ingest_cursor — sonst übernimmt ein Rebuild
  // den Live-Cursor oder ein Live-Run überschreibt den Replay-Stand.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ingest_cursor(
      id INTEGER PRIMARY KEY CHECK(id = 1), cursor_id TEXT, cursor_seq INTEGER,
      cursor_digest TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bridge_state(
      id INTEGER PRIMARY KEY CHECK(id = 1), state TEXT NOT NULL,
      narrative_boundary TEXT, slot_owner TEXT, slot_since TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS thinker_claims(
      id INTEGER PRIMARY KEY CHECK(id = 1), owner TEXT NOT NULL, claimed_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL, released_at TEXT
    );
  `);
}

function migrate(db) {
  let version = Number(db.prepare('PRAGMA user_version').get().user_version ?? 0);
  if (version > DOKI_SCHEMA_VERSION) {
    throw new Error(`DOKI schema ${version} is newer than supported ${DOKI_SCHEMA_VERSION}`);
  }
  if (version === 0) {
    db.exec('BEGIN');
    try {
      applySchemaV1(db);
      db.exec('PRAGMA user_version = 1');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    version = 1;
  }
  if (version < DOKI_SCHEMA_VERSION) {
    db.exec('BEGIN');
    try {
      applySchemaV2(db);
      db.exec(`PRAGMA user_version = ${DOKI_SCHEMA_VERSION}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function openDokiDb(path) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(resolve(path), { timeout: 250 });
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}
