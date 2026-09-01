#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runScope } from "./scope.mjs";
import { runStatus, runJobs } from "./jobs.mjs";
import { runHistory } from "./history.mjs";
import { runLog } from "./log.mjs";
import { runAnswer } from "./answer.mjs";
import { ensureFalsifyHome } from "../artifacts/db.mjs";
import { runDoctor } from "./doctor.mjs";
import { runSettings, runModels } from "./settings.mjs";
import { HELP_TEXT } from "./help.mjs";
import { fail } from "./util.mjs";

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "help";
  switch (cmd) {
    case "status": runStatus(args[1]); break;
    case "jobs": runJobs(); break;
    case "history": runHistory(args.slice(1)); break;
    case "scope": runScope(args.slice(1)); break;
    case "log": runLog(args[1]); break;
    case "answer": runAnswer(args.slice(1)); break;
    case "ensure-home": {
      const home = ensureFalsifyHome();
      console.log(`FALSIFY_HOME=${home}`);
      console.log(`DB: ${home}/falsify.db`);
      console.log(`Keys: ${home}/.env`);
      break;
    }
    case "doctor": await runDoctor(); break;
    case "settings": await runSettings(args.slice(1)); break;
    case "models": await runModels(args.slice(1)); break;
    case "help": case "-h": case "--help": console.log(HELP_TEXT); break;
    default: fail(`Unbekannter Befehl: ${cmd} (falsify help)`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
