// FalsifyMe · cli/stats.mjs – `falsify stats` (Progression-Statistik)
// -----------------------------------------------------------------------------
// Zeigt den persistente User-Anker (Gesamtstatistik) – abgeleitet aus der
// EINZIGEN Persistenzquelle (SQLite-Queue, read-only). `--json` fuer
// Skripte/Agents. KEIN Schreiben.
// -----------------------------------------------------------------------------
import { openDb, closeDb } from "../artifacts/db.mjs";
import { collectStats, progressionStatement } from "../artifacts/stats.mjs";

const pad = (s, w) => String(s).padEnd(w);
const kv = (k, v) => `  ${pad(k, 10)}${v}`;
const fmtBytes = (b) => (b > 1024 ? `${(b / 1024).toFixed(0)} KB` : `${b} B`);
const n = (v) => Number(v) || 0;

export function runStats(args = []) {
  const json = args.includes("--json");
  const db = openDb();
  try {
    const s = collectStats(db);
    if (json) {
      console.log(JSON.stringify(s, null, 2));
      return;
    }
    const statuses = Object.entries(s.jobsByStatus)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ") || "–";
    const verdicts = ["WRITE", "PLAN", "RESEARCH", "ASK"]
      .map((k) => `${k} ${n(s.jobsByVerdict[k])}`)
      .join(" · ") + ` · UNBEKANNT ${n(s.unbekannt)}`;
    const waves = Object.entries(s.findingsByWave)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ") || "–";
    const scopes = Object.entries(s.scopesByStatus)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ") || "–";
    console.log("FALSIFYME · PROGRESSION – persistenter User-Anker (aus der SQLite-Queue abgeleitet)");
    console.log("──────────────────────────────────────────────────────────────");
    console.log("");
    console.log(`  ${progressionStatement(s)}`);
    console.log("");
    console.log(kv("JOBS", `${s.jobsTotal} gesamt · ${statuses}`));
    console.log(kv("VERDICTS", verdicts));
    console.log(kv("FINDINGS", `${s.findingsTotal} (${waves})`));
    console.log(kv("TASKS", `${s.scopesTotal} Scopes · ${scopes}`));
    console.log(kv("MODELL", `${s.modelCalls} nachweisbare Calls (Jobs mit Verdict + Evil-Twin-Findings)`));
    console.log(kv("SQLITE", `${fmtBytes(s.sqlite.bytes)} · ` +
      Object.entries(s.sqlite.rowsPerTable).map(([k, v]) => `${k} ${v}`).join(" · ")));
    console.log("");
    console.log("  Alles lokale Daten (FALSIFY_HOME) – kein Sammeln, kein Upload. `falsify stats --json` fuer Agents.");
  } finally {
    closeDb();
  }
}
