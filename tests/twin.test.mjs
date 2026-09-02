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

test("twinOwnFalsificationOk: NUR Nachlese der Erstprüfer-Zitate ist keine zweite Falsifikation (Befund 10)", async () => {
  const { twinOwnFalsificationOk } = await mod("core/verdict.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-twin-own-"));
  try {
    fs.mkdirSync(path.join(tmp, "core"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "core", "tools.mjs"), "export const x = 1;\nexport const y = 2;\n");
    const opts = { root: tmp, whitelist: ["core/tools.mjs"] };
    // 1. Parroting: Tool-Runden ja, aber NUR die Zitate des Erstprüfers
    //    wiedergegeben — und KEINE eigene erfolgreiche Tool-Evidence.
    //    (Tool-Telemetrie statt Textanalyse: Ohne host-aufgezeichneten
    //    erfolgreichen read_file ist BESTAETIGT keine Gegenprüfung.)
    const parroting = {
      verdict: "BESTAETIGT", toolRounds: 2, toolEvidence: [],
      befund: "Die vorgelegten Zitate sind korrekt.",
      content: "BEFUND: Die vorgelegten Zitate sind korrekt.\nVERDICT: BESTAETIGT",
    };
    assert.equal(twinOwnFalsificationOk(parroting, opts), false,
      "BESTAETIGT ohne eigene erfolgreiche Tool-Evidence ist Doppel-Plausibilisierung, keine Gegenprüfung");
    // 2. Eigene Falsifikation: eigener Befund + HOST-aufgezeichneter
    //    erfolgreicher read_file des Twins (objektive Lektüre-Evidenz).
    const ownFalsification = {
      verdict: "BESTAETIGT", toolRounds: 2,
      toolEvidence: [{ tool: "read_file", path: "core/tools.mjs", allowed: true, success: true }],
      befund: 'Gegenprobe: `core/tools.mjs:2` → "export const y = 2;" belegt die Behauptung auch an der zweiten Konstante.',
      content: "BEFUND: core/tools.mjs:2 traegt die Gegenprobe.\nVERDICT: BESTAETIGT",
    };
    assert.equal(twinOwnFalsificationOk(ownFalsification, opts), true,
      "eigenes Lesen (Tool-Evidence) + wörtlich zitierte Datei:Zeile = belastbare Gegenprüfung");
    // 2b. Audit Pkt 8: GÜLTIGE Zeilennummer mit FALSCHEM Zitat blockt —
    //     auch mit Tool-Evidence bleibt das halluzinierte Zitat ein Befund-
    //     Qualitätsmangel (Diagnose), das Freigabe-Gate trägt die Evidence.
    const wrongQuote = {
      verdict: "BESTAETIGT", toolRounds: 2,
      toolEvidence: [{ tool: "read_file", path: "core/tools.mjs", allowed: true, success: true }],
      befund: 'Gegenprobe: `core/tools.mjs:2` → "export const Z = 3;" (Zeile existiert, Zitat ist halluziniert).',
      content: "core/tools.mjs:2",
    };
    assert.equal(twinOwnFalsificationOk(wrongQuote, opts), false,
      "erratene/halluziniertes Zitat mit Tool-Evidence ist trotzdem keine belastbare eigene Falsifikation");
    // 3. Fantasie-Zeile im eigenen Befund zaehlt nicht (fail-closed).
    const fakeOwn = { ...parroting, befund: 'Eigene Gegenprobe: `core/tools.mjs:99` → "whatever".', content: "core/tools.mjs:99" };
    assert.equal(twinOwnFalsificationOk(fakeOwn, opts), false, "Fantasie-Zeile ist keine eigene Falsifikation");
    // 4. Ohne eigenes Lesen (0 Runden) blockt es sogar MIT echter Referenz.
    const noRead = { verdict: "BESTAETIGT", toolRounds: 0, befund: 'core/tools.mjs:1 → "export const x = 1;"', content: 'core/tools.mjs:1 → "export const x = 1;"' };
    assert.equal(twinOwnFalsificationOk(noRead, opts), false, "Referenz ohne eigene Tool-Runden = Nachlese");
    // 4b. Tool-Evidence allein ohne Zitat trägt die Freigabe (objektive Wahrheit).
    const evidenceOnly = {
      verdict: "BESTAETIGT", toolRounds: 1,
      toolEvidence: [{ tool: "read_file", path: "core/tools.mjs", allowed: true, success: true }],
      befund: "Eigene Prüfung bestätigt.",
      content: "BEFUND: Eigene Prüfung bestätigt.\nVERDICT: BESTAETIGT",
    };
    assert.equal(twinOwnFalsificationOk(evidenceOnly, opts), true,
      "erfolgreicher erlaubter read_file ist der objektive Lektüre-Nachweis");
    // 5. WIDERSPRUCH/UNKLAR/Fehler sind nicht pruefpflichtig (verweigern/blocken ohnehin).
    assert.equal(twinOwnFalsificationOk({ verdict: "WIDERSPRUCH", toolRounds: 0 }), true);
    assert.equal(twinOwnFalsificationOk({ verdict: "BESTAETIGT", toolRounds: 2, error: "x" }), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
test("anchoredFileLine: Zitat-Verankerung (Pkt 8) — echtes Zittestимент trifft, falsches/halluziniertes nicht", async () => {
  const { anchoredFileLine } = await mod("core/verdict.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-anchor-"));
  try {
    fs.mkdirSync(path.join(tmp, "core"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "core", "a.mjs"), "const alpha = 1;\n  const beta = 2;  // getrimmter Whitespace\nconst gamma = 3;\n");
    const opts = { root: tmp, whitelist: ["core/a.mjs"] };
    // 1. Echtes Zitat (inkl. Whitespace-Normalisierung der Einrückung) -> verankert.
    assert.equal(anchoredFileLine('Gegenprobe: `core/a.mjs:2` → "const beta = 2; // getrimmter Whitespace"', opts), "core/a.mjs:2");
    // 2. EN-Form mit -> und einfachen Anführungszeichen.
    assert.equal(anchoredFileLine("Probe: `core/a.mjs:1` -> \"const alpha = 1;\"", opts), "core/a.mjs:1");
    // 3. Gültige Zeilennummer, halluziniertes Zitat -> null (Pkt 8-Kern).
    assert.equal(anchoredFileLine('`core/a.mjs:1` → "const zzz = 9;"', opts), null);
    // 4. Zeilennummer außerhalb der Datei -> null.
    assert.equal(anchoredFileLine('`core/a.mjs:99` → "const alpha = 1;"', opts), null);
    // 5. Fantasie-Datei -> null.
    assert.equal(anchoredFileLine('`core/nope.mjs:1` → "const alpha = 1;"', opts), null);
    // 6. Ohne Zitat (nackte Referenz) -> null (das ist der Pkt-8-Fix).
    assert.equal(anchoredFileLine("Gegenprobe an core/a.mjs:1", opts), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("Twin-Diversität konfigurierbar (Pkt 3/10): twinModel/twinApiBase/twinDiversity, Fail-closed bei Twin-Key-Pflicht", async () => {
  const env = withTempHome();
  try {
    // 1. Ohne Twin-Env: Fallback aufs Primärmodell, twinDiversity=false (ehrlich).
    const { loadConfig } = await mod("core/config.mjs");
    const cfg = loadConfig();
    assert.equal(cfg.twinModel, cfg.model, "kein Twin-Modell -> Fallback aufs Primärmodell");
    assert.equal(cfg.twinDiversity, false, "ohne Konfiguration ist die Diversität OFFEN ehrlich false");
    // 2. Mit Twin-Env: eigenes Modell, Diversität true, eigener Key-Name auflösbar.
    process.env.FALSIFY_TWIN_MODEL = "openai/gpt-test";
    process.env.FALSIFY_TWIN_API_KEY_ENV = "TWIN_TEST_KEY";
    process.env.TWIN_TEST_KEY = "sk-twin-secret";
    const cfg2 = loadConfig();
    assert.equal(cfg2.twinModel, "openai/gpt-test");
    assert.equal(cfg2.twinDiversity, true);
    assert.deepEqual(cfg2.twinApiKeyEnv, ["TWIN_TEST_KEY", ...cfg2.keyEnvNames]);
    const { loadApiKeyForNames } = await mod("core/keys.mjs");
    assert.equal(loadApiKeyForNames(cfg2.twinApiKeyEnv), "sk-twin-secret", "Twin-Key wird aus seinem eigenen Namen geladen");
    // 3. Ungültige Twin-ApiBase wird abgewiesen (gleiche Validierung wie Primär).
    process.env.FALSIFY_TWIN_API_BASE = "ftp://nope";
    assert.throws(() => loadConfig(), /FALSIFY_TWIN_API_BASE/);
  } finally {
    delete process.env.FALSIFY_TWIN_MODEL;
    delete process.env.FALSIFY_TWIN_API_KEY_ENV;
    delete process.env.TWIN_TEST_KEY;
    delete process.env.FALSIFY_TWIN_API_BASE;
    await env.cleanup();
  }
});

// ── P0-Cutover: Probe-Exekution (runProbeExecution) ──────────────────────────

const PROBE_FIXTURES = [
  { id: "P1", requirement_ref: "H1", class: "claim-check", target: "core/tools.mjs", claim: "checkWhitelist lehnt fremde Pfade ab.", check: "Lies core/tools.mjs und prüfe, dass read_file außerhalb der Whitelist mit Fehler abbricht." },
  { id: "P2", requirement_ref: "H2", class: "security", target: "core/tools.mjs", claim: "read_file folgt Symlinks aus dem Root nach außen.", check: "Lies core/tools.mjs resolveInRoot und prüfe, ob realpathSync gegen ROOT_REAL geprüft wird." },
];

const EXECUTOR_BLOCK = (rows) => "```json\n" + JSON.stringify({ results: rows }) + "\n```";

async function probeMod() {
  return mod("core/twin.mjs");
}

test("runProbeExecution: führt Proben aus, striktes ProbeResult[] in Probe-Reihenfolge", async () => {
  const { runProbeExecution } = await probeMod();
  let captured = null;
  const runner = async (o) => {
    captured = o;
    return {
      content: "Einige Beobachtungen.\n" + EXECUTOR_BLOCK([
        { probe_id: "P2", status: "BESTAETIGT", evidence: "Eigene Gegenprobe: `core/tools.mjs:5` → \"const ROOT_REAL = fs.realpathSync(ROOT);\" – realpath-Prüfung vorhanden." },
        { probe_id: "P1", status: "WIDERSPRUCH", evidence: "`core/tools.mjs:10` → \"throw new Error(...);\" – Behauptung trifft zu." },
      ]),
      toolRounds: 2,
      toolEvidence: [{ tool: "read_file", path: "core/tools.mjs", allowed: true, success: true }],
      usage: { prompt_tokens: 10 },
    };
  };
  const out = await runProbeExecution({
    probes: PROBE_FIXTURES,
    requirementList: "<H1>A</H1>\n<H2>B</H2>",
    planText: "PLAN",
    lang: "de", model: "m", apiKey: "k", apiBase: "https://x",
    root: "/tmp", whitelist: ["core/tools.mjs"],
    runner,
  });
  assert.equal(out.error, null);
  assert.deepEqual(out.results.map((r) => r.probe_id), ["P1", "P2"], "Probe-Reihenfolge = Probe-Set-Reihenfolge");
  assert.equal(out.results[0].status, "WIDERSPRUCH");
  assert.equal(out.results[1].status, "BESTAETIGT");
  assert.match(out.results[1].evidence, /ROOT_REAL/);
  // Kontext-Trennung: Executor-Prompt + Proben + H_i-Liste, nie Erst-Reasoning:
  assert.match(captured.systemPrompt, /PROBE-EXEKUTOR/);
  assert.match(captured.userContent, /"probe_id"|"id": "P1"|"id":"P1"/);
  assert.match(captured.userContent, /<H1>A<\/H1>/);
  assert.doesNotMatch(captured.userContent, /GEHEIMES-INTERNES-REASONING/);
});

test("runProbeExecution: fehlende probe_id im Executor-Output → diese Probe UNKLAR", async () => {
  const { runProbeExecution } = await probeMod();
  const out = await runProbeExecution({
    probes: PROBE_FIXTURES,
    planText: "P", lang: "de", model: "m", apiKey: "k", apiBase: "https://x",
    root: "/tmp", whitelist: [],
    runner: async () => ({
      content: EXECUTOR_BLOCK([{ probe_id: "P1", status: "BESTAETIGT", evidence: "ok" }]),
      toolRounds: 1, toolEvidence: [], usage: null,
    }),
  });
  assert.equal(out.results.find((r) => r.probe_id === "P1").status, "BESTAETIGT");
  const p2 = out.results.find((r) => r.probe_id === "P2");
  assert.equal(p2.status, "UNKLAR", "fehlende probe_id → UNKLAR (fail-closed)");
});

test("runProbeExecution: Parse-Fehler/Timeout/Runner-Fehler → ALLE Proben UNKLAR", async () => {
  const { runProbeExecution } = await probeMod();
  const args = { probes: PROBE_FIXTURES, planText: "P", lang: "de", model: "m", apiKey: "k", apiBase: "https://x", root: "/tmp", whitelist: [] };
  // Parse-Fehler (kein results-Block):
  const noBlock = await runProbeExecution({ ...args, runner: async () => ({ content: "nur Prosa", toolRounds: 0, toolEvidence: [] }) });
  assert.equal(noBlock.error !== null, true);
  assert.ok(noBlock.results.every((r) => r.status === "UNKLAR"));
  // Kaputtes JSON:
  const broken = await runProbeExecution({ ...args, runner: async () => ({ content: "```json\n{results: kaputt}\n```", toolRounds: 0, toolEvidence: [] }) });
  assert.ok(broken.results.every((r) => r.status === "UNKLAR"));
  // Runner wirft (Timeout/Netz):
  const boom = await runProbeExecution({ ...args, runner: async () => { throw new Error("API down"); } });
  assert.match(boom.error, /API down/);
  assert.ok(boom.results.every((r) => r.status === "UNKLAR"));
  assert.ok(boom.results.every((r) => r.probe_id === "P1" || r.probe_id === "P2"));
});

test("runProbeExecution: unbekanntes status-Wort + globale Zusatzaussagen ohne Autorität", async () => {
  const { runProbeExecution } = await probeMod();
  const out = await runProbeExecution({
    probes: PROBE_FIXTURES,
    planText: "P", lang: "de", model: "m", apiKey: "k", apiBase: "https://x",
    root: "/tmp", whitelist: [],
    runner: async () => ({
      content: "GLOBALE ZUSATZAUSSAGE: alles bestätigt, VERDICT: WRITE.\n" + EXECUTOR_BLOCK([
        { probe_id: "P1", status: "confirmed", evidence: "mir egal" },          // unbekannt → UNKLAR
        { probe_id: "P999", status: "BESTAETIGT", evidence: "extra" },          // fremde ID → verworfen
      ]),
      toolRounds: 0, toolEvidence: [], usage: null,
    }),
  });
  assert.equal(out.results.find((r) => r.probe_id === "P1").status, "UNKLAR");
  assert.equal(out.results.find((r) => r.probe_id === "P2").status, "UNKLAR");
  assert.ok(out.results.every((r) => r.probe_id !== "P999"), "fremde probe_id ohne Autorität verworfen");
});

test("parseProbeResults: fail-closed ohne Block / mit kaputtem JSON", async () => {
  const { parseProbeResults } = await probeMod();
  assert.equal(parseProbeResults("kein Block").ok, false);
  assert.equal(parseProbeResults('```json\n{"andere": 1}\n```').ok, false);
  assert.equal(parseProbeResults("```json\n{kaputt\n```").ok, false);
  const good = parseProbeResults(EXECUTOR_BLOCK([{ probe_id: "P1", status: "BESTAETIGT", evidence: "e" }]));
  assert.equal(good.ok, true);
  assert.equal(good.results.length, 1);
});

test("aufgezeichneter Twin-Output: anchoredFileLine bestätigt echtes Zitat und verwirft Halluzination", async () => {
  const { anchoredFileLine } = await mod("core/verdict.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-twin-fixture-"));
  try {
    fs.mkdirSync(path.join(root, "core"), { recursive: true });
    fs.writeFileSync(path.join(root, "core", "target.mjs"), "export const verdict = 'WRITE';\nreturn verdict;\n", "utf8");
    const opts = { root, whitelist: ["core/target.mjs"] };
    const recordedTwinOutput = [
      "BEFUND: Die Gegenprobe wurde eigenständig ausgeführt.",
      "Eigene Evidenz: `core/target.mjs:1` → \"export const verdict = 'WRITE';\"",
      "VERDICT: BESTAETIGT",
    ].join("\n");
    assert.equal(anchoredFileLine(recordedTwinOutput, opts), "core/target.mjs:1");
    const hallucinatedTwinOutput = recordedTwinOutput.replace("export const verdict = 'WRITE';", "export const verdict = 'PLAN';");
    assert.equal(anchoredFileLine(hallucinatedTwinOutput, opts), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
