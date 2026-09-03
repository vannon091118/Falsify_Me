#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { openDokiDb, openReadOnlyFalsifyDb } from './db.mjs';
import { listTerminalEvents } from './falsify-reader.mjs';
import { processEvent } from './runtime.mjs';
import { replayTerminalEvents, resetReplayCursor } from './replay.mjs';

const args=process.argv.slice(2);
const get=(k)=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
const ALLOWED_REBUILD_TABLES = new Set([
  'dialog_messages', 'prompt_runs', 'phase_reports', 'anomalies', 'gaps',
  'observations', 'update_jobs', 'rotation_state', 'q_table',
]);
function assertSqlIdentifier(value) {
  if (!ALLOWED_REBUILD_TABLES.has(value)) throw new Error(`Unbekannte DOKI-Rebuild-Tabelle: ${value}`);
  return value;
}
const cmd=args[0];
if(!['run','rebuild'].includes(cmd)){console.error('Usage: node doki/src/cli.mjs run|rebuild --falsify-db <path> --doki-db <path> [--event <id>]');process.exit(2);}
const falsifyPath=get('--falsify-db'), dokiPath=get('--doki-db'), eventId=get('--event');
if(!falsifyPath||!dokiPath||!existsSync(falsifyPath)){console.error('FalsifyMe DB oder DOKI DB fehlt.');process.exit(2);}
const fdb=openReadOnlyFalsifyDb(falsifyPath), ddb=openDokiDb(dokiPath);
try{
  if(cmd==='rebuild'){
    ddb.exec('BEGIN IMMEDIATE');
    try{
      for(const table of ALLOWED_REBUILD_TABLES) ddb.exec(`DELETE FROM ${assertSqlIdentifier(table)}`);
      resetReplayCursor(ddb);
      ddb.exec('COMMIT');
    } catch(error){try{ddb.exec('ROLLBACK')}catch{};throw error;}
  }
  if(eventId){
    console.log(JSON.stringify(await processEvent({falsifyDb:fdb,dokiDb:ddb,eventId})));
  } else {
    const result=await replayTerminalEvents({falsifyDb:fdb,dokiDb:ddb});
    for(const message of result.messages) console.log(JSON.stringify(message));
  }
} finally {ddb.close();fdb.close();}
