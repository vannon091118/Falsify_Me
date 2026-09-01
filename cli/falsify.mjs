#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// falsify – npm-bin-Wrapper (Windows/Linux/macOS) · FalsifyMe 2.0
// -----------------------------------------------------------------------------
// npm erzeugt fuer `bin`-Eintraege Shims, die auf Windows `node <bin>` aufrufen.
// Damit `npm install -g falsifyme` ueberall funktioniert, ist der bin-Eintrag
// dieser Node-Wrapper; die gesamte CLI-Logik bleibt in der Bash-CLI
// (cli/falsify.sh) – kein Logik-Duplikat, kein hartkodierter Pfad: alles wird
// relativ zum eigenen Paketverzeichnis aufgeloest (import.meta.url).
//
// Voraussetzungen (siehe README):
//   - Node.js >= 22.5 (node:sqlite)
//   - Windows: Git Bash (bash auf dem PATH), z.B. https://git-scm.com/download/win
// ─────────────────────────────────────────────────────────────────────────────
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sh = path.join(root, "cli", "falsify.sh");
const bash = process.env.FALSIFY_BASH || "bash";

const r = spawnSync(bash, [sh, ...process.argv.slice(2)], { stdio: "inherit" });

if (r.error) {
  console.error(`FEHLER: bash wurde nicht gefunden (${bash}).`);
  console.error("Voraussetzung (Windows): Git Bash installieren, z.B. https://git-scm.com/download/win");
  console.error("Alternativ bash-Pfad setzen: FALSIFY_BASH=C:\\Program Files\\Git\\bin\\bash.exe");
  process.exit(3);
}
process.exit(r.status ?? 1);
