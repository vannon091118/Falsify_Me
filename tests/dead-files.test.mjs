// FalsifyMe · tests/dead-files.test.mjs – tote Dateien im ganzen Repo verhindern
// -----------------------------------------------------------------------------
// ARCHITEKTUR-VERTRAG (Befund 2026-09-03, erweitert 2026-09-04 auf den ganzen
// Baum): Keine *.mjs/*.ts-Datei im Repo darf Scaffolding sein — eine Datei,
// die von keinem Modul importiert UND von keinem Test eingebunden ist, rostet
// still und kann (wie AAADashboardView.mjs: Import von nicht existierendem
// TuiBox.mjs) kaputte Referenzen tragen, ohne dass irgendein Test sie berührt.
//
// WAS ZÄHLT ALS EINGEBUNDEN?
//   1. Import-Specifier (from "…", import "…", import(…)) — aufgelöst gegen
//      das Quellverzeichnis, kommentar-bereinigt.
//   2. Pfad-/Basisname-String in EINER ANDEREN Code-Datei (.mjs/.ts/.sh/.cmd/
//      .ps1/.json) — deckt Einstiegspunkte ab, die nie importiert werden:
//      `node ui/worker.mjs` in .cmd/.sh/.ps1, package.json-Scripts ("falsify":
//      "cli/falsify.mjs", "install:user": "node install.mjs"), Fixtures, die
//      Tests per fileURLToPath spawnen (demo-agent.mjs, stream-agent-fixture.mjs),
//      und dynamische Ladepfade wie mod("core/protocols.mjs"). Kommentare
//      werden entfernt — eine Erwähnung im Doku-Kommentar zählt NICHT.
//   3. Testdateien (*.test.mjs/*.test.ts) sind per Vertrag eingebunden: der
//      Test-Runner findet sie über Globs (node --test tests/*.test.mjs
//      doki/tests/*.test.mjs ui/tui/*.test.mjs ui/tui.test.mjs …) — sie sind
//      die Tests selbst, kein toter Code.
//   4. Dokumentierte Relikte in DEAD_ALLOWED (WHY-Pflicht): Dateien, die
//      BEWUSST nicht verdrahtet sind. Ein Eintrag dort darf nur existieren,
//      solange die Datei wirklich unreferenziert ist — eine wieder
//      referenzierte Datei macht die Allowlist stale (Selbstzertifizierung).
//
// Nicht-vakuös (Selbstzertifizierung): bekannte Importe UND Einstiegspunkte
// MÜSSEN gefunden werden (Scan nicht blind); eine absichtlich unimportierte
// Fixture-Datei MUSS gemeldet werden; DEAD_ALLOWED muss exakt den aktuell
// toten Dateien entsprechen (weder übersehene Tote noch stale Einträge).
// -----------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, "/");

/**
 * Dokumentierte, bewusst unverdrahtete Relikte: Datei -> WHY (Pflicht).
 * Nur Dateien, die aktuell toten Code enthalten, gehören hierher — der
 * Statik-Test 1 verlangt exakte Gleichheit (keine stale Einträge, keine
 * übersehenen Toten).
 */
const DEAD_ALLOWED = new Map([
  [
    "doki/src/qlearning.mjs",
    "Bewusstes Relikt seit MIRROR_V1-Etude (2026-09-03): der reine DOKI-Kern " +
      "(signals/atled/ylamona/blocks/etats) ersetzt den Q-Learning-Pfad; " +
      "q_table bleibt als Relikt-Tabelle (doki/tests/etats.test.mjs:142 sichert " +
      "sogar ab, dass KEIN Kern-Modul qlearning/q_table referenziert).",
  ],
]);

/** Endungen, die einen Einstiegspunkt per Pfad-String einbinden können. */
const CODE_EXT = /\.(mjs|ts|sh|cmd|ps1|json)$/;
const TEST_FILE = /\.(test|spec)\.(mjs|ts)$/;

/** Alle *.mjs/*.ts unter root (ohne node_modules/.git), absolute Pfade. */
function moduleFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      // Runtime-/Tool-Verzeichnisse (gitignored: .git, .freebuff-Worktrees,
      // .planning) und Abhängigkeiten nie mitzählen.
      if (name.startsWith(".") || name === "node_modules") continue;
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".mjs") || name.endsWith(".ts")) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Alle Code-Dateien (inkl. .sh/.cmd/.ps1/.json), die referenzieren können. */
function codeFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      // Runtime-/Tool-Verzeichnisse (gitignored: .git, .freebuff-Worktrees,
      // .planning) und Abhängigkeiten nie mitzählen.
      if (name.startsWith(".") || name === "node_modules") continue;
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (CODE_EXT.test(name)) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Entfernt NUR Kommentare — String-Literale (Import-/Pfad-Referenzen) bleiben. */
function stripCommentsOnly(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Import-Specifier aus Quelltext: from "…", import "…", import(…). */
function importSpecifiers(src) {
  const out = [];
  const re = /(?:from\s+|import\s*\(\s*|import\s+)(["'])([^"']+)\1/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[2]);
  return out;
}

/** Menge aller Repo-relativen Pfade, die per Import referenziert werden. */
function referencedModules(root) {
  const refs = new Set();
  for (const file of moduleFiles(root)) {
    const src = stripCommentsOnly(fs.readFileSync(file, "utf8"));
    for (const spec of importSpecifiers(src)) {
      if (!spec.startsWith(".") || !spec.endsWith(".mjs")) continue;
      const resolved = path.resolve(path.dirname(file), spec);
      const rel = path.relative(root, resolved).replace(/\\/g, "/");
      refs.add(rel);
    }
  }
  return refs;
}

/**
 * Tote Dateien: *.mjs/*.ts, die weder per Import noch per Pfad-/Basisname-
 * String in einer anderen Code-Datei referenziert werden, keine Testdatei
 * und nicht in DEAD_ALLOWED sind. Repo-relativ, sortiert (deterministisch).
 */
function deadFiles(root, allowed, selfRel = null) {
  const refs = referencedModules(root);
  const code = codeFiles(root).map((f) => ({
    rel: path.relative(root, f).replace(/\\/g, "/"),
    src: stripCommentsOnly(fs.readFileSync(f, "utf8")),
  }));
  const out = [];
  for (const file of moduleFiles(root)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    if (TEST_FILE.test(rel)) continue; // Testdateien: Runner bindet sie ein
    if (refs.has(rel)) continue; // 1) Import-Referenz
    const base = path.basename(rel);
    // 2) Pfad-/Basisname-String (Einstiegspunkte, Fixtures, Spawns). Die
    //    eigene Testdatei (selfRel) zaehlt NICHT als Referenzgeber — sonst
    //    wuerde die DEAD_ALLOWED-Erwaehnung hier den Relikt-Eintrag selbst
    //    als "eingebunden" maskieren (Selbstzertifizierung wuerde luegen).
    const byString = code.some(
      ({ rel: cRel, src }) => cRel !== rel && cRel !== selfRel && (src.includes(rel) || src.includes(base))
    );
    if (byString) continue;
    if (allowed.has(rel)) continue; // 3) dokumentiertes Relikt (WHY-Pflicht)
    out.push(rel);
  }
  return out.sort();
}

// ── Test 1: kein toter Code im ganzen Repo (außer dokumentierten Relikten) ──
test("STATISCH: keine toten *.mjs/*.ts-Dateien im Repo (unimportiert, ungetestet, nicht-Relikt)", () => {
  const dead = deadFiles(ROOT, DEAD_ALLOWED, SELF);
  assert.deepEqual(
    dead,
    [],
    "Tote Dateien gefunden (weder importiert noch per Pfad-String eingebunden, keine Testdatei, kein dokumentiertes Relikt). Jede Datei braucht einen Import, eine Einstiegs-Referenz oder einen DEAD_ALLOWED-Eintrag mit WHY."
  );
});

// ── Test 2: DEAD_ALLOWED ist nicht stale und nicht unvollständig ────────────
test("STATISCH: DEAD_ALLOWED entspricht exakt den aktuell unreferenzierten Nicht-Test-Dateien", () => {
  // Ohne die Allowlist: was wäre ohne die Relikte toter Code?
  const deadWithoutAllow = deadFiles(ROOT, new Map(), SELF);
  assert.deepEqual(
    [...DEAD_ALLOWED.keys()].sort(),
    deadWithoutAllow,
    "Allowlist-Drift: Einträge müssen exakt den aktuell toten Dateien entsprechen — " +
      "eine wieder referenzierte Datei gehört NICHT mehr hierher (stale), " +
      "eine übersehene tote Datei MUSS hierher (WHY-Pflicht)."
  );
});

// ── Test 3: bekannte Referenzwege werden gefunden (Scan nicht blind) ────────
test("SELBSTZERTIFIZIERUNG: bekannte Importe + Einstiegspunkte werden gefunden", () => {
  const refs = referencedModules(ROOT);
  // Verdrahteter Kern (Import-Referenzen): App von tui.mjs, SlotsView/ReasoningView
  // von App, ParticlesView/panelBody von SlotsView, ProgressBar/FindingsPanel von
  // ReasoningView, EvilTwinView von App + evil-twin-view.test.mjs.
  for (const expect of [
    "ui/tui/views/App.mjs",
    "ui/tui/views/SlotsView.mjs",
    "ui/tui/views/ParticlesView.mjs",
    "ui/tui/views/panelBody.mjs",
    "ui/tui/views/ReasoningView.mjs",
    "ui/tui/views/ProgressBar.mjs",
    "ui/tui/views/FindingsPanel.mjs",
    "ui/tui/views/EvilTwinView.mjs",
  ]) {
    assert.ok(refs.has(expect), `${expect} muss als Import erkannt werden`);
  }

  // Einstiegspunkte, die NIE importiert werden, aber per Pfad-String in
  // Code-Dateien eingebunden sind (node-Aufrufe, Spawns, package.json).
  // Müssen vom String-Scan als "eingebunden" erkannt werden (nicht tot).
  const allowed = DEAD_ALLOWED;
  for (const entry of [
    "install.mjs", // package.json "install:user" + FalsifyMe-Setup.cmd
    "uninstall.mjs", // package.json "uninstall:user" + FalsifyMe-Deinstall.cmd
    "cli/falsify.mjs", // package.json bin "falsify"
    "cli/main.mjs", // cli/falsify.sh: node "$V2_DIR/cli/main.mjs" …
    "cli/run.mjs", // cli/falsify.sh: node "$V2_DIR/cli/run.mjs"
    "doki/src/cli.mjs", // doki/package.json start: node src/cli.mjs
    "ui/worker.mjs", // dock-runner.ps1, falsify.sh, skills agent-skill-falsify
    "ui/tui-demo.mjs", // ui/START-TUI.cmd, ui/TEST-TUI.cmd
    "ui/demo-agent.mjs", // tui.test.mjs/tui-demo.mjs: fileURLToPath(new URL(...))
    "tests/stream-agent-fixture.mjs", // agent-stream-output.test.mjs: spawn
    "core/protocols.mjs", // Tests: mod("core/protocols.mjs") (dynamischer Ladepfad)
    "skills/agent-skill-falsify.mjs", // config.json usage + core/skill-version.mjs
  ]) {
    assert.ok(
      !deadFiles(ROOT, allowed, SELF).includes(entry),
      `${entry} ist ein Einstiegspunkt und darf NICHT als tote Datei gemeldet werden`
    );
  }
});

// ── Test 4: unimportierte Fixture wird gemeldet (nicht-vakuös) ───────────────
test("SELBSTZERTIFIZIERUNG: unimportierte Fixture-Datei wird gemeldet (nicht-vakuös)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-dead-"));
  try {
    fs.mkdirSync(path.join(root, "ui", "tui", "views"), { recursive: true });
    fs.mkdirSync(path.join(root, "ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "ui", "tui.mjs"), 'import Used from "./tui/views/Used.mjs";\n');
    fs.writeFileSync(path.join(root, "ui", "tui", "views", "Used.mjs"), "export default 1;\n");
    fs.writeFileSync(path.join(root, "ui", "tui", "views", "Orphan.mjs"), "export default 2;\n");
    // Einstiegspunkt-Fallback: per Pfad-String in einer .cmd referenziert, nie importiert.
    fs.writeFileSync(path.join(root, "ui", "tui", "views", "Entry.mjs"), "export default 3;\n");
    fs.writeFileSync(path.join(root, "start.cmd"), "@echo off\nnode ui/tui.mjs\nnode ui/tui/views/Entry.mjs\n");
    const dead = deadFiles(root, new Map());
    assert.deepEqual(dead, ["ui/tui/views/Orphan.mjs"], "nur die nie referenzierte Datei ist tot");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});