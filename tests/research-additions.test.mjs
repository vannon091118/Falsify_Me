// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/research-additions.test.mjs – Dynamische Whitelist-
// Nachforderung (UI-094)
// -----------------------------------------------------------------------------
// Deckt ab: extractResearchAdditions (Extraktion aus RESEARCH-Antworten,
// Security-Filter gegen Traversal/Absolut/Drive/URL/Fantasie, Cap, Root-
// Existenz-Filter), Persistenz (RESEARCH setzt research_additions, WRITE
// leert) und den Submit-Merge (nachgeforderte Dateien ergaenzen die
// Whitelist automatisch vor dem --files-Check).
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const savedHome = process.env.FALSIFY_HOME;

function withTempHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-radd-"));
  process.env.FALSIFY_HOME = tmp;
  return {
    tmp,
    cleanup() {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      if (savedHome === undefined) delete process.env.FALSIFY_HOME;
      else process.env.FALSIFY_HOME = savedHome;
    },
  };
}

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

test("extractResearchAdditions: parst konkrete Datei-Referenzen aus RESEARCH-Antwort", async () => {
  const { extractResearchAdditions } = await mod("core/verdict.mjs");
  const content = [
    "BEFUND: Ich brauche Zugriff auf core/tools.mjs und artifacts/jobs.mjs, um die Transaktionen zu pruefen.",
    "Auch 'tests/security.test.mjs' und uninstall.mjs sind noetig; core/verdict.mjs:23 waere hilfreich.",
    "VERDICT: RESEARCH",
  ].join("\n");
  const out = extractResearchAdditions(content);
  // Datei:Zeile-Referenzen werden als DATEI (ohne Zeilennummer) extrahiert —
  // der Thinker will die Datei lesen, nicht nur die Zeile.
  assert.deepEqual(new Set(out), new Set(["core/tools.mjs", "artifacts/jobs.mjs", "tests/security.test.mjs", "uninstall.mjs", "core/verdict.mjs"]));
  assert.ok(out.includes("core/verdict.mjs"), "Datei aus Datei:Zeile wird extrahiert");
  assert.ok(!out.some((f) => f.includes(":")), "keine Zeilennummer in den Nachforderungen");

  // Dedupe
  const dup = extractResearchAdditions("BEFUND: core/tools.mjs und core/tools.mjs fehlen");
  assert.deepEqual(dup, ["core/tools.mjs"]);
});

test("extractResearchAdditions: Security-Filter blockt Traversal/Absolut/Drive/URL/Fantasie", async () => {
  const { extractResearchAdditions } = await mod("core/verdict.mjs");
  const content = [
    "BEFUND: ../escape.js, /tmp/evil.js, C:\\x\\y.js, C:/windows/system32/drv.js,",
    "https://example.com/x.js, keinZugriff, plan.md und sicher.txt fehlen.",
    "VERDICT: RESEARCH",
  ].join("\n");
  const out = extractResearchAdditions(content);
  assert.deepEqual(out, ["plan.md", "sicher.txt"]);
});

test("extractResearchAdditions: Cap begrenzt (Default 20, max ueberschreibbar)", async () => {
  const { extractResearchAdditions } = await mod("core/verdict.mjs");
  const many = Array.from({ length: 30 }, (_, i) => `mod${i}/file${i}.js`).join(", ");
  const c = `BEFUND: fehlt: ${many}`;
  assert.equal(extractResearchAdditions(c).length, 20);
  assert.equal(extractResearchAdditions(c, { max: 5 }).length, 5);
});

test("extractResearchAdditions: Root-Filter - nur real existierende Dateien", async () => {
  const { extractResearchAdditions } = await mod("core/verdict.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-radd-root-"));
  try {
    fs.mkdirSync(path.join(tmp, "core"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "core", "tools.mjs"), "export const x = 1;\n");
    const c = "BEFUND: fehlt core/tools.mjs und ghost.js";
    // Ohne root: beide Pfad-Formen zaehlen (Existenz ist Sache des Aufrufers).
    assert.deepEqual(new Set(extractResearchAdditions(c)), new Set(["core/tools.mjs", "ghost.js"]));
    // Mit root: nur die existierende Datei.
    assert.deepEqual(extractResearchAdditions(c, { root: tmp }), ["core/tools.mjs"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("Persistenz: RESEARCH setzt research_additions, WRITE leert sie", async () => {
  const h = withTempHome();
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, getScope, updateScopeAfterReview } = await mod("artifacts/scopes.mjs");
    const db = openDb();
    const s = createScope(db, "Task");
    assert.equal(getScope(db, s.id).research_additions, null);

    updateScopeAfterReview(db, s.id, "RESEARCH", "Daten fehlen", "sub", undefined, ["core/tools.mjs", "uninstall.mjs"]);
    assert.equal(getScope(db, s.id).research_additions, "core/tools.mjs,uninstall.mjs");

    // Leere Nachforderung -> null (kein leerer String im Zustand)
    updateScopeAfterReview(db, s.id, "RESEARCH", "Daten fehlen", "sub", undefined, []);
    assert.equal(getScope(db, s.id).research_additions, null);

    updateScopeAfterReview(db, s.id, "RESEARCH", "Daten fehlen", "sub", undefined, ["a.js"]);
    assert.equal(getScope(db, s.id).research_additions, "a.js");

    // WRITE leert die offene Nachforderung (Scope gilt als bedient).
    updateScopeAfterReview(db, s.id, "WRITE", "Alles gut", "sub", undefined, null);
    assert.equal(getScope(db, s.id).research_additions, null);
    closeDb();
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});

test("Submit-Merge: RESEARCH-Nachforderung ergaenzt die Whitelist automatisch", async () => {
  const h = withTempHome();
  try {
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, updateScopeAfterReview } = await mod("artifacts/scopes.mjs");
    const db = openDb();

    // Fremdes Ziel-Projekt mit einer realen, aber nicht genannten Datei.
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-radd-proj-"));
    fs.mkdirSync(path.join(proj, "core"), { recursive: true });
    fs.writeFileSync(path.join(proj, "core", "tools.mjs"), "export const x = 1;\n");

    const s = createScope(db, "Task");
    updateScopeAfterReview(db, s.id, "RESEARCH", "Ich brauche core/tools.mjs", "sub", undefined, ["core/tools.mjs", "ghost.mjs"]);

    const planFile = path.join(h.tmp, "plan.txt");
    fs.writeFileSync(planFile, "Plan-Text der naechsten Iteration");
    closeDb(); // Kindprozess oeffnet die DB selbst

    const child = spawn(process.execPath, [
      path.join(ROOT, "cli", "run.mjs"),
      "--submit", "--scope", s.id, "--plan-file", planFile, "--root", proj,
      "--files", "core/tools.mjs",
    ], { cwd: ROOT, env: { ...process.env, FALSIFY_HOME: h.tmp }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    const code = await new Promise((res) => child.on("close", res));
    assert.equal(code, 0, `Submit mit explizitem --files besteht dank Nachforderung:\n${out}`);
    assert.match(out, /Dateien \(Whitelist\): .*core\/tools\.mjs/, "explizite Datei bleibt in der Whitelist");
    assert.match(out, /1 nachgeforderte Datei\(en\) existieren nicht/, "ghost.mjs wird ehrlich uebersprungen");

    const db2 = openDb();
    const jobs = db2.prepare("SELECT files FROM jobs ORDER BY created_at DESC LIMIT 1").get();
    assert.ok(jobs.files.split(",").includes("core/tools.mjs"), "nachgeforderte Datei ist in der Whitelist des Jobs");
    assert.ok(!jobs.files.split(",").includes("ghost.mjs"), "Fantasie-Pfad ist NICHT in der Whitelist");
    closeDb();
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});
