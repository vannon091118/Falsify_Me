// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · artifacts/jobs.mjs – Jobs/Queue/Claim + Worker-Registrierung
// -----------------------------------------------------------------------------
// Die Warteschlange liegt in SQLite – Jobs werden ATOMAR geclaimt (BEGIN
// IMMEDIATE … COMMIT), kein Lock-File-Rennen. Worker-Fenster registrieren sich
// in meta (Fenster 1..MAX_WINDOWS) mit PID + Herzschlag.
// ─────────────────────────────────────────────────────────────────────────────
import { nowIso, genId, setMeta, getMeta, isProcessAlive } from "./db.mjs";

// ── Jobs ─────────────────────────────────────────────────────────────────────
export function createJob(db, { scopeId, payload, diffText, root, files, mode, status = "QUEUED" }) {
  const id = genId("job");
  db.prepare(
    "INSERT INTO jobs(id, scope_id, payload, diff_text, root, files, mode, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, scopeId ?? null, payload ?? null, diffText ?? null, root ?? null, files ?? null, mode ?? null, status, nowIso());
  return id;
}

export function getJob(db, id) {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
}

export function jobFilesList(job) {
  return (job?.files || "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function jobToRunning(db, id, windowIdx) {
  db.prepare("UPDATE jobs SET status = 'RUNNING', window_idx = ?, started_at = ? WHERE id = ?")
    .run(windowIdx ?? null, nowIso(), id);
}

export function jobDone(db, id, verdict, error) {
  const status = error ? `ERROR ${error}` : `DONE ${verdict || "UNBEKANNT"}`;
  db.prepare("UPDATE jobs SET status = ?, verdict = ?, error = ?, done_at = ? WHERE id = ?")
    .run(status, verdict ?? null, error ?? null, nowIso(), id);
}

export function listJobs(db, { status } = {}) {
  if (status) {
    return db.prepare("SELECT * FROM jobs WHERE status LIKE ? ORDER BY created_at DESC").all(`${status}%`);
  }
  return db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all();
}

// ── Worker-Claim: atomar über SQLite (kein Lock-File-Rennen) ─────────────────
/**
 * Claimt den nächsten QUEUED-Job für Fenster <windowIdx>. Bevorzugt Jobs des
 * zuletzt bearbeiteten (noch aktiven) Scopes (Scope-Affinität), sonst den
 * ältesten QUEUED-Job. Transaktional – kein zweiter Worker bekommt denselben Job.
 */
export function claimNextJob(db, windowIdx, preferredScopeId) {
  db.exec("BEGIN IMMEDIATE");
  try {
    let row = null;
    if (preferredScopeId) {
      row = db.prepare(
        "SELECT id FROM jobs WHERE status = 'QUEUED' AND scope_id = ? ORDER BY created_at ASC LIMIT 1"
      ).get(preferredScopeId);
    }
    if (!row) {
      row = db.prepare(
        "SELECT id FROM jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1"
      ).get();
    }
    if (!row) { db.exec("COMMIT"); return null; }
    jobToRunning(db, row.id, windowIdx);
    db.exec("COMMIT");
    return getJob(db, row.id);
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* egal */ }
    throw e;
  }
}

// ── Worker-Registrierung (Fenster 1..MAX_WINDOWS) ────────────────────────────
export function registerWorker(db, windowIdx, pid) {
  setMeta(db, `worker.${windowIdx}.pid`, String(pid));
  setMeta(db, `worker.${windowIdx}.scope`, "");
  setMeta(db, `worker.${windowIdx}.ts`, nowIso());
}

export function heartbeatWorker(db, windowIdx) {
  setMeta(db, `worker.${windowIdx}.ts`, nowIso());
}

export function workerScope(db, windowIdx) {
  return getMeta(db, `worker.${windowIdx}.scope`) || "";
}

export function setWorkerScope(db, windowIdx, scopeId) {
  setMeta(db, `worker.${windowIdx}.scope`, scopeId || "");
}

export function unregisterWorker(db, windowIdx) {
  try {
    db.prepare("DELETE FROM meta WHERE key IN (?, ?, ?)")
      .run(`worker.${windowIdx}.pid`, `worker.${windowIdx}.scope`, `worker.${windowIdx}.ts`);
  } catch { /* egal */ }
}

export function workerPid(db, windowIdx) {
  return Number(getMeta(db, `worker.${windowIdx}.pid`) || 0);
}

/** True, wenn für Fenster <windowIdx> ein lebender Worker registriert ist. */
export function isWorkerAlive(db, windowIdx) {
  const pid = workerPid(db, windowIdx);
  if (!isProcessAlive(pid)) return false;
  const ts = getMeta(db, `worker.${windowIdx}.ts`);
  if (ts) {
    const ageMs = Date.now() - new Date(ts).getTime();
    if (ageMs > 60 * 60 * 1000) return false; // Herzschlag > 1 h alt → als tot behandeln
  }
  return true;
}

/** Registrierte/laufende Worker (1..MAX_WINDOWS) als Liste. */
export function listWorkers(db, maxWindows = 3) {
  const out = [];
  for (let i = 1; i <= maxWindows; i++) {
    const pid = workerPid(db, i);
    const alive = isProcessAlive(pid);
    const running = db.prepare(
      "SELECT id, scope_id FROM jobs WHERE status = 'RUNNING' AND window_idx = ? ORDER BY started_at DESC LIMIT 1"
    ).get(i);
    out.push({ idx: i, pid, alive, runningJob: running ? running.id : null, runningScope: running ? running.scope_id : null });
  }
  return out;
}
