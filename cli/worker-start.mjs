// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/worker-start.mjs – `falsify worker start [fenster]`
// -----------------------------------------------------------------------------
// Startet ui/worker.mjs (Fenster N) DETACHT im Hintergrund und verifiziert
// ehrlich, dass er sich registriert hat. Universeller Startpfad für
// Linux/macOS und für Hintergrundbetrieb unter Windows – der sichtbare Dock-
// Start (Desktop-Icon / ui\start-dock.cmd) bleibt die Empfehlung für Nutzer
// („Niemals headless" gilt für die UX-Abnahme; dieser Pfad ist für Agents/
// Automatisierung bzw. Server, wie README/WIRING §0 es trennt).
// Doppel-Start ist harmlos: der zweite Prozess sieht den lebenden ersten und
// beendet sich selbst (ui/worker.mjs main(), isWorkerAlive-Guard).
// Kein Verdict-Pfad: dieses Modul startet nur einen registrierten Worker und
// lügt nicht über das Ergebnis (Registrierung wird gegen die Queue geprüft).
// ─────────────────────────────────────────────────────────────────────────────
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, closeDb, falsifyHome } from "../artifacts/db.mjs";
import { listWorkers } from "../artifacts/jobs.mjs";
import { MAX_WINDOWS } from "./workerliveness.mjs";
import { fail } from "./util.mjs";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

// Einstiegserkennung (Windows-sicher, vgl. AGENTS.md): NUR wenn diese Datei
// selbst der Einstieg ist, läuft main() – als Modul bleibt alles injizierbar.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  runWorkerStart(process.argv.slice(2));
}

export function runWorkerStart(args) {
  // `falsify worker start <1..3> [--name <name>]` – sprechender Agent-Name
  //  (UI-142): parallele Agents/Docks identifizieren sich gegenseitig über den
  // Namen (Status-API, Dock-Titel), statt fremde Fenster als Bug zu deuten.
  const nameIdx = args.indexOf("--name");
  let name = null;
  if (nameIdx !== -1) {
    name = String(args[nameIdx + 1] || "").trim().slice(0, 24) || null;
    args = [...args.slice(0, nameIdx), ...args.slice(nameIdx + 2)];
  } else {
    const eq = args.find((a) => a.startsWith("--name="));
    if (eq) name = String(eq.slice(7)).trim().slice(0, 24) || null;
    args = args.filter((a) => !a.startsWith("--name="));
  }
  const idx = Number(args[0] || process.env.FALSIFY_WINDOW || 1);
  if (!Number.isInteger(idx) || idx < 1 || idx > MAX_WINDOWS) {
    fail(`Nutzung: falsify worker start <1..${MAX_WINDOWS}> [--name <Agent-Name>]`);
  }
  const agentName = name || `Agent ${idx}`;

  // Vorab-Check: läuft in diesem Slot schon ein frischer Worker? Dann sind wir
  // fertig (idempotent) – der Doppel-Start-Schutz des Workers macht dasselbe,
  // aber so sparen wir den Prozess und antworten sofort ehrlich.
  const db = openDb();
  const pre = listWorkers(db, MAX_WINDOWS).find((w) => w.idx === idx);
  if (pre && pre.alive) {
    console.log(`Worker-Fenster ${idx} läuft bereits (PID ${pre.pid}) – nichts zu tun.`);
    closeDb();
    return;
  }
  closeDb();

  const workerPath = path.join(THIS_DIR, "..", "ui", "worker.mjs");
  const child = spawn(process.execPath, [workerPath], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, FALSIFY_WINDOW: String(idx), FALSIFY_AGENT_NAME: agentName, FALSIFY_HEADLESS_WORKER: "1" },
  });
  child.unref();

  // Ehrliche Verifikation: der Worker registriert sich beim Start VOR der
  // Selbsttest-Phase. Wir warten kurz und prüfen die Registrierung gegen die
  // Queue – „gestartet" heißt hier nachweisbar registriert, nicht nur PID
  // an den Kernel übergeben.
  const deadline = Date.now() + 8000;
  const poll = () => {
    const d2 = openDb();
    const w = listWorkers(d2, MAX_WINDOWS).find((x) => x.idx === idx);
    closeDb();
    if (w && w.alive) {
      console.log(`Worker gestartet und registriert: Fenster ${idx} · ${w.name} · PID ${w.pid} · FALSIFY_HOME=${falsifyHome()}`);
      console.log("Jobs in QUEUED werden jetzt übernommen. Sichtbar verfolgen: Desktop-Icon \"FalsifyMe\" (Windows) oder dieses Log: falsify log <job-id>.");
      return;
    }
    if (Date.now() > deadline) {
      // Fail-closed ehrlich: Prozess ist weg oder hat sich nicht registriert.
      console.error(`FEHLER: Worker-Fenster ${idx} hat sich nicht registriert (PID ${child.pid} beendet oder heartbeat fehlt). Details: FALSIFY_WINDOW=${idx} node ui/worker.mjs manuell ausführen.`);
      process.exitCode = 3;
      return;
    }
    setTimeout(poll, 400);
  };
  poll();
}
