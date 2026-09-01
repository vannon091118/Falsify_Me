#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runScope } from "./scope.mjs";
import { runStatus, runJobs, runPing, runAbort } from "./jobs.mjs";
import { runHistory } from "./history.mjs";
import { runLog } from "./log.mjs";
import { runAnswer } from "./answer.mjs";
import { ensureFalsifyHome } from "../artifacts/db.mjs";
import { runDoctor } from "./doctor.mjs";
import { runSettings, runModels } from "./settings.mjs";
import { runOnboardCli } from "./onboard.mjs";
import { HELP_TEXT } from "./help.mjs";
import { fail } from "./util.mjs";

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "help";
  switch (cmd) {
    case "status": runStatus(args[1]); break;
    case "jobs": runJobs(); break;
    case "ping": runPing(args[1]); break;
    case "abort": runAbort(args[1]); break;
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
    case "bootstrap": {
      const { runBootstrap } = await import("./bootstrap/main.mjs");
      const { bootstrapFlags } = await import("./bootstrap.mjs");
      const { packageRoot } = await import("./bootstrap/install.mjs");
      const os = await import("node:os");
      const bArgs = args.slice(1);
      const bFlags = bootstrapFlags(bArgs);
      const r = await runBootstrap({
        root: packageRoot,
        homeDir: os.homedir(),
        dryRun: bFlags.dryRun,
        skipDock: bFlags.skipDock,
        noDesktop: bFlags.noDesktop,
        projectRoot: bFlags.projectRoot,
        mode: bFlags.mode,
        reichweite: bFlags.reichweite,
      });
      if (!r.ok) process.exit(1);
      console.log();
      break;
    }
    case "onboard": {
      const r = await runOnboardCli(args.slice(1));
      if (r && !r.ok) process.exit(2);
      break;
    }
    case "doctor": await runDoctor(); break;
    case "settings": await runSettings(args.slice(1)); break;
    case "models": await runModels(args.slice(1)); break;
    case "help": case "-h": case "--help": console.log(HELP_TEXT); break;
    default: fail(`Unbekannter Befehl: ${cmd} (falsify help)`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Unerwartete Fehler immer als saubere eine Zeile (kein Stack-Trace) + Exit 3.
  main().catch((e) => {
    console.error(`FEHLER: ${e?.message || e}`);
    process.exit(3);
  });
}
