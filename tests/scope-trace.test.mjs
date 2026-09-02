// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/scope-trace.test.mjs
// TDD-/Regressionstests für die datenbasierte scope-trace-Erklärung.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runScopeTrace(scopeId, home) {
  return spawnSync(process.execPath, [path.join(ROOT, "cli", "main.mjs"), "scope", "trace", scopeId], {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, FALSIFY_HOME: home },
  });
}

async function seedHome(seed) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-scope-trace-"));
  const previousHome = process.env.FALSIFY_HOME;
  process.env.FALSIFY_HOME = tmp;
  const dbModule = await import("../artifacts/db.mjs");
  const scopeMod = await import("../artifacts/scopes.mjs");
  const jobMod = await import("../artifacts/jobs.mjs");
  const db = dbModule.openDb();
  const scope = await seed({ db, scopeMod, jobMod });
  dbModule.closeDb();
  if (previousHome === undefined) delete process.env.FALSIFY_HOME;
  else process.env.FALSIFY_HOME = previousHome;
  return { tmp, scope };
}

function cleanupHome(home) {
  fs.rmSync(home, { recursive: true, force: true });
}

test("scope trace: je Runde rationale Zeile + Loop-Abschluss, read-only + wiederholbar", async () => {
  const { tmp, scope } = await seedHome(async ({ db, scopeMod, jobMod }) => {
    const scope = scopeMod.createScope(db, "Scope mit Loop und kurzer Erklärung");
    jobMod.createJob(db, { scopeId: scope.id, payload: "p", wave: "scan", mode: "plan", agentIntent: "Erste Annahme: nur Header lesen" });
    jobMod.createJob(db, { scopeId: scope.id, payload: "p", wave: "plan", mode: "plan", agentIntent: "Zweite Annahme: Evidenz prüfen" });
    const ids = db.prepare("SELECT id FROM jobs ORDER BY created_at").all().map((r) => r.id);
    jobMod.jobDone(db, ids[0], "RESEARCH", null);
    jobMod.jobDone(db, ids[1], "PLAN", null);
    scopeMod.addFinding(db, { scopeId: scope.id, jobId: ids[0], round: 1, wave: "scan", mode: "plan", befund: "Runde 1: Recherche nötig", content: "c", verdict: "RESEARCH" });
    scopeMod.addFinding(db, { scopeId: scope.id, jobId: ids[1], round: 2, wave: "plan", mode: "plan", befund: "Runde 2: Gate-Format lückig", content: "c", verdict: "PLAN" });
    scopeMod.updateScopeAfterReview(db, scope.id, "PLAN", "Runde 2: Gate-Format lückig", null, null, null);
    return scope;
  });
  try {
    const r1 = runScopeTrace(scope.id, tmp);
    assert.equal(r1.status, 0, `scope trace exit 0 (stderr: ${r1.stderr})`);
    const out1 = String(r1.stdout);
    assert.match(out1, /^LOOP-TRACE /m, "Trace-Kopf vorhanden");
    assert.match(out1, /HEADER: Scope mit Loop und kurzer Erklärung/, "HEADER im Trace");
    assert.match(out1, /→ diese Runde blieb bei RESEARCH, weil/, "Runde 1 rationale vorhanden");
    assert.match(out1, /→ diese Runde blieb bei PLAN, weil/, "Runde 2 rationale vorhanden");
    assert.match(out1, /Loop-Ausgang: OFFEN/, "Loop-Ausgang OFFEN vorhanden");
    assert.match(out1, /Nächster Schritt:/m, "Nächster Schritt im Loop-Abschluss vorhanden");

    const r2 = runScopeTrace(scope.id, tmp);
    assert.equal(r2.status, 0, `zweiter scope trace exit 0 (stderr: ${r2.stderr})`);
    assert.equal(String(r2.stdout), out1, "scope trace ist wiederholbar und read-only");
  } finally {
    cleanupHome(tmp);
  }
});

test("scope trace: leere und unbekannte IDs liefern saubere CLI-Fehler", async () => {
  const { tmp } = await seedHome(async ({ db, scopeMod }) => scopeMod.createScope(db, "Nur ein Scope"));
  try {
    const missingId = runScopeTrace("scope-existiert-nicht", tmp);
    assert.equal(missingId.status, 2);
    assert.match(missingId.stderr, /Scope nicht gefunden/);
    const emptyId = spawnSync(process.execPath, [path.join(ROOT, "cli", "main.mjs"), "scope", "trace"], {
      encoding: "utf8", timeout: 30000, env: { ...process.env, FALSIFY_HOME: tmp },
    });
    assert.equal(emptyId.status, 2);
    assert.match(emptyId.stderr, /Verwendung: falsify scope trace/);
  } finally {
    cleanupHome(tmp);
  }
});

test("scope trace: fehlendes Finding bleibt ehrlich und ordnet Jobs nach Erstellung", async () => {
  const { tmp, scope } = await seedHome(async ({ db, scopeMod, jobMod }) => {
    const scope = scopeMod.createScope(db, "Unvollständiger Loop");
    const first = jobMod.createJob(db, { scopeId: scope.id, payload: "first", wave: "first", mode: "plan" });
    const second = jobMod.createJob(db, { scopeId: scope.id, payload: "second", wave: "second", mode: "plan" });
    jobMod.jobDone(db, first, "PLAN", null);
    jobMod.jobDone(db, second, "WRITE", null);
    scopeMod.addFinding(db, { scopeId: scope.id, jobId: second, round: 2, wave: "second", mode: "write", befund: null, content: "", verdict: "WRITE" });
    return scope;
  });
  try {
    const result = runScopeTrace(scope.id, tmp);
    assert.equal(result.status, 0);
    const out = String(result.stdout);
    assert.match(out, /Welle first · DONE PLAN/);
    assert.match(out, /Welle second · DONE WRITE/);
    assert.match(out, /keine eindeutige Begründung in den gespeicherten Daten/);
    assert.match(out, /Runde 2|WRITE/);
  } finally {
    cleanupHome(tmp);
  }
});

test("scope trace: Divergenz-Anker wird als Grund des offenen Loops priorisiert", async () => {
  const { tmp, scope } = await seedHome(async ({ db, scopeMod, jobMod }) => {
    const scope = scopeMod.createScope(db, "Divergenter Scope");
    const job = jobMod.createJob(db, { scopeId: scope.id, payload: "p", wave: "plan", mode: "plan", agentIntent: "Coder versteht Änderung A" });
    jobMod.jobDone(db, job, "PLAN", null);
    scopeMod.addFinding(db, { scopeId: scope.id, jobId: job, round: 1, wave: "plan", mode: "plan", befund: "Falsifikation versteht Änderung B", content: "c", verdict: "PLAN" });
    scopeMod.updateScopeAfterReview(db, scope.id, "PLAN", "Falsifikation versteht Änderung B", null, "Coder und Falsifikation meinen unterschiedliche Änderungen", null);
    return scope;
  });
  try {
    const result = runScopeTrace(scope.id, tmp);
    assert.equal(result.status, 0);
    const out = String(result.stdout);
    assert.match(out, /Offene Divergenz \(Loop-Anker\): Coder und Falsifikation meinen unterschiedliche Änderungen/);
    assert.match(out, /Loop-Ausgang: OFFEN — die Scope-Divergenz hält den Loop offen/);
    assert.match(out, /Divergenz-Anker präzisieren/);
  } finally {
    cleanupHome(tmp);
  }
});

test("scope trace: geschlossener Scope erhält GESCHLOSSEN-Abschluss", async () => {
  const { tmp, scope } = await seedHome(async ({ db, scopeMod, jobMod }) => {
    const scope = scopeMod.createScope(db, "Geschlossener Scope");
    const job = jobMod.createJob(db, { scopeId: scope.id, payload: "p", wave: "scan", mode: "write" });
    jobMod.jobDone(db, job, "WRITE", null);
    scopeMod.addFinding(db, { scopeId: scope.id, jobId: job, round: 1, wave: "scan", mode: "write", befund: "Falsifikation bestanden", content: "c", verdict: "WRITE" });
    scopeMod.updateScopeAfterReview(db, scope.id, "WRITE", "Falsifikation bestanden", null, null, null);
    return scope;
  });
  try {
    const result = runScopeTrace(scope.id, tmp);
    assert.equal(result.status, 0);
    const out = String(result.stdout);
    assert.match(out, /Loop-Ausgang: GESCHLOSSEN/);
    assert.match(out, /freigegebene Änderung umsetzen/);
  } finally {
    cleanupHome(tmp);
  }
});
