// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/jobs.mjs – Job-Befehle (status | jobs)
// -----------------------------------------------------------------------------
// Lese-Zugriffe auf die SQLite-Warteschlange (artifacts/jobs.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { openDb, closeDb } from "../artifacts/db.mjs";
import { getJob, listJobs, setJobAbort } from "../artifacts/jobs.mjs";
import { fail } from "./util.mjs";

// ── ping <job-id> (Wait-Auswertung für Coder/Skill) ─────────────────────────
// `falsify wait --ping <id>` = EINE Auswertungsrunde statt blockierendem Loop.
// Denk-/Schreibdauer ist anbieterabhängig nicht abschätzbar – deshalb gibt es
// KEINEN festen Timeout; der Coder bewertet den Ping und entscheidet über
// Weiterwarten oder Abbruch (falsify abort <id>).
// Ausgabe: STATUS <zustand> <verstrichene Sekunden>
// Exit: 0 = DONE WRITE · 1 = DONE PLAN/RESEARCH · 3 = ERROR/kein Verdict ·
//       4 = läuft noch (QUEUED/RUNNING – Coder wertet aus)
export function runPing(id) {
  if (!id) fail("Nutzung: falsify ping <job-id>"); // leerer id wuerde sonst als SQLite-Bind-Fehler verdeckt
  const db = openDb();
  const job = getJob(db, id);
  if (!job) fail(`Unbekannter Job: ${id}`);
  const t0 = new Date(job.started_at || job.created_at || Date.now()).getTime();
  const elapsed = Math.max(0, Math.round((Date.now() - t0) / 1000));
  console.log(`STATUS ${job.status} ${elapsed}s`);
  closeDb();
  if (job.status === "DONE WRITE") process.exitCode = 0;
  else if (job.status === "DONE PLAN" || job.status === "DONE RESEARCH") process.exitCode = 1;
  else if (job.status.startsWith("ERROR") || job.status.startsWith("DONE")) process.exitCode = 3;
  else process.exitCode = 4; // QUEUED/RUNNING: läuft noch – Coder wertet aus
}

// ── abort <job-id> (CLI-Abbruch eines Queue-Jobs) ───────────────────────────
// Setzt das Abort-Flag in der Queue; der Worker pollt es während des laufenden
// Kindprozesses und killt den Job echt. Kein Fake-Verdict: Der Job endet als
// ERROR "Abgebrochen (CLI)" – keine Freigabe.
export function runAbort(id) {
  if (!id) fail("Nutzung: falsify abort <job-id>"); // leerer id wuerde sonst als SQLite-Bind-Fehler verdeckt
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

// ── status <job-id> ──────────────────────────────────────────────────────────
export function runStatus(id) {
  if (!id) fail("Nutzung: falsify status <job-id>"); // leerer id wuerde sonst als SQLite-Bind-Fehler verdeckt
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
