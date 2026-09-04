// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/full-loop-negative.test.mjs – Negative Loop-Matrix (TASK-020)
// -----------------------------------------------------------------------------
// Jeder Missbrauchs-/Fehlerfall endet im EXAKT erwarteten Blockade-/Fehler-
// zustand OHNE unautorisierte Freigabe, OHNE Child-Job und OHNE Umgehen der
// Gates. Isolierte FALSIFY_HOME; die Gate-/Queue-Logik läuft echt.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-neg-proj-"));
  fs.writeFileSync(path.join(dir, "app.js"), "export function add(a, b) {\n  return a + b;\n}\n");
  return dir;
}

async function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-neg-home-"));
  process.env.FALSIFY_HOME = tmp;
  const dbMod = await mod("artifacts/db.mjs");
  const db = dbMod.openDb();
  return {
    db,
    dbMod,
    tmp,
    cleanup() {
      dbMod.closeDb();
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      if (process.env.FALSIFY_HOME === tmp) delete process.env.FALSIFY_HOME;
    },
  };
}

test("negativ: Twin-WIDERSPRUCH-Probe im Handoff macht den Handoff ungültig (keine Freigabe)", async () => {
  const { buildHandoff, validateHandoff } = await mod("core/handoff.mjs");
  const handoff = buildHandoff({
    jobId: "j", scopeId: "s", checkoutId: "c", iterationId: "i",
    verdict: "WRITE", phase: "write",
    probeResults: [
      { probe_id: "P1", status: "BESTAETIGT", evidenceOk: true, reason: "ok" },
      { probe_id: "P2", status: "WIDERSPRUCH", evidenceOk: false, reason: "Gegenbeweis" },
    ],
    beforeSnapshot: { digest: "d" }, allowedFiles: ["app.js"],
  });
  const v = validateHandoff(handoff);
  assert.equal(v.ok, false, "WIDERSPRUCH darf nie Freigabe tragen");
  assert.ok(v.reasons.some((r) => /P2 ist nicht BESTAETIGT/.test(r)));
});

test("negativ: Twin-Timeout (alle Proben UNKLAR) trägt keine Freigabe", async () => {
  const { validateHandoff } = await mod("core/handoff.mjs");
  const handoff = {
    version: 1, handoff_id: "h", job_id: "j", scope_id: "s", parent_job_id: null,
    checkout_id: "c", iteration_id: "i", verdict: "WRITE", phase: "write",
    reasons: [], probe_results: [
      { probe_id: "P1", status: "UNKLAR", evidenceOk: false, reason: "timeout" },
    ],
    twin_evidence: null, required_action: "APPLY_WRITE", next_state: "WRITE_AUTHORIZED",
    before_snapshot: { digest: "d" }, allowed_files: ["app.js"],
  };
  const v = validateHandoff(handoff);
  assert.equal(v.ok, false);
});

test("negativ: fehlendes F6 bzw. A7 im Protokoll blockt das finale Gate (TEST-010)", async () => {
  const { validateFalsificationRecord, validateChangeGate } = await mod("core/protocols.mjs");
  const dir = tempProject();
  try {
    const f = {
      F1: "a", F2: "b", F3: "c", F4: "d", F5: "e",
      // F6 fehlt absichtlich
      F7: "g", F8: "h", F9: "i", F10: "WRITE – begründet.",
    };
    const rf = validateFalsificationRecord(f, { root: dir });
    assert.equal(rf.ok, false);
    assert.ok(rf.reasons.some((r) => /F6/.test(r)));
    const a = {};
    for (let i = 1; i <= 10; i++) a[`A${i}`] = { answer: "JA", proof: "Beleg lang genug hier", test: "npm test" };
    delete a.A7;
    const ra = validateChangeGate(a, { root: dir });
    assert.equal(ra.ok, false);
    assert.ok(ra.reasons.some((r) => /A7/.test(r)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("negativ: ungültige Evidence-Referenz (Fantasie-Zeile) im Protokoll failt", async () => {
  const { validateFalsificationRecord } = await mod("core/protocols.mjs");
  const dir = tempProject();
  try {
    const f = {
      F1: "a", F2: "b", F3: "c", F4: "d", F5: "e",
      F6: "Evidenz: app.js:5000 – existiert nicht.",
      F7: "g", F8: "h", F9: "i", F10: "WRITE – begründet.",
    };
    const r = validateFalsificationRecord(f, { root: dir });
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => /Referenz-Zeile existiert nicht/.test(x)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("negativ: NO_CHANGE-Report → LOOP_BLOCKED, kein Child-Job (RISK-007)", async () => {
  const s = await setup();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const handoffMod = await mod("artifacts/handoff.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const changes = await mod("core/changes.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const dir = tempProject();
    try {
      const scopeId = scopes.createScope(s.db, "Header").id;
      const before = changes.snapshotRoot(dir, ["app.js"]);
      const pid = jobs.createJob(s.db, { scopeId, payload: "p", root: dir, files: "app.js", mode: "write" });
      s.db.prepare("UPDATE jobs SET loop_state = 'WRITE_AUTHORIZED' WHERE id = ?").run(pid);
      const cmp = changes.compareSnapshots(before, before, { allowedFiles: ["app.js"] });
      const handoff = { handoff_id: "h", job_id: pid, scope_id: scopeId, before_snapshot: before };
      const r = handoffMod.completeHandoff(s.db, {
        report: { handoff_id: "h", job_id: pid, scope_id: scopeId, checkout_id: null, writer_id: "a", before_digest: before.digest, after_digest: before.digest, changed_files: [], diff_digest: cmp.diff_digest, write_status: "NO_CHANGE" },
        handoff, changeComparison: cmp, allowedFiles: ["app.js"],
      });
      assert.equal(r.ok, false);
      assert.equal(loops.getLoopState(s.db, pid), "LOOP_BLOCKED");
      const children = s.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE parent_job_id = ?").get(pid);
      assert.equal(children.n, 0, "kein Child ohne echte Änderung");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  } finally {
    s.cleanup();
  }
});

test("negativ: Report mit fremdem/unautorisiertem Pfad wird abgelehnt (SEC-002)", async () => {
  const { validateChangeReport } = await mod("core/changes.mjs");
  const dir = tempProject();
  try {
    const before = { digest: "d1", entries: [{ path: "app.js", sha256: "x", size: 10 }] };
    const after = { digest: "d2", entries: [{ path: "app.js", sha256: "y", size: 12 }, { path: "evil.js", sha256: "z", size: 3 }] };
    const report = {
      handoff_id: "h", job_id: "j", scope_id: "s", checkout_id: "c", writer_id: "w",
      before_digest: "d1", after_digest: "d2", changed_files: ["app.js", "evil.js"],
      diff_digest: "dd", write_status: "COMPLETED",
    };
    const handoff = { handoff_id: "h", job_id: "j", scope_id: "s", checkout_id: "c", before_snapshot: before };
    const v = validateChangeReport(report, { handoff, after, allowedFiles: ["app.js"] });
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => /unauthorized|unerlaubt/i.test(r)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("negativ: Report mit falschem Projekt (Korrelationsbruch) wird abgelehnt", async () => {
  const { validateChangeReport } = await mod("core/changes.mjs");
  const before = { digest: "d1", entries: [] };
  const after = { digest: "d2", entries: [] };
  const report = {
    handoff_id: "h", job_id: "j-FREMDES-PROJEKT", scope_id: "s", checkout_id: "c",
    writer_id: "w", before_digest: "d1", after_digest: "d2", changed_files: [],
    diff_digest: "dd", write_status: "COMPLETED",
  };
  const handoff = { handoff_id: "h", job_id: "j-ECHT", scope_id: "s", checkout_id: "c", before_snapshot: before };
  const v = validateChangeReport(report, { handoff, after, allowedFiles: ["app.js"] });
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => /Job-ID stimmt nicht/.test(r)));
});

test("negativ: Loop-Limit (max_loop_count) endet terminal in LOOP_BLOCKED", async () => {
  const s = await setup();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const handoffMod = await mod("artifacts/handoff.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const scopeId = scopes.createScope(s.db, "Header").id;
    const pid = jobs.createJob(s.db, { scopeId, payload: "p", root: ".", files: "app.js", mode: "write" });
    s.db.prepare("UPDATE jobs SET loop_state = 'WRITE_IN_PROGRESS', loop_count = 5, max_loop_count = 5 WHERE id = ?").run(pid);
    const cmp = { changed: true, changed_files: ["app.js"], unauthorized_files: [], diff_digest: "dd", before_digest: "b", after_digest: "a" };
    const r = handoffMod.completeHandoff(s.db, {
      report: { handoff_id: "h", job_id: pid, scope_id: scopeId, checkout_id: null, writer_id: "w", before_digest: "b", after_digest: "a", changed_files: ["app.js"], diff_digest: "dd", write_status: "COMPLETED" },
      handoff: { handoff_id: "h", job_id: pid, scope_id: scopeId, before_snapshot: { digest: "b" } },
      changeComparison: cmp, allowedFiles: ["app.js"],
    });
    assert.equal(r.ok, false);
    assert.equal(loops.getLoopState(s.db, pid), "LOOP_BLOCKED");
  } finally {
    s.cleanup();
  }
});

test("negativ: Terminale Loop-Zustände sind unumkehrlich (SEC-004, Wiederholung/Restart)", async () => {
  const s = await setup();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const scopeId = scopes.createScope(s.db, "Header").id;
    for (const terminal of ["LOOP_BLOCKED", "ABORTED", "ERROR"]) {
      const pid = jobs.createJob(s.db, { scopeId, payload: "p", root: ".", files: "app.js", mode: "plan" });
      s.db.prepare("UPDATE jobs SET loop_state = ?, status = CASE WHEN ? = 'ERROR' THEN 'ERROR x' ELSE status END WHERE id = ?").run(terminal, terminal, pid);
      const again = loops.transitionLoop(s.db, pid, "RUNNING");
      assert.equal(again.ok, false, `${terminal} darf nie wieder öffnen`);
      const done = loops.transitionLoop(s.db, pid, "WRITE_AUTHORIZED");
      assert.equal(done.ok, false);
    }
  } finally {
    s.cleanup();
  }
});

test("negativ: NO_CHANGE per CLI emittiert LOOP_BLOCKED als FM-EVT (UI-124, FALSIFY_UI=1)", async () => {
  const s = await setup();
  try {
    const jobs = await mod("artifacts/jobs.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const changes = await mod("core/changes.mjs");
    const identity = await mod("core/identity.mjs");
    const projects = await mod("artifacts/projects.mjs");
    const dir = tempProject();
    try {
      // validateChangeReport verlangt eine nicht-leere checkout_id; scopes
      // bindet per FOREIGN KEY an `checkouts` — realer Anker + bindAnchor
      // (Muster tests/full-loop-e2e.test.mjs). Schreibziel ist nur das temp-Projekt.
      const anchor = identity.initAnchor(dir);
      assert.equal(anchor.ok, true, anchor.message);
      projects.bindAnchor(s.db, anchor, dir);
      const checkoutId = anchor.value.checkoutId;
      const scopeId = scopes.createScope(s.db, "Header", { checkoutId }).id;
      const before = changes.snapshotRoot(dir, ["app.js"]);
      const pid = jobs.createJob(s.db, { scopeId, checkoutId, payload: "p", root: dir, files: "app.js", mode: "write" });
      s.db.prepare("UPDATE jobs SET loop_state = 'WRITE_AUTHORIZED' WHERE id = ?").run(pid);
      // Handoff im Test-FALSIFY_HOME persistieren (wie die echte Pipeline).
      fs.mkdirSync(path.join(s.tmp, "logs"), { recursive: true });
      const handoff = { handoff_id: "h", job_id: pid, scope_id: scopeId, checkout_id: checkoutId, before_snapshot: before };
      fs.writeFileSync(path.join(s.tmp, "logs", `handoff-${pid}.json`), JSON.stringify(handoff), "utf8");
      // NO_CHANGE-Report aus gemessenem (unverändertem) Zustand — erfüllt
      // validateChangeReport (write_status NO_CHANGE ist in der Allow-Liste).
      const cmp = changes.compareSnapshots(before, before, { allowedFiles: ["app.js"] });
      const report = {
        handoff_id: "h", job_id: pid, scope_id: scopeId, checkout_id: checkoutId, writer_id: "a",
        before_digest: before.digest, after_digest: before.digest, changed_files: [],
        diff_digest: cmp.diff_digest, write_status: "NO_CHANGE",
      };
      const reportFile = path.join(s.tmp, "report-nochange.json");
      fs.writeFileSync(reportFile, JSON.stringify(report), "utf8");
      const main = path.join(ROOT, "cli", "main.mjs");
      // Mit FALSIFY_UI=1: terminaler Zustand MUSS als FM-EVT das Dock erreichen,
      // obwohl die CLI fail-closed mit Exit 3 endet (keine Freigabe).
      const withUi = spawnSync(process.execPath, [main, "handoff", "complete", "--file", reportFile, "--root", dir], {
        cwd: ROOT, env: { ...process.env, FALSIFY_HOME: s.tmp, FALSIFY_UI: "1", FALSIFY_WINDOW: "1" }, encoding: "utf8",
      });
      assert.equal(withUi.status, 3, withUi.stdout + withUi.stderr);
      assert.match(withUi.stdout, /FM-EVT: \{"t":"loop","s":"LOOP_BLOCKED"/, "LOOP_BLOCKED als FM-EVT im CLI-Out");
      // Ohne FALSIFY_UI: kein Marker (Gate-Beweis — keine Nebenwirkung).
      const plain = spawnSync(process.execPath, [main, "handoff", "complete", "--file", reportFile, "--root", dir], {
        cwd: ROOT, env: { ...process.env, FALSIFY_HOME: s.tmp }, encoding: "utf8",
      });
      assert.equal(plain.status, 3, plain.stdout + plain.stderr);
      assert.ok(!/FM-EVT:/.test(plain.stdout), "ohne FALSIFY_UI keine FM-EVT-Marker");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  } finally {
    s.cleanup();
  }
});

test("negativ: Handoff mit Secret-Signatur wird abgelehnt (SEC-001, Duplikat-Restart)", async () => {
  const { validateHandoff } = await mod("core/handoff.mjs");
  const handoff = {
    version: 1, handoff_id: "h", job_id: "j", scope_id: "s", parent_job_id: null,
    checkout_id: "c", iteration_id: "i", verdict: "WRITE", phase: "write",
    reasons: ["Authorization: Bearer abcdefghijklmnop"],
    probe_results: [{ probe_id: "P1", status: "BESTAETIGT", evidenceOk: true, reason: "ok" }],
    twin_evidence: null, required_action: "APPLY_WRITE", next_state: "WRITE_AUTHORIZED",
    before_snapshot: { digest: "d" }, allowed_files: ["app.js"],
  };
  const v = validateHandoff(handoff);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => /Secret/.test(r)));
});
