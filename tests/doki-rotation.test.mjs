// DOKI-Blocker 6 (2026-09-03): thinker_start/thinker_done sind die EINZIGE
// Quelle fuer die Shared-Key-Rotation (doki/src/rotation.mjs liest genau
// diese loop_events). Dieser Test pinnt den Vertrag: die Events werden um
// den REALEN Modell-Loop geschrieben — inkl. Fehlerfall (Fenster schliesst,
// Rotation staunt nicht) — und der doki-rotation-Vertrag konsumiert sie
// korrekt (busy waehrend start..done, frei danach).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recordLoopEvent } from '../artifacts/loops.mjs';
import { sharedKeyWindowOpen } from '../doki/src/rotation.mjs';

function fixtureDb() {
  const dir = mkdtempSync(join(tmpdir(), 'doki-rotation-'));
  const db = new DatabaseSync(join(dir, 'falsify.db'));
  db.exec(`
    CREATE TABLE jobs(
      id TEXT PRIMARY KEY, checkout_id TEXT, scope_id TEXT, payload TEXT, diff_text TEXT,
      root TEXT, files TEXT, agent_intent TEXT, affected TEXT, wave TEXT, mode TEXT,
      status TEXT, verdict TEXT, window_idx INTEGER, error TEXT, runtime_config TEXT,
      attempt INTEGER, max_attempts INTEGER, failure_kind TEXT, retry_at TEXT,
      created_at TEXT, started_at TEXT, done_at TEXT, parent_job_id TEXT, handoff_id TEXT,
      iteration_id TEXT, change_digest TEXT, header_digest TEXT, loop_state TEXT,
      review_iteration INTEGER, loop_count INTEGER, max_loop_count INTEGER
    );
    CREATE TABLE loop_events(
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, scope_id TEXT, handoff_id TEXT,
      change_digest TEXT, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT,
      payload TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE scopes(
      id TEXT PRIMARY KEY, checkout_id TEXT, header TEXT, phase TEXT, last_befund TEXT,
      open_conflicts INTEGER, last_divergence TEXT, research_additions TEXT, hardened_at TEXT
    );
  `);
  return { dir, db };
}

test('rotation contract: FalsifyMe schreibt thinker_start/done um den realen Modell-Loop', () => {
  const { dir, db } = fixtureDb();
  try {
    db.prepare(`INSERT INTO jobs(id, status, loop_state, created_at) VALUES('j1', 'RUNNING', 'THINKING', '2026-09-03T10:00:00.000Z')`).run();
    const ev = (type, payload) => recordLoopEvent(db, { jobId: 'j1', eventType: type, payload });

    // Vor dem ersten Denker-Call: kein Fenster -> frei (keine Alt-Events).
    const anchor = recordLoopEvent(db, { jobId: 'j1', eventType: 'submitted', toState: 'QUEUED' });
    assert.equal(sharedKeyWindowOpen(db, anchor), true, 'kein thinker-Event = frei');

    // Reale Loop-Umrandung (wie cli/run.mjs): start -> ... Arbeit ... -> done.
    ev('thinker_start', { model: 'm1' });
    const during = recordLoopEvent(db, { jobId: 'j1', eventType: 'heartbeat' });
    assert.equal(sharedKeyWindowOpen(db, during), false, 'zwischen start und done ist das Fenster GESCHLOSSEN (Thinker belegt)');
    ev('thinker_done', { model: 'm1', secs: 2.5 });
    const after = recordLoopEvent(db, { jobId: 'j1', eventType: 'transition', toState: 'VERIFYING' });
    assert.equal(sharedKeyWindowOpen(db, after), true, 'nach done ist das Fenster wieder FREI');

    // Zweite Runde: neues Fenster, wieder belegt, wieder frei.
    ev('thinker_start', { model: 'm2' });
    const during2 = recordLoopEvent(db, { jobId: 'j1', eventType: 'heartbeat' });
    assert.equal(sharedKeyWindowOpen(db, during2), false, 'zweites Fenster ebenfalls belegt');
    ev('thinker_done', { model: 'm2', error: 'HTTP 429' });
    const after2 = recordLoopEvent(db, { jobId: 'j1', eventType: 'transition', toState: 'VERIFYING' });
    assert.equal(sharedKeyWindowOpen(db, after2), true, 'Fehler-done schliesst das Fenster genauso (Rotation staunt nicht)');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test('rotation contract payloads: Modell- und Fehler-Diagnose kommen mit', () => {
  const { dir, db } = fixtureDb();
  try {
    db.prepare(`INSERT INTO jobs(id, status, loop_state, created_at) VALUES('j1', 'RUNNING', 'THINKING', '2026-09-03T10:00:00.000Z')`).run();
    recordLoopEvent(db, { jobId: 'j1', eventType: 'thinker_start', payload: { model: 'nvidia/nemotron-x' } });
    recordLoopEvent(db, { jobId: 'j1', eventType: 'thinker_done', payload: { model: 'nvidia/nemotron-x', error: 'HTTP 429' } });
    const rows = db.prepare(`SELECT event_type, payload FROM loop_events WHERE event_type LIKE 'thinker%' ORDER BY created_at`).all();
    assert.equal(rows.length, 2);
    assert.equal(JSON.parse(rows[0].payload).model, 'nvidia/nemotron-x');
    const done = JSON.parse(rows[1].payload);
    assert.equal(done.error, 'HTTP 429');
    assert.equal(done.model, 'nvidia/nemotron-x');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
