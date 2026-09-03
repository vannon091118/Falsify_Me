import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, closeDb } from "../artifacts/db.mjs";
import {
  appendDecisionRecord,
  initAnchor,
  parseAnchor,
  parseDecisionRecords,
  validateAnchorForRoot,
} from "../core/identity.mjs";
import {
  assertAnchorBinding,
  bindAnchor,
  checkProjectConsistency,
  requireProjectIdentity,
} from "../artifacts/projects.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tempRoot(prefix = "falsify-identity-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withHome() {
  const previous = process.env.FALSIFY_HOME;
  const home = tempRoot("falsify-identity-home-");
  process.env.FALSIFY_HOME = home;
  return {
    home,
    restore() {
      closeDb();
      if (previous === undefined) delete process.env.FALSIFY_HOME;
      else process.env.FALSIFY_HOME = previous;
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

function setup(root) {
  const anchor = initAnchor(root);
  assert.equal(anchor.ok, true, anchor.message);
  const db = openDb();
  bindAnchor(db, anchor, root);
  return { anchor, db };
}

test("anchor: mintet stabil, validiert nur gegen den gebundenen Root", () => {
  const root = tempRoot();
  const copy = tempRoot();
  try {
    const anchor = initAnchor(root);
    assert.equal(anchor.ok, true, anchor.message);
    assert.equal(validateAnchorForRoot(root).ok, true);
    assert.equal(validateAnchorForRoot(copy).ok, false);
    const copied = fs.readFileSync(path.join(root, "FalsifyME.md"), "utf8");
    fs.writeFileSync(path.join(copy, "FalsifyME.md"), copied);
    const copiedResult = validateAnchorForRoot(copy);
    assert.equal(copiedResult.ok, false);
    assert.equal(copiedResult.code, "ANCHOR_ROOT_NAME");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test("anchor init: .gitignore schuetzt FalsifyME.md (kein Mitpushen, idempotent)", () => {
  // User-Ticket 2026-09-03: Bootstrap darf den Anker nicht ins User-Repo
  // pushen lassen — initAnchor traegt /FalsifyME.md in die .gitignore ein.
  const root = tempRoot();
  try {
    fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\ndist/\n");
    const anchor = initAnchor(root);
    assert.equal(anchor.ok, true, anchor.message);
    let gi = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    assert.ok(gi.includes("node_modules/"), "bestehende .gitignore-Inhalte bleiben erhalten");
    assert.ok(gi.includes("/FalsifyME.md"), "Anker wird ignoriert (nicht committen/pushen)");
    // Zweiter Lauf idempotent: genau ein markierter Block, genau ein Eintrag.
    initAnchor(root);
    gi = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    assert.equal(gi.match(/\/FalsifyME\.md/g).length, 1, "kein Doppel-Eintrag");
    assert.ok(fs.existsSync(path.join(root, "FalsifyME.md")), "Anker existiert weiterhin");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("anchor: Payload- und Records-Tampering fail-closed", () => {
  const root = tempRoot();
  try {
    const anchor = initAnchor(root);
    assert.equal(anchor.ok, true, anchor.message);
    const file = path.join(root, "FalsifyME.md");
    const original = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, original.replace("ROOT_NAME=", "ROOT_NAME=changed-"));
    assert.equal(validateAnchorForRoot(root).ok, false);
    fs.writeFileSync(file, original);
    const record = appendDecisionRecord(root, {
      id: "decision-1",
      type: "user-decision",
      source: "test",
      content: "User confirmed the scope.",
      createdAt: new Date().toISOString(),
      confirmed: true,
    });
    assert.equal(record.ok, true, record.message);
    const withRecord = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, `${withRecord}\nUntrusted: injected\n`);
    const parsed = validateAnchorForRoot(root);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "RECORD_UNKNOWN_FIELD");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("decision records: confirmation and newline injection are rejected", () => {
  const root = tempRoot();
  try {
    assert.equal(appendDecisionRecord(root, {
      id: "x",
      type: "notiz",
      source: "test",
      content: "not allowed",
      createdAt: new Date().toISOString(),
      confirmed: false,
    }).code, "RECORD_CONFIRMATION");
    const anchor = initAnchor(root);
    assert.equal(anchor.ok, true, anchor.message);
    const base = { id: "x", type: "notiz", source: "test", createdAt: new Date().toISOString() };
    assert.equal(appendDecisionRecord(root, { ...base, content: "x", confirmed: false }).code, "RECORD_CONFIRMATION");
    assert.equal(appendDecisionRecord(root, { ...base, content: "x\ny", confirmed: true }).code, "RECORD_CONTENT");
    assert.equal(appendDecisionRecord(root, { ...base, content: "x", source: "a\nb", confirmed: true }).code, "RECORD_SOURCE");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project binding: two roots stay separate and mismatches are detected", () => {
  const env = withHome();
  const first = tempRoot();
  const second = tempRoot();
  try {
    const { anchor: a1, db } = setup(first);
    const a2 = initAnchor(second, { projectId: a1.value.projectId });
    assert.equal(a2.ok, true, a2.message);
    bindAnchor(db, a2, second);
    assert.notEqual(a1.value.checkoutId, a2.value.checkoutId);
    assert.equal(requireProjectIdentity(db, first).checkout.checkout_id, a1.value.checkoutId);
    assert.equal(requireProjectIdentity(db, second).checkout.checkout_id, a2.value.checkoutId);
    assert.equal(checkProjectConsistency(db).ok, true);
    assert.throws(() => bindAnchor(db, a1, second), /Anchor-Root-Bindung|anderen Projekt-Root/);
  } finally {
    env.restore();
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test("parser: unknown record fields and malformed blocks fail closed", () => {
  const root = tempRoot();
  try {
    const anchor = initAnchor(root);
    assert.equal(anchor.ok, true, anchor.message);
    const text = fs.readFileSync(path.join(root, "FalsifyME.md"), "utf8");
    const headerOnly = text.replace(/\n## User-confirmed decision records[\s\S]*$/, "");
    const malformed = `${headerOnly}\n## User-confirmed decision records\n\n### Record x\nType: notiz\nUnexpected line\n`;
    const parsed = parseDecisionRecords(malformed);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "RECORD_UNKNOWN_FIELD");
    assert.equal(parseAnchor(text).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── CLI-Lifecycle (`falsify anchor …`): die öffentlichen Befehle müssen
// denselben Vertrag erzwingen wie die Module (fail-closed, keine Still-Upgrade
// von Legacy-Zuständen). Getestet über den echten Einstieg (cli/main.mjs) mit
// isolierter FALSIFY_HOME – kein Mock, kein Modul-Doppel.
test("anchor CLI: init → check → record → clone über den echten Einstieg", () => {
  const home = tempRoot("falsify-identity-cli-home-");
  const root = tempRoot("falsify-identity-cli-root-");
  const target = tempRoot("falsify-identity-cli-clone-");
  const env = { ...process.env, FALSIFY_HOME: home };
  const main = path.join(REPO_ROOT, "cli", "main.mjs");
  const run = (...args) => spawnSync(process.execPath, [main, "anchor", ...args], {
    encoding: "utf8", timeout: 60000, env, cwd: REPO_ROOT,
  });
  try {
    // init: legt den Anker an und registriert ihn in SQLite.
    const init = run("init", "--root", root);
    assert.equal(init.status, 0, init.stderr);
    assert.match(init.stdout, /FALSIFYME_ANCHOR=angelegt/);
    const checkoutId = (init.stdout.match(/CHECKOUT_ID=(\S+)/) || [])[1];
    assert.ok(checkoutId, "CHECKOUT_ID ausgegeben");

    // init ist idempotent: zweiter Aufruf erkennt den vorhandenen Anker.
    const again = run("init", "--root", root);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /FALSIFYME_ANCHOR=vorhanden/);
    assert.equal((again.stdout.match(/CHECKOUT_ID=(\S+)/) || [])[1], checkoutId, "kein neuer Checkout bei erneutem init");

    // check: verifiziert Anker + SQLite-Bindung, ohne zu schreiben.
    const check = run("check", "--root", root);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /FALSIFYME_ANCHOR=OK/);
    assert.match(check.stdout, new RegExp(`CHECKOUT_ID=${checkoutId}`));

    // record: bestätigter Decision-Record landet im Anker und sync't SQLite.
    const rec = run("record", "user-decision", "--root", root, "--id", "decision-cli-1",
      "--source", "user chat", "--content", "User confirmed the CLI lifecycle contract.", "--confirm");
    assert.equal(rec.status, 0, rec.stderr);
    assert.match(rec.stdout, /RECORD_ID=decision-cli-1/);
    const anchorText = fs.readFileSync(path.join(root, "FalsifyME.md"), "utf8");
    assert.match(anchorText, /### Record decision-cli-1/);
    const afterRecord = run("check", "--root", root);
    assert.equal(afterRecord.status, 0, afterRecord.stderr, "Anker+SQLite nach Record synchron");

    // record ohne --confirm: fail-closed (Exit 2, keine persistente Änderung).
    const recDigest = fs.readFileSync(path.join(root, "FalsifyME.md"), "utf8");
    const unconfirmed = run("record", "notiz", "--root", root, "--id", "decision-cli-2",
      "--source", "agent", "--content", "Not confirmed.");
    assert.equal(unconfirmed.status, 2, "ohne --confirm kein Erfolg");
    assert.equal(fs.readFileSync(path.join(root, "FalsifyME.md"), "utf8"), recDigest, "Anker unverändert");

    // clone: neuer physischer Checkout, gleiche PROJECT_ID, eigener Checkout-Eintrag.
    const clone = run("clone", "--from", root, "--root", target);
    assert.equal(clone.status, 0, clone.stderr);
    assert.match(clone.stdout, /FALSIFYME_ANCHOR=CLONED/);
    const projectId = (init.stdout.match(/PROJECT_ID=(\S+)/) || [])[1];
    assert.equal((clone.stdout.match(/PROJECT_ID=(\S+)/) || [])[1], projectId, "logische Projekt-ID wandert mit");
    const cloneCheckout = (clone.stdout.match(/CHECKOUT_ID=(\S+)/) || [])[1];
    assert.notEqual(cloneCheckout, checkoutId, "physische Checkout-ID ist neu");
    const cloneCheck = run("check", "--root", target);
    assert.equal(cloneCheck.status, 0, cloneCheck.stderr);
    assert.match(fs.readFileSync(path.join(target, "FalsifyME.md"), "utf8"), /### Record decision-cli-1/, "Records wandern explizit mit (bewusster Lifecycle-Act)");
  } finally {
    closeDb();
    for (const dir of [home, root, target]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("anchor CLI: check ohne Registrierung fail-closed (kein Still-Promote)", () => {
  const home = tempRoot("falsify-identity-cli-home2-");
  const root = tempRoot("falsify-identity-cli-orphan-");
  const env = { ...process.env, FALSIFY_HOME: home };
  try {
    // Anker-Datei existiert, wurde aber NIE in SQLite registriert: check muss
    // verweigern (fail-closed), nicht still als gültig durchgehen.
    const created = initAnchor(root);
    assert.equal(created.ok, true, created.message);
    const check = spawnSync(process.execPath, [path.join(REPO_ROOT, "cli", "main.mjs"), "anchor", "check", "--root", root], {
      encoding: "utf8", timeout: 60000, env, cwd: REPO_ROOT,
    });
    assert.notEqual(check.status, 0, "unregistrierter Anker darf nicht als OK durchgehen");
    assert.match(check.stderr, /FEHLER/i);
  } finally {
    closeDb();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
