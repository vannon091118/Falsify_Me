// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/selfreview.test.mjs – Self-Review-Scope-Regel (UI-097)
// -----------------------------------------------------------------------------
// Regel (Nutzer-Vorgabe 2026-09-01): Self-Review darf keinen blinden Bereich
// erzeugen – bei erkannter Selbstprüfung liegen die Prüf-Kernkomponenten
// automatisch im Prüf-Scope. Getestet: Marker-Erkennung, Union + Existenz-
// Filter, Fremdprojekt bleibt unverändert, und der live-Submit-Pfad gegen
// eine isolierte FALSIFY_HOME (kein API-Call nötig – submit nur queued).
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { initAnchor } from "../core/identity.mjs";
import { bindAnchor } from "../artifacts/projects.mjs";
import { openDb, closeDb } from "../artifacts/db.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const savedHome = process.env.FALSIFY_HOME;

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

test("isSelfReviewRoot: nur echtes eigenes Checkout (alle Marker)", async () => {
  const sr = await mod("core/selfreview.mjs");
  assert.equal(sr.isSelfReviewRoot(ROOT), true, "eigenes Repo ist Selbstprüfung");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-sr-"));
  try {
    assert.equal(sr.isSelfReviewRoot(tmp), false, "leeres Verzeichnis ist keine Selbstprüfung");
    // Teil-Marker reichen nicht (z.B. zufällig gleiche Dateinamen):
    fs.mkdirSync(path.join(tmp, "artifacts"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "core"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "artifacts/db.mjs"), "x");
    fs.writeFileSync(path.join(tmp, "core/tools.mjs"), "x");
    assert.equal(sr.isSelfReviewRoot(tmp), false, "2 von 3 Markern reichen nicht");
    // erst mit dem dritten Marker wird es Selbstprüfung:
    fs.mkdirSync(path.join(tmp, "cli"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "cli/run.mjs"), "x");
    assert.equal(sr.isSelfReviewRoot(tmp), true, "alle 3 Marker = Selbstprüfung");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("ensureSelfReviewWhitelist: Union mit Kern (nur existierende Ergänzungen), added-Meldung, idempotent", async () => {
  const sr = await mod("core/selfreview.mjs");
  const r = sr.ensureSelfReviewWhitelist(ROOT, ["README.md", "custom.js"]);
  // Explizite --files bleiben ungefiltert (Existenzprüfung = feasibility);
  // die Kern-ERGÄNZUNG filtert nach Existenz.
  assert.ok(r.files.includes("custom.js"), "explizite Liste bleibt unangetastet");
  for (const core of ["core/tools.mjs", "artifacts/jobs.mjs", "cli/run.mjs", "ui/worker.mjs", "WIRING.md"]) {
    assert.ok(r.files.includes(core), `Kern ergänzt: ${core}`);
  }
  assert.ok(r.added.includes("core/tools.mjs"), "added listet Ergänzungen (für ehrliche Ausgabe)");
  assert.ok(!r.added.includes("README.md"), "explicit vorhandenes wird nicht als added gemeldet");
  // Idempotenz: nochmal anwenden -> keine neuen Einträge.
  const r2 = sr.ensureSelfReviewWhitelist(ROOT, r.files);
  assert.deepEqual(r2.added, [], "zweiter Durchlauf ergänzt nichts");
  assert.deepEqual(r2.files, r.files);
});

test("Kein blinder Bereich (Regel 1): der PRÜFMECHANISMUS selbst liegt im Self-Review-Scope", async () => {
  const sr = await mod("core/selfreview.mjs");
  const r = sr.ensureSelfReviewWhitelist(ROOT, ["README.md"]);
  // Gerade die Gate- und Regel-Komponenten dürfen nicht unsichtbar bleiben:
  for (const check of [
    "core/twin.mjs",                         // Evil-Twin-Gegenprüfung (Regel 6)
    "core/prompt-text/system-de.md",         // Prüf-Regeln als Daten (DE/EN)
    "core/prompt-text/system-en.md",
    "core/prompt-text/system-eviltwin-de.md",
    "core/prompt-text/system-eviltwin-en.md",
  ]) {
    assert.ok(r.files.includes(check), `Prüfmechanismus im Scope: ${check}`);
  }
  // Und die Whitelist-Semantik muss den Zugriff tatsächlich gewähren:
  const { makeTools } = await mod("core/tools.mjs");
  const api = makeTools(ROOT, r.files);
  assert.match(api.execTool("read_file", { path: "core/twin.mjs" }), /runTwinCheck/);
  assert.match(
    api.execTool("read_file", { path: "core/prompt-text/system-eviltwin-de.md" }),
    /Evil Twin/
  );
});

test("ensureSelfReviewWhitelist: Fremdprojekt bleibt unverändert (nie Zugriffserweiterung)", async () => {
  const sr = await mod("core/selfreview.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-sr-"));
  try {
    fs.writeFileSync(path.join(tmp, "app.js"), "x");
    const r = sr.ensureSelfReviewWhitelist(tmp, ["app.js"]);
    assert.deepEqual(r.files, ["app.js"]);
    assert.deepEqual(r.added, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("Live-Submit-Smoke: --files nur WIRING.md -> Job-Whitelist enthält den Kern (isolierte Home)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-sr-sub-"));
  process.env.FALSIFY_HOME = home;
  const anchor = initAnchor(ROOT);
  assert.equal(anchor.ok, true, anchor.message);
  const identityDb = openDb();
  bindAnchor(identityDb, anchor, ROOT);
  closeDb();
  try {
    const plan = path.join(home, "plan.txt");
    fs.writeFileSync(plan, "Prüfe das Repo gegen den Vertrag.");
    const res = spawnSync(process.execPath, [
      path.join(ROOT, "cli/run.mjs"),
      "--submit", "--root", ROOT, "--files", "WIRING.md",
      "--plan-file", plan,
    ], { encoding: "utf8", cwd: ROOT });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Selbstprüfung erkannt/, "ehrliche Meldung beim Submit");
    const id = (res.stdout.match(/JOB_ID=(job-[0-9]+-[a-z0-9]+)/) || [])[1];
    assert.ok(id, "Job-ID vorhanden");
    // Whitelist in der DB nachsehen:
    const db = new DatabaseSync(path.join(home, "falsify.db"));
    const files = db.prepare("SELECT files FROM jobs WHERE id = ?").get(id).files;
    db.close();
    assert.ok(files.includes("core/tools.mjs"), "Kern in Job-Whitelist gespeichert");
    assert.ok(files.includes("artifacts/jobs.mjs"));
    assert.ok(!/[,\s]custom\.js/.test(files), "keine Fantasiepfade");
  } finally {
    try { fs.rmSync(path.join(ROOT, "FalsifyME.md"), { force: true }); } catch { /* test cleanup */ }
    process.env.FALSIFY_HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});