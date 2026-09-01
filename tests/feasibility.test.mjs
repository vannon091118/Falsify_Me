// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/feasibility.test.mjs – Umsetzbarkeits-Puffer (Intent → Execution)
// Prüft core/feasibility.mjs gegen echte Temp-Dateien (read-only, deterministisch).
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkFeasibility, SEV } from "../core/feasibility.mjs";

function withFiles(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "feas-"));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(root, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content ?? "", "utf8");
  }
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("leerer Plan blockt immer (feasible=false, kein Modell-Call nötig)", () => {
  const t = withFiles({ "app.js": "" });
  try {
    const r = checkFeasibility({ header: "App fixen", planText: "   ", root: t.root, whitelist: ["app.js"] });
    assert.equal(r.feasible, false);
    assert.ok(r.blocks.some((b) => b.includes("Kein Plan")));
  } finally { t.cleanup(); }
});

test("fehlende Whitelist-Datei -> Block (Datei existiert nicht unter root, OHNE Verdict-Steuerwort)", () => {
  const t = withFiles({ "app.js": "" });
  try {
    const r = checkFeasibility({ header: "Auth fixen", planText: "Auth in app.js prüfen", root: t.root, whitelist: ["app.js", "fehlt.js"] });
    assert.equal(r.feasible, false);
    assert.ok(r.blocks.join(" ").includes("existieren nicht"), "Plural-Meldung: Whitelist-Dateien existieren nicht");
    // E2E-Befund 3 (2026-09-01): feasibility redet KEINE Verdict-Sprache -
    // Verdict-Steuerwörter (RESEARCH/PLAN/WRITE) gehören nicht in block-Text.
    assert.ok(!/\b(?:RESEARCH|PLAN|WRITE)\b/.test(r.blocks.join(" ")), "kein Verdict-Steuerwort im Block");
  } finally { t.cleanup(); }
});

test("Whitelist ..-Traversal blockt (Pfadsicherheit, kein Escape)", () => {
  const t = withFiles({ "app.js": "" });
  try {
    const r = checkFeasibility({ header: "X", planText: "app.js ändern", root: t.root, whitelist: ["../geheim.txt"] });
    assert.equal(r.feasible, false);
    assert.ok(r.blocks.join(" ").includes("verlässt"));
  } finally { t.cleanup(); }
});

test("Diff ausserhalb des Zugriffsrahmens blockt (Regel 5: Struktur-Kohärenz)", () => {
  const t = withFiles({ "app.js": "", "lib/extra.js": "", "geheim.js": "" });
  try {
    const r = checkFeasibility({
      header: "Auth fixen", planText: "Auth in app.js prüfen", root: t.root,
      whitelist: ["app.js", "lib/extra.js"],
      diffText: "--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n-x\n+y\n--- a/geheim.js\n+++ b/geheim.js\n+z\n",
    });
    assert.equal(r.feasible, false);
    assert.ok(r.blocks.some((b) => b.includes("geheim.js")), "Diff-Datei ausserhalb des Rahmens blockt");
    assert.ok(!/\b(?:RESEARCH|PLAN|WRITE)\b/.test(r.blocks.join(" ")), "kein Verdict-Steuerwort");
  } finally { t.cleanup(); }
});

test("Plan↔Diff-Divergenz blockt (Plan nennt X, Aenderung betrifft Y)", () => {
  const t = withFiles({ "app.js": "", "lib/extra.js": "", "lib/y.js": "" });
  try {
    const r = checkFeasibility({
      header: "Auth fixen", planText: "Auth in app.js fixen", root: t.root,
      whitelist: ["app.js", "lib/y.js"],
      diffText: "--- a/lib/y.js\n+++ b/lib/y.js\n@@ -1 +1 @@\n-x\n+y\n",
    });
    assert.equal(r.feasible, false);
    assert.ok(r.blocks.some((b) => /Plan nennt app\.js/.test(b) && /lib\/y\.js/.test(b)), "Divergenz Plan↔Diff blockt");
  } finally { t.cleanup(); }
});

test("Plan↔Diff konsistent: Diff berührt genau die genannten Dateien -> kein Block", () => {
  const t = withFiles({ "app.js": "" });
  try {
    const r = checkFeasibility({
      header: "Auth fixen", planText: "Auth in app.js fixen", root: t.root,
      whitelist: ["app.js"],
      diffText: "--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n-x\n+y\n",
    });
    assert.equal(r.feasible, true, "konsistente Einreichung bleibt frei");
  } finally { t.cleanup(); }
});

test("Plan nennt existierende Datei ausserhalb Whitelist -> nur Warning (Zugriffsrahmen), nicht blockend", () => {
  const t = withFiles({ "app.js": "", "lib/extra.js": "" });
  try {
    const r = checkFeasibility({ header: "App fixen", planText: "Ändere app.js und lib/extra.js", root: t.root, whitelist: ["app.js"] });
    assert.equal(r.feasible, true, "extrahierte Pfade, die existieren, duerfen nicht blocken");
    assert.ok(
      r.findings.some((f) => f.severity === SEV.WARNING && f.text.includes("ausserhalb der Zugriffs-Whitelist")),
      "Warnung: Datei ausserhalb der Whitelist nennt Zugriffsrahmen-Problem",
    );
  } finally { t.cleanup(); }
});

test("Plan nennt nicht existierende Datei -> Warning (Annahmen kennzeichnen)", () => {
  const t = withFiles({ "app.js": "" });
  try {
    const r = checkFeasibility({ header: "App fixen", planText: "Neue Datei util/helper.js anlegen", root: t.root, whitelist: ["app.js"] });
    assert.equal(r.feasible, true, "Ankündigung einer neuen Datei ist kein Umsetzbarkeits-Block");
    assert.ok(r.findings.some((f) => f.text.includes("util/helper.js")));
  } finally { t.cleanup(); }
});

test("Intent-Drift: Plan ohne signifikante Header-Begriffe -> Warnung", () => {
  const t = withFiles({ "app.js": "" });
  try {
    const r = checkFeasibility({ header: "Login-Absicherung mit JWT-Rotation für alle Endpunkte umsetzen", planText: "Datei öffnen und Doku lesen - kein konkreter Bezug", root: t.root, whitelist: ["app.js"] });
    assert.equal(r.feasible, true);
    assert.ok(r.findings.some((f) => f.text.includes("Intent-Drift")), "Header-Bezug fehlt -> Warnung erwartet");
  } finally { t.cleanup(); }
});

test("Intent-Passung: Plan zitiert Header-Begriffe -> keine Drift-Warnung; voller Lauf bleibt feasible", () => {
  const t = withFiles({ "app.js": "x", "lib/auth.js": "y" });
  try {
    const r = checkFeasibility({ header: "Login-Absicherung mit JWT-Rotation für alle Endpunkte umsetzen", planText: "JWT-Rotation in allen Endpunkten: app.js + lib/auth.js anpassen", root: t.root, whitelist: ["app.js", "lib/auth.js"] });
    assert.equal(r.feasible, true);
    assert.equal(r.findings.some((f) => f.text.includes("Intent-Drift")), false);
    assert.equal(r.blocks.length, 0);
  } finally { t.cleanup(); }
});