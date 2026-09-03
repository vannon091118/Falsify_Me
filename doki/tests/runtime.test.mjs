import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDokiDb } from '../src/db.mjs';
import { processEvent } from '../src/runtime.mjs';
import { resolveSwitches } from '../src/model.mjs';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'doki-')), fPath=join(dir,'falsify.db'), dPath=join(dir,'doki.db'), fdb=new DatabaseSync(fPath);
  fdb.exec(`CREATE TABLE jobs(id TEXT PRIMARY KEY, project_id TEXT, checkout_id TEXT, loop_state TEXT, status TEXT, verdict TEXT, wave TEXT, attempt INTEGER, loop_count INTEGER, max_loop_count INTEGER, parent_job_id TEXT, iteration_id TEXT, review_iteration INTEGER, header_digest TEXT, change_digest TEXT, runtime_config TEXT, created_at TEXT, started_at TEXT, done_at TEXT);
  CREATE TABLE loop_events(id TEXT PRIMARY KEY, job_id TEXT NOT NULL, scope_id TEXT, handoff_id TEXT, change_digest TEXT, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT, payload TEXT, created_at TEXT NOT NULL);
  CREATE TABLE findings(job_id TEXT, round INTEGER, wave TEXT, mode TEXT, befund TEXT, verdict TEXT);
  CREATE TABLE scopes(id TEXT PRIMARY KEY, header TEXT, phase TEXT, last_befund TEXT, open_conflicts TEXT, last_divergence TEXT, research_additions TEXT, hardened_at TEXT);
  CREATE TABLE projects(project_id TEXT, checkout_id TEXT, bound_root TEXT, anchor_digest TEXT);
  CREATE TABLE checkouts(checkout_id TEXT, project_id TEXT, bound_root TEXT, anchor_digest TEXT);`);
  fdb.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('j1',null,null,'DONE','DONE WRITE','WRITE','scan',1,1,5,null,null,0,'h','c',null,'2026-09-03T00:00:00Z','2026-09-03T00:01:00Z','2026-09-03T00:02:00Z');
  fdb.prepare('INSERT INTO loop_events VALUES(?,?,?,?,?,?,?,?,?,?)').run('e1','j1','s1',null,'c','transition','RUNNING','DONE',JSON.stringify({safe:true}),'2026-09-03T00:02:00Z');
  fdb.prepare('INSERT INTO findings VALUES(?,?,?,?,?,?)').run('j1',1,'scan','x','facts','WRITE');
  fdb.prepare('INSERT INTO findings VALUES(?,?,?,?,?,?)').run('j1',1,'evil','x','facts','WRITE');
  fdb.prepare('INSERT INTO scopes VALUES(?,?,?,?,?,?,?,?)').run('s1','hello','DONE','facts','[]','','[]',null);
  return {dir,fdb,dPath};
}

test('same loop_event is idempotent and yields one message',async()=>{
  const {dir,fdb,dPath}=fixture(), ddb=openDokiDb(dPath), env={DOKI_MAX_CALLS:'0'};
  const a=await processEvent({falsifyDb:fdb,dokiDb:ddb,eventId:'e1',env}), b=await processEvent({falsifyDb:fdb,dokiDb:ddb,eventId:'e1',env});
  assert.equal(a.message_id,b.message_id); assert.equal(ddb.prepare('SELECT COUNT(*) c FROM observations').get().c,1); assert.equal(ddb.prepare('SELECT COUNT(*) c FROM dialog_messages').get().c,1);
  ddb.close();fdb.close();rmSync(dir,{recursive:true,force:true});
});

test('reswitch hard cap is five and sixth red decision falls back',()=>assert.deepEqual(resolveSwitches(['RED','RED','RED','RED','RED','RED']),{action:'FACTUAL_FALLBACK',reswitchCount:5}));

test('doki db schema is present',()=>{const {dir,fdb,dPath}=fixture();fdb.close();const db=openDokiDb(dPath), names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);for(const n of ['observations','update_jobs','phase_reports','gaps','q_table','prompt_runs','dialog_messages','rotation_state','anomalies'])assert.ok(names.includes(n));db.close();rmSync(dir,{recursive:true,force:true});});
