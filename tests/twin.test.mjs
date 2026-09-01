// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/twin.test.mjs – Unabhängige Gegenprüfung (Regel 6, UI-104)
// -----------------------------------------------------------------------------
// Deckt ab: extractClaims (DE/EN-Abschnitt, Abbruch am nächsten Header),
// parseTwinVerdict (strenge Lesart, fail-closed Default), runTwinCheck
// (Kontext-Trennung: nur header/plan/befund/claims – nie Erst-Reasoning;
// Twin-System-Prompt; Fail-closed bei Runner-Fehler/leerer Antwort) und den
// Persistenz-Vertrag der evil-twin-Welle in findings.wave.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const savedHome = process.env.FALSIFY_HOME;

function withTempHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-twin-"));
  process.env.FALSIFY_HOME = tmp;
  return {
    tmp,
    async cleanup() {
      try { (await mod("artifacts/db.mjs")).closeDb(); } catch { /* egal */ }
      for (let i = 0; i < 10; i++) {
        try { fs.rmSync(tmp, { recursive: true, force: true }); break; }
        catch (e) { if (i === 9) throw e; await new Promise((r) => setTimeout(r, 60)); }
      }
      if (savedHome === undefined) delete process.env.FALSIFY_HOME;
      else process.env.FALSIFY_HOME = savedHome;
    },
  };
}

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

const SAMPLE = `## Falsifikationsversuche
1. Racy: setWorkerScope laeuft nach dem Claim – Code artifacts/jobs.mjs:41
2. Luecke: list_dir leakt Namen – core/tools.mjs:88
## Was haelt stand
Der Rest.
## Empfehlung
Fixen.
BEFUND: Zwei belegte Schwächen.
VERDICT: PLAN`;

test("extractClaims: DE-Abschnitt wird extrahiert, endet am nächsten Header", async () => {
  const { extractClaims } = await mod("core/twin.mjs");
  const claims = extractClaims(SAMPLE);
  assert.match(claims, /1\. Racy: setWorkerScope/);
  assert.match(claims, /2\. Luecke: list_dir/);
  assert.doesNotMatch(claims, /Was haelt stand/);
  assert.doesNotMatch(claims, /BEFUND:/);
});

test("extractClaims: EN-Header wird erkannt", async () => {
  const { extractClaims } = await mod("core/twin.mjs");
  const claims = extractClaims(
    "## Falsification attempts\n1. Bug in artifacts/jobs.mjs\n## What holds up\nnothing"
  );
  assert.match(claims, /1\. Bug in artifacts\/jobs\.mjs/);
  assert.doesNotMatch(claims, /What holds up/);
});

test("extractClaims: kein Abschnitt -> leer (fail-closed Material)", async () => {
  const { extractClaims } = await mod("core/twin.mjs");
  assert.equal(extractClaims("BEFUND: nur ein Befund, kein Versuch"), "");
  assert.equal(extractClaims(""), "");
  assert.equal(extractClaims(null), "");
});

test("parseTwinVerdict: strenge Lesart, unbekanntes -> UNKLAR", async () => {
  const { parseTwinVerdict, TWIN } = await mod("core/twin.mjs");
  assert.equal(parseTwinVerdict("VERDICT: BESTAETIGT"), TWIN.CONFIRMED);
  assert.equal(parseTwinVerdict("VERDICT: BESTÄTIGT"), TWIN.CONFIRMED);
  assert.equal(parseTwinVerdict("VERDICT: bestätigt"), TWIN.CONFIRMED);
  assert.equal(parseTwinVerdict("VERDICT: WIDERSPRUCH"), TWIN.CONTRADICTED);
  assert.equal(parseTwinVerdict("VERDICT: UNKLAR"), TWIN.UNCLEAR);
  assert.equal(parseTwinVerdict("Alles gut."), TWIN.UNCLEAR);
  assert.equal(parseTwinVerdict("VERDICT: WRITE"), TWIN.UNCLEAR); // fremdes Vokabular
  assert.equal(parseTwinVerdict(""), TWIN.UNCLEAR);
  assert.equal(parseTwinVerdict(null), TWIN.UNCLEAR);
});

test("runTwinCheck: Kontext-Trennung – nur Behauptungen, nie Erst-Reasoning", async () => {
  const { runTwinCheck, TWIN } = await mod("core/twin.mjs");
  let captured = null;
  const runner = async (o) => {
    captured = o;
    return { content: "BEFUND: Hält.\nVERDICT: BESTAETIGT", toolRounds: 3, usage: null };
  };
  const out = await runTwinCheck({
    header: "HEADER-TEXT",
    planText: "PLAN-TEXT",
    befund: "BEFUND-TEXT",
    claims: "CLAIM-TEXT",
    model: "m", apiKey: "k", apiBase: "https://x",
    root: "/tmp", whitelist: ["a.js"],
    runner,
  });
  assert.equal(out.verdict, TWIN.CONFIRMED);
  assert.ok(captured, "Runner muss gerufen werden");
  assert.match(captured.systemPrompt, /Evil Twin/);
  assert.match(captured.userContent, /HEADER-TEXT/);
  assert.match(captured.userContent, /PLAN-TEXT/);
  assert.match(captured.userContent, /BEFUND-TEXT/);
  assert.match(captured.userContent, /CLAIM-TEXT/);
  // Erst-Reasoning-Text (nicht unter den Claims) darf NICHT durchrutschen:
  assert.doesNotMatch(captured.userContent, /GEHEIMES-INTERNES-REASONING/);
  assert.doesNotMatch(captured.userContent, /SUBPROMPT/);
});

test("runTwinCheck: leere Claims -> Hinweis statt stiller Freigabe", async () => {
  const { runTwinCheck } = await mod("core/twin.mjs");
  let captured = null;
  await runTwinCheck({
    planText: "P", claims: "", model: "m", apiKey: "k", apiBase: "https://x",
    root: "/tmp", whitelist: [],
    runner: async (o) => { captured = o; return { content: "VERDICT: BESTAETIGT" }; },
  });
  assert.match(captured.userContent, /ohne Widerlegung ist nicht belastbar/);
});

test("runTwinCheck: Fail-closed – Runner-Fehler wird UNKLAR, nie Freigabe", async () => {
  const { runTwinCheck, TWIN } = await mod("core/twin.mjs");
  const boom = await runTwinCheck({
    planText: "P", claims: "C", model: "m", apiKey: "k", apiBase: "https://x",
    root: "/tmp", whitelist: [],
    runner: async () => { throw new Error("API down"); },
  });
  assert.equal(boom.verdict, TWIN.UNCLEAR);
  assert.match(boom.error, /API down/);

  const junk = await runTwinCheck({
    planText: "P", claims: "C", model: "m", apiKey: "k", apiBase: "https://x",
    root: "/tmp", whitelist: [],
    runner: async () => ({ content: "was auch immer" }),
  });
  assert.equal(junk.verdict, TWIN.UNCLEAR);
});

test("runTwinCheck: WIDERSPRUCH liefert Twin-Befund mit", async () => {
  const { runTwinCheck, TWIN } = await mod("core/twin.mjs");
  const out = await runTwinCheck({
    planText: "P", claims: "C", model: "m", apiKey: "k", apiBase: "https://x",
    root: "/tmp", whitelist: [],
    runner: async () => ({
      content: "BEFUND: Zitierte Zeile existiert nicht – Strohmann.\nVERDICT: WIDERSPRUCH",
    }),
  });
  assert.equal(out.verdict, TWIN.CONTRADICTED);
  assert.match(out.befund, /Strohmann/);
});

test("Persistenz-Vertrag: evil-twin-Welle landet in findings.wave", async () => {
  const env = withTempHome();
  try {
    const dbm = await mod("artifacts/db.mjs");
    const { createScope, addFinding, getFindings } = await mod("artifacts/scopes.mjs");
    const db = dbm.openDb();
    const scopeId = createScope(db, "H").id;
    addFinding(db, {
      scopeId, jobId: "j1", round: 1, wave: "scan", mode: "write",
      befund: "Erstprüfung", content: "c1", verdict: "WRITE",
    });
    addFinding(db, {
      scopeId, jobId: "j1", round: 2, wave: "evil-twin", mode: "write",
      befund: "GEGENPRÜFUNG BESTAETIGT: hält", content: "c2", verdict: "WRITE",
    });
    const findings = getFindings(db, scopeId);
    assert.equal(findings.length, 2);
    assert.deepEqual(findings.map((f) => f.wave), ["scan", "evil-twin"]);
    // Invariante-4-Vertrag: das letzte Finding trägt das final geltende Urteil.
    assert.equal(findings[findings.length - 1].verdict, "WRITE");
  } finally {
    await env.cleanup();
  }
});

test("twinEvidenceOk: BESTAETIGT ohne eigenes Lesen wird deterministisch geblockt", async () => {
  const { twinEvidenceOk } = await mod("core/verdict.mjs");
  const env = withTempHome();
  try {
    // 1. BESTAETIGT mit 0 Tool-Runden + keiner Referenz -> KEINE Freigabe
    const noRead = { verdict: "BESTAETIGT", toolRounds: 0, befund: "Haelt stand.", content: "BEFUND: Haelt stand.\nVERDICT: BESTAETIGT" };
    assert.equal(twinEvidenceOk(noRead, { root: env.tmp, whitelist: [] }), false,
      "BESTAETIGT ohne eigenes Lesen ist keine unabhaengige Bestaetigung");
    // 2. BESTAETIGT mit nachgewiesener Tool-Runde -> Freigabe belastbar
    const withRead = { ...noRead, toolRounds: 3 };
    assert.equal(twinEvidenceOk(withRead, { root: env.tmp, whitelist: [] }), true);
    // 3. BESTAETIGT ohne Tool-Runde, ABER mit verifizierbarer Datei:Zeile -> ok
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-twin-ok-"));
    try {
      fs.mkdirSync(path.join(tmp, "core"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "core", "tools.mjs"), "export const x = 1;\n");
      const withRef = { ...noRead, befund: "Geprueft: core/tools.mjs:1 ist wie behauptet.", content: "core/tools.mjs:1" };
      assert.equal(twinEvidenceOk(withRef, { root: tmp, whitelist: [] }), true,
        "verifizierbare Datei:Zeile kompensiert fehlende Tool-Runden");
      // Fantasie-Referenz zaehlt NICHT (Zeile existiert nicht)
      const fakeRef = { ...noRead, befund: "Geprueft: core/tools.mjs:99 ist wie behauptet." };
      assert.equal(twinEvidenceOk(fakeRef, { root: tmp, whitelist: [] }), false,
        "Fantasie-Zeile ist keine Evidenz");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
    // 4. WIDERSPRUCH/UNKLAR sind nicht pruefpflichtig (verweigern ohnehin)
    assert.equal(twinEvidenceOk({ verdict: "WIDERSPRUCH", toolRounds: 0, befund: "X" }), true);
    assert.equal(twinEvidenceOk({ verdict: "UNKLAR", toolRounds: 0, befund: "X" }), true);
    // 5. Fehler -> fail-closed
    assert.equal(twinEvidenceOk({ verdict: "BESTAETIGT", toolRounds: 0, error: "API kaputt" }), false);
  } finally {
    await env.cleanup();
  }
});