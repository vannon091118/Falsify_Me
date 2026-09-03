import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDokiDb, openReadOnlyFalsifyDb } from '../src/db.mjs';
import { processEvent } from '../src/runtime.mjs';
import { resolveSwitches } from '../src/model.mjs';
import { sharedKeyWindowOpen } from '../src/rotation.mjs';

function fixture(activeState='DONE') {
  const dir = mkdtempSync(join(tmpdir(), 'doki-'));
  const fPath = join(dir, 'falsify.db');
  const dPath = join(dir, 'doki.db');
  const fdb = new DatabaseSync(fPath);
  fdb.exec(`
    CREATE TABLE jobs(
      id TEXT PRIMARY KEY,
      checkout_id TEXT,
      scope_id TEXT,
      payload TEXT,
      diff_text TEXT,
      root TEXT,
      files TEXT,
      agent_intent TEXT,
      affected TEXT,
      wave TEXT,
      mode TEXT,
      status TEXT,
      verdict TEXT,
      window_idx INTEGER,
      error TEXT,
      runtime_config TEXT,
      attempt INTEGER,
      max_attempts INTEGER,
      failure_kind TEXT,
      retry_at TEXT,
      created_at TEXT,
      started_at TEXT,
      done_at TEXT,
      parent_job_id TEXT,
      handoff_id TEXT,
      iteration_id TEXT,
      change_digest TEXT,
      header_digest TEXT,
      loop_state TEXT,
      review_iteration INTEGER,
      loop_count INTEGER,
      max_loop_count INTEGER
    );
    CREATE TABLE loop_events(
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      scope_id TEXT,
      handoff_id TEXT,
      change_digest TEXT,
      event_type TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT,
      payload TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE findings(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_id TEXT,
      job_id TEXT,
      round INTEGER,
      wave TEXT,
      mode TEXT,
      befund TEXT,
      content TEXT,
      verdict TEXT,
      created_at TEXT
    );
    CREATE TABLE scopes(
      id TEXT PRIMARY KEY,
      checkout_id TEXT,
      header TEXT,
      status TEXT,
      phase TEXT,
      last_befund TEXT,
      sub_prompt TEXT,
      open_conflicts INTEGER,
      hardened_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      done_at TEXT,
      last_gap TEXT,
      last_divergence TEXT,
      research_additions TEXT
    );
    CREATE TABLE projects(
      project_id TEXT PRIMARY KEY,
      created_at TEXT
    );
    CREATE TABLE checkouts(
      checkout_id TEXT PRIMARY KEY,
      project_id TEXT,
      bound_root TEXT,
      root_name TEXT,
      root_binding TEXT,
      anchor_digest TEXT,
      records_digest TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  fdb.prepare(`INSERT INTO jobs (
    id, checkout_id, scope_id, payload, diff_text, root, files, agent_intent, affected,
    wave, mode, status, verdict, window_idx, error, runtime_config, attempt, max_attempts,
    failure_kind, retry_at, created_at, started_at, done_at, parent_job_id, handoff_id,
    iteration_id, change_digest, header_digest, loop_state, review_iteration, loop_count, max_loop_count
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'j1', null, 's1', null, null, null, null, null, null,
    'scan', 'write', activeState === 'DONE' ? 'DONE WRITE' : 'RUNNING', 'WRITE', null, null, null,
    1, 2, null, null, '2026-09-03T00:00:00Z', '2026-09-03T00:01:00Z', '2026-09-03T00:02:00Z',
    null, null, null, 'c', 'h', activeState, 0, 1, 5
  );
  fdb.prepare('INSERT INTO loop_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    'e1', 'j1', 's1', null, 'c', 'transition', 'RUNNING', activeState,
    JSON.stringify({ safe: true }), '2026-09-03T00:02:00Z'
  );
  fdb.prepare(`INSERT INTO findings (
    scope_id, job_id, round, wave, mode, befund, content, verdict, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?)`).run('s1', 'j1', 1, 'scan', 'write', 'facts', 'x', 'WRITE', '2026-09-03T00:02:00Z');
  fdb.prepare(`INSERT INTO findings (
    scope_id, job_id, round, wave, mode, befund, content, verdict, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?)`).run('s1', 'j1', 1, 'evil', 'write', 'facts', 'x', 'WRITE', '2026-09-03T00:02:01Z');
  fdb.prepare(`INSERT INTO scopes (
    id, checkout_id, header, status, phase, last_befund, sub_prompt, open_conflicts,
    hardened_at, created_at, updated_at, done_at, last_gap, last_divergence, research_additions
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    's1', null, 'hello', 'done', 'write', 'facts', null, 0, null,
    '2026-09-03T00:00:00Z', '2026-09-03T00:02:00Z', null, null, null, null
  );
  return { dir, fPath, fdb, dPath };
}

test('same loop_event is idempotent and yields one message', async () => {
  const { dir, fdb, dPath } = fixture();
  const ddb = openDokiDb(dPath);
  const env = { DOKI_MAX_CALLS: '0' };
  const a = await processEvent({ falsifyDb: fdb, dokiDb: ddb, eventId: 'e1', env });
  const b = await processEvent({ falsifyDb: fdb, dokiDb: ddb, eventId: 'e1', env });
  assert.equal(a.message_id, b.message_id);
  assert.equal(ddb.prepare('SELECT COUNT(*) c FROM observations').get().c, 1);
  assert.equal(ddb.prepare('SELECT COUNT(*) c FROM dialog_messages').get().c, 1);
  ddb.close();
  fdb.close();
  rmSync(dir, { recursive: true, force: true });
});

test('reswitch hard cap is five and sixth red decision falls back', () => {
  assert.deepEqual(
    resolveSwitches(['RED', 'RED', 'RED', 'RED', 'RED', 'RED']),
    { action: 'FACTUAL_FALLBACK', reswitchCount: 5 },
  );
});

test('read-only FalsifyMe DB rejects writes', () => {
  const { dir, fPath, fdb } = fixture();
  fdb.close();
  const db = openReadOnlyFalsifyDb(fPath);
  assert.throws(() => db.exec("INSERT INTO scopes(id, header, status, phase) VALUES('x', '', 'done', 'write')"));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('active thinker closes the shared key window', () => {
  const { dir, fdb } = fixture('RUNNING');
  assert.equal(sharedKeyWindowOpen(fdb, 'e1'), false);
  fdb.close();
  rmSync(dir, { recursive: true, force: true });
});

test('doki db schema is present', () => {
  const { dir, fdb, dPath } = fixture();
  fdb.close();
  const db = openDokiDb(dPath);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  for (const n of ['observations', 'update_jobs', 'phase_reports', 'gaps', 'q_table', 'prompt_runs', 'dialog_messages', 'rotation_state', 'anomalies']) {
    assert.ok(names.includes(n));
  }
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
