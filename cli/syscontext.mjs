// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/syscontext.mjs – System-Orientierung pflegen (Coder-CLI)
// -----------------------------------------------------------------------------
// `falsify syscontext set|show|history` — der Coding-Agent pflegt die
// schema-validierte Systemübersicht im FALSIFY-Home. FalsifyMe (run.mjs)
// rendert den Stand in JEDEN Review als UNTRUSTED CONTEXT — dieser Befehl
// ist der Schreib-Kanal des CODERS, kein FalsifyMe-Write ins Projekt.
//   set      --root <dir> --file <overview.json> [--by <quelle>]
//   show     --root <dir>
//   history  --root <dir> [--last n]
// Schema-Verstoß → fail-closed (Exit 2) mit allen Fehlern.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { falsifyHome } from "../artifacts/db.mjs";
import {
  SYSCONTEXT_SCHEMA_VERSION,
  validateSysContextDoc,
  loadSysContext,
  readSysContextHistory,
  saveSysContext,
} from "../core/syscontext.mjs";
import { fail } from "./util.mjs";

function option(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function rootFrom(args) {
  const given = option(args, "--root");
  return path.resolve(given || process.cwd());
}

/** Liest die Coder-Datei (JSON) und validiert streng gegen Schema v1. */
function readAndValidate(file, root, by) {
  if (!file) fail("syscontext set braucht --file <overview.json>");
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail(`Übersicht unlesbar (${file}): ${e.message}`);
  }
  const check = validateSysContextDoc(raw);
  if (!check.ok) {
    console.error(`FEHLER: Schema v${SYSCONTEXT_SCHEMA_VERSION}-Verstoß in ${file}:`);
    for (const err of check.errors) console.error(`  · ${err}`);
    process.exit(2);
  }
  // Stempel: Root + Quelle + Zeit werden von FalsifyMe gesetzt (nie vom
  // Modell-Inhalt) — der Coder liefert nur subject/sections.
  const doc = {
    ...raw,
    schemaVersion: SYSCONTEXT_SCHEMA_VERSION,
    root: path.resolve(root),
    updatedBy: String(by || "coder").slice(0, 80),
    updatedAt: new Date().toISOString(),
  };
  return doc;
}

function formatDiff(diff) {
  if (!diff) return "(erster Stand)";
  const parts = [];
  if (diff.sectionsAdded.length) parts.push(`+Sektionen ${diff.sectionsAdded.join(",")}`);
  if (diff.sectionsRemoved.length) parts.push(`-Sektionen ${diff.sectionsRemoved.join(",")}`);
  if (diff.sectionsChanged.length) parts.push(`~Sektionen ${diff.sectionsChanged.join(",")}`);
  if (!parts.length) parts.push("keine inhaltliche Änderung");
  return `${parts.join(" · ")} (facts ${diff.factsBefore}→${diff.factsAfter}, Zeichen ${diff.charsBefore}→${diff.charsAfter})`;
}

export function runSysContext(args = []) {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "set") return sysContextSet(rest);
  if (sub === "show") return sysContextShow(rest);
  if (sub === "history") return sysContextHistory(rest);
  fail("Verwendung: falsify syscontext set --root <dir> --file <overview.json> [--by <quelle>] | show --root <dir> | history --root <dir> [--last n]");
}

function sysContextSet(args) {
  const root = rootFrom(args);
  const file = option(args, "--file");
  const by = option(args, "--by");
  const doc = readAndValidate(file, root, by);
  const entry = saveSysContext(falsifyHome(), root, doc, { updatedBy: doc.updatedBy });
  const history = readSysContextHistory(falsifyHome(), root);
  console.log("SYSCONTEXT=gespeichert");
  console.log(`ROOT=${doc.root}`);
  console.log(`SUBJECT=${doc.subject}`);
  console.log(`SCHEMA=v${doc.schemaVersion} · BY=${doc.updatedBy} · SNAPSHOT=${entry.at}`);
  console.log(`DIFF=${formatDiff(entry.diff)}`);
  console.log(`HISTORY=${history.length} Snapshots`);
}

function sysContextShow(args) {
  const root = rootFrom(args);
  const loaded = loadSysContext(falsifyHome(), root);
  if (!loaded.ok) {
    if (loaded.reason === "missing") {
      console.log("SYSCONTEXT=keiner");
      console.log(`Hinweis: Übersicht anlegen – falsify syscontext set --root "${root}" --file overview.json`);
      return;
    }
    console.error(`FEHLER: Gespeicherte Übersicht ist schema-ungültig (${loaded.errors?.length || 0} Fehler) – neu setzen: falsify syscontext set --root "${root}" --file overview.json`);
    for (const err of loaded.errors || []) console.error(`  · ${err}`);
    process.exit(2);
  }
  console.log(JSON.stringify(loaded.doc, null, 2));
}

function sysContextHistory(args) {
  const root = rootFrom(args);
  const last = Number(option(args, "--last") || "10");
  const history = readSysContextHistory(falsifyHome(), root);
  if (!history.length) {
    console.log("SYSCONTEXT_HISTORY=leer");
    console.log(`Hinweis: Übersicht anlegen – falsify syscontext set --root "${root}" --file overview.json`);
    return;
  }
  console.log(`SYSCONTEXT_HISTORY=${history.length} Snapshots (Root ${root})`);
  for (const h of history.slice(-last).reverse()) {
    console.log(`- ${h.at} · by=${h.by} · sha=${h.sha256} · ${formatDiff(h.diff)}`);
  }
}
