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
    const handoffMod = await mod("artifacts/handoff.mjs");
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
      const first = handoffMod.completeHandoff(s.db, { report, handoff, changeComparison: comparison, allowedFiles: ["app.js"], reReviewJob: { payload: "re", root: dir, files: "app.js", runtimeConfig: { model: "m" }, maxAttempts: 2 } });
      assert.equal(first.ok, true, JSON.stringify(first.reasons || first));
      assert.equal(first.idempotent, false);
      assert.ok(first.re_review_job_id, "Child-Job erzeugt");
      // 99 identische Wiederholungen: immer idempotent, kein zweites Child.
      for (let i = 0; i < 99; i++) {
        const again = handoffMod.completeHandoff(s.db, { report, handoff, changeComparison: comparison, allowedFiles: ["app.js"], reReviewJob: { payload: "re", root: dir, files: "app.js", runtimeConfig: { model: "m" }, maxAttempts: 2 } });
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
    const handoffMod = await mod("artifacts/handoff.mjs");
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
      const noChange = handoffMod.completeHandoff(s.db, { report: { handoff_id: "h-x", job_id: parentId, scope_id: scopeId, checkout_id: null, writer_id: "a", before_digest: before.digest, after_digest: before.digest, changed_files: [], diff_digest: comparison.diff_digest, write_status: "NO_CHANGE" }, handoff, changeComparison: comparison, allowedFiles: ["app.js"] });
      assert.equal(noChange.ok, false);
      assert.ok(noChange.reasons.some((r) => /NO_CHANGE/.test(r)));
      assert.equal(loops.getLoopState(s.db, parentId), "LOOP_BLOCKED");
      // ABORTED-Report → ABORTED.
      const p2 = jobs.createJob(s.db, { scopeId, payload: "p", root: dir, files: "app.js", mode: "write" });
      s.db.prepare("UPDATE jobs SET loop_state = 'WAITING_FOR_AGENT' WHERE id = ?").run(p2);
      const aborted = handoffMod.completeHandoff(s.db, { report: { handoff_id: "h-y", job_id: p2, scope_id: scopeId, checkout_id: null, writer_id: "a", before_digest: before.digest, after_digest: before.digest, changed_files: [], diff_digest: "d", write_status: "ABORTED" }, handoff: { ...handoff, job_id: p2, handoff_id: "h-y" }, changeComparison: comparison, allowedFiles: ["app.js"] });
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
      const limited = handoffMod.completeHandoff(s.db, { report: { handoff_id: "h-z", job_id: p3, scope_id: scopeId, checkout_id: null, writer_id: "a", before_digest: before.digest, after_digest: cmp2.after_digest, changed_files: cmp2.changed_files, diff_digest: cmp2.diff_digest, write_status: "COMPLETED" }, handoff: { ...handoff, job_id: p3, handoff_id: "h-z" }, changeComparison: cmp2, allowedFiles: ["app.js"], reReviewJob: { payload: "r", root: dir, files: "app.js" } });
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

// ── Loop-State-Divergenz: RE_REVIEW_RUNNING + DONE sind echte Runtime-Zustände ──
// Kausale Kette (TASK-011): Child createJob → RE_REVIEW_QUEUED → Claim →
// RE_REVIEW_RUNNING → Re-Review-Ausführung → finaler Verdict → DONE.
// Jeder Pfeil hier hat ein Runtime-Ereignis + eine autoritative Code-Stelle
// (claimJob/claimNextJob → advanceLoop claim; jobDone → advanceLoop
// finalize/error — GENAU EINE Loop-Transition pro finalem Job-Zustandsübergang).

test("loops: Child-Claim macht RE_REVIEW_RUNNING real (B, F — kein Phantom-State)", async () => {
  const s = await setupDb();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const scopeId = scopes.createScope(s.db, "Re-Review-Header").id;

    // Normales Erstlauf-Job (kein Re-Review): Claim darf NICHT auf
    // RE_REVIEW_RUNNING springen (F: kein Phantom-State ohne Re-Review).
    const normal = jobs.createJob(s.db, { scopeId, payload: "p", root: ".", files: "a.js", mode: "plan" });
    const claimed = jobs.claimNextJob(s.db, 1, scopeId);
    assert.equal(claimed.id, normal, "Erstlauf-Job wird geclaimt");
    assert.equal(claimed.loop_state, null, "Erstlauf ohne Loop-Zustand: Claim erzeugt KEIN RE_REVIEW_RUNNING (F)");

    // Re-Review-Kind (wie von completeHandoff erzeugt: RE_REVIEW_QUEUED).
    const child = jobs.createJob(s.db, { scopeId, payload: "re", root: ".", files: "a.js", mode: "write" });
    s.db.prepare("UPDATE jobs SET loop_state = 'RE_REVIEW_QUEUED' WHERE id = ?").run(child);
    const claimedChild = jobs.claimNextJob(s.db, 2, scopeId);
    assert.equal(claimedChild.id, child, "Re-Review-Kind wird geclaimt");
    assert.equal(claimedChild.status, "RUNNING");
    assert.equal(claimedChild.loop_state, "RE_REVIEW_RUNNING", "B: Claim setzt RE_REVIEW_RUNNING");

    // E: Retry-Idempotenz: doppelter Claim erzeugt keine zweite/illegale Transition.
    s.db.prepare("UPDATE jobs SET status = 'QUEUED', window_idx = NULL, started_at = NULL WHERE id = ?").run(child);
    const reClaimed = jobs.claimNextJob(s.db, 2, scopeId);
    assert.equal(reClaimed.id, child);
    assert.equal(reClaimed.loop_state, "RE_REVIEW_RUNNING", "Retry bleibt RE_REVIEW_RUNNING (idempotent)");
    const events = loops.listLoopEvents(s.db, child).filter((e) => e.event_type === "claim_start");
    assert.equal(events.length, 1, "E: Retry erzeugt KEINE zweite Transition (idempotent)");
  } finally {
    s.cleanup();
  }
});

test("loops: DONE entsteht nur nach finalem NICHT-WRITE-Verdict eines Re-Reviews (D, G)", async () => {
  const s = await setupDb();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const loopflow = await mod("artifacts/loopflow.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const scopeId = scopes.createScope(s.db, "Done-Header").id;

    // Re-Review-Kind claimen → RE_REVIEW_RUNNING.
    const child = jobs.createJob(s.db, { scopeId, payload: "re", root: ".", files: "a.js", mode: "write" });
    s.db.prepare("UPDATE jobs SET loop_state = 'RE_REVIEW_QUEUED' WHERE id = ?").run(child);
    jobs.claimNextJob(s.db, 1, scopeId);
    assert.equal(loops.getLoopState(s.db, child), "RE_REVIEW_RUNNING");

    // G: Solange der Re-Review läuft (status=RUNNING), ist KEIN DONE erlaubt —
    // der Verdict fehlt noch. advanceLoop(finalize) wird erst NACH jobDone
    // (im Review-Commit) aufgerufen — hier direkt geprüft: skipped.
    const premature = loopflow.advanceLoop(s.db, child, { event: "finalize", verdict: "PLAN" });
    assert.equal(premature.ok, true);
    assert.equal(premature.skipped, true, "kein DONE bei laufendem Job (kein finaler Verdict)");
    assert.equal(loops.getLoopState(s.db, child), "RE_REVIEW_RUNNING");

    // D: Erst der persistierte finale NICHT-WRITE-Verdict schließt den Loop —
    // jobDone vollzieht die DONE-Transition atomar (GENAU EINE Loop-Transition
    // pro finalem Job-Zustandsübergang, kein separater CLI-Schritt).
    jobs.jobDone(s.db, child, "PLAN", null);
    assert.equal(loops.getLoopState(s.db, child), "DONE", "jobDone setzt DONE kausal");
    assert.equal(jobs.getJob(s.db, child).status, "DONE PLAN");
    // Ein erneuter finalize-Versuch (Re-Delivery) ist idempotent — DONE bleibt DONE.
    const again = loopflow.advanceLoop(s.db, child, { event: "finalize", verdict: "PLAN", scopeId });
    assert.equal(again.ok, true);
    assert.equal(again.skipped, true, "terminaler DONE wird nicht doppelt verbucht");
    // Terminal bleibt terminal (SEC-004).
    assert.equal(loops.transitionLoop(s.db, child, "RE_REVIEW_RUNNING").ok, false);
  } finally {
    s.cleanup();
  }
});

test("loops: WRITE-Verdict lässt den Loop offen — kein vorzeitiges DONE (G)", async () => {
  const s = await setupDb();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const scopeId = scopes.createScope(s.db, "Write-Offen-Header").id;

    const child = jobs.createJob(s.db, { scopeId, payload: "re", root: ".", files: "a.js", mode: "write" });
    s.db.prepare("UPDATE jobs SET loop_state = 'RE_REVIEW_QUEUED' WHERE id = ?").run(child);
    jobs.claimNextJob(s.db, 1, scopeId);
    jobs.jobDone(s.db, child, "WRITE", null);
    // WRITE lässt den Loop offen — jobDone/advanceLoop(finalize) überspringt,
    // kein vorzeitiges DONE (Handoff → WRITE_AUTHORIZED folgt im Handoff-Pfad).
    assert.equal(loops.getLoopState(s.db, child), "RE_REVIEW_RUNNING", "WRITE lässt den Loop offen (kein DONE)");
    // Der Handoff-Pfad schiebt danach legal weiter:
    const t = loops.transitionLoop(s.db, child, "WRITE_AUTHORIZED", { eventType: "handoff_emitted" });
    assert.equal(t.ok, true);
    assert.equal(loops.getLoopState(s.db, child), "WRITE_AUTHORIZED");
  } finally {
    s.cleanup();
  }
});

test("loops: Fehler-Finalisierung schließt den Loop kausal auf ERROR (Crash-Boundary)", async () => {
  const s = await setupDb();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const scopeId = scopes.createScope(s.db, "Error-Header").id;

    const child = jobs.createJob(s.db, { scopeId, payload: "re", root: ".", files: "a.js", mode: "write" });
    s.db.prepare("UPDATE jobs SET loop_state = 'RE_REVIEW_QUEUED' WHERE id = ?").run(child);
    jobs.claimNextJob(s.db, 1, scopeId);
    assert.equal(loops.getLoopState(s.db, child), "RE_REVIEW_RUNNING");
    // Worker-Crash/Review-Fehler: jobDone mit error → Loop folgt auf ERROR.
    const finalized = jobs.jobDone(s.db, child, null, "Worker-Abbruch (Recovery)", { failureKind: "worker-crash" });
    assert.equal(finalized, true);
    assert.equal(jobs.getJob(s.db, child).status, "ERROR Worker-Abbruch (Recovery)");
    assert.equal(loops.getLoopState(s.db, child), "ERROR", "Loop schließt kausal auf ERROR");
    assert.equal(loops.transitionLoop(s.db, child, "DONE").ok, false, "ERROR ist terminal");
  } finally {
    s.cleanup();
  }
});

test("loops: A — Parent wird nicht DONE, solange der Child aussteht", async () => {
  const s = await setupDb();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const handoffMod = await mod("artifacts/handoff.mjs");
    const loopflow = await mod("artifacts/loopflow.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const changes = await mod("core/changes.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const scopeId = scopes.createScope(s.db, "Parent-Header").id;
    const dir = tempProject();
    try {
      const before = changes.snapshotRoot(dir, ["app.js"]);
      const parentId = jobs.createJob(s.db, { scopeId, payload: "p", root: dir, files: "app.js", mode: "write" });
      s.db.prepare("UPDATE jobs SET loop_state = 'WRITE_AUTHORIZED' WHERE id = ?").run(parentId);
      loops.transitionLoop(s.db, parentId, "WAITING_FOR_AGENT");
      loops.transitionLoop(s.db, parentId, "WRITE_IN_PROGRESS");
      fs.writeFileSync(path.join(dir, "app.js"), "export function add(a, b) {\n  return a * b;\n}\n");
      const after = changes.snapshotRoot(dir, ["app.js"]);
      const comparison = changes.compareSnapshots(before, after, { allowedFiles: ["app.js"] });
      const handoff = { handoff_id: "h-p", job_id: parentId, scope_id: scopeId, checkout_id: null, before_snapshot: before };
      const report = {
        handoff_id: "h-p", job_id: parentId, scope_id: scopeId, checkout_id: null,
        writer_id: "agent", before_digest: before.digest, after_digest: comparison.after_digest,
        changed_files: comparison.changed_files, diff_digest: comparison.diff_digest, write_status: "COMPLETED",
      };
      const done = handoffMod.completeHandoff(s.db, { report, handoff, changeComparison: comparison, allowedFiles: ["app.js"], reReviewJob: { payload: "re", root: dir, files: "app.js", maxAttempts: 2 } });
      assert.equal(done.ok, true);
      const childId = done.re_review_job_id;
      assert.ok(childId);
      // Child steht aus (QUEUED) — Parent darf NICHT DONE sein.
      assert.equal(loops.getLoopState(s.db, parentId), "RE_REVIEW_QUEUED");
      assert.notEqual(loops.getLoopState(s.db, parentId), "DONE");
      // Parent-Verdict ist WRITE (Job-State), aber Loop läuft weiter (Child ausstehend).
      jobs.jobDone(s.db, parentId, "WRITE", null);
      // advanceLoop(finalize) auf dem PARENT: kein RE_REVIEW_RUNNING → skipped, kein DONE.
      const r = loopflow.advanceLoop(s.db, parentId, { event: "finalize", verdict: "WRITE", scopeId });
      assert.equal(r.ok, true);
      assert.equal(r.skipped, true);
      assert.notEqual(loops.getLoopState(s.db, parentId), "DONE");
      assert.equal(jobs.getJob(s.db, childId).status, "QUEUED");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  } finally {
    s.cleanup();
  }
});

// ── SEC-004 Terminal-Matrix + Atomizität (nachgeschärft 2026-09-03) ──────────
// Der zentrale Test ist NICHT der Happy Path (claim → running → done), sondern
// die Invariante: TERMINAL + beliebiger späterer Versuch einer Loop-Transition
// = TERMINAL unverändert. Und für Fehler: ERROR-Transition = status + loop_state
// als EINE atomare Einheit (jobDone-Transaktionsgrenze).

test("loops: Terminal-Matrix — DONE/ABORTED/ERROR/LOOP_BLOCKED bleiben bei Re-Completion unverändert (SEC-004)", async () => {
  const s = await setupDb();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const handoffMod = await mod("artifacts/handoff.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const scopeId = scopes.createScope(s.db, "Terminal-Matrix-Header").id;
    const dir = tempProject();
    try {
      const changes = await mod("core/changes.mjs");
      const beforeSnap = changes.snapshotRoot(dir, ["app.js"]);
      fs.writeFileSync(path.join(dir, "app.js"), "neu\n");
      const afterSnap = changes.snapshotRoot(dir, ["app.js"]);
      const comparison = changes.compareSnapshots(beforeSnap, afterSnap, { allowedFiles: ["app.js"] });
      for (const terminal of ["DONE", "ABORTED", "ERROR", "LOOP_BLOCKED"]) {
        const p = jobs.createJob(s.db, { scopeId, payload: "p", root: dir, files: "app.js", mode: "write" });
        // Terminaler Zustand + Loop-Limit erreicht: der COMPLETED-Report läuft in
        // die Loop-Limit-Branch, die früher per rohem UPDATE überschrieb.
        s.db.prepare("UPDATE jobs SET loop_state = ?, loop_count = 5, max_loop_count = 5 WHERE id = ?").run(terminal, p);
        const handoff = { handoff_id: `h-${terminal}`, job_id: p, scope_id: scopeId, before_snapshot: beforeSnap };
        const report = {
          handoff_id: `h-${terminal}`, job_id: p, scope_id: scopeId, checkout_id: null,
          writer_id: "a", before_digest: beforeSnap.digest, after_digest: comparison.after_digest,
          changed_files: comparison.changed_files, diff_digest: comparison.diff_digest, write_status: "COMPLETED",
        };
        const r = handoffMod.completeHandoff(s.db, { report, handoff, changeComparison: comparison, allowedFiles: ["app.js"], reReviewJob: { payload: "r", root: dir, files: "app.js" } });
        assert.equal(r.ok, false, `${terminal}: Re-Completion muss abgelehnt werden`);
        assert.equal(loops.getLoopState(s.db, p), terminal, `${terminal} bleibt unverändert (SEC-004)`);
        assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE parent_job_id = ?").get(p).n, 0, `${terminal}: kein Child`);
        assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM loop_events WHERE job_id = ? AND event_type = 'loop_limit'").get(p).n, 0, `${terminal}: kein loop_limit-Event`);
      }
      // NO_CHANGE-/ABORTED-Re-Delivery überschreibt ebenfalls keinen Terminal-Zustand.
      const p = jobs.createJob(s.db, { scopeId, payload: "p", root: dir, files: "app.js", mode: "write" });
      s.db.prepare("UPDATE jobs SET loop_state = 'ABORTED' WHERE id = ?").run(p);
      const h = { handoff_id: "h-re", job_id: p, scope_id: scopeId, before_snapshot: beforeSnap };
      const r2 = handoffMod.completeHandoff(s.db, { report: { handoff_id: "h-re", job_id: p, scope_id: scopeId, checkout_id: null, writer_id: "a", before_digest: beforeSnap.digest, after_digest: beforeSnap.digest, changed_files: [], diff_digest: comparison.diff_digest, write_status: "NO_CHANGE" }, handoff: h, changeComparison: comparison, allowedFiles: ["app.js"] });
      assert.equal(r2.ok, false);
      assert.equal(loops.getLoopState(s.db, p), "ABORTED", "ABORTED bleibt auch nach NO_CHANGE-Re-Delivery unverändert");
      // Loop-Limit auf OFFENEM Produktionspfad (WRITE_AUTHORIZED + RE_REVIEW_QUEUED)
      // → terminales LOOP_BLOCKED (kein illegaler Übergang, kein hängender Loop).
      for (const openState of ["WRITE_AUTHORIZED", "RE_REVIEW_QUEUED"]) {
        const q = jobs.createJob(s.db, { scopeId, payload: "p", root: dir, files: "app.js", mode: "write" });
        s.db.prepare("UPDATE jobs SET loop_state = ?, loop_count = 5, max_loop_count = 5 WHERE id = ?").run(openState, q);
        const hq = { handoff_id: `h-${openState}`, job_id: q, scope_id: scopeId, before_snapshot: beforeSnap };
        const rq = handoffMod.completeHandoff(s.db, { report: { handoff_id: `h-${openState}`, job_id: q, scope_id: scopeId, checkout_id: null, writer_id: "a", before_digest: beforeSnap.digest, after_digest: comparison.after_digest, changed_files: comparison.changed_files, diff_digest: comparison.diff_digest, write_status: "COMPLETED" }, handoff: hq, changeComparison: comparison, allowedFiles: ["app.js"], reReviewJob: { payload: "r", root: dir, files: "app.js" } });
        assert.equal(rq.ok, false);
        assert.equal(loops.getLoopState(s.db, q), "LOOP_BLOCKED", `${openState} am Loop-Limit → LOOP_BLOCKED`);
        assert.ok(rq.reasons.some((x) => /Loop-Limit/.test(x)), `${openState}: ehrliche Loop-Limit-Meldung`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  } finally {
    s.cleanup();
  }
});

test("loops: jobDone ist atomar — rollback einer äußeren Transaktion macht weder status noch loop_state sichtbar (Crash-Boundary)", async () => {
  const s = await setupDb();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const scopeId = scopes.createScope(s.db, "Atomic-Header").id;

    // Re-Review-Kind: RE_REVIEW_QUEUED → Claim → RE_REVIEW_RUNNING.
    const child = jobs.createJob(s.db, { scopeId, payload: "re", root: ".", files: "a.js", mode: "write" });
    s.db.prepare("UPDATE jobs SET loop_state = 'RE_REVIEW_QUEUED' WHERE id = ?").run(child);
    jobs.claimNextJob(s.db, 1, scopeId);
    assert.equal(loops.getLoopState(s.db, child), "RE_REVIEW_RUNNING");

    // Crash-Boundary provozieren: äußere Transaktion offen, jobDone vollzieht
    // finalize (status=DONE + loop DONE) INNERHALB der Transaktion, dann
    // ROLLBACK der äußeren Transaktion (simulierter Absturz vor COMMIT).
    // Wäre jobDone nicht atomar, bliebe status=DONE oder loop DONE sichtbar.
    s.db.exec("BEGIN IMMEDIATE");
    jobs.jobDone(s.db, child, "PLAN", null);
    s.db.exec("ROLLBACK");
    assert.equal(jobs.getJob(s.db, child).status, "RUNNING", "status nach Rollback unverändert (kein DONE sichtbar)");
    assert.equal(loops.getLoopState(s.db, child), "RE_REVIEW_RUNNING", "loop_state nach Rollback unverändert (kein DONE sichtbar)");

    // Gleiches für den ERROR-Pfad: status=ERROR + loop ERROR sind EINE Einheit.
    s.db.exec("BEGIN IMMEDIATE");
    jobs.jobDone(s.db, child, null, "Crash-Test", { failureKind: "worker-crash" });
    s.db.exec("ROLLBACK");
    assert.equal(jobs.getJob(s.db, child).status, "RUNNING", "kein ERROR nach Rollback sichtbar");
    assert.equal(loops.getLoopState(s.db, child), "RE_REVIEW_RUNNING", "kein loop ERROR nach Rollback sichtbar");

    // Standalone (keine äußere Transaktion): SAVEPOINT committet BEIDES atomar.
    const finalized = jobs.jobDone(s.db, child, null, "Worker-Abbruch (Recovery)", { failureKind: "worker-crash" });
    assert.equal(finalized, true);
    assert.equal(jobs.getJob(s.db, child).status, "ERROR Worker-Abbruch (Recovery)");
    assert.equal(loops.getLoopState(s.db, child), "ERROR", "Standalone-jobDone committet status+loop atomar");
  } finally {
    s.cleanup();
  }
});

test("loops: jobDone lehnt einen zweiten Abschluss ab — kein Umschreiben eines finalen Zustands (Immutable-Guard)", async () => {
  const s = await setupDb();
  try {
    const loops = await mod("artifacts/loops.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const scopeId = scopes.createScope(s.db, "Atomic-Immutable-Header").id;

    const child = jobs.createJob(s.db, { scopeId, payload: "re", root: ".", files: "a.js", mode: "write" });
    s.db.prepare("UPDATE jobs SET loop_state = 'RE_REVIEW_QUEUED' WHERE id = ?").run(child);
    jobs.claimNextJob(s.db, 1, scopeId);
    jobs.jobDone(s.db, child, "PLAN", null);
    assert.equal(loops.getLoopState(s.db, child), "DONE");

    // Ein späterer ERROR-Versuch (Crash-Guard nach dem Review-Commit, Abort-
    // Race, Recovery-Double) darf weder status noch loop_state umschreiben.
    const second = jobs.jobDone(s.db, child, null, "Später Fehler");
    assert.equal(second, false, "zweiter Abschluss ist ein No-Op");
    assert.equal(jobs.getJob(s.db, child).status, "DONE PLAN", "Status bleibt DONE PLAN");
    assert.equal(loops.getLoopState(s.db, child), "DONE", "Loop bleibt DONE (kein ERROR über DONE)");
    assert.equal(loops.listLoopEvents(s.db, child).filter((e) => e.event_type === "loop_error").length, 0, "kein loop_error-Event");
  } finally {
    s.cleanup();
  }
});
