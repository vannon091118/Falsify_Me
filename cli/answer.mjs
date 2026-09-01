// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/answer.mjs – Antwort eines Jobs als Datei exportieren
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { openDb, closeDb, falsifyHome } from "../artifacts/db.mjs";
import { getJob } from "../artifacts/jobs.mjs";
import { getScope } from "../artifacts/scopes.mjs";
import { fail } from "./util.mjs";

export function runAnswer(rest) {
  const id = rest[0];
  if (!id) fail("Verwendung: falsify answer <job-id> [--file <pfad>]");
  const db = openDb();
  const job = getJob(db, id);
  if (!job) fail(`Unbekannter Job: ${id}`);
  const scope = job.scope_id ? getScope(db, job.scope_id) : null;
  const finding = job.scope_id ? db.prepare("SELECT * FROM findings WHERE job_id = ? LIMIT 1").get(id) : null;
  const content = [
    `Job-ID: ${id}`,
    `Zeit: ${job.created_at}`,
    `Fertig: ${job.done_at || "?"}`,
    `Verdict: ${job.verdict || "UNBEKANNT"}`,
    `Modus: ${job.mode || "plan"}`,
    `Scope: ${job.scope_id || "–"}`,
    scope ? `HEADER (1:1): ${scope.header}` : "",
    `Datenzugriff: ${job.root || "?"}`,
    job.files ? `Whitelist: ${job.files}` : "",
    ``,
    `## Iteration`,
    ``,
    job.payload || "(leer)",
    job.diff_text ? `\n## Diff\n\n${job.diff_text}` : "",
    ``,
    `## Ergebnis`,
    ``,
    finding?.content || `(kein Inhalt – ${job.error ? `Fehler: ${job.error}` : "Status " + job.status})`,
    ``,
  ].filter((l) => l !== "").join("\n");

  const idx = rest.indexOf("--file");
  const out = idx >= 0 && rest[idx + 1] ? path.resolve(rest[idx + 1]) : path.join(falsifyHome(), "logs", `falsify-answer-${id}.txt`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content, "utf8");
  console.log(`Antwort exportiert: ${out}`);
  closeDb();
}
