#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { openDokiDb, openReadOnlyFalsifyDb } from './db.mjs';
import { listTerminalEvents } from './falsify-reader.mjs';
import { processEvent } from './runtime.mjs';

const args=process.argv.slice(2);
if(args[0]!=='run'){console.error('Usage: node doki/src/cli.mjs run --falsify-db <path> --doki-db <path> [--event <id>]');process.exit(2);}
const get=(k)=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
const falsifyPath=get('--falsify-db'), dokiPath=get('--doki-db'), eventId=get('--event');
if(!falsifyPath||!dokiPath||!existsSync(falsifyPath)){console.error('FalsifyMe DB oder DOKI DB fehlt.');process.exit(2);}
const fdb=openReadOnlyFalsifyDb(falsifyPath), ddb=openDokiDb(dokiPath);
try{const events=eventId?[{id:eventId}]:listTerminalEvents(fdb);for(const e of events)console.log(JSON.stringify(await processEvent({falsifyDb:fdb,dokiDb:ddb,eventId:e.id})));}
finally{ddb.close();fdb.close();}
