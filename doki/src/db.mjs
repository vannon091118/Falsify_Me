import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openReadOnlyFalsifyDb(path) {
  return new DatabaseSync(resolve(path), { readOnly: true, timeout: 250 });
}

export function openDokiDb(path) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(resolve(path), { timeout: 250 });
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA synchronous=NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS observations(
      update_id TEXT PRIMARY KEY, loop_event_id TEXT NOT NULL, job_id TEXT, scope_id TEXT,
      event_type TEXT, from_state TEXT, to_state TEXT, snapshot_json TEXT NOT NULL,
      snapshot_digest TEXT NOT NULL, created_at TEXT NOT NULL
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
  return db;
}
