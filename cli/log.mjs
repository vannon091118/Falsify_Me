// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/log.mjs – volles Job-Protokoll (Payload + Antwort)
// ─────────────────────────────────────────────────────────────────────────────
import { openDb, closeDb } from "../artifacts/db.mjs";
import { getJob } from "../artifacts/jobs.mjs";
import { getScope } from "../artifacts/scopes.mjs";
import { fail } from "./util.mjs";

export function runLog(id) {
  if (!id) fail("Verwendung: falsify log <job-id>");
  const db = openDb();
  const job = getJob(db, id);
  if (!job) fail(`Unbekannter Job: ${id}`);
  console.log(`Job: ${job.id}`);
  console.log(`Status: ${job.status}`);
  if (job.scope_id) {
    const scope = getScope(db, job.scope_id);
    console.log(`Scope: ${job.scope_id}  (Phase ${scope?.phase || "?"})`);
    if (scope) console.log(`HEADER (1:1): ${scope.header}`);
  }
  console.log(`Modus: ${job.mode || "plan"}`);
  if (job.root) console.log(`Datenzugriff: ${job.root}`);
  if (job.files) console.log(`Whitelist: ${job.files}`);
  if (job.verdict) console.log(`Verdict: ${job.verdict}`);
  console.log(`Angelegt: ${job.created_at}`);
  if (job.started_at) console.log(`Gestartet: ${job.started_at}`);
  if (job.done_at) console.log(`Fertig: ${job.done_at}`);
  console.log("\n### Iteration (Payload)\n");
  console.log(job.payload || "(leer)");
  if (job.diff_text) {
    console.log("\n### Diff\n");
    console.log(job.diff_text);
  }
  if (job.scope_id) {
    const finding = db.prepare("SELECT * FROM findings WHERE job_id = ? LIMIT 1").get(id);
    if (finding) {
      console.log("\n### Ergebnis (volle Antwort)\n");
      console.log(finding.content || "(kein Inhalt)");
    }
  }
  closeDb();
}
