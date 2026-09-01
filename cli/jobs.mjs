// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/jobs.mjs – Job-Befehle (status | jobs)
// -----------------------------------------------------------------------------
// Lese-Zugriffe auf die SQLite-Warteschlange (artifacts/jobs.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { openDb, closeDb } from "../artifacts/db.mjs";
import { getJob, listJobs } from "../artifacts/jobs.mjs";
import { fail } from "./util.mjs";

// ── status <job-id> ──────────────────────────────────────────────────────────
export function runStatus(id) {
  const db = openDb();
  const job = getJob(db, id);
  if (!job) fail(`Unbekannter Job: ${id}`);
  console.log(job.status);
  console.log(`created: ${job.created_at || "?"}`);
  if (job.started_at) console.log(`started: ${job.started_at}`);
  if (job.done_at) console.log(`done: ${job.done_at}`);
  if (job.verdict) console.log(`verdict: ${job.verdict}`);
  if (job.scope_id) console.log(`scope: ${job.scope_id}`);
  closeDb();
}

// ── jobs ─────────────────────────────────────────────────────────────────────
export function runJobs() {
  const db = openDb();
  const all = listJobs(db);
  const q = all.filter((j) => j.status === "QUEUED");
  const r = all.filter((j) => j.status === "RUNNING");
  const d = all.filter((j) => j.status.startsWith("DONE"));
  const e = all.filter((j) => j.status.startsWith("ERROR"));
  console.log("=== QUEUED ===");
  console.log(q.length ? q.map((j) => j.id).join("\n") : "(keine)");
  console.log("=== RUNNING ===");
  console.log(r.length ? r.map((j) => `${j.id}${j.scope_id ? ` (scope ${j.scope_id})` : ""}`).join("\n") : "(keine)");
  console.log("=== DONE ===");
  console.log(d.length ? d.map((j) => `${j.id} ${j.verdict || ""}`.trim()).join("\n") : "(keine)");
  console.log("=== ERROR ===");
  console.log(e.length ? e.map((j) => `${j.id} ${j.error || ""}`.trim()).join("\n") : "(keine)");
  closeDb();
}
