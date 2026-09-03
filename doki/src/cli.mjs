#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { openDokiDb, openReadOnlyFalsifyDb } from './db.mjs';
import { listTerminalEvents } from './falsify-reader.mjs';
import { processEvent } from './runtime.mjs';

const args=process.argv.slice(2);
const get=(k)=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
const cmd=args[0];
const visible=args.includes('--visible');
if(!['run','rebuild'].includes(cmd)){console.error('Usage: node doki/src/cli.mjs run|rebuild --falsify-db <path> --doki-db <path> [--event <id>] [--visible]');process.exit(2);}
const falsifyPath=get('--falsify-db'), dokiPath=get('--doki-db'), eventId=get('--event');
if(!falsifyPath||!dokiPath||!existsSync(falsifyPath)){console.error('FalsifyMe DB oder DOKI DB fehlt.');process.exit(2);}
const fdb=openReadOnlyFalsifyDb(falsifyPath), ddb=openDokiDb(dokiPath);
try{
  if(cmd==='rebuild'){
    ddb.exec('BEGIN IMMEDIATE');
    try{for(const table of ['dialog_messages','prompt_runs','phase_reports','anomalies','gaps','observations','update_jobs','rotation_state']) ddb.exec(`DELETE FROM ${table}`); ddb.exec('COMMIT');}
    catch(error){try{ddb.exec('ROLLBACK')}catch{};throw error;}
  }
  const events=eventId?[{id:eventId}]:listTerminalEvents(fdb);
  for(const e of events){
    const message=await processEvent({falsifyDb:fdb,dokiDb:ddb,eventId:e.id});
    if(visible){
      console.log(`\n[DOKI] ${message.narrator_ref ?? 'Narrator'} · ${message.mode} · ${message.render_path}`);
      console.log(message.body);
      console.log(`[DOKI] authority=${message.authority} · update=${message.update_ref}`);
    } else console.log(JSON.stringify(message));
  }
} finally {ddb.close();fdb.close();}
