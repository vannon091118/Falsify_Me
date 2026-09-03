// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/ticketflow.test.mjs – Ticket-Workflow & Auto-Scope (UI-127)
// -----------------------------------------------------------------------------
// Deckt ab: resolveScopeForCheckout (new/continue/ambiguous, Terminale zaehlen
// nicht), Submit --header (Auto-Anlage + Fortsetzung an DEMSELBEN Scope ohne
// Scope-ID), ambiguous fail-closed (Exit 2, kein Job), Warnung bei unscoped
// Submit, `falsify start` (new/continue/ambiguous), `falsify resume`
// (offene Auftraege + --header), `falsify history` (Wirkung/Freigaben).
// Isoliertes FALSIFY_HOME (mkdtemp), kein Live-Key, kein Dock, keine echte
// Queue-Ausfuehrung (Submit only queued).
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

function withTempHome(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix || "falsify-ticket-"));
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

async function fixtureProject() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-ticket-proj-"));
  fs.mkdirSync(path.join(proj, "src"), { recursive: true });
  fs.writeFileSync(path.join(proj, "src", "app.js"), "export const ok = true;\n");
  return proj;
}

async function registerAnchor(root) {
  const identity = await mod("core/identity.mjs");
  const projects = await mod("artifacts/projects.mjs");
  const anchor = identity.initAnchor(root);
  assert.equal(anchor.ok, true, anchor.message);
  const db = (await mod("artifacts/db.mjs")).openDb();
  projects.bindAnchor(db, anchor, root);
  (await mod("artifacts/db.mjs")).closeDb();
  return anchor;
}

function runCli(args, envHome) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "cli", "main.mjs"), ...args], {
      cwd: ROOT,
      env: { ...process.env, FALSIFY_HOME: envHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    child.on("close", (code) => resolve({ code, out }));
  });
}

function runSubmit(args, envHome) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "cli", "run.mjs"), "--submit", ...args], {
      cwd: ROOT,
      env: { ...process.env, FALSIFY_HOME: envHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    child.on("close", (code) => resolve({ code, out }));
  });
}

test("resolveScopeForCheckout: new → continue → ambiguous, Terminale zaehlen nicht", async () => {
  const h = withTempHome();
  try {
    // Zwei echte Checkouts (Anker an zwei Projekt-Kopien), damit FK-Bindungen gelten.
    const p1 = await fixtureProject();
    const p2 = await fixtureProject();
    const c1 = (await registerAnchor(p1)).value.checkoutId;
    const c2 = (await registerAnchor(p2)).value.checkoutId;
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, resolveScopeForCheckout, updateScopeAfterReview } = await mod("artifacts/scopes.mjs");
    const db = openDb();
    const ticket = "Ticket fuer die Aufloesungs-Matrix";
    assert.equal(resolveScopeForCheckout(db, c1, ticket).kind, "new");

    const s1 = createScope(db, ticket, { checkoutId: c1 });
    assert.equal(resolveScopeForCheckout(db, c1, ticket).kind, "continue");
    assert.equal(resolveScopeForCheckout(db, c1, ticket).scope.id, s1.id);

    // Terminal (hardened/done) zaehlt NICHT → wieder new (abgeschlossenes Ticket startet frisch).
    updateScopeAfterReview(db, s1.id, "WRITE", "Bestaetigt", "sub", "SCOPE-KONFORM", null);
    assert.equal(resolveScopeForCheckout(db, c1, ticket).kind, "new");

    const a = createScope(db, ticket, { checkoutId: c1 });
    const b = createScope(db, ticket, { checkoutId: c1 });
    assert.equal(resolveScopeForCheckout(db, c1, ticket).kind, "ambiguous");
    assert.equal(resolveScopeForCheckout(db, c1, ticket).scopes.length, 2);
    assert.equal(resolveScopeForCheckout(db, c1, "anderes Ticket").kind, "new");
    // checkout-getrennt: identischer Header in anderem Checkout kollidiert nicht
    assert.equal(resolveScopeForCheckout(db, c2, ticket).kind, "new");
    assert.equal(a.id !== b.id, true);
    closeDb();
    fs.rmSync(p1, { recursive: true, force: true });
    fs.rmSync(p2, { recursive: true, force: true });
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});

test("Submit --header: Auto-Anlage + Fortsetzung am selben Scope ohne Scope-ID", async () => {
  const h = withTempHome();
  try {
    const proj = await fixtureProject();
    const anchor = await registerAnchor(proj);
    const planFile = path.join(h.tmp, "plan.txt");
    fs.writeFileSync(planFile, "Iterations-Plan");

    const args = (p) => ["--header", p, "--plan-file", planFile, "--root", proj, "--files", "src/app.js"];

    const first = await runSubmit(args("Ticket A"), h.tmp);
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /Scope automatisch bestimmt: scope-/);
    assert.match(first.out, /neuer Scope fuer das Ticket/);

    // Zweite Einreichung desselben Tickets OHNE Scope-ID → Fortsetzung desselben Scopes.
    const second = await runSubmit(args("Ticket A"), h.tmp);
    assert.equal(second.code, 0, second.out);
    assert.match(second.out, /Fortsetzung des offenen Tickets/);
    assert.doesNotMatch(second.out, /neuer Scope fuer das Ticket/);

    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const db = openDb();
    const jobs = db.prepare("SELECT scope_id FROM jobs ORDER BY created_at ASC").all();
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].scope_id, jobs[1].scope_id, "beide Jobs haengen am selben automatisch bestimmten Scope");
    const scopes = db.prepare("SELECT * FROM scopes").all();
    assert.equal(scopes.length, 1, "genau EIN Scope angelegt (kein Duplikat)");
    assert.equal(scopes[0].checkout_id, anchor.value.checkoutId);
    closeDb();
    fs.rmSync(proj, { recursive: true, force: true });
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});

test("Submit --header: mehrere offene Scopes mit identischem Ticket → fail-closed Exit 2, kein Job", async () => {
  const h = withTempHome();
  try {
    const proj = await fixtureProject();
    const anchor = await registerAnchor(proj);
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope } = await mod("artifacts/scopes.mjs");
    const db = openDb();
    createScope(db, "Doppeltes Ticket", { checkoutId: anchor.value.checkoutId });
    createScope(db, "Doppeltes Ticket", { checkoutId: anchor.value.checkoutId });
    closeDb();

    const planFile = path.join(h.tmp, "plan.txt");
    fs.writeFileSync(planFile, "Plan");
    const r = await runSubmit(["--header", "Doppeltes Ticket", "--plan-file", planFile, "--root", proj, "--files", "src/app.js"], h.tmp);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /Mehrere offene Scopes mit identischem Ticket/);
    const db2 = openDb();
    assert.equal(db2.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, 0, "kein Job bei Mehrdeutigkeit");
    closeDb();
    fs.rmSync(proj, { recursive: true, force: true });
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});

test("Submit ohne --header und ohne --scope: ehrliche Warnung (kein stiller Modus)", async () => {
  const h = withTempHome();
  try {
    const proj = await fixtureProject();
    await registerAnchor(proj);
    const planFile = path.join(h.tmp, "plan.txt");
    fs.writeFileSync(planFile, "Direkt-CI-Plan");
    const r = await runSubmit(["--plan-file", planFile, "--root", proj, "--files", "src/app.js"], h.tmp);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Job OHNE Scope-Anker und OHNE Ticket/);
    fs.rmSync(proj, { recursive: true, force: true });
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});

test("falsify start: neues Ticket legt Scope an, offenes Ticket zeigt Fortsetzung, Mehrdeutigkeit exit 2", async () => {
  const h = withTempHome();
  try {
    const proj = await fixtureProject();
    const anchor = await registerAnchor(proj);

    const first = await runCli(["start", "UX-Ticket fuer start", "--root", proj], h.tmp);
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /Scope automatisch angelegt: scope-/);
    assert.match(first.out, /falsify submit --header "UX-Ticket fuer start"/);

    // Gleiches Ticket → Fortsetzung (keine zweite Anlage).
    const second = await runCli(["start", "UX-Ticket fuer start", "--root", proj], h.tmp);
    assert.equal(second.code, 0, second.out);
    assert.match(second.out, /Offenes Ticket gefunden → Fortsetzung/);
    assert.doesNotMatch(second.out, /Scope automatisch angelegt/);

    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const db = openDb();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM scopes").get().n, 1);
    assert.equal(db.prepare("SELECT checkout_id FROM scopes").get().checkout_id, anchor.value.checkoutId);
    closeDb();

    // Mehrdeutig: zweiten aktiven Scope manuell erzwingen, dann start → Exit 2.
    const db2 = openDb();
    const { createScope } = await mod("artifacts/scopes.mjs");
    createScope(db2, "UX-Ticket fuer start", { checkoutId: anchor.value.checkoutId });
    closeDb();
    const amb = await runCli(["start", "UX-Ticket fuer start", "--root", proj], h.tmp);
    assert.equal(amb.code, 2, amb.out);
    assert.match(amb.out, /Mehrere offene Scopes mit identischem Ticket/);
    fs.rmSync(proj, { recursive: true, force: true });
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});

test("falsify resume: offene Auftraege ohne Scope-ID + gezielt per --header", async () => {
  const h = withTempHome();
  try {
    const proj = await fixtureProject();
    const anchor = await registerAnchor(proj);
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, updateScopeAfterReview, addFinding } = await mod("artifacts/scopes.mjs");
    const db = openDb();
    const s = createScope(db, "Resume-Ticket", { checkoutId: anchor.value.checkoutId });
    addFinding(db, { scopeId: s.id, jobId: "job-1", round: 1, mode: "plan", befund: "Plan unklar", verdict: "PLAN" });
    updateScopeAfterReview(db, s.id, "PLAN", "Plan unklar", "sub", "SCOPE-DIVERGENZ: anderer Ansatz", null);
    closeDb();

    const list = await runCli(["resume", "--root", proj], h.tmp);
    assert.equal(list.code, 0, list.out);
    assert.match(list.out, /Offene Auftraege dieses Projekts/);
    assert.match(list.out, /Resume-Ticket/);
    assert.match(list.out, /falsify submit --header "Resume-Ticket"/);
    assert.match(list.out, /Offene Scope-Divergenz/);

    const byHeader = await runCli(["resume", "--header", "Resume-Ticket", "--root", proj], h.tmp);
    assert.equal(byHeader.code, 0, byHeader.out);
    assert.match(byHeader.out, /Resume-Ticket/);
    assert.match(byHeader.out, /PLAN×1/);

    const unknown = await runCli(["resume", "--header", "Fremdes Ticket", "--root", proj], h.tmp);
    assert.equal(unknown.code, 0, unknown.out);
    assert.match(unknown.out, /Kein offener Scope mit diesem Ticket/);
    fs.rmSync(proj, { recursive: true, force: true });
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});

test("falsify history: Wirkung je Auftrag (Freigaben/Blockaden) + Detail --scope", async () => {
  const h = withTempHome();
  try {
    const proj = await fixtureProject();
    const anchor = await registerAnchor(proj);
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const { createScope, updateScopeAfterReview, addFinding } = await mod("artifacts/scopes.mjs");
    const db = openDb();
    const s = createScope(db, "History-Ticket", { checkoutId: anchor.value.checkoutId });
    addFinding(db, { scopeId: s.id, jobId: "j1", round: 1, mode: "plan", befund: "Luecke in a", verdict: "PLAN" });
    updateScopeAfterReview(db, s.id, "PLAN", "Luecke in a", "sub", null, null);
    addFinding(db, { scopeId: s.id, jobId: "j2", round: 2, mode: "plan", befund: "Bestaetigt mit Probe", verdict: "WRITE" });
    updateScopeAfterReview(db, s.id, "WRITE", "Bestaetigt mit Probe", "sub", "SCOPE-KONFORM", null);
    closeDb();

    const list = await runCli(["history", "--last", "5"], h.tmp);
    assert.equal(list.code, 0, list.out);
    assert.match(list.out, /History-Ticket/);
    assert.match(list.out, /HART/);
    assert.match(list.out, /1 Freigabe\(n\) \(WRITE\)/);
    assert.match(list.out, /1 Blockade\(n\) \(PLAN\/RESEARCH\)/);

    const detail = await runCli(["history", "--scope", s.id], h.tmp);
    assert.equal(detail.code, 0, detail.out);
    assert.match(detail.out, /Runde 1/);
    assert.match(detail.out, /Runde 2/);
    assert.match(detail.out, /Gehaertet:/);
    fs.rmSync(proj, { recursive: true, force: true });
  } finally {
    const { closeDb } = await mod("artifacts/db.mjs");
    try { closeDb(); } catch { /* egal */ }
    h.cleanup();
  }
});
