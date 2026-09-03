// FalsifyMe · tests/dead-views.test.mjs – tote Views verhindern
// -----------------------------------------------------------------------------
// ARCHITEKTUR-VERTRAG (Befund 2026-09-03): ui/tui/views/ darf keine Datei
// enthalten, die von keinem anderen Modul importiert wird. Eine nie importierte
// View ist Scaffolding: sie rostet still, wird nie gerendert, nie getestet und
// kann (wie AAADashboardView.mjs: Import von nicht existierendem TuiBox.mjs)
// sogar kaputte Referenzen tragen, ohne dass irgendein Test sie berührt.
//
// Mechanik (statisch, kein Modell, keine DB):
//   1. Alle *.mjs-Dateien des Repos (ohne node_modules/.git) einsammeln.
//   2. Aus jeder Datei die Import-Specifier extrahieren (from "…", import "…",
//      import(…)) — Kommentare werden VORHER entfernt, damit eine Erwähnung
//      im Doku-Kommentar keine Referenz vortäuscht.
//   3. Relative Specifier (.mjs) gegen das Verzeichnis der Quelldatei auflösen
//      → Menge aller tatsächlich referenzierten Modul-Pfade (Repo-relativ).
//   4. Jede Datei in ui/tui/views/ (außer *.test.mjs — Testdateien werden nie
//      importiert, das ist ihr Vertrag) MUSS in dieser Menge stehen.
// Testdateien ZÄHLEN als Referenzgeber (eine View, die nur ein Test importiert,
// ist nicht tot) — der Scan läuft über den GANZEN Baum inkl. tests/.
//
// Nicht-vakuös (Selbstzertifizierung): der Mechanismus muss die bekannten
// View-Importe finden UND eine absichtlich unimportierte Fixture-View melden.
// Eine umbenannte/gelöschte View bricht Test 1; ein blinder Scan bricht Test 3.
// -----------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Alle *.mjs-Dateien unter root (ohne node_modules/.git), absolute Pfade. */
function mjsFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === ".git" || name === "node_modules") continue;
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".mjs")) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Entfernt NUR Kommentare — String-Literale (die Import-Specifier) bleiben. */
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

/** Menge aller Repo-relativen Pfade, die von irgendeinem Modul importiert werden. */
function referencedModules(root) {
  const refs = new Set();
  for (const file of mjsFiles(root)) {
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
 * Tote Views: Dateien in ui/tui/views/ (ohne *.test.mjs), die von keinem
 * Modul importiert werden. Repo-relative Pfade, sortiert (deterministisch).
 */
function deadViews(root) {
  const viewsDir = path.join(root, "ui", "tui", "views");
  if (!fs.existsSync(viewsDir)) return [];
  const views = fs
    .readdirSync(viewsDir)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .map((f) => `ui/tui/views/${f}`);
  const refs = referencedModules(root);
  return views.filter((v) => !refs.has(v)).sort();
}

test("STATISCH: keine toten Views in ui/tui/views/ (nie importierte Dateien)", () => {
  const dead = deadViews(ROOT);
  assert.deepEqual(
    dead,
    [],
    "Tote Views gefunden (nie importiert): jede Datei in ui/tui/views/ muss von mindestens einem Modul importiert werden."
  );
});

test("SELBSTZERTIFIZIERUNG: bekannte View-Importe werden gefunden (Scan nicht blind)", () => {
  const refs = referencedModules(ROOT);
  // Verdrahteter Kern: App von tui.mjs, SlotsView/ReasoningView von App,
  // ParticlesView/panelBody von SlotsView, ProgressBar/FindingsPanel von
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
    assert.ok(refs.has(expect), `${expect} muss als importiert erkannt werden`);
  }
});

test("SELBSTZERTIFIZIERUNG: unimportierte Fixture-View wird gemeldet (nicht-vakuös)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-views-"));
  try {
    fs.mkdirSync(path.join(root, "ui", "tui", "views"), { recursive: true });
    fs.mkdirSync(path.join(root, "ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "ui", "tui.mjs"), 'import Used from "./tui/views/Used.mjs";\n');
    fs.writeFileSync(path.join(root, "ui", "tui", "views", "Used.mjs"), "export default 1;\n");
    fs.writeFileSync(path.join(root, "ui", "tui", "views", "Orphan.mjs"), "export default 2;\n");
    const dead = deadViews(root);
    assert.deepEqual(dead, ["ui/tui/views/Orphan.mjs"], "nur die nie importierte View ist tot");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});