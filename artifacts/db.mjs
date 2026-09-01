#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · artifacts/db.mjs – SQLite-Grundlage (EINZIGE Persistenzquelle)
// -----------------------------------------------------------------------------
// Alle Daten liegen AUSSERHALB des Repos in FALSIFY_HOME (Default:
// ~/.Falsify_Private — das private Wissensverzeichnis, getrennt vom Programm
// in ~/.Falsify_Core):
//   .env          → API-Keys (lokal, nichts für GitHub)
//   falsify.db    → SQLite (WAL) – Scopes, Findings (Befunde), Jobs, Meta
//                   + rate_limit-Tabelle (40-RPM-Reservierungen; eine Tabelle
//                   in derselben Datei, KEINE Datei daneben)
//   logs/         → Fenster-/Dock-Logs, optionale Antwort-Exporte
//
// Privacy-Vertrag: Die Daten gehören dem NUTZER und sind NUR für das lokale
// FalsifyMe verfügbar (kein Sammeln, kein Telemetrie-Upload). Modelle, die
// FalsifyMe via API nutzt, sehen nur das, was der Nutzer selbst einreicht
// (Nutzerentscheidung). Der Scope-HEADER (User-Input 1:1) ist der Drift-Anker.
//
// Dieses Modul stellt Verbindung + Schema + Meta bereit. Die fachlichen
// Zugriffe sind granular aufgeteilt:
//   artifacts/scopes.mjs  → Scope + Artefakt + Findings
//   artifacts/jobs.mjs    → Jobs/Queue/Claim + Worker-Registrierung
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = "5";

// ── FALSIFY_HOME auflösen / anlegen ─────────────────────────────────────────
export function falsifyHome() {
  if (process.env.FALSIFY_HOME && process.env.FALSIFY_HOME.trim()) {
    return path.resolve(process.env.FALSIFY_HOME.trim());
  }
  // Default: ~/.Falsify_Private (private Wissensdaten, getrennt vom Programm
  // ~/.Falsify_Core). FALSIFY_HOME bleibt als Override nutzbar (z. B. Tests,
  // Migration bestehender Installationen).
  return path.join(os.homedir(), ".Falsify_Private");
}

/** Legt FALSIFY_HOME an (inkl. logs/ und .env-Vorlage), falls er fehlt. */
export function ensureFalsifyHome() {
  const home = falsifyHome();
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(home, "logs"), { recursive: true });
  const envFile = path.join(home, ".env");
  if (!fs.existsSync(envFile)) {
    try {
      fs.writeFileSync(
        envFile,
        [
          "# FalsifyMe · API-Keys (lokal, ausserhalb des Repos)",
          "# Trage mindestens EINEN Key ein – Provider-neutral (OpenAI-kompatibel):",
          "#   NVIDIA NIM → NVIDIA_API_KEY · OpenAI → OPENAI_API_KEY · anderes → FALSIFY_API_KEY",
          "NVIDIA_API_KEY=",
          "OPENAI_API_KEY=",
          "FALSIFY_API_KEY=",
          "",
          "# Ziel/Modell überschreiben (alternativ ~/.Falsify_Private/config.json oder Env-Vars):",
          "# FALSIFY_API_BASE=https://integrate.api.nvidia.com/v1",
          "# FALSIFY_MODEL=nvidia/nemotron-3-ultra-550b-a55b",
          "",
        ].join("\n"),
        "utf8"
      );
    } catch { /* egal */ }
  }
  return home;
}

// ── DB öffnen (singleton pro Prozess) ────────────────────────────────────────
let _db = null;
export function openDb() {
  if (_db) return _db;
  const home = ensureFalsifyHome();
  const db = new DatabaseSync(path.join(home, "falsify.db"));
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA busy_timeout=10000;");
  migrate(db);
  _db = db;
  return db;
}

export function closeDb() {
  if (_db) { try { _db.close(); } catch { /* egal */ } _db = null; }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta(
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS scopes(
      id          TEXT PRIMARY KEY,
      header      TEXT NOT NULL,            -- User-Input 1:1 (HEADER, nie umformuliert)
      status      TEXT NOT NULL DEFAULT 'active',   -- active | hardened | done
      phase       TEXT NOT NULL DEFAULT 'plan',     -- plan | research | write
      last_befund TEXT,                             -- letzter vollständiger zusammenfassender Befund
      sub_prompt  TEXT,                             -- vom Modell aktualisierter Sub-Prompt (Fallback gegen Drift)
      open_conflicts INTEGER NOT NULL DEFAULT 0,    -- offene belastbare Widersprüche (PLAN/RESEARCH-Zyklen)
      hardened_at TEXT,                             -- Zeitpunkt der Härtung (letztes WRITE mit 0 offenen Konflikten)
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      done_at     TEXT
    );
    CREATE TABLE IF NOT EXISTS findings(
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_id   TEXT NOT NULL REFERENCES scopes(id),
      job_id     TEXT,
      round      INTEGER NOT NULL,          -- 1..n innerhalb des Scopes
      wave       TEXT,                      -- scan | plan | evil | replan (Etage 2: Wellen-Dimension)
      mode       TEXT,                      -- plan | research | write
      befund     TEXT,                      -- BEFUND-Zeile der Antwort
      content    TEXT,                      -- volle Antwort (Kritik/Ergebnis)
      verdict    TEXT,                      -- PLAN | RESEARCH | WRITE | ASK | ...
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_findings_scope ON findings(scope_id);
    CREATE TABLE IF NOT EXISTS jobs(
      id          TEXT PRIMARY KEY,
      scope_id    TEXT REFERENCES scopes(id),
      payload     TEXT,                     -- Iterations-Text (Plan / Recherche / Umsetzung)
      diff_text   TEXT,
      root        TEXT,
      files       TEXT,                     -- Whitelist (kommagetrennt)
      agent_intent TEXT,                    -- Etage 2: Agent-eigenes Verständnis der Aufgabe (NEU)
      affected    TEXT,                     -- Etage 2: betroffene Daten (kommagetrennt, optional)
      wave        TEXT NOT NULL DEFAULT 'scan', -- Etage 2: Wellen-Dimension (scan|plan|evil|replan)
      mode        TEXT,                     -- plan | research | write (bei Einreichung)
      status      TEXT NOT NULL DEFAULT 'QUEUED',   -- QUEUED | RUNNING | DONE <V> | ERROR
      verdict     TEXT,
      window_idx  INTEGER,
      error       TEXT,
      created_at  TEXT NOT NULL,
      started_at  TEXT,
      done_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_scope  ON jobs(scope_id);
  `);
  // Migration: Spalte sub_prompt bei bestehenden Datenbanken nachrüsten.
  try {
    db.exec("ALTER TABLE scopes ADD COLUMN sub_prompt TEXT");
  } catch { /* Spalte existiert bereits */ }
  // Migration: Spalte last_gap (GAP-Erfassung: offener Divergenz-Befund).
  try {
    db.exec("ALTER TABLE scopes ADD COLUMN last_gap TEXT");
  } catch { /* Spalte existiert bereits */ }
  // Migration: abort_requested (CLI-Abbruch für Queue-Jobs).
  try {
    db.exec("ALTER TABLE jobs ADD COLUMN abort_requested INTEGER DEFAULT 0");
  } catch { /* Spalte existiert bereits */ }

  // ── Etage 2 (Schema-Version 3): Intake-Felder, Wave-Dimension, Härtung ────
  // Bestehende Datenbanken bekommen die neuen Spalten per ALTER TABLE –
  // alles nullable bzw. mit Default, kein Datenumzug nötig.
  try {
    db.exec("ALTER TABLE jobs ADD COLUMN agent_intent TEXT");
  } catch { /* existiert */ }
  try {
    db.exec("ALTER TABLE jobs ADD COLUMN affected TEXT");
  } catch { /* existiert */ }
  try {
    db.exec("ALTER TABLE jobs ADD COLUMN wave TEXT NOT NULL DEFAULT 'scan'");
  } catch { /* existiert */ }
  try {
    db.exec("ALTER TABLE findings ADD COLUMN wave TEXT");
  } catch { /* existiert */ }
  try {
    db.exec("ALTER TABLE scopes ADD COLUMN open_conflicts INTEGER NOT NULL DEFAULT 0");
  } catch { /* existiert */ }
  try {
    db.exec("ALTER TABLE scopes ADD COLUMN hardened_at TEXT");
  } catch { /* existiert */ }

  // ── Schema-Version 4 (Loop-Anker): scopes.last_divergence ────────────────
  // Der Divergenz-Anker speichert den zuletzt deklarierten Unterschied
  // zwischen dem Umsetzungsvorschlag des CODERS (agent_intent) und dem des
  // Thinkers (## Umsetzungsverstaendnis). Null = konform/kein offener
  // Anker. Wird beim Review-Commit gesetzt/geleert (Ein-Wahrheit-Pfad).
  try {
    db.exec("ALTER TABLE scopes ADD COLUMN last_divergence TEXT");
  } catch { /* existiert */ }

  // ── Schema-Version 5 (UI-094): Whitelist-Nachforderung ───────────────────
  // RESEARCH kann Dateien konkret benennen, die der Thinker fuer die weitere
  // Falsifikation lesen will. Diese werden hier persistiert (kommagetrennt,
  // wie jobs.files) und beim naechsten Submit automatisch in die Whitelist
  // gemerged. WRITE leert die Liste. Null = keine offene Nachforderung.
  try {
    db.exec("ALTER TABLE scopes ADD COLUMN research_additions TEXT");
  } catch { /* existiert */ }

  setMeta(db, "schema_version", SCHEMA_VERSION);
}

// ── Meta (kleine Schlüssel/Wert-Daten) ───────────────────────────────────────
export function setMeta(db, key, value) {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}
export function getMeta(db, key) {
  const r = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return r ? r.value : null;
}

export function nowIso() { return new Date().toISOString(); }
export function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; }
}
