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
  } catch (e) {
    bad(`Config: ${e.message}`);
  }

  // 3) API-Key
  try {
    const { loadApiKey, keyEnvFile } = await import("../core/keys.mjs");
    const key = loadApiKey();
    if (key) ok(`API-Key gefunden (${keyEnvFile()})`);
    else bad(`Kein API-Key (${keyEnvFile()})`);
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
