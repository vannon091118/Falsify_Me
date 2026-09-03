// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/jobs.mjs – Job-Befehle (status | jobs)
// -----------------------------------------------------------------------------
// Lese-Zugriffe auf die SQLite-Warteschlange (artifacts/jobs.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import path from "node:path";
import { openDb, closeDb } from "../artifacts/db.mjs";
import { getJob, listJobs, setJobAbort, listWorkers } from "../artifacts/jobs.mjs";

// Fensterzahl wie ui/worker.mjs (Umgebung konsistent): 1..N Slot-Registrierungen.
const MAX_WINDOWS = Number(process.env.FALSIFY_MAX_WINDOWS || 3);
import { exitCodeOf } from "../core/verdict.mjs";
import { fail } from "./util.mjs";

export function terminalExitCode(status) {
  if (String(status || "").startsWith("DONE ")) return exitCodeOf(String(status).slice(5));
  if (String(status || "").startsWith("ERROR")) return exitCodeOf(null);
  return 4;
}

export function runPing(id) {
  if (!id) fail("Nutzung: falsify ping <job-id>");
  const db = openDb();
  const job = getJob(db, id);
  if (!job) fail(`Unbekannter Job: ${id}`);
  const t0 = new Date(job.started_at || job.created_at || Date.now()).getTime();
  const elapsed = Math.max(0, Math.round((Date.now() - t0) / 1000));
  console.log(`STATUS ${job.status} ${elapsed}s`);
  closeDb();
  process.exitCode = terminalExitCode(job.status);
}

export function runAbort(id) {
  if (!id) fail("Nutzung: falsify abort <job-id>");
  const db = openDb();
  const job = getJob(db, id);
  if (!job) fail(`Unbekannter Job: ${id}`);
  if (job.status.startsWith("DONE") || job.status.startsWith("ERROR")) {
    console.log(`Job ${id} ist bereits beendet (${job.status}).`);
    closeDb();
    return;
  }
  setJobAbort(db, id);
  console.log(`Abort angefordert für ${id} – der Worker bricht den Job ab (keine Freigabe).`);
  closeDb();
}

export function runStatus(id) {
  if (!id) fail("Nutzung: falsify status <job-id>");
  const db = openDb();
  const job = getJob(db, id);
  if (!job) fail(`Unbekannter Job: ${id}`);
  console.log(job.status);
  console.log(`created: ${job.created_at || "?"}`);
  if (job.started_at) console.log(`started: ${job.started_at}`);
  if (job.done_at) console.log(`done: ${job.done_at}`);
  if (job.verdict) console.log(`verdict: ${job.verdict}`);
  if (job.scope_id) console.log(`scope: ${job.scope_id}`);
  // User-Test-Befund (2026-09-03): QUEUED ohne lebenden Worker ist der eine
  // Onboarding-Moment, in dem ein neuer User orientierungslos wartet. Ehrlich
  // hinschauen statt schweigen – kein Fake-Status, nur ein Hinweis.
  if (job.status === "QUEUED") {
    const workers = listWorkers(db, MAX_WINDOWS).filter((w) => w.alive);
    if (!workers.length) {
      console.log("");
      console.log("⚠ Kein Worker-Fenster läuft – dieser Job bleibt QUEUED, bis ein Fenster ihn übernimmt.");
      if (process.platform === "win32") {
        console.log("  Start: Desktop-Icon \"FalsifyMe\" oder ui\\start-dock.cmd 1 (sichtbar, \"Niemals headless\").");
      } else {
        console.log(`  Start: FALSIFY_WINDOW=1 node ${path.join("ui", "worker.mjs")} (im Installationsverzeichnis, z. B. ~/.Falsify_Core) – Linux/macOS ohne sichtbares Fenster.`);
      }
    }
  }
  closeDb();
}

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
