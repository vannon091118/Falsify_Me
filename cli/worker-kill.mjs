// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/worker-kill.mjs – `falsify worker kill` (UI-141)
// -----------------------------------------------------------------------------
// GEZIELTES Killen ORPHER Worker-Prozesse. Motivation (User-Fall 2026-09-03):
// Ein stale Worker aus einem ALTEN Install-Verzeichnis (z. B. C:\tmp\bs-dock-…)
// hält den Slot besetzt – das neue Dock-Fenster sieht isWorkerAlive → true,
// schließt sich still, und bootstrap meldet „Worker nicht als RUNNING erkannt“.
// Bislang gab es KEINEN Pfad, diesen Worker gezielt zu töten (nur uninstall).
//
// Eine Verantwortung: registrierte Worker inventarisieren (Fenster 0..N —
// Fenster 0 = Direkt-Run-Worker) und Orphans killen. KEIN Prozess-Tabellen-
// Scan (der PowerShell-CIM-Abgleich wurde bewusst entfernt): gekillt werden
// NUR PIDs, die in DIESEM FALSIFY_HOME registriert sind. Keine zweite
// Liveness-Wahrheit (Heartbeat bleibt die eine), kein Verdict-Pfad, kein
// Queue-Writer (Queue-Schreibzugriffe laufen ausschließlich über artifacts/
// jobs.mjs: unregisterWorker + reapStaleJobs — Waisen-Jobs schließt der
// bestehende Recovery-Pfad fail-closed als „ERROR Worker-Abbruch (Recovery)“).
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { openDb, closeDb, isProcessAlive, getMeta } from "../artifacts/db.mjs";
import {
  reapStaleJobs, unregisterWorker, workerPid, agentName, WORKER_STALE_MS,
} from "../artifacts/jobs.mjs";
import { MAX_WINDOWS } from "./workerliveness.mjs";
import { fail } from "./util.mjs";

const THIS_PID = process.pid;

/** Inventar Fenster 0..MAX: registrierte Worker mit Frische-Klassifikation. */
export function inventoryWorkers(db, maxWindows = MAX_WINDOWS) {
  const out = [];
  for (let i = 0; i <= maxWindows; i++) {
    const pid = workerPid(db, i);
    if (!pid) continue; // nie registriert → nichts zu tun
    const ts = getMeta(db, `worker.${i}.ts`);
    const ageMs = ts ? Date.now() - new Date(ts).getTime() : Infinity;
    const pidAlive = isProcessAlive(pid);
    out.push({
      idx: i,
      pid,
      name: agentName(db, i),
      pidAlive,
      heartbeatFresh: ageMs <= WORKER_STALE_MS,
      // Orphan = Prozess weg ODER Heartbeat abgelaufen (der Status-API-Maßstab).
      orphan: !pidAlive || ageMs > WORKER_STALE_MS,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      mine: pid === THIS_PID,
    });
  }
  return out;
}

export function killPid(pid) {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "pipe" });
  } else {
    process.kill(pid, "SIGKILL");
  }
}

function fmtAge(ms) {
  if (ms == null) return "ohne Heartbeat";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m} min ${s % 60}s`;
}

/**
 * Programmgestützte Orphan-Reparatur (doctor --repair-all, UI-150): killt
 * ALLE in DIESEM FALSIFY_HOME registrierten Orphans (tote PID ODER
 * abgelaufener Heartbeat — dieselbe Klassifikation wie der CLI-Pfad),
 * räumt deren Registrierung und schließt anschließend Waisen-Jobs
 * fail-closed über reapStaleJobs (ERROR Worker-Abbruch (Recovery)). Nie:
 * frische Worker, nie die eigene PID. Bericht als Rückgabe (kein eigenes
 * console.log — der Aufrufer doctor meldet). Kein Prozess-Tabellen-Scan,
 * keine zweite Liveness-Wahrheit.
 */
export function repairStaleWorkers() {
  const db = openDb();
  try {
    const inv = inventoryWorkers(db, MAX_WINDOWS);
    let killed = 0;
    let cleaned = 0;
    const stopped = [];
    for (const w of inv) {
      if (w.mine || !w.orphan) continue; // frisch + Selbstschutz: nie killen
      const reason = w.pidAlive ? `Heartbeat abgelaufen (${fmtAge(w.ageMs)})` : "Prozess tot";
      if (w.pidAlive) {
        try { killPid(w.pid); killed++; } catch { /* Prozess schon weg – Registry trotzdem räumen */ }
      }
      unregisterWorker(db, w.idx);
      cleaned++;
      stopped.push({ idx: w.idx, name: w.name, pid: w.pid, reason });
    }
    // Queue-Orphan-Reparatur: laeuft IMMER (idempotent) — schließt RUNNING-
    // Waisen toter/abgemeldeter Worker auch dann, wenn keine Registrierung
    // mehr uebrig war (partieller Reap > gar keiner).
    let reaped = [];
    try { reaped = reapStaleJobs(db, MAX_WINDOWS); } catch { /* partiell ok */ }
    return { killed, cleaned, reaped, stopped, registeredTotal: inv.length };
  } finally {
    closeDb();
  }
}

/**
 * Hauptpfad. Optionen:
 *   --dry-run      anzeigen, nichts ändern
 *   --force <n>    FRISCHES Fenster n explizit töten (nur mit Nummer, nie alle)
 *   <n>            nur dieses Fenster (Orphan-Check bleibt an)
 * Ohne Ziel: ALLE registrierten Orphans.
 */
export function runWorkerKill(args) {
  const dryRun = args.includes("--dry-run");
  // --force NUR mit Fensternummer: `--force 2` tötet auch FRISCHE Slots —
  // bewusst nie „alle frischen“ (zu breit für ein Kill-Werkzeug).
  const forceIdx = args.indexOf("--force");
  let forceArg = null;
  if (forceIdx !== -1) {
    const nxt = args[forceIdx + 1];
    if (nxt != null && /^\d+$/.test(nxt)) forceArg = nxt;
    else fail("--force braucht eine Fensternummer: `falsify worker kill --force 2` (Orphans: einfach `falsify worker kill`).");
  }
  // Freistehende Nummer (nicht die hinter --force) = gezieltes Fenster,
  // Orphan-Check bleibt an.
  const numberArgs = args.map((a, i) => (/^\d+$/.test(a) ? { a, i } : null)).filter(Boolean);
  const standalone = numberArgs.filter((n) => n.i !== forceIdx + 1);
  const onlyIdx = forceArg != null
    ? Number(forceArg)
    : (standalone.length ? Number(standalone[standalone.length - 1].a) : null);
  const wantsForce = forceArg != null;

  const db = openDb();
  const inv = inventoryWorkers(db, MAX_WINDOWS);
  // Anzeige-Lauf über das VOLLSTÄNDIGE Inventar (nur Fenster-Filter) — frische
  // Worker müssen als „übersprungen“ SICHTBAR sein (ehrlicher Bericht), nicht
  // still aus der Zielliste fallen. Nur der Kill-Entscheid bleibt auf Orphans
  // (bzw. --force-Ziele) beschränkt.
  const shown = inv.filter((w) => (onlyIdx == null ? true : w.idx === onlyIdx));
  if (onlyIdx != null && !shown.length) {
    console.log(`Fenster ${onlyIdx} ist nicht registriert – nichts zu töten.`);
    closeDb();
    return;
  }

  let killed = 0;
  let cleaned = 0;
  const lines = [];
  for (const w of shown) {
    if (!w.orphan && !wantsForce) {
      lines.push(`  Fenster ${w.idx} · ${w.name} · PID ${w.pid} – FRISCH (Heartbeat ${fmtAge(w.ageMs)}) – übersprungen (gezieltes Töten: --force ${w.idx}).`);
      continue;
    }
    if (w.mine) {
      lines.push(`  Fenster ${w.idx} · ${w.name} · PID ${w.pid} – eigene PID, NICHT getötet (Selbstschutz).`);
      continue;
    }
    const reason = w.pidAlive ? `Heartbeat abgelaufen (${fmtAge(w.ageMs)})` : "Prozess tot";
    if (dryRun) {
      lines.push(`  [DRY-RUN] Fenster ${w.idx} · ${w.name} · PID ${w.pid} – würde gestoppt (${reason}).`);
      continue;
    }
    if (w.pidAlive) {
      try { killPid(w.pid); killed++; } catch { /* Prozess schon weg – Registry trotzdem räumen */ }
    }
    unregisterWorker(db, w.idx); // pid/scope/ts/name weg (NUR dieses Fenster)
    cleaned++;
    lines.push(`  ✓ Fenster ${w.idx} · ${w.name} · PID ${w.pid} gestoppt (${reason}), Registrierung geräumt.`);
  }

  // Waisen-Jobs der soeben getöteten Worker fail-closed schließen (derselbe
  // Pfad wie die automatische Recovery, kein Fake-Verdict).
  let reaped = [];
  if (!dryRun && (killed || cleaned)) {
    try { reaped = reapStaleJobs(db, MAX_WINDOWS); } catch { /* partiell ok */ }
  }
  closeDb();

  console.log(dryRun ? "Worker-Inventar (DRY-RUN, nichts geändert):" : "Worker-Inventar:");
  if (!inv.length) console.log("  Keine registrierten Worker (Fenster 0..MAX) – nichts zu töten.");
  for (const l of lines) console.log(l);
  if (reaped.length) console.log(`♻ ${reaped.length} Waisen-Job(s) fail-closed geschlossen (ERROR Worker-Abbruch (Recovery)): ${reaped.join(", ")}`);
  if (dryRun) return;
  console.log(`Fertig: ${killed} Prozess(e) gestoppt, ${cleaned} Registrierung(en) geräumt. Slot(s) frei – Neustart: falsify worker start 1`);
}

// Einstiegserkennung (Windows-sicher, AGENTS.md-Regel: exakter Pfadvergleich).
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  runWorkerKill(process.argv.slice(2));
}
