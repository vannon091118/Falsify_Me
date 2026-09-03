// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/workerliveness.mjs – Worker-Liveness (eine Wahrheit)
// -----------------------------------------------------------------------------
// EIN Ort für die Frage „läuft überhaupt ein Worker?". Dock-Fenster und
// Headless-/Hintergrund-Worker registrieren sich IDENTISCH über registerWorker
// + Heartbeat (artifacts/jobs.mjs) – die Liveness-Semantik (frischer Heartbeat,
// WORKER_STALE_MS) ist damit bewusst für beide Betriebsarten dieselbe. Kein
// zweiter Liveness-Pfad, keine Prozesstabelle-Abfrage (Root-Cause-Fix 2026-09).
// Nur Lesen + Hinweise: dieses Modul entscheidet NIEMALS einen Verdict und
// schreibt nie die Queue.
// ─────────────────────────────────────────────────────────────────────────────
import { listWorkers, workerHeartbeatAgeMs } from "../artifacts/jobs.mjs";

// Fensterzahl wie ui/worker.mjs (Umgebung konsistent): 1..N Slot-Registrierungen.
export const MAX_WINDOWS = Number(process.env.FALSIFY_MAX_WINDOWS || 3);

/** Snapshot: frische (alive) und registriert-abgestorbene Worker-Fenster. */
export function workerSnapshot(db, maxWindows = MAX_WINDOWS) {
  const ws = listWorkers(db, maxWindows);
  return {
    all: ws,
    fresh: ws.filter((w) => w.alive),
    stale: ws.filter((w) => w.pid && !w.alive),
    any: ws.some((w) => w.alive),
  };
}

/** Alter des frischesten Heartbeats über alle Fenster (ms) oder null (nie). */
export function lastHeartbeatAge(db, maxWindows = MAX_WINDOWS) {
  return workerHeartbeatAgeMs(db, maxWindows);
}

function fmtAge(ms) {
  if (ms == null) return "noch nie registriert";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "vor <1 min";
  if (min < 60) return `vor ${min} min`;
  const h = Math.floor(min / 60);
  return `vor ${h} h ${min % 60} min`;
}

/**
 * Plattformkorrekte Starthinweise (Hintergrund zuerst, sichtbar als Zweitoption).
 * `falsify worker start` ist der universelle Hintergrundpfad (alle Plattformen).
 */
export function workerHintLines({ indent = "  " } = {}) {
  if (process.platform === "win32") {
    return [
      `${indent}Orphan-Worker beseitigen (Slot blockiert?): falsify worker kill --dry-run`,
      `${indent}Sofort starten (Hintergrund): falsify worker start 1`,
      `${indent}Sichtbar (Empfehlung, \"Niemals headless\"): Desktop-Icon \"FalsifyMe\" oder ui\\start-dock.cmd 1`,
    ];
  }
  return [
    `${indent}Orphan-Worker beseitigen (Slot blockiert?): falsify worker kill --dry-run`,
    `${indent}Sofort starten (Hintergrund): falsify worker start 1`,
    `${indent}Ohne eigenes Fenster: FALSIFY_WINDOW=1 node ui/worker.mjs (im Installationsverzeichnis)`,
  ];
}

/**
 * Ehrliche Warnung, wenn KEIN Worker frisch heartbeated. Gibt true zurück, wenn
 * gewarnt wurde. Nennt das Alter der letzten Worker-Aktivität („seit X min kein
 * Worker") statt still zu schweigen – kein Fake-Status, keine Erfindung.
 */
export function warnIfNoWorker(db, { maxWindows = MAX_WINDOWS, reason = " dieser Job bleibt QUEUED, bis ein Worker ihn übernimmt" } = {}) {
  const snap = workerSnapshot(db, maxWindows);
  if (snap.any) return false;
  const age = lastHeartbeatAge(db, maxWindows);
  console.log(`⚠ Kein Worker mit frischem Heartbeat – ${reason}. Letzte Worker-Aktivität: ${fmtAge(age)}.`);
  for (const line of workerHintLines()) console.log(line);
  return true;
}
