// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/handoff-report.test.mjs – `falsify handoff report` (UI-137)
// -----------------------------------------------------------------------------
// Beweist die echte Oberfläche des Report-Generators: FalsifyMe misst den
// Repo-Zustand selbst (vorher konnte nur der externe Agent die Digests von
// Hand nachbauen — der Loop hing am Rückweg von WRITE_AUTHORIZED). Der
// generierte Report besteht den UNVERÄNDERTEN validateChangeReport-Gate und
// `falsify handoff complete` erzeugt daraus das echte Re-Review-Child.
// Negativ: ein nach der Generierung erneut geänderter Repo-Zustand wird
// fail-closed abgelehnt (kein Fake-Report, kein Child).
//
// Kein Gate-Mock: der WRITE_AUTHORIZED-Fixture-Zustand wird über die ECHTEN
// Pipeline-Funktionen aufgebaut (createJob → buildHandoff →
// markWriteAuthorized); nur die CLI-Spawn-Aufrufe kommen über die echte
// main.mjs-Oberfläche (Muster: tests/full-loop-e2e.test.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

function runCli({ home, args }) {
  const child = spawn(process.execPath, [path.join(ROOT, "cli", "main.mjs"), ...args], {
    cwd: ROOT,
    env: { ...process.env, FALSIFY_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { out += c; });
  return { outP: new Promise((res) => child.stdout.on("close", () => res(out))), doneP: new Promise((res) => child.on("close", res)) };
}

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-hr-proj-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "app.js"), "export function add(a, b) {\n  return a + b;\n}\n");
  return dir;
}

// Baut einen WRITE_AUTHORIZED-Job mit persistiertem v1-Handoff über die
// ECHTEN Pipeline-Funktionen. Returned: IDs + Basis-Digest des Fixtures.
async function setupAuthorizedJob({ home, project, header }) {
  process.env.FALSIFY_HOME = home;
  const { openDb, closeDb } = await mod("artifacts/db.mjs");
  const identity = await mod("core/identity.mjs");
  const projects = await mod("artifacts/projects.mjs");
  const scopes = await mod("artifacts/scopes.mjs");
  const { createJob } = await mod("artifacts/jobs.mjs");
  const { buildHandoff, serializeHandoff } = await mod("core/handoff.mjs");
  const { markWriteAuthorized } = await mod("artifacts/loopflow.mjs");
  const { snapshotRoot } = await mod("core/changes.mjs");

  const anchor = identity.initAnchor(project);
  assert.equal(anchor.ok, true, anchor.message);
  const idDb = openDb();
  projects.bindAnchor(idDb, anchor, project);
  closeDb();

  const db = openDb();
  const scope = scopes.createScope(db, header, { checkoutId: anchor.value.checkoutId });
  const before = snapshotRoot(project, ["src/app.js"]);
  const jobId = createJob(db, {
    checkoutId: anchor.value.checkoutId,
    scopeId: scope.id,
    payload: "WRITE-Lauf (Fixture, UI-137)",
    root: project,
    files: "src/app.js",
    mode: "write",
  });
  const handoff = buildHandoff({
    jobId,
    scopeId: scope.id,
    checkoutId: anchor.value.checkoutId,
    iterationId: "iter-1",
    verdict: "WRITE",
    phase: "write",
    reasons: ["Fixture-Befund: Anforderung ist adressiert."],
    probeResults: [
      { probe_id: "P1", requirement_ref: "H1", status: "BESTAETIGT", evidenceOk: true, reason: "Eigene Gegenprobe: add summiert direkt (src/app.js:2)." },
    ],
    twinEvidence: { tool_rounds: 1, file_refs: ["src/app.js"] },
    beforeSnapshot: before,
    allowedFiles: ["src/app.js"],
  });
  fs.mkdirSync(path.join(home, "logs"), { recursive: true });
  fs.writeFileSync(path.join(home, "logs", `handoff-${jobId}.json`), serializeHandoff(handoff), "utf8");
  const wa = markWriteAuthorized(db, jobId, { handoffId: handoff.handoff_id, changeDigest: before.digest, scopeId: scope.id });
  assert.equal(wa.ok, true, wa.reason);
  db.prepare("UPDATE jobs SET change_digest = ? WHERE id = ?").run(before.digest, jobId);
  closeDb();
  return { jobId, scopeId: scope.id, checkoutId: anchor.value.checkoutId, handoffId: handoff.handoff_id, beforeDigest: before.digest };
}

const APP_WITH_CLIP = "export function add(a, b) {\n  return a + b;\n}\n\nexport function clip(v, max) {\n  if (v > max) return max;\n  return v;\n}\n";

test("handoff report: generiert einen validen Write-Report → complete erzeugt das echte Re-Review-Child", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-hr-home-"));
  const project = tempProject();
  try {
    const { jobId, scopeId, checkoutId, handoffId, beforeDigest } = await setupAuthorizedJob({
      home: tmp,
      project,
      header: "Die Funktion add addiert zwei Zahlen.",
    });

    // Externer Writer (einziger Repository-Writer) setzt die freigegebene
    // Änderung um — der Report wird NICHT von Hand gebaut, sondern generiert.
    fs.writeFileSync(path.join(project, "src", "app.js"), APP_WITH_CLIP);

    const reportFile = path.join(tmp, "report.json");
    const gen = runCli({ home: tmp, args: ["handoff", "report", "--job-id", jobId, "--root", project, "--out", reportFile, "--writer-id", "fake-external-agent"] });
    const genOut = await gen.outP;
    const genCode = await gen.doneP;
    assert.equal(genCode, 0, `handoff report muss Exit 0 sein.\n=== AUSGABE ===\n${genOut}`);
    assert.match(genOut, /HANDOFF_REPORT=/);
    assert.match(genOut, /src\/app\.js/, "geänderte Datei wird ehrlich benannt");

    const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    assert.equal(report.handoff_id, handoffId);
    assert.equal(report.job_id, jobId);
    assert.equal(report.scope_id, scopeId);
    assert.equal(report.checkout_id, checkoutId);
    assert.equal(report.writer_id, "fake-external-agent");
    assert.equal(report.write_status, "COMPLETED");
    assert.equal(report.before_digest, beforeDigest);
    assert.deepEqual(report.changed_files, ["src/app.js"]);
    // Die Digests sind messbare Wahrheit: exakt die Werte von compareSnapshots
    // gegen den echten Handoff-Before-Snapshot (kein erfundener Hash).
    const { snapshotRoot, compareSnapshots, validateChangeReport } = await mod("core/changes.mjs");
    const handoff = JSON.parse(fs.readFileSync(path.join(tmp, "logs", `handoff-${jobId}.json`), "utf8"));
    const after = snapshotRoot(project, ["src/app.js"]);
    const comparison = compareSnapshots(handoff.before_snapshot, after, { allowedFiles: ["src/app.js"] });
    assert.equal(report.after_digest, comparison.after_digest);
    assert.equal(report.diff_digest, comparison.diff_digest);
    // Der generierte Report besteht den UNVERÄNDERTEN Gate direkt (das ist
    // die Garantie: der Generator schreibt keine neue Wahrheit, er liest nur).
    assert.equal(validateChangeReport(report, { handoff, after, allowedFiles: ["src/app.js"] }).ok, true);

    // `falsify handoff complete` (echte Oberfläche): Exit 0 + Re-Review-Child
    // in der EINEN Queue — der Loop schließt sich ohne manuellen Re-Submit.
    const hc = runCli({ home: tmp, args: ["handoff", "complete", "--file", reportFile, "--root", project] });
    const hcOut = await hc.outP;
    const hcCode = await hc.doneP;
    assert.equal(hcCode, 0, `handoff complete muss Exit 0 sein.\n=== AUSGABE ===\n${hcOut}`);
    const childId = (hcOut.match(/RE_REVIEW_JOB_ID=(\S+)/) || [])[1];
    assert.ok(childId, "Child-Job-ID gemeldet");
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const db = openDb();
    const child = db.prepare("SELECT * FROM jobs WHERE id = ?").get(childId);
    assert.ok(child, "Child-Job existiert");
    assert.equal(child.parent_job_id, jobId);
    assert.equal(child.handoff_id, handoffId);
    assert.equal(child.change_digest, comparison.diff_digest);
    assert.equal(child.scope_id, scopeId);
    assert.equal(child.checkout_id, checkoutId);
    assert.equal(child.loop_state, "RE_REVIEW_QUEUED");
    assert.equal(child.status, "QUEUED", "Child wartet in der EINEN Queue");
    closeDb();
  } finally {
    if (process.env.FALSIFY_HOME === tmp) delete process.env.FALSIFY_HOME;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("handoff report: stale Report (Zustand nach Generierung erneut geändert) wird fail-closed abgelehnt", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-hr-home-"));
  const project = tempProject();
  try {
    const { jobId } = await setupAuthorizedJob({
      home: tmp,
      project,
      header: "Stale-Report-Ticket",
    });

    // Änderung 1: der externe Writer arbeitet die Freigabe ab.
    fs.writeFileSync(path.join(project, "src", "app.js"), APP_WITH_CLIP);
    const reportFile = path.join(tmp, "report-stale.json");
    // Ohne --writer-id: ehrliche Warnung + leere writer_id (kein stiller Fake).
    const gen = runCli({ home: tmp, args: ["handoff", "report", "--job-id", jobId, "--root", project, "--out", reportFile] });
    const genOut = await gen.outP;
    const genCode = await gen.doneP;
    assert.equal(genCode, 0, `handoff report muss Exit 0 sein.\n=== AUSGABE ===\n${genOut}`);
    assert.match(genOut, /writer_id ist leer/);
    let report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    assert.equal(report.writer_id, "");
    // Der Agent bezeugt seine Absicht (einzige Ergänzung am generierten Report).
    report = { ...report, writer_id: "fake-external-agent" };
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");

    // Änderung 2: Repo-Zustand ändert sich NACH der Generierung → der Report
    // ist stale; complete misst selbst nach und lehnt fail-closed ab.
    fs.writeFileSync(path.join(project, "src", "app.js"), APP_WITH_CLIP + "export function extra() { return 1; }\n");
    const hc = runCli({ home: tmp, args: ["handoff", "complete", "--file", reportFile, "--root", project] });
    const hcOut = await hc.outP;
    const hcCode = await hc.doneP;
    assert.equal(hcCode, 3, `stale Report muss Exit 3 sein.\n=== AUSGABE ===\n${hcOut}`);
    assert.match(hcOut, /after_digest/, "after_digest-Mismatch als Ursache benannt");
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const db = openDb();
    const childCount = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE parent_job_id = ?").get(jobId).n;
    assert.equal(childCount, 0, "kein Child aus einem stale Report");
    closeDb();
  } finally {
    if (process.env.FALSIFY_HOME === tmp) delete process.env.FALSIFY_HOME;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("handoff report: Guards (Job ohne Handoff, fehlende Handoff-Datei, existierende --out, unbekannte Option)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-hr-home-"));
  const project = tempProject();
  try {
    // Job OHNE Handoff (normaler QUEUED-Job) → Exit 3, kein Report.
    process.env.FALSIFY_HOME = tmp;
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const identity = await mod("core/identity.mjs");
    const projects = await mod("artifacts/projects.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const { createJob } = await mod("artifacts/jobs.mjs");
    const anchor = identity.initAnchor(project);
    assert.equal(anchor.ok, true, anchor.message);
    const idDb = openDb();
    projects.bindAnchor(idDb, anchor, project);
    closeDb();
    const db = openDb();
    const scope = scopes.createScope(db, "Guard-Ticket", { checkoutId: anchor.value.checkoutId });
    const plainJob = createJob(db, {
      checkoutId: anchor.value.checkoutId,
      scopeId: scope.id,
      payload: "x",
      root: project,
      files: "src/app.js",
      mode: "write",
    });
    closeDb();

    const g1 = runCli({ home: tmp, args: ["handoff", "report", "--job-id", plainJob, "--root", project] });
    const g1Out = await g1.outP;
    const g1Code = await g1.doneP;
    assert.equal(g1Code, 3, `Job ohne Handoff → Exit 3\n=== AUSGABE ===\n${g1Out}`);
    assert.match(g1Out, /keinen Handoff/);

    // Authorisierter Job, aber Handoff-Datei fehlt → Exit 3 (fail-closed).
    const { jobId } = await setupAuthorizedJob({ home: tmp, project, header: "Guard-Ticket 2" });
    fs.rmSync(path.join(tmp, "logs", `handoff-${jobId}.json`));
    const g2 = runCli({ home: tmp, args: ["handoff", "report", "--job-id", jobId, "--root", project] });
    const g2Out = await g2.outP;
    const g2Code = await g2.doneP;
    assert.equal(g2Code, 3, `fehlende Handoff-Datei → Exit 3\n=== AUSGABE ===\n${g2Out}`);
    assert.match(g2Out, /Handoff nicht gefunden/);

    // Valid: frischer autorisierter Job (der obige verlor seine Handoff-Datei
    // absichtlich), Report generieren, dann --out auf dieselbe Datei → Exit 2,
    // bestehender Inhalt bleibt unangetastet (kein Clobber).
    const { jobId: jobId2 } = await setupAuthorizedJob({ home: tmp, project, header: "Guard-Ticket 3" });
    const reportFile = path.join(tmp, "report-guard.json");
    fs.writeFileSync(path.join(project, "src", "app.js"), APP_WITH_CLIP);
    const g3 = runCli({ home: tmp, args: ["handoff", "report", "--job-id", jobId2, "--root", project, "--out", reportFile] });
    await g3.outP;
    const g3Code = await g3.doneP;
    assert.equal(g3Code, 0, "erste Generierung muss gelingen");
    const before = fs.readFileSync(reportFile, "utf8");
    const g4 = runCli({ home: tmp, args: ["handoff", "report", "--job-id", jobId2, "--root", project, "--out", reportFile] });
    const g4Out = await g4.outP;
    const g4Code = await g4.doneP;
    assert.equal(g4Code, 2, `existierende --out → Exit 2\n=== AUSGABE ===\n${g4Out}`);
    assert.match(g4Out, /existiert bereits/);
    assert.equal(fs.readFileSync(reportFile, "utf8"), before, "nichts überschrieben");

    // Unbekannte Option → Exit 2.
    const g5 = runCli({ home: tmp, args: ["handoff", "report", "--job-id", jobId2, "--bogus", "x", "--root", project] });
    const g5Out = await g5.outP;
    const g5Code = await g5.doneP;
    assert.equal(g5Code, 2, `unbekannte Option → Exit 2\n=== AUSGABE ===\n${g5Out}`);
  } finally {
    if (process.env.FALSIFY_HOME === tmp) delete process.env.FALSIFY_HOME;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("handoff complete: Agent-Report ohne job_id wird VOR jedem DB-Zugriff abgewiesen (Exit 2, kein sqlite-Bind-Fehler)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-hr-home-"));
  const project = tempProject();
  try {
    await setupAuthorizedJob({ home: tmp, project, header: "Die Funktion add addiert zwei Zahlen." });

    // Kaputter Agent-Report: job_id fehlt komplett. Der JSON-Pfad ist UNTRUSTED
    // und getJob lief VOR validateChangeReport — ohne Guard traf fehlendes
    // job_id die node:sqlite-Bind-Falle (irreführende Meldung, Exit 3 statt
    // der ehrlichen Exit-2-Vertragsklasse).
    const broken = path.join(tmp, "report-ohne-job-id.json");
    fs.writeFileSync(broken, JSON.stringify({ handoff_id: "h-x", writer_id: "fake" }), "utf8");
    const b = runCli({ home: tmp, args: ["handoff", "complete", "--file", broken, "--root", project] });
    const bOut = await b.outP;
    const bCode = await b.doneP;
    assert.equal(bCode, 2, `fehlendes job_id → Exit 2\n=== AUSGABE ===\n${bOut}`);
    assert.match(bOut, /job_id/, "ehrliche Pflichtfeld-Meldung");
    assert.doesNotMatch(bOut, /Provided value cannot be bound|SQLITE/i, "kein roher sqlite-Bind-Fehler");

    // Gleiche Vertragsklasse: Nicht-String und Leer-String.
    for (const bad of [{ job_id: 42 }, { job_id: "   " }]) {
      const p = path.join(tmp, "report-bad.json");
      fs.writeFileSync(p, JSON.stringify(bad), "utf8");
      const r = runCli({ home: tmp, args: ["handoff", "complete", "--file", p, "--root", project] });
      const rOut = await r.outP;
      assert.equal(await r.doneP, 2, `job_id=${JSON.stringify(bad.job_id)} → Exit 2\n=== AUSGABE ===\n${rOut}`);
    }
  } finally {
    if (process.env.FALSIFY_HOME === tmp) delete process.env.FALSIFY_HOME;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});