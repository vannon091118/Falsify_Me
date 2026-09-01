// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · artifacts/jobs.mjs – Jobs/Queue/Claim + Worker-Registrierung
// -----------------------------------------------------------------------------
// Die Warteschlange liegt in SQLite – Jobs werden ATOMAR geclaimt (BEGIN
// IMMEDIATE … COMMIT), kein Lock-File-Rennen. Worker-Fenster registrieren sich
// in meta (Fenster 1..MAX_WINDOWS) mit PID + Herzschlag.
// ─────────────────────────────────────────────────────────────────────────────
import { nowIso, genId, setMeta, getMeta, isProcessAlive } from "./db.mjs";

// ── Jobs ─────────────────────────────────────────────────────────────────────
export function createJob(db, { scopeId, payload, diffText, root, files, agentIntent = null, affected = null, wave = "scan", mode, status = "QUEUED" }) {
  const id = genId("job");
  db.prepare(
    "INSERT INTO jobs(id, scope_id, payload, diff_text, root, files, agent_intent, affected, wave, mode, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, scopeId ?? null, payload ?? null, diffText ?? null, root ?? null, files ?? null, agentIntent ?? null, affected ?? null, wave || "scan", mode ?? null, status, nowIso());
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

// ── Abort (CLI-angeordneter Job-Abbruch) ────────────────────────────────────
// `falsify abort <id>` bzw. `falsify wait --abort` setzen das Flag; der
// Worker pollt es während eines laufenden Kindprozesses und killt den Job
// echt (createAbort). Kein Fake-Verdict: der Job endet als ERROR
// "Abgebrochen (CLI)" – das Flag wird nach der Verarbeitung geloescht.
export function setJobAbort(db, id) {
  db.prepare("UPDATE jobs SET abort_requested = 1 WHERE id = ?").run(id);
}

export function clearJobAbort(db, id) {
  db.prepare("UPDATE jobs SET abort_requested = 0 WHERE id = ?").run(id);
}

export function isAbortRequested(db, id) {
  const r = db.prepare("SELECT abort_requested FROM jobs WHERE id = ?").get(id);
  return Boolean(r && Number(r.abort_requested));
}

// ── Worker-Claim: atomar über SQLite (kein Lock-File-Rennen) ─────────────────
/**
 * Claimt den nächsten QUEUED-Job für Fenster <windowIdx>. Bevorzugt Jobs des
 * zuletzt bearbeiteten (noch aktiven) Scopes (Scope-Affinität), sonst den
 * ältesten QUEUED-Job. Transaktional – kein zweiter Worker bekommt denselben Job.
 * Die Affinität wird INNERHALB der Claim-Transaktion gelesen (E2E-Befund
 * 2026-09-01: ein Vorab-Lesen ausserhalb wäre gegen setWorkerScope racy).
 */
export function claimNextJob(db, windowIdx, preferredScopeId = null) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const preferred = preferredScopeId || workerScope(db, windowIdx);
    let row = null;
    if (preferred) {
      row = db.prepare(
        "SELECT id, scope_id FROM jobs WHERE status = 'QUEUED' AND scope_id = ? ORDER BY created_at ASC LIMIT 1"
      ).get(preferred);
    }
    if (!row) {
      row = db.prepare(
        "SELECT id, scope_id FROM jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1"
      ).get();
    }
    if (!row) { db.exec("COMMIT"); return null; }
    jobToRunning(db, row.id, windowIdx);
    // Scope-Affinität ATOMAR mit dem Claim setzen (E2E-Befund 5, 2026-09-01):
    // Ein separater setWorkerScope-Aufruf NACH dem Claim liesse zwischen Claim
    // und Scope-Switch einen zweiten Worker denselben Scope claimen. Hier läuft
    // der Scope-Switch in derselben BEGIN-IMMEDIATE-Transaktion – Fenster koppelt
    // sich damit fest an den Scope, bis ein Job eines anderen Scopes geclaimt wird.
    if (row.scope_id) setWorkerScope(db, windowIdx, row.scope_id);
    db.exec("COMMIT");
    return getJob(db, row.id);
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* egal */ }
    throw e;
  }
}

/**
 * Worker-Start-Recovery (E2E-Befund 4, 2026-09-01): Schliesst RUNNING-Jobs,
 * deren registrierter Worker tot ist (hart gekillt, Stromausfall), als
 * "Worker-Abbruch (Recovery)" – die Queue luegt sonst dauerhaft:
 * claimNextJob claimt nur QUEUED, ein verwaister RUNNING-Job wuerde nie
 * fertig werden. Aufruf: worker.mjs beim Start (nach registerWorker).
 * @returns {string[]} geschlossene Job-IDs
 */
export function reapStaleJobs(db, maxWindows = 3) {
  const reaped = [];
  // Fenster 0 = DIREKT-RUNS (falsify run --job-id, window_idx NULL; registrieren
  // sich selbst als Fenster-0-Worker mit Heartbeat). Ein gecrashter Direkt-Run
  // altert dadurch genauso aus wie ein gekilltes Worker-Fenster — die Recovery
  // behandelt beide Pfade gleich (Regel-3-Rig, Asymmetrie-Fix).
  for (let i = 0; i <= maxWindows; i++) {
    const alive = isWorkerAlive(db, i);
    const jobs = db.prepare(
      "SELECT id FROM jobs WHERE status = 'RUNNING' AND (window_idx = ? OR (window_idx IS NULL AND ? = 0))"
    ).all(i, i);
    for (const j of jobs) {
      if (!alive) {
        jobDone(db, j.id, null, "Worker-Abbruch (Recovery)");
        reaped.push(j.id);
      }
    }
  }
  return reaped;
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

/**
 * True, wenn für Fenster <windowIdx> ein lebender Worker registriert ist.
 * Bewusst ZWEI Staleness-Semantiken (dokumentiert, kein stiller Split):
 * - isWorkerAlive: 1 h – Duplikat-/Recovery-Schutz (nur ein Fenster pro Slot;
 *   verhindert, dass ein kurz angehaltener Worker als tot gilt und ein
 *   zweites Fenster denselben Slot belegt).
 * - WORKER_STALE_MS (15 s): Status-API (listWorkers/.alive) – frische
 *   Heartbeats sind die Grundlage von --check/--state.
 */
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

// Heartbeat-Frische: ein registrierter Worker ist nur dann ein ECHTER Worker,
// wenn sein Herzschlag nicht älter als STALE_MS ist. Der Worker heartbeated
// seit der Registrierung kontinuierlich (setInterval, auch während Jobs) -
// hart gekillte Fenster (taskkill //T) altern dadurch aus und koennen keine
// false RUNNING/BUSY-Meldung mehr erzeugen (Root-Cause-Fix, ersetzt den
// frueheren PowerShell-CIM-Prozessabgleich).
// Worker-Heartbeat-Frische für die Status-API. Der Worker heartbeated alle
// 5 s; 3x Heartbeat-Intervall (15 s) ist robust gegen GC/Netz-Jitter, aber
// hart gekillte Fenster altern schnell aus (E2E-Befund 6: 60 s liessen die
// Status-API bis zu einer Minute lügen).
export const WORKER_STALE_MS = 15 * 1000;

/** Registrierte/laufende Worker (1..MAX_WINDOWS) als Liste. */
export function listWorkers(db, maxWindows = 3) {
  const out = [];
  for (let i = 1; i <= maxWindows; i++) {
    const pid = workerPid(db, i);
    const ts = getMeta(db, `worker.${i}.ts`);
    let fresh = false;
    if (ts) {
      const ageMs = Date.now() - new Date(ts).getTime();
      fresh = ageMs <= WORKER_STALE_MS;
    }
    const alive = isProcessAlive(pid) && fresh;
    const running = db.prepare(
      "SELECT id, scope_id FROM jobs WHERE status = 'RUNNING' AND window_idx = ? ORDER BY started_at DESC LIMIT 1"
    ).get(i);
    out.push({ idx: i, pid, alive, runningJob: running ? running.id : null, runningScope: running ? running.scope_id : null });
  }
  return out;
}
