import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDokiDb } from "../src/db.mjs";
import { processEvent } from "../src/runtime.mjs";
import { CHARACTERS, RELATIONSHIP_COUNT } from "../src/ensemble-state.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "doki-act-"));
  const fPath = join(dir, "falsify.db");
  const dPath = join(dir, "doki.db");
  const fdb = new DatabaseSync(fPath);
  fdb.exec(`
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
    CREATE TABLE findings(
      id INTEGER PRIMARY KEY AUTOINCREMENT, scope_id TEXT, job_id TEXT, round INTEGER,
      wave TEXT, mode TEXT, befund TEXT, content TEXT, verdict TEXT, created_at TEXT
    );
    CREATE TABLE scopes(
      id TEXT PRIMARY KEY, checkout_id TEXT, header TEXT, status TEXT, phase TEXT,
      last_befund TEXT, sub_prompt TEXT, open_conflicts INTEGER, hardened_at TEXT,
      created_at TEXT, updated_at TEXT, done_at TEXT, last_gap TEXT, last_divergence TEXT,
      research_additions TEXT
    );
    CREATE TABLE projects(project_id TEXT PRIMARY KEY, created_at TEXT);
    CREATE TABLE checkouts(checkout_id TEXT PRIMARY KEY, project_id TEXT, bound_root TEXT, root_name TEXT, root_binding TEXT, anchor_digest TEXT, records_digest TEXT, created_at TEXT, updated_at TEXT);
  `);

  fdb.prepare(`INSERT INTO jobs (
    id, checkout_id, scope_id, payload, diff_text, root, files, agent_intent, affected,
    wave, mode, status, verdict, window_idx, error, runtime_config, attempt, max_attempts,
    failure_kind, retry_at, created_at, started_at, done_at, parent_job_id, handoff_id,
    iteration_id, change_digest, header_digest, loop_state, review_iteration, loop_count, max_loop_count
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "j1", null, "s1", null, null, null, null, "intent: implement activation", null,
    "scan", "write", "DONE WRITE", "WRITE", null, null, null,
    1, 2, null, null, "2026-09-04T00:00:00Z", "2026-09-04T00:01:00Z", "2026-09-04T00:02:00Z",
    null, null, null, "c", "h", "DONE", 0, 1, 5
  );
  fdb.prepare("INSERT INTO loop_events VALUES(?,?,?,?,?,?,?,?,?,?)").run(
    "e1", "j1", "s1", null, "c", "verdict", "RUNNING", "DONE",
    JSON.stringify({ verdict: "WRITE" }), "2026-09-04T00:02:00Z"
  );
  fdb.prepare(`INSERT INTO findings (
    scope_id, job_id, round, wave, mode, befund, content, verdict, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?)`).run("s1", "j1", 1, "scan", "write", "All clean", "content", "WRITE", "2026-09-04T00:02:00Z");
  fdb.prepare(`INSERT INTO findings (
    scope_id, job_id, round, wave, mode, befund, content, verdict, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?)`).run("s1", "j1", 1, "evil", "write", "Challenge verified", "content", "WRITE", "2026-09-04T00:02:01Z");
  fdb.prepare(`INSERT INTO scopes (
    id, checkout_id, header, status, phase, last_befund, sub_prompt, open_conflicts,
    hardened_at, created_at, updated_at, done_at, last_gap, last_divergence, research_additions
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "s1", null, "Activation Scope", "done", "write", "No open conflicts", null, 0, null,
    "2026-09-04T00:00:00Z", "2026-09-04T00:02:00Z", null, null, null, null
  );
  return { dir, fPath, fdb, dPath };
}

test("Etappe 1: ensemble in prompt carries all 14 characters and relationships from etats", async () => {
  const { dir, fdb, dPath } = fixture();
  const ddb = openDokiDb(dPath);
  const mockCall = async () => ({ text: "Zynische Prosa von Narrator 15.", model: "thinker-model" });

  const message = await processEvent({
    falsifyDb: fdb,
    dokiDb: ddb,
    eventId: "e1",
    modelCall: mockCall,
  });

  assert.equal(message.mode, "NARRATIVE");
  assert.equal(message.body, "Zynische Prosa von Narrator 15.");

  const promptRow = ddb.prepare("SELECT prompt_json FROM prompt_runs WHERE update_id = ?").get(message.update_ref);
  assert.ok(promptRow);
  const promptData = JSON.parse(promptRow.prompt_json);

  assert.ok(promptData.body);
  const match = promptData.body.match(/STRIPE_ENSEMBLE\n(\{.*\})/);
  assert.ok(match, "STRIPE_ENSEMBLE must exist in prompt body");
  const ensembleStripe = JSON.parse(match[1]);

  assert.equal(Object.keys(ensembleStripe.characters).length, 14);
  assert.equal(Object.keys(ensembleStripe.relationships).length, RELATIONSHIP_COUNT);
  for (const name of CHARACTERS) {
    assert.ok(ensembleStripe.characters[name], `Character ${name} exists in ensemble`);
  }
  assert.ok(ensembleStripe.relevantCharacters.length > 0);
  assert.ok(ensembleStripe.relevantCharacters.length <= 7);

  ddb.close(); fdb.close();
  rmSync(dir, { recursive: true, force: true });
});

test("Etappe 2: narrator text is persisted in narrative_outputs per patternKey with call_count=1", async () => {
  const { dir, fdb, dPath } = fixture();
  const ddb = openDokiDb(dPath);
  let calls = 0;
  const mockCall = async () => {
    calls++;
    return { text: "Genau ein Thinker-Call für dieses Muster.", model: "thinker-model" };
  };

  const message = await processEvent({
    falsifyDb: fdb,
    dokiDb: ddb,
    eventId: "e1",
    modelCall: mockCall,
  });

  assert.equal(calls, 1);
  assert.equal(message.mode, "NARRATIVE");

  const outputs = ddb.prepare("SELECT * FROM narrative_outputs").all();
  assert.equal(outputs.length, 1);
  const row = outputs[0];

  assert.equal(row.history_id, "DONE|WRITE|scan");
  assert.equal(row.narrator_id, "NARRATOR_15");
  assert.equal(row.message_text, "Genau ein Thinker-Call für dieses Muster.");
  assert.equal(row.call_count, 1);
  assert.ok(row.output_id);
  assert.ok(row.prompt_digest);

  const second = await processEvent({
    falsifyDb: fdb,
    dokiDb: ddb,
    eventId: "e1",
    modelCall: mockCall,
  });
  assert.equal(second.message_id, message.message_id);
  assert.equal(ddb.prepare("SELECT COUNT(*) c FROM narrative_outputs").get().c, 1);

  ddb.close(); fdb.close();
  rmSync(dir, { recursive: true, force: true });
});
