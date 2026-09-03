// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/probe-e2e.test.mjs – P0-Cutover: 3 Fixture-E2E
// -----------------------------------------------------------------------------
// Beweist die Kette als Ganzes (Schritt 6) ohne Live-Key, im bestehenden
// isolierten Muster (Wegwerf-FALSIFY_HOME, lokaler Fake-OpenAI-Server, echte
// cli/run.mjs-Kindprozesse):
//
//   1. E2E-WRITE:  Thinker-Probe-Set, Twin führt alle Proben BESTAETIGT mit
//                  echter verankerter Zitat-Evidence + echtem read_file
//                  (Host-Tool-Evidence) → Exit 0, Scope hardened,
//                  open_conflicts = 0, Wellen + Invariante 4 korrekt.
//   2. E2E-PLAN:   Twin widerspricht (WIDERSPRUCH) + Coverage-Lücke → Exit 1,
//                  GAP/Phase korrekt, evil-twin-Finding trägt das geltende
//                  Urteil (Invariante 4).
//   3. E2E-vager Header: formal gültige H1-Probe, vom Twin als nicht
//                  ausführbar beurteilt (UNKLAR) → Exit 1 (PLAN).
//
// Kein Mock des Gates: parseVerdict/validateProbeSet/runProbeExecution/
// computeVerdict laufen ECHT; nur der HTTP-Endpunkt ist lokal gefaked.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const savedHome = process.env.FALSIFY_HOME;

function withTempHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-probe-e2e-"));
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

// ── Wegwerf-Zielprojekt (nicht das Repo – kein Self-Review-Zusatz) ───────────
function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-probe-e2e-proj-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src", "app.js"),
    [
      "export function add(a, b) {",
      "  return a + b;",
      "}",
      "",
      "export function clip(v, max) {",
      "  if (v > max) return max;",
      "  return v;",
      "}",
      "",
    ].join("\n"),
  );
  return dir;
}

// ── Fake-OpenAI-Server (chat/completions, JSON, kein Stream) ─────────────────
// responder(reqBody) → { content, toolCalls? }  |  { throw: msg }
function fakeApi(responder) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { /* egal */ }
      let out;
      try { out = responder(body); } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: String(e?.message || e) } }));
        return;
      }
      if (out?.throw) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: out.throw } }));
        return;
      }
      const message = { role: "assistant", content: out?.content ?? "" };
      if (out?.toolCalls?.length) {
        message.tool_calls = out.toolCalls.map((tc, i) => ({
          id: tc.id || `call_${i}`,
          type: "function",
          function: { name: tc.name, arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments || {}) },
        }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message, finish_reason: out?.toolCalls?.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Startet cli/run.mjs als Kindprozess und liefert { code, out }. */
function runCli({ home, root, args, apiBase }) {
  const child = spawn(process.execPath, [path.join(ROOT, "cli", "run.mjs"), ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      FALSIFY_HOME: home,
      FALSIFY_API_BASE: apiBase,
      FALSIFY_API_KEY_ENV: "FALSIFY_TEST_KEY",
      FALSIFY_TEST_KEY: "dummy-key-e2e",
      FALSIFY_MAX_RPM: "1000",
      FALSIFY_REASONING_EFFORT: "off",
      FALSIFY_TWIN_REASONING_EFFORT: "off",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { out += c; });
  return { outP: new Promise((res) => child.stdout.on("close", () => res(out))), doneP: new Promise((res) => child.on("close", res)), out() { return out; } };
}

// Der Thinker-WRITE-Text: echter Befund + Umsetzungsverständnis (konform) +
// Probe-Set (requirement_ref = Original-H_i aus dem Header) + WRITE-Kandidat.
function thinkerWrite({ h1Ref = "H1", h2Ref = "H2", target = "src/app.js", line = 2, quote = "  return a + b;" } = {}) {
  return [
    "BEFUND: Die Umsetzung erfüllt beide Anforderungen; die Gegenprobe bestätigt die Argumentgrenzen nicht als verletzt.",
    "",
    "## Umsetzungsverstaendnis (FalsifyMe)",
    "SCOPE-KONFORM: Die Iteration adressiert genau die Anforderungen des Headers.",
    "",
    "SUBPROMPT:",
    "Naechste Iteration: keine - Freigabe empfohlen.",
    "",
    "```json",
    JSON.stringify({
      probes: [
        { id: "P1", requirement_ref: h1Ref, class: "claim-check", target, claim: "add addiert beide Argumente ohne Runden.", check: "Lies src/app.js und pruefe, dass add a und b ohne Transformation summiert." },
        { id: "P2", requirement_ref: h2Ref, class: "edge-case", target, claim: "clip klemmt Werte ueber dem Maximum auf max.", check: "Lies src/app.js und pruefe, dass clip bei v > max genau max zurueckgibt." },
      ],
    }),
    "```",
    "",
    "VERDICT: WRITE",
  ].join("\n");
}

// Der Executor-(Twin-)Antwort-Block: je Probe ein striktes ProbeResult; für
// BESTAETIGT wird die tragende Zeile WÖRTLICH zitiert (anchoredFileLine-Form).
function executorBlock(rows) {
  return "```json\n" + JSON.stringify({ results: rows }) + "\n```";
}

function executorConfirm({ line = 2, quote = "  return a + b;" } = {}) {
  return [
    "Ich habe beide Proben selbst gegen src/app.js ausgefuehrt (read_file).",
    executorBlock([
      { probe_id: "P1", status: "BESTAETIGT", evidence: `Eigene Gegenprobe: \`src/app.js:${line}\` → "${quote}" – add summiert direkt.` },
      { probe_id: "P2", status: "BESTAETIGT", evidence: "Eigene Gegenprobe: clip gibt bei v > max max zurueck (Zeile 6 gelesen)." },
    ]),
    "VERDICT: KEINS – Urteilskraft trägt ausschließlich der Probe-Block oben.",
  ].join("\n");
}

// ── Gemeinsamer E2E-Lauf: Scope + Direkt-Job gegen den Fake-Server ──────────
async function runE2E({ responder, header, plan }) {
  const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const identity = await mod("core/identity.mjs");
    const projects = await mod("artifacts/projects.mjs");
    const home = withTempHome();
    const project = tempProject();
    const anchor = identity.initAnchor(project);
    assert.equal(anchor.ok, true, anchor.message);
    const identityDb = openDb();
    projects.bindAnchor(identityDb, anchor, project);
    closeDb();
  const server = await fakeApi(responder);
  const apiBase = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const db = openDb();
    const scope = scopes.createScope(db, header, { checkoutId: anchor.value.checkoutId });
    closeDb();
    const cli = runCli({
      home: home.tmp,
      root: project,
      apiBase,
      args: ["--scope", scope.id, "--root", project, "--files", "src/app.js", "--no-wait", plan],
    });
    const out = await cli.outP;
    const code = await cli.doneP;
    return { code, out, home, project, scopeId: scope.id, server };
  } catch (e) {
    server.close();
    home.cleanup();
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    throw e;
  }
}

function cleanupE2E(r) {
  r.server.close();
  r.home.cleanup();
  fs.rmSync(r.project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

const HEADER = "Die Funktion add addiert zwei Zahlen. Die Funktion clip klemmt Werte auf ein Maximum.";

test("P0-E2E WRITE: alle Proben BESTAETIGT mit echter Evidence → Exit 0, hardened, Invariante 4", async () => {
  // Runde 1 (Thinker): WRITE-Kandidat mit Probe-Set. Runde 2 (Twin): liest
  // ECHT per Tool-Call, dann BESTAETIGT mit wörtlich verankerter Evidence.
  let round = 0;
  const r = await runE2E({
    header: HEADER,
    plan: "Iteration: add und clip implementiert (src/app.js), beide Anforderungen erfuellt.",
    responder: () => {
      round++;
      if (round === 1) return { content: thinkerWrite({}) };
      if (round === 2) return {
        toolCalls: [{ name: "read_file", arguments: { path: "src/app.js" } }],
      };
      return { content: executorConfirm({}) };
    },
  });
  try {
    assert.equal(r.code, 0, `E2E-WRITE muss Exit 0 sein.\n=== AUSGABE ===\n${r.out}`);
    assert.match(r.out, /VERDICT: WRITE/);
    assert.match(r.out, /Freigabe durch das Gate/);

    // Queue-/Scope-Wahrheit prüfen (gleiche DB-Lese-Pfade wie doctor):
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const jobs = await mod("artifacts/jobs.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const db = openDb();
    const job = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(job.status, "DONE WRITE");
    assert.equal(job.verdict, "WRITE");
    const scope = scopes.getScope(db, r.scopeId);
    assert.equal(scope.status, "hardened", "WRITE härtet den Scope");
    assert.equal(scope.open_conflicts, 0);
    assert.equal(scope.phase, "write");
    assert.equal(scope.last_gap, null, "WRITE schließt den GAP");
    const findings = scopes.getFindings(db, r.scopeId);
    assert.ok(findings.length >= 2, "Thinker-Finding + evil-twin-Finding");
    assert.equal(findings[findings.length - 1].wave, "evil-twin");
    assert.equal(findings[findings.length - 1].verdict, "WRITE", "Invariante 4: letztes Finding trägt das geltende Urteil");
    assert.match(findings[findings.length - 1].befund, /GEGENPRÜFUNG Probe-Exekution/);
    assert.match(findings[findings.length - 1].befund, /BESTAETIGT=2/);
    closeDb();
  } finally {
    cleanupE2E(r);
  }
});

test("P0-E2E PLAN: WIDERSPRUCH + Coverage-Lücke → Exit 1, GAP offen, Invariante 4", async () => {
  // Runde 1: WRITE-Kandidat, aber P2 referenziert H3 (existiert nicht) und H2
  // bleibt un-covert → Validator failt; zusätzlich läuft der Twin NICHT
  // (kaputte Sets erreichen ihn nie) – das Gate entscheidet allein.
  let round = 0;
  const r = await runE2E({
    header: HEADER,
    plan: "Iteration: add und clip implementiert (src/app.js), beide Anforderungen erfuellt.",
    responder: () => {
      round++;
      if (round === 1) {
        const bad = JSON.parse(JSON.stringify({ probes: [
          { id: "P1", requirement_ref: "H1", class: "claim-check", target: "src/app.js", claim: "add addiert beide Argumente ohne Runden.", check: "Lies src/app.js und pruefe, dass add a und b ohne Transformation summiert." },
          { id: "P2", requirement_ref: "H3", class: "edge-case", target: "src/app.js", claim: "clip klemmt Werte ueber dem Maximum auf max.", check: "Lies src/app.js und pruefe, dass clip bei v > max genau max zurueckgibt." },
        ] }));
        return { content: thinkerWrite({}).replace(/\u0060\u0060\u0060json[\s\S]*\u0060\u0060\u0060/, "```json\n" + JSON.stringify(bad) + "\n```") };
      }
      // Darf nicht erreicht werden (Twin läuft bei kaputtem Set nie):
      return { content: executorConfirm({}) };
    },
  });
  try {
    assert.equal(r.code, 1, `Kein Probe-Set-Erfolg = Exit 1 (PLAN).\n=== AUSGABE ===\n${r.out}`);
    assert.match(r.out, /Gate: PLAN/);
    assert.match(r.out, /ist keine Original-Anforderungs-ID/, "Paraphrase-/Fremd-ID-Grund sichtbar");
    assert.match(r.out, /Coverage: H2 hat keine Probe/, "Coverage-Härte sichtbar");
    assert.match(r.out, /kein Gegenprüfungs-Call/, "kaputtes Set erreicht den Twin nie");
    // Endgültiges Urteil ist PLAN; der Thinker-Stream-Echo-WRITE zählt nicht:
    assert.doesNotMatch(r.out, /VERDICT: WRITE – nicht freigegeben|VERDICT: WRITE → Freigabe/);
    assert.match(r.out, /VERDICT: PLAN – nicht freigegeben/);

    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const db = openDb();
    const job = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(job.status, "DONE PLAN");
    const scope = scopes.getScope(db, r.scopeId);
    assert.equal(scope.status, "active", "PLAN ent-härtet nicht");
    assert.equal(scope.open_conflicts, 1);
    assert.equal(scope.phase, "plan");
    assert.ok(scope.last_gap, "GAP bleibt offen");
    const findings = scopes.getFindings(db, r.scopeId);
    assert.equal(findings[findings.length - 1].verdict, "PLAN");
    closeDb();
  } finally {
    cleanupE2E(r);
  }
});

test("P0-E2E vager Header: formal gültige H1-Probe, Twin UNKLAR (nicht ausführbar) → PLAN", async () => {
  // Header zerfällt deterministisch zu genau H1; das Probe-Set ist formal
  // valide (P1 deckt H1, Target existiert) – aber der Twin kann die Assertion
  // inhaltlich nicht ausführen → UNKLAR → Gate: PLAN (Schichten-Regel:
  // vager Header ist kein Validator-Befund, sondern Twin-/Gate-Sache).
  let round = 0;
  const r = await runE2E({
    header: "Mach das System besser.",
    plan: "Iteration: add und clip implementiert (src/app.js).",
    responder: () => {
      round++;
      if (round === 1) {
        return { content: thinkerWrite({ h2Ref: "H1" }).replace(/"P2", "requirement_ref"/, '"P2", "requirement_ref"') };
      }
      if (round === 2) return { toolCalls: [{ name: "read_file", arguments: { path: "src/app.js" } }] };
      return {
        content: [
          "Die Assertion laesst sich nicht eindeutig ausfuehren – unbestimmt, was zu pruefen ist.",
          executorBlock([
            { probe_id: "P1", status: "UNKLAR", evidence: "Assertion nicht ausführbar: „Mach das System besser“ definiert kein prüfbares Verhalten." },
            { probe_id: "P2", status: "UNKLAR", evidence: "Assertion nicht ausführbar: kein konkretes Prüfkriterium ableitbar." },
          ]),
          "VERDICT: KEINS – Urteilskraft trägt ausschließlich der Probe-Block oben.",
        ].join("\n"),
      };
    },
  });
  try {
    assert.equal(r.code, 1, `UNKLAR-Probe = Exit 1 (PLAN).\n=== AUSGABE ===\n${r.out}`);
    assert.match(r.out, /Gate: PLAN/);
    assert.match(r.out, /Probe P1: UNKLAR/);
    assert.match(r.out, /Probe P2: UNKLAR/);
    assert.match(r.out, /Gegenprüfung \(Evil Twin – Probe-Exekution/, "Twin lief bei gültigem Set");

    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const scopes = await mod("artifacts/scopes.mjs");
    const db = openDb();
    const job = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(job.status, "DONE PLAN");
    const findings = scopes.getFindings(db, r.scopeId);
    const twinFinding = findings[findings.length - 1];
    assert.equal(twinFinding.wave, "evil-twin");
    assert.equal(twinFinding.verdict, "PLAN");
    assert.match(twinFinding.befund, /UNKLAR=2/);
    closeDb();
  } finally {
    cleanupE2E(r);
  }
});

test("P0-E2E Rubber-Stamp: Thinker-WRITE ohne jedes Probe-Set → PLAN (kein Twin-Call)", async () => {
  let round = 0;
  const r = await runE2E({
    header: HEADER,
    plan: "Iteration: add und clip implementiert (src/app.js).",
    responder: () => {
      round++;
      if (round === 1) return { content: "Alles gut gelaufen, keine Probleme.\nVERDICT: WRITE" };
      return { content: executorConfirm({}) }; // darf nicht erreicht werden
    },
  });
  try {
    assert.equal(r.code, 1, `WRITE ohne Probe-Set = Exit 1 (PLAN).\n=== AUSGABE ===\n${r.out}`);
    assert.match(r.out, /Gate: PLAN/);
    assert.match(r.out, /Probe-Set unlesbar|Probe-Set fehlt|kein ```json-Probe-Set/);
    assert.doesNotMatch(r.out, /Gegenprüfung \(Evil Twin/);
    const { openDb, closeDb } = await mod("artifacts/db.mjs");
    const db = openDb();
    assert.equal(db.prepare("SELECT status FROM jobs ORDER BY created_at DESC LIMIT 1").get().status, "DONE PLAN");
    closeDb();
  } finally {
    cleanupE2E(r);
  }
});
