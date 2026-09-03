// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/loop.test.mjs – Handoff/Change/Protokoll/Loop-Verträge
// Isolierte FALSIFY_HOME (Wegwerf), keine Modell-Calls nötig.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-loop-proj-"));
  fs.writeFileSync(path.join(dir, "app.js"), "export function add(a, b) {\n  return a + b;\n}\n");
  return dir;
}

// ── core/handoff.mjs (TASK-006) ──────────────────────────────────────────────
test("handoff: valider v1-Handoff besteht die strikte Validierung", async () => {
  const { buildHandoff, validateHandoff, serializeHandoff } = await mod("core/handoff.mjs");
  const handoff = buildHandoff({
    jobId: "job-1", scopeId: "scope-1", checkoutId: "co-1", iterationId: "it-1",
    verdict: "WRITE", phase: "write", reasons: ["BEFUND ok"],
    probeResults: [{ probe_id: "P1", requirement_ref: "H1", status: "BESTAETIGT", evidenceOk: true, reason: "src/app.js:2" }],
    twinEvidence: { tool_rounds: 2, file_refs: ["src/app.js:2"] },
    beforeSnapshot: { digest: "abc", entries: [] },
    allowedFiles: ["src/app.js"],
  });
  const v = validateHandoff(handoff);
  assert.ok(v.ok, v.reasons.join("; "));
  assert.equal(validateHandoff(JSON.parse(serializeHandoff(handoff))).ok, true, "Serialisierung round-trip");
});

test("handoff: fehlende Felder, WIDERSPRUCH-Probe, Korrelationsbruch failen", async () => {
  const { buildHandoff, validateHandoff } = await mod("core/handoff.mjs");
  const handoff = buildHandoff({
    jobId: "job-1", scopeId: "scope-1", checkoutId: "co-1", iterationId: "it-1",
    verdict: "WRITE", phase: "write",
    probeResults: [{ probe_id: "P1", status: "WIDERSPRUCH", evidenceOk: false, reason: "x" }],
    beforeSnapshot: { digest: "abc" }, allowedFiles: ["app.js"],
  });
  const v = validateHandoff(handoff);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => /nicht BESTAETIGT/.test(r)));
  assert.ok(v.reasons.some((r) => /keine verifizierte Evidence/.test(r)));
  const corr = validateHandoff(handoff, { expected: { scope_id: "scope-ANDERS" } });
  assert.ok(corr.reasons.some((r) => /Korrelation fehlgeschlagen/.test(r)));
  // Verdict != WRITE failt.
  const wrong = validateHandoff({ ...handoff, verdict: "PLAN" });
  assert.ok(wrong.reasons.some((r) => /verdict muss WRITE/.test(r)));
});

test("handoff: Secret-Signaturen werden abgelehnt (SEC-001)", async () => {
  const { validateHandoff } = await mod("core/handoff.mjs");
  const base = {
    version: 1, handoff_id: "h1", job_id: "j1", scope_id: "s1", parent_job_id: null,
    checkout_id: "c1", iteration_id: "i1", verdict: "WRITE", phase: "write",
    reasons: [], probe_results: [{ probe_id: "P1", status: "BESTAETIGT", evidenceOk: true, reason: "ok" }],
    twin_evidence: null, required_action: "APPLY_WRITE", next_state: "WRITE_AUTHORIZED",
    before_snapshot: { digest: "d" }, allowed_files: ["a.js"],
  };
  const leaky = { ...base, reasons: ['api_key: "sk-abcdefghijklmnopqrstuvwx"'] };
  const v = validateHandoff(leaky);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => /Secret/.test(r)));
});

test("handoff: renderCoderBrief leitet den Coder-Brief aus einem validen Handoff ab (keine neue Wahrheit)", async () => {
  const { buildHandoff, validateHandoff, renderCoderBrief, serializeHandoff } = await mod("core/handoff.mjs");
  const handoff = buildHandoff({
    jobId: "job-1", scopeId: "scope-1", checkoutId: "co-1", iterationId: "it-1",
    verdict: "WRITE", phase: "write", reasons: ["BEFUND ok"],
    probeResults: [{ probe_id: "P1", requirement_ref: "H1", status: "BESTAETIGT", evidenceOk: true, reason: "src/app.js:2 geprueft" }],
    twinEvidence: { tool_rounds: 2, file_refs: ["src/app.js:2"] },
    beforeSnapshot: { digest: "abc123", git_head: "deadbeef" },
    allowedFiles: ["src/app.js"],
  });
  const brief = renderCoderBrief(handoff);
  assert.equal(brief.ok, true, brief.reason);
  // Konsumierbare Arbeitsanweisung: Whitelist, Basis, Twin-Ergebnis, Rückgabepflicht.
  assert.match(brief.brief, /src\/app\.js/);
  assert.match(brief.brief, /abc123/);
  assert.match(brief.brief, /BESTAETIGT/);
  assert.match(brief.brief, /handoff complete/);
  // Pure: Brief ist eine Ableitung — zweimal gerendert byte-identisch.
  assert.equal(renderCoderBrief(handoff).brief, brief.brief);
  // Fail-closed: aus einem ungültigen Handoff (WIDERSPRUCH-Probe) entsteht kein Brief.
  const bad = { ...JSON.parse(serializeHandoff(handoff)), probe_results: [{ probe_id: "P1", status: "WIDERSPRUCH", evidenceOk: false, reason: "x" }] };
  const rejected = renderCoderBrief(bad);
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /fail-closed/);
});

// ── core/changes.mjs (TASK-009 + TEST-006/007) ───────────────────────────────
test("changes: Content-Änderung erzeugt echten Digest, unverändert keinen", async () => {
  const { snapshotRoot, compareSnapshots } = await mod("core/changes.mjs");
  const dir = tempProject();
  try {
    const before = snapshotRoot(dir, ["app.js"]);
    fs.writeFileSync(path.join(dir, "app.js"), "export function add(a, b) {\n  return a + b + 1;\n}\n");
    const after = snapshotRoot(dir, ["app.js"]);
    const cmp = compareSnapshots(before, after, { allowedFiles: ["app.js"] });
    assert.equal(cmp.changed, true);
    assert.deepEqual(cmp.changed_files, ["app.js"]);
    assert.notEqual(cmp.diff_digest, before.digest);
    // Unverändert → kein Change, gleicher Digest.
    const after2 = snapshotRoot(dir, ["app.js"]);
    const cmp2 = compareSnapshots(after, after2, { allowedFiles: ["app.js"] });
    assert.equal(cmp2.changed, false);
    // Unerlaubte Datei failt in die unauthorized-Liste.
    fs.writeFileSync(path.join(dir, "evil.js"), "hacked");
    const cmp3 = compareSnapshots(after2, snapshotRoot(dir, ["app.js", "evil.js"]), { allowedFiles: ["app.js"] });
    assert.deepEqual(cmp3.unauthorized_files, ["evil.js"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("changes: Write-Report-Korrelation fehlerhaft → abgelehnt", async () => {
  const { snapshotRoot, compareSnapshots, validateChangeReport } = await mod("core/changes.mjs");
  const dir = tempProject();
  try {
    const before = snapshotRoot(dir, ["app.js"]);
    fs.writeFileSync(path.join(dir, "app.js"), "changed\n");
    const after = snapshotRoot(dir, ["app.js"]);
    const comparison = compareSnapshots(before, after, { allowedFiles: ["app.js"] });
    const handoff = { handoff_id: "h1", job_id: "j1", scope_id: "s1", checkout_id: "c1", before_snapshot: before };
    const good = {
      handoff_id: "h1", job_id: "j1", scope_id: "s1", checkout_id: "c1", writer_id: "agent-1",
      before_digest: before.digest, after_digest: comparison.after_digest,
      changed_files: comparison.changed_files, diff_digest: comparison.diff_digest,
      write_status: "COMPLETED",
    };
    assert.equal(validateChangeReport(good, { handoff, after, allowedFiles: ["app.js"] }).ok, true);
    // Fremde Handoff-ID failt.
    const bad = { ...good, handoff_id: "h-ANDERS" };
    assert.equal(validateChangeReport(bad, { handoff, after, allowedFiles: ["app.js"] }).ok, false);
    // Falscher after_digest failt.
    const stale = { ...good, after_digest: "alt" };
    assert.ok(validateChangeReport(stale, { handoff, after, allowedFiles: ["app.js"] }).reasons.some((r) => /after_digest/.test(r)));
    // Unbekannter write_status failt.
    assert.ok(validateChangeReport({ ...good, write_status: "WOHER_SOLL_ICH_DAS_WISSEN" }, { handoff, after, allowedFiles: ["app.js"] }).reasons.some((r) => /write_status/.test(r)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

// ── core/protocols.mjs (TASK-016 + TEST-010) ─────────────────────────────────
function fullChangeGate() {
  const entries = {};
  for (let i = 1; i <= 10; i++) {
    entries[`A${i}`] = { answer: "JA", proof: `Beleg ${i}: geprüft in app.js`, test: `node --test tests/x.test.mjs` };
  }
  return entries;
}
function fullFRecord(rootRef) {
  return {
    F1: "Ausgangsbehauptung: add summiert zwei Zahlen korrekt.",
    F2: "User contract: Header 1:1 übernommen.",
    F3: "Scope match: exakt die Header-Anforderungen.",
    F4: "Annahme: Zeile 2 enthält die Summe.",
    F5: "Angriff: Gegegenprobe mit Grenzwerten.",
    F6: `Evidenz: app.js:2 gelesen und verifiziert (${rootRef}).`,
    F7: "Gegenbeweis gesucht: keine Umordnung gefunden, Grenzfälle geprüft.",
    F8: "Ungeprüft: Verhalten bei nicht-numerischen Eingaben.",
    F9: "Restrisiko: Modell-Familien-Bias beim Twin möglich.",
    F10: "WRITE – Evidenz trägt die Freigabe.",
  };
}

test("protocols: vollständige A/F-Records mit echter Evidenz bestehen", async () => {
  const { validateChangeGate, validateFalsificationRecord } = await mod("core/protocols.mjs");
  const dir = tempProject();
  try {
    const a = validateChangeGate(fullChangeGate(), { root: dir, whitelist: ["app.js"] });
    const f = validateFalsificationRecord(fullFRecord("real"), { root: dir, whitelist: ["app.js"] });
    assert.ok(a.ok && f.ok, [...a.reasons, ...f.reasons].join("; "));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("protocols: fehlendes Feld, falsche Zeile, pauschales 'keine', nicht-JA failen", async () => {
  const { validateChangeGate, validateFalsificationRecord } = await mod("core/protocols.mjs");
  const dir = tempProject();
  try {
    // A7 fehlt.
    const missing = fullChangeGate();
    delete missing.A7;
    assert.ok(validateChangeGate(missing, { root: dir }).reasons.some((r) => /A7/.test(r)));
    // A4 nicht JA.
    const notJa = fullChangeGate();
    notJa.A4.answer = "NEIN";
    assert.ok(validateChangeGate(notJa, { root: dir }).reasons.some((r) => /A4 ist nicht JA/.test(r)));
    // JA ohne Proof.
    const noProof = fullChangeGate();
    noProof.A2.proof = "kuz";
    assert.ok(validateChangeGate(noProof, { root: dir }).reasons.some((r) => /A2/.test(r)));
    // F6 mit Fantasie-Zeile (app.js hat 3 Zeilen).
    const badLine = fullFRecord("real");
    badLine.F6 = "Evidenz: app.js:999 – existiert nicht.";
    assert.ok(validateFalsificationRecord(badLine, { root: dir }).reasons.some((r) => /Referenz-Zeile existiert nicht/.test(r)));
    // F6 ohne Datei:Zeile-Referenz.
    const noRef = fullFRecord("real");
    noRef.F6 = "Evidenz: irgendwo geprüft.";
    assert.ok(validateFalsificationRecord(noRef, { root: dir }).reasons.some((r) => /keine Datei:Zeile-Referenz/.test(r)));
    // F8 pauschal 'keine' failt.
    const dishonest = fullFRecord("real");
    dishonest.F8 = "keine";
    assert.ok(validateFalsificationRecord(dishonest, { root: dir }).reasons.some((r) => /F8/.test(r)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

// ── artifacts/loops.mjs (TASK-011/012/014/015 + TEST-008/009) ────────────────
function setupDb() {
  return (async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-loop-home-"));
    process.env.FALSIFY_HOME = tmp;
    const dbMod = await mod("artifacts/db.mjs");
    const db = dbMod.openDb();
    return { db, dbMod, cleanup: () => { dbMod.closeDb(); fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); if (process.env.FALSIFY_HOME === tmp) delete process.env.FALSIFY_HOME; } };
  })();
}

test("loops: legale Übergänge persistieren, illegale failen, Terminal ist unumkehrlich", async () => {
  const s = await setupDb();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const id = jobs.createJob(s.db, { scopeId: null, payload: "p", root: ".", files: "a.js", mode: "plan" });
    s.db.prepare("UPDATE jobs SET loop_state = 'QUEUED' WHERE id = ?").run(id);
    assert.equal(loops.transitionLoop(s.db, id, "RE_REVIEW_QUEUED").ok, false, "QUEUED → RE_REVIEW_QUEUED ist illegal");
    assert.equal(loops.transitionLoop(s.db, id, "RUNNING").ok, true);
    assert.equal(loops.transitionLoop(s.db, id, "WRITE_AUTHORIZED").ok, true);
    assert.equal(loops.transitionLoop(s.db, id, "WAITING_FOR_AGENT").ok, true);
    // Terminale Unumkehrlichkeit:
    assert.equal(loops.transitionLoop(s.db, id, "ABORTED").ok, true);
    assert.equal(loops.transitionLoop(s.db, id, "RUNNING").ok, false, "ABORTED ist terminal");
    // Audit-Historie ist append-only vorhanden.
    const events = loops.listLoopEvents(s.db, id);
    assert.ok(events.length >= 4, `mind. 4 Events, sind ${events.length}`);
    assert.equal(events[events.length - 1].to_state, "ABORTED");
  } finally {
    s.cleanup();
  }
});

test("loops: completeHandoff idempotent — 100 identische Reports, genau ein Child", async () => {
  const s = await setupDb();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const changes = await mod("core/changes.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const scopeId = scopes.createScope(s.db, "Test-Header").id;
    const dir = tempProject();
    try {
      const before = changes.snapshotRoot(dir, ["app.js"]);
      const parentId = jobs.createJob(s.db, { scopeId, payload: "p", root: dir, files: "app.js", mode: "write", runtimeConfig: { model: "m" } });
      // Loop-Zustand manuell in WRITE_IN_PROGRESS bringen (per legaler Kette):
      s.db.prepare("UPDATE jobs SET loop_state = 'WRITE_IN_PROGRESS', max_loop_count = 5 WHERE id = ?").run(parentId);
      // Illegaler Sprung von WRITE_IN_PROGRESS ist WRITE_AUTHORIZED→…-Kette;
      // completeHandoff vollzieht CHANGE_CAPTURED→RE_REVIEW_QUEUED selbst —
      // für den Test hier direkte Legalisierung über die Übergangstabelle:
      s.db.prepare("UPDATE jobs SET loop_state = 'WRITE_AUTHORIZED' WHERE id = ?").run(parentId);
      loops.transitionLoop(s.db, parentId, "WAITING_FOR_AGENT");
      loops.transitionLoop(s.db, parentId, "WRITE_IN_PROGRESS");
      // Externe Änderung simulieren.
      fs.writeFileSync(path.join(dir, "app.js"), "export function add(a, b) {\n  return a * b;\n}\n");
      const after = changes.snapshotRoot(dir, ["app.js"]);
      const comparison = changes.compareSnapshots(before, after, { allowedFiles: ["app.js"] });
      const handoff = { handoff_id: "h-1", job_id: parentId, scope_id: scopeId, checkout_id: null, before_snapshot: before };
      const report = {
        handoff_id: "h-1", job_id: parentId, scope_id: scopeId, checkout_id: null,
        writer_id: "agent", before_digest: before.digest, after_digest: comparison.after_digest,
        changed_files: comparison.changed_files, diff_digest: comparison.diff_digest,
        write_status: "COMPLETED",
      };
      // Legalisierungs-Kette: WRITE_IN_PROGRESS→CHANGE_CAPTURED passiert in
      // completeHandoff selbst (Transition prüft WRITE_IN_PROGRESS→CHANGE_CAPTURED).
      const first = loops.completeHandoff(s.db, { report, handoff, changeComparison: comparison, allowedFiles: ["app.js"], reReviewJob: { payload: "re", root: dir, files: "app.js", runtimeConfig: { model: "m" }, maxAttempts: 2 } });
      assert.equal(first.ok, true, JSON.stringify(first.reasons || first));
      assert.equal(first.idempotent, false);
      assert.ok(first.re_review_job_id, "Child-Job erzeugt");
      // 99 identische Wiederholungen: immer idempotent, kein zweites Child.
      for (let i = 0; i < 99; i++) {
        const again = loops.completeHandoff(s.db, { report, handoff, changeComparison: comparison, allowedFiles: ["app.js"], reReviewJob: { payload: "re", root: dir, files: "app.js", runtimeConfig: { model: "m" }, maxAttempts: 2 } });
        assert.equal(again.ok, true);
        assert.equal(again.idempotent, true);
        assert.equal(again.re_review_job_id, first.re_review_job_id);
      }
      const children = s.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE parent_job_id = ?").get(parentId);
      assert.equal(children.n, 1, "GENAU EIN Child-Job");
      // Child trägt die volle Korrelation (TASK-013).
      const child = s.db.prepare("SELECT * FROM jobs WHERE parent_job_id = ?").get(parentId);
      assert.equal(child.handoff_id, "h-1");
      assert.equal(child.scope_id, scopeId);
      assert.equal(child.change_digest, comparison.diff_digest);
      assert.equal(child.review_iteration, 1);
      assert.equal(child.loop_count, 1);
      assert.equal(child.loop_state, "RE_REVIEW_QUEUED");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  } finally {
    s.cleanup();
  }
});

test("loops: NO_CHANGE blockt, ABORTED-Report ist terminal, Loop-Limit blockt", async () => {
  const s = await setupDb();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const changes = await mod("core/changes.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const scopeId = scopes.createScope(s.db, "Test-Header 2").id;
    const dir = tempProject();
    try {
      const before = changes.snapshotRoot(dir, ["app.js"]);
      const parentId = jobs.createJob(s.db, { scopeId, payload: "p", root: dir, files: "app.js", mode: "write" });
      s.db.prepare("UPDATE jobs SET loop_state = 'WAITING_FOR_AGENT' WHERE id = ?").run(parentId);
      const comparison = changes.compareSnapshots(before, before, { allowedFiles: ["app.js"] });
      const handoff = { handoff_id: "h-x", job_id: parentId, scope_id: scopeId, before_snapshot: before };
      // NO_CHANGE-Report → LOOP_BLOCKED, kein Child.
      const noChange = loops.completeHandoff(s.db, { report: { handoff_id: "h-x", job_id: parentId, scope_id: scopeId, checkout_id: null, writer_id: "a", before_digest: before.digest, after_digest: before.digest, changed_files: [], diff_digest: comparison.diff_digest, write_status: "NO_CHANGE" }, handoff, changeComparison: comparison, allowedFiles: ["app.js"] });
      assert.equal(noChange.ok, false);
      assert.ok(noChange.reasons.some((r) => /NO_CHANGE/.test(r)));
      assert.equal(loops.getLoopState(s.db, parentId), "LOOP_BLOCKED");
      // ABORTED-Report → ABORTED.
      const p2 = jobs.createJob(s.db, { scopeId, payload: "p", root: dir, files: "app.js", mode: "write" });
      s.db.prepare("UPDATE jobs SET loop_state = 'WAITING_FOR_AGENT' WHERE id = ?").run(p2);
      const aborted = loops.completeHandoff(s.db, { report: { handoff_id: "h-y", job_id: p2, scope_id: scopeId, checkout_id: null, writer_id: "a", before_digest: before.digest, after_digest: before.digest, changed_files: [], diff_digest: "d", write_status: "ABORTED" }, handoff: { ...handoff, job_id: p2, handoff_id: "h-y" }, changeComparison: comparison, allowedFiles: ["app.js"] });
      assert.equal(aborted.ok, false);
      assert.equal(loops.getLoopState(s.db, p2), "ABORTED");
      // Loop-Limit: max_loop_count erreicht → LOOP_BLOCKED statt Child.
      const p3 = jobs.createJob(s.db, { scopeId, payload: "p", root: dir, files: "app.js", mode: "write" });
      s.db.prepare("UPDATE jobs SET loop_state = 'WRITE_IN_PROGRESS', loop_count = 5, max_loop_count = 5 WHERE id = ?").run(p3);
      s.db.prepare("UPDATE jobs SET loop_state = 'WRITE_AUTHORIZED' WHERE id = ?").run(p3);
      loops.transitionLoop(s.db, p3, "WAITING_FOR_AGENT");
      loops.transitionLoop(s.db, p3, "WRITE_IN_PROGRESS");
      fs.writeFileSync(path.join(dir, "app.js"), "neu\n");
      const after = changes.snapshotRoot(dir, ["app.js"]);
      const cmp2 = changes.compareSnapshots(before, after, { allowedFiles: ["app.js"] });
      const limited = loops.completeHandoff(s.db, { report: { handoff_id: "h-z", job_id: p3, scope_id: scopeId, checkout_id: null, writer_id: "a", before_digest: before.digest, after_digest: cmp2.after_digest, changed_files: cmp2.changed_files, diff_digest: cmp2.diff_digest, write_status: "COMPLETED" }, handoff: { ...handoff, job_id: p3, handoff_id: "h-z" }, changeComparison: cmp2, allowedFiles: ["app.js"], reReviewJob: { payload: "r", root: dir, files: "app.js" } });
      assert.equal(limited.ok, false);
      assert.ok(limited.reasons.some((r) => /Loop-Limit/.test(r)));
      assert.equal(loops.getLoopState(s.db, p3), "LOOP_BLOCKED");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  } finally {
    s.cleanup();
  }
});
