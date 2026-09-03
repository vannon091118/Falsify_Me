#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/doctor.mjs – Runtime-Vertragsprüfung
// -----------------------------------------------------------------------------
// Prüft: Node-Version (engines), Konfiguration (Validierung), API-Key,
// DB-Schema inkl. sub_prompt-Migration. Kein Netzaufruf.
// Exit: 0 = alles ok · 2 = Problem gefunden
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runDoctor() {
  const problems = [];
  const ok = (m) => console.log(`  ✅ ${m}`);
  const bad = (m) => { problems.push(m); console.log(`  ❌ ${m}`); };

  console.log("FalsifyMe doctor – Runtime-Vertragsprüfung\n");

  // 1) Node-Version (package.json engines)
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const major = Number(process.versions.node.split(".")[0]);
  const needMajor = Number(String(pkg.engines?.node || ">=22").replace(/[^0-9.]/g, "").split(".")[0]);
  if (major >= needMajor) ok(`Node ${process.versions.node} (>= ${needMajor} gefordert)`);
  else bad(`Node ${process.versions.node} zu alt (>= ${needMajor} gefordert)`);
  // Selbst-Kenntnis (User-Test 2026-09-03): das Werkzeug nennt seine Version —
  // `falsify --version` und doctor zeigen dieselbe Quelle (package.json).
  ok(`FalsifyMe v${pkg.version}`);
  // Produktkern bleibt dependency-frei; die Terminal-UI braucht bewusst
  // ink + react (Doku: package.json). Alles andere ist unerwartet.
  const DOC_DEPS = { ink: "^7.1.1", react: "^19.2.8" };
  const unexpected = Object.keys(pkg.dependencies || {}).filter((k) => !(k in DOC_DEPS));
  if (unexpected.length) {
    bad(`unerwartete Dependencies in package.json: ${unexpected.join(", ")}`);
  } else {
    // ink/react muessen tatsaechlich aufloesbar sein (TUI startet sonst nicht).
    const missing = ["ink", "react"].filter((m) => {
      try { import.meta.resolve(m); return false; } catch { return true; }
    });
    if (missing.length) bad(`TUI-Dependencies fehlen in node_modules: ${missing.join(", ")} (npm install ausfuehren)`);
    else ok("Dependencies ok (ink + react fuer Terminal-UI; Produktkern bleibt dependency-frei)");
  }

  // 2) Konfiguration (Validierung – wirft bei ungültigen Werten)
  try {
    const { loadConfig } = await import("../core/config.mjs");
    const cfg = loadConfig();
    ok(`Config: ${cfg.provider} · ${cfg.model} · maxRpm ${cfg.maxRpm} · timeout ${cfg.timeoutMs} ms`);
    // Twin-Diversität (Pkt 3/10): Sichtbar machen, ob die Gegenprüfung
    // modellfremd läuft — sonst ist der gemeinsame Blindspot eine Grenze.
    if (cfg.twinDiversity) {
      ok(`Twin-Diversität: Gegenprüfung mit eigenem Modell (${cfg.twinModel} @ ${cfg.twinApiBase}, effort ${cfg.twinReasoningEffort}, maxTokens ${cfg.twinMaxTokens})`);
    } else {
      bad("Twin-Diversität: Gegenprüfung läuft mit dem PRIMÄRMODELL (FALSIFY_TWIN_MODEL/FALSIFY_TWIN_API_BASE nicht gesetzt) – geteilter Modell-Bias möglich (BESTAETIGT ist dann Fallprüfung, keine unabhängige Wahrheit)");
    }
  } catch (e) {
    bad(`Config: ${e.message}`);
  }

  // 3) API-Key (inkl. Herkunft — User-Ticket 2026-09-03: ein geerbter
  // Prozess-Env-Key lief Job-los durch und brach erst mit HTTP 403 im Lauf;
  // doctor muss DIESE Falle sichtbar machen, nicht nur „Key da/nicht da“).
  try {
    const { loadApiKey, keyEnvFile, keyNames } = await import("../core/keys.mjs");
    const key = loadApiKey();
    if (key) {
      let fromFile = false;
      try {
        const envContent = fs.readFileSync(keyEnvFile(), "utf8");
        fromFile = keyNames().some((n) => envContent.split(/\r?\n/).some((l) => l.startsWith(`${n}=`) && l.slice(n.length + 1).trim()));
      } catch { /* .env fehlt/unlesbar → Key kann nur aus der Prozess-Env kommen */ }
      const envName = fromFile ? null : keyNames().find((n) => process.env[n]?.trim());
      if (fromFile) ok(`API-Key gefunden (${keyEnvFile()})`);
      else if (envName) bad(`API-Key kommt aus der PROZESS-UMGEBUNG (geerbtes ${envName}), NICHT aus ${keyEnvFile()} — riskant: unsichtbar für andere Shells, kollidiert mit der .env-Verwaltung. Fix: Key in ${keyEnvFile()} eintragen und die Umgebungsvariable entfernen.`);
      else ok(`API-Key gefunden (${keyEnvFile()})`);
    } else {
      bad(`Kein API-Key (${keyEnvFile()})`);
    }
  } catch (e) {
    bad(`Key-Check fehlgeschlagen: ${e.message}`);
  }

  // 4) DB-Schema inkl. Migration
  try {
    const { openDb, closeDb } = await import("../artifacts/db.mjs");
    const db = openDb();
    const cols = db.prepare("PRAGMA table_info(scopes)").all().map((c) => c.name);
    if (cols.includes("sub_prompt")) ok("DB-Schema: scopes.sub_prompt vorhanden");
    else bad("DB-Schema: scopes.sub_prompt fehlt (Migration)");
    const jm = db.prepare("PRAGMA journal_mode").get();
    if (String(jm.journal_mode).toLowerCase() === "wal") ok("DB: WAL-Modus aktiv");
    else bad(`DB: journal_mode=${jm.journal_mode} (WAL erwartet)`);

    // 5) Zustandsmodell-Konsistenz (Regel 3 – keine zweite Wahrheit):
    // Prüft abgeleitete Zustände gegen ihre Quelldaten (hardened/conflicts,
    // last_gap/Befund, Orphan-RUNNING, jobs- vs. findings-Verdict, Waisen).
    const { checkQueueConsistency } = await import("../artifacts/invariants.mjs");
    const q = checkQueueConsistency(db);
    if (q.ok) ok("Zustandsmodell: konsistent (hardened/GAP/Verdict/Worker – eine Wahrheit)");
    else for (const v of q.violations) bad(`Zustandsmodell: ${v}`);

    // 6) Worker-Liveness (User-Test 2026-09-03): Jobs QUEUED ohne lebendes
    // Worker-Fenster ist DER Onboarding-Moment, in dem neue Nutzer
    // orientierungslos warten. Hartes Problem nur, wenn wirklich Jobs warten;
    // sonst ehrlicher Hinweis (frische Installation hat bewusst kein Fenster).
    const { listJobs } = await import("../artifacts/jobs.mjs");
    const { workerSnapshot } = await import("./workerliveness.mjs");
    const snap = workerSnapshot(db);
    const queued = listJobs(db, { status: "QUEUED" });
    if (snap.fresh.length) {
      ok(`Worker: ${snap.fresh.length} aktiv (${snap.fresh.map((w) => `Fenster ${w.idx}, pid ${w.pid}`).join(" · ")}) – Hintergrund- oder Dock-Fenster zählen gleichermaßen (eine Registrierung, ein Heartbeat).`);
    } else if (snap.stale.length) {
      bad(`Worker registriert, aber Herzschlag abgelaufen (Fenster ${snap.stale.map((w) => w.idx).join(", ")}) – Prozess tot oder gekillt. Sofort starten (Hintergrund): falsify worker start 1 · Windows sichtbar: Desktop-Icon "FalsifyMe" oder ui\\start-dock.cmd 1`);
    } else if (queued.length) {      bad(`Kein Worker aktiv, aber ${queued.length} Job(s) QUEUED – sie bleiben hängen, bis ein Worker startet. Sofort starten (Hintergrund): falsify worker start 1 · Windows sichtbar: Desktop-Icon "FalsifyMe" oder ui\\start-dock.cmd 1`);
    } else {
      console.log("  ℹ️  Kein Worker aktiv (Queue leer – ein Worker wird erst beim ersten Job gebraucht. Start: falsify worker start 1 · Windows sichtbar: ui\\start-dock.cmd 1)");
    }
    closeDb();
  } catch (e) {
    bad(`DB: ${e.message}`);
  }

  console.log("");
  if (problems.length) {
    console.log(`doctor: ${problems.length} Problem(e) gefunden`);
    process.exitCode = 2;
  } else {
    console.log("doctor: alles ok");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDoctor();
}
