// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/queue.test.mjs – Queue-Invarianten des Batch-Refactors
// -----------------------------------------------------------------------------
// Deckt ab: falsify wait --ping (USER-AGENT-Auswertung, Exit 4 = laeuft noch),
// falsify abort (Flag in der Queue, kein Fake-Verdict), Worker-Status nur aus
// frischen Heartbeats (--check liest NUR die Queue), GAP-Erfassung im Scope,
// Anti-Self-Check-Bias (WRITE ohne Challenge -> UNKNOWN) und onTool-Art.
// Alles laeuft gegen Wegwerf-FALSIFY_HOME.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const savedHome = process.env.FALSIFY_HOME;

function withTempHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-q-"));
  process.env.FALSIFY_HOME = tmp;
  return {
    tmp,
    cleanup() {
      // Windows: SQLite gibt WAL-Handles einen Tick NACH closeDb() frei –
      // rmSync direkt danach faengt EPERM-Flicker (Queue-Test 2026-09-01).
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      if (savedHome === undefined) delete process.env.FALSIFY_HOME;
      else process.env.FALSIFY_HOME = savedHome;
    },
  };
}

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

function createJob(db, { scopeId = null, status = "QUEUED" } = {}) {
  const { createJob } = dbModule;
  return createJob(db, { scopeId, payload: "Plan", diffText: null, root: ROOT, files: "a.js", mode: "plan", status });
}

function createScope(db, header) {
  return scopeModule.createScope(db, { header });
}

let dbModule;
let scopeModule;

test.before(async () => {
  dbModule = await mod("artifacts/jobs.mjs");
  scopeModule = await mod("artifacts/scopes.mjs");
});

test("wait --ping: laufender Job -> Exit 4 (USER AGENT wertet aus), DONE WRITE -> 0", async () => {
  const home = withTempHome();
  try {
    const { openDb, closeDb } = requireDb();
    const db = openDb();
    const id = createJob(db, { status: "QUEUED" });
    closeDb();

    const { runPing } = requireCliJobs();
    runPing(id); // QUEUED -> laeuft noch
    assert.equal(process.exitCode, 4, "QUEUED/RUNNING = Exit 4 (Auswertung durch USER AGENT)");
    process.exitCode = 0;

    // Job auf DONE WRITE setzen
    const db2 = openDb();
    dbModule.jobDone(db2, id, "WRITE", null);
    closeDb();
    runPing(id);
    assert.equal(process.exitCode, 0, "DONE WRITE = Exit 0");
    process.exitCode = 0;

    // Security-Review 2026-09-01 (Pkt 4/7): finale Zustaende sind IMMUTABEL —
    // ein zweites jobDone (Crash-Guard, spaeter Abort, Recovery-Double)
    // darf ein persistiertes WRITE nie tilgen (vorher empirisch: WRITE ->
    // ERROR per 2. Aufruf). Weitere Finalisierungen werden no-op.
    const { getJob } = await mod("artifacts/jobs.mjs");
    const db3 = openDb();
    const overridden = dbModule.jobDone(db3, id, "PLAN", null);
    closeDb();
    assert.equal(overridden, false, "zweites jobDone wird abgelehnt");
    const still = getJob(openDb(), id);
    closeDb();
    assert.equal(still.status, "DONE WRITE", "WRITE bleibt bestehen (kein Umschreiben)");
    assert.equal(still.verdict, "WRITE");
    runPing(id);
    assert.equal(process.exitCode, 0, "Status bleibt DONE WRITE = Exit 0");
    process.exitCode = 0;
  } finally {
    home.cleanup();
  }
});

test("falsify wait (bash-Loop): DONE ASK -> Exit 5 statt 3", async () => {
  const home = withTempHome();
  try {
    const { openDb, closeDb } = requireDb();
    const db = openDb();
    const id = createJob(db, { status: "QUEUED" });
    dbModule.jobDone(db, id, "ASK", null); // Status "DONE ASK"
    closeDb();

    const child = spawn("bash", [path.join(ROOT, "cli", "falsify.sh"), "wait", id], {
      cwd: ROOT,
      env: { ...process.env, FALSIFY_HOME: home.tmp },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    const code = await new Promise((res) => child.on("close", res));
    assert.equal(code, 5, `bash-wait DONE ASK -> Exit 5 (nicht 3):\n${out}`);
    assert.match(out, /VERDICT: ASK/);
  } finally {
    home.cleanup();
  }
});

test("run.mjs-Crash (kaputte DB) -> Exit 3, KEIN Exit 1 (PLAN-Luege)", async () => {
  const home = withTempHome();
  try {
    // Kaputte DB: openDb wirft -> runMain lehnt ab -> Crash-Guard (Befund 13c).
    fs.writeFileSync(path.join(home.tmp, "falsify.db"), "DIES IST KEINE SQLITE-DATENBANK");
    const child = spawn(process.execPath, [path.join(ROOT, "cli", "run.mjs"), "Plan-Text"], {
      cwd: ROOT,
      env: { ...process.env, FALSIFY_HOME: home.tmp },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    const code = await new Promise((res) => child.on("close", res));
    assert.equal(code, 3, `Crash = Exit 3 (nicht 1, sonst wuerde er als PLAN lesbar):\n${out}`);
    assert.match(out, /Interner Fehler/);
    assert.match(out, /KEIN Verdict/);
  } finally {
    home.cleanup();
  }
});

test("falsify abort: setzt Flag in der Queue (kein Fake-Verdict), Job bleibt offen", () => {
  const home = withTempHome();
  try {
    const { openDb, closeDb } = requireDb();
    const db = openDb();
    const id = createJob(db, { status: "QUEUED" });
    closeDb();

    const { runAbort } = requireCliJobs();
    runAbort(id);
    const db2 = openDb();
    assert.equal(dbModule.isAbortRequested(db2, id), true, "Abort-Flag gesetzt");
    assert.equal(dbModule.getJob(db2, id).status, "QUEUED", "Job endet NICHT sofort (Worker killt erst)");
    dbModule.clearJobAbort(db2, id);
    assert.equal(dbModule.isAbortRequested(db2, id), false, "Flag nach Verarbeitung geloescht");
    closeDb();
  } finally {
    home.cleanup();
  }
});

test("listWorkers: stale Heartbeat -> kein RUNNING (Root-Cause-Fix statt PowerShell-CIM)", () => {
  const home = withTempHome();
  try {
    const { openDb, closeDb, setMeta } = requireDb();
    const db = openDb();
    // Lebende PID (dieser Testprozess), aber Herzschlag 2 h alt -> STALE.
    setMeta(db, "worker.1.pid", String(process.pid));
    setMeta(db, "worker.1.ts", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
    let workers = dbModule.listWorkers(db, 3);
    assert.equal(workers[0].alive, false, "alter Heartbeat darf kein RUNNING erzeugen");
    assert.equal(workers[0].pid, process.pid, "PID vorhanden, aber frisch entscheidet");

    // Frischer Heartbeat (gleiche PID) -> RUNNING.
    setMeta(db, "worker.1.ts", new Date().toISOString());
    workers = dbModule.listWorkers(db, 3);
    assert.equal(workers[0].alive, true, "frischer Heartbeat + lebende PID = RUNNING");
    closeDb();
  } finally {
    home.cleanup();
  }
});

test("GAP-Erfassung: PLAN/RESEARCH haelt den Gap offen, WRITE schliesst ihn", () => {
  const home = withTempHome();
  try {
    const { openDb, closeDb } = requireDb();
    const { createScope } = scopeModule;
    const db = openDb();
    const scope = createScope(db, "Auftrag 1:1");
    scopeModule.updateScopeAfterReview(db, scope.id, "PLAN", "Plan widerspricht Header", null);
    let s = scopeModule.getScope(db, scope.id);
    assert.equal(s.last_gap, "Plan widerspricht Header", "GAP offen bei PLAN");
    const viewPlan = scopeModule.artifactView(s, []);
    assert.ok(viewPlan.includes("GAP (offen"), "Scope-Show zeigt offenen GAP");

    scopeModule.updateScopeAfterReview(db, scope.id, "WRITE", "Kein Befund", null);
    s = scopeModule.getScope(db, scope.id);
    assert.equal(s.last_gap, null, "GAP geschlossen bei WRITE");
    const viewWrite = scopeModule.artifactView(s, []);
    assert.ok(viewWrite.includes("GAP: geschlossen"), "Scope-Show zeigt geschlossenen GAP");
    closeDb();
  } finally {
    home.cleanup();
  }
});

test("Anti-Self-Check-Bias: WRITE ohne Challenge-Nachweis -> UNKNOWN (keine Freigabe)", async () => {
  const { enforceWriteChallenge, hasChallengeEvidence, findingSeverity, parseVerdict } = await mod("core/verdict.mjs");
  // Rubber-Stamp: VERDICT WRITE, aber keine Falsifikationsversuche/BEFUND.
  assert.equal(parseVerdict("Alles gut.\nVERDICT: WRITE"), "WRITE");
  assert.equal(hasChallengeEvidence("Alles gut.\nVERDICT: WRITE"), false);
  assert.equal(enforceWriteChallenge("Alles gut.\nVERDICT: WRITE", "WRITE"), null, "WRITE ohne Challenge = keine Freigabe");
  // Echter Challenge-Nachweis -> WRITE (Widerlegung + verifizierte Evidenz:
  // Symbol claimNextJob existiert, artifacts/jobs.mjs:78 ist eine echte Zeile).
  const WL = ["artifacts/jobs.mjs", "core/tools.mjs", "core/verdict.mjs", "artifacts/db.mjs"];
  const opts = { root: ROOT, whitelist: WL };
  const withChallenge = "## Falsifikationsversuche\n1. Widerlegt: `claimNextJob` ist racy – der Claim selektiert ohne scope_id (artifacts/jobs.mjs:78)\nBEFUND: Claim nicht atomar\nVERDICT: WRITE";
  assert.equal(enforceWriteChallenge(withChallenge, "WRITE", opts), "WRITE", "Widerlegung mit verifizierter Evidenz erlaubt WRITE");
  // E2E-Befund 2026-09-01: BEFUND allein ist kein Challenge-Beleg (Rubber-Stamp).
  assert.equal(enforceWriteChallenge("BEFUND: nix\nVERDICT: WRITE", "WRITE", opts), null, "BEFUND ohne Abschnitt = kein Beleg");
  // „Keine gefunden“ und Versuche ohne Substanz (<10 Zeichen) zaehlen nicht.
  assert.equal(hasChallengeEvidence("## Falsifikationsversuche\nKeine gefunden\nVERDICT: WRITE", opts), false, "Keine gefunden = kein Beleg");
  assert.equal(hasChallengeEvidence("## Falsifikationsversuche\n1. ok\nVERDICT: WRITE", opts), false, "Versuch ohne Substanz = kein Beleg");

  // ── Rig-Review 2026-09-01: die empirisch durchgereichten Rubber-Stamps ──
  const rubber = (t) => hasChallengeEvidence(`## Falsifikationsversuche\n${t}\nVERDICT: WRITE`, opts);
  assert.equal(rubber("1. Geprüft, keine Fehler gefunden in core/verdict.mjs"), false, "Bestätigung + angehängter Whitelist-Pfad ist KEINE Widerlegung");
  assert.equal(rubber("1. Gegenprobe bestätigt: artifacts/db.mjs ist korrekt"), false, "Bestätigung („ist korrekt“) trotz Whitelist-Datei");
  assert.equal(rubber("1. Widerlegt: siehe `nonsenseSymbol9997`"), false, "Fantasie-Symbol kommt nicht im Code vor (nur Pfade wurden vorher verifiziert)");
  assert.equal(rubber("1. core/verdict.mjs:99999 belegt das Gegenteil"), false, "Fantasie-Zeilennummer existiert nicht in der Datei");
  // RunDance-Befund 7 (2026-09-01): EIN einzelnes Widerlegungs-Token + Pfad
  // ist ein Rubber-Stamp („Widerlegt: `claimNextJob` (pfad)“ hat keinen
  // inhaltlichen Angriff) – es braucht ZWEI Token ODER ein Token mit
  // verifizierter Datei:Zeile (stärkste Evidenz kompensiert Einzel-Token).
  assert.equal(rubber("1. Bug in artifacts/jobs.mjs"), false, "Ein Token + Whitelist-Pfad = kein Beleg mehr");
  assert.equal(rubber("1. Lücke: `claimNextJob` hat keine Orphan-Recovery (artifacts/jobs.mjs)"), false, "Ein Token (Lücke) + Symbol + Pfad = Rubber-Stamp");
  assert.equal(rubber("1. Lücke, racy: `claimNextJob` hat keine Orphan-Recovery (artifacts/jobs.mjs)"), true, "Zwei Widerlegungs-Token + Symbol + Pfad = Beleg");
  assert.equal(rubber("1. Widerlegt: `claimNextJob` (artifacts/jobs.mjs:78)"), true, "Ein Token + verifizierte Datei:Zeile = Beleg");
  // RunDance-Befund 8: Ein-Token + FANTASIE-Zeile in existierender Datei
  // muss blocken (Negativ-Test fuer den datei-zeile-Kompensationspfad).
  assert.equal(rubber("1. Widerlegt: `claimNextJob` (artifacts/jobs.mjs:99999)"), false, "Ein Token + Fantasie-Zeilennummer = kein Beleg");
  // EN-Negations-Senke: englische Bestaetigungs-Phrasen zaehlen nicht als Angriff.
  assert.equal(rubber("1. Refuted, violation: no errors found in artifacts/jobs.mjs"), false, "EN-Bestaetigungs-Phrase neutralisiert die Widerlegungs-Tokens");
  assert.equal(rubber("1. Refuted, violation: nothing wrong in artifacts/jobs.mjs"), false, "EN-Phrase nothing wrong = kein Angriff");
  // Audit-Befund 8/9 (2026-09-01): ZWEI REFUTATION-Tokens, die nur eine
  // Bestaetigung sind ("no gap and no flaw"), waren ein Rubber-Stamp-Bypass.
  // Die EN-Negations-Senke muss sie als reine Bestaetigung erkennen.
  assert.equal(rubber("1. I see no gap and no flaw in core/verdict.mjs"), false, "Zwei Refutations-Woerter in reiner Bestaetigung = kein Angriff");
  assert.equal(rubber("1. No issues detected, all good in core/verdict.mjs"), false, "EN-Phrasen no issues/all good = kein Angriff");
  assert.equal(rubber("1. The code looks correct, no vulnerabilities in core/verdict.mjs"), false, "EN-Phrasen looks correct/no vulnerabilities = kein Angriff");
  // Live-Probe (Checklisten-Audit 2026-09-01): komma-sequenzierte Negationen
  // scheiterten an \s+ nach dem Nomen — "no gap, no flaw, no issue" passierte
  // das Gate. Das optionale Suffix ist \b-gebunden, das Komma-Format blockt.
  assert.equal(rubber("1. No gap, no flaw, no issue — the implementation is solid (core/verdict.mjs)"), false, "Komma-sequenzierte EN-Negation + solid = kein Angriff");
  assert.equal(rubber("1. No bug, no gap (core/verdict.mjs)"), false, "Kurze Komma-Negation = kein Angriff");
  // Audit-Befund 2 (2026-09-01): Datei:Zeile mit falscher Gross-/Kleinschrift
  // darf nicht verworfen werden — resolveRel loest case-insensitiv auf.
  assert.equal(rubber("1. Widerlegt: `claimNextJob` (Artifacts/Jobs.mjs:78)"), true, "Case-insensitive Datei:Zeile wird aufgeloest");
  // Mehrzeiliges Bündel: Evidenz in der FOLGEZEILE zählt (vorher strukturell
  // blockt). Ab RunDance-Befund 7 braucht der Versuch ZWEI Widerlegungs-Token
  // (hier: Lücke + racy) – Ein-Token-Pfad-Stamps sind kein Beleg mehr.
  assert.equal(hasChallengeEvidence("## Falsifikationsversuche\n1. Lücke, racy:\n   `claimNextJob` lässt RUNNING-Waisen ohne Recovery (artifacts/jobs.mjs)\nVERDICT: WRITE", opts), true, "Evidenz in Folgezeile zählt");
  // RunDance-E2E-Befund 2026-09-01: Versuche als Markdown-Untertitel („### N.")
  // sind FORMAT-Varianten echter Widerlegungen – sie wurden als Abschnittsende
  // missdeutet (section=„") und degradierten einen evidenzgetragenen WRITE zu
  // UNKNOWN. Hard boundary sind NUR #/##-Headings; „### N.“ bleibt im Abschnitt.
  const mdHeader = "## Falsifikationsversuche\n### 1. removeDesktopIcons() wird in main() nicht aufgerufen?\n**Code:** `artifacts/jobs.mjs:78` – await claimNextJob(); steht in main(). **Widerlegt.**\nVERDICT: WRITE";
  assert.equal(hasChallengeEvidence(mdHeader, opts), true, "### N.-Untertitel zählen als Versuch-Bündel (Format-Variante)");
  assert.equal(enforceWriteChallenge(mdHeader, "WRITE", opts), "WRITE", "### N.-Form erlaubt WRITE bei echter Widerlegung + Evidenz");
  // RunDance-Befund 7: auch BENANNTE ###-Köpfe ohne Nummer sind Bündel-Starts.
  const mdNamed = "## Falsifikationsversuche\n### Widerlegung: claimNextJob ist racy\n**Code:** `artifacts/jobs.mjs:78` – der Claim selektiert ohne scope_id. **Widerlegt.**\nVERDICT: WRITE";
  assert.equal(hasChallengeEvidence(mdNamed, opts), true, "### Widerlegung:<ohne Nummer> zählt als Versuch-Bündel");
  // Regression: Rubber-Stamp in DERSELBEN ###-Form bleibt blockt (Semantik unverändert).
  assert.equal(hasChallengeEvidence("## Falsifikationsversuche\n### 1. Gegenprobe\n**Code:** `artifacts/jobs.mjs:78` – ist korrekt, keine Fehler gefunden.\nVERDICT: WRITE", opts), false, "Bestätigung in ###-Form bleibt kein Beleg");
  // Fantasie-Pfad bleibt ungültig.
  assert.equal(rubber("1. Bug in core/geheim.mjs:12"), false, "nicht existierende Datei:Zeile = kein Beleg");
  // Severity echt (UI-065-Befund 3)
  assert.equal(findingSeverity("WRITE"), "discovered");
  assert.equal(findingSeverity("PLAN"), "warning");
  assert.equal(findingSeverity("RESEARCH"), "warning");
  assert.equal(findingSeverity(null), "critical");
  assert.equal(findingSeverity("UNBEKANNT"), "critical");
});

test("Audit-Befund 1: fileTextCache wird pro hasChallengeEvidence-Call wiederverwendet (N Buendel != Nx Datei-Reads)", async () => {
  const { hasChallengeEvidence } = await mod("core/verdict.mjs");
  const WL = ["artifacts/jobs.mjs", "core/verdict.mjs"];
  const opts = { root: ROOT, whitelist: WL };
  // Instrumentiere fs.readFileSync, um zu zaehlen, wie oft dieselbe Datei
  // gelesen wird. Vor dem Fix erzeugte jedes Bündel eine frische Map und las
  // dieselbe Whitelist-Datei N× neu.
  const orig = fs.readFileSync;
  const counts = new Map();
  fs.readFileSync = function (p, ...rest) {
    const key = String(p).replace(/\\/g, "/");
    if (key.endsWith("jobs.mjs") || key.endsWith("verdict.mjs")) counts.set(key, (counts.get(key) || 0) + 1);
    return orig.call(this, p, ...rest);
  };
  try {
    const twoBundles = "## Falsifikationsversuche\n1. Widerlegt: Bug (artifacts/jobs.mjs:78)\n2. Widerlegt: racy (artifacts/jobs.mjs:78)\nVERDICT: WRITE";
    assert.equal(hasChallengeEvidence(twoBundles, opts), true, "Zwei echte Widerlegungen mit Datei:Zeile = Beleg");
    // jobs.mjs darf nur EINMAL gelesen werden (Cache-Hoisting), nicht pro Bündel.
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    assert.equal(total, 1, `jobs.mjs/verdict.mjs wurden ${total}x gelesen (erwartet 1x durch Cache)`);
  } finally {
    fs.readFileSync = orig;
  }
});

test("Regel 5: WRITE gegen strukturelle Blocker wird zu PLAN (kein formal grün)", async () => {
  const { enforceStructuralCoherence } = await mod("core/verdict.mjs");
  // Keine Blocker: WRITE bleibt.
  assert.equal(enforceStructuralCoherence([], "WRITE"), "WRITE");
  // Harte Blocker (fehlende Whitelist-Dateien, Diff ausserhalb, Plan↔Diff):
  // ein formales Challenge-Gate macht keine kaputte Basis grün -> PLAN.
  assert.equal(enforceStructuralCoherence(["Diese Dateien der Whitelist existieren nicht unter root: x.js"], "WRITE"), "PLAN");
  assert.equal(enforceStructuralCoherence(["Der Diff verändert Dateien ausserhalb des Zugriffsrahmens: geheim.js"], "WRITE"), "PLAN");
  assert.equal(enforceStructuralCoherence(["Der Plan nennt app.js, aber die eingereichte Aenderung betrifft lib/y.js"], "WRITE"), "PLAN");
  // Nicht-WRITE wird nie angetastet.
  assert.equal(enforceStructuralCoherence(["irgendein Blocker"], "PLAN"), "PLAN");
  assert.equal(enforceStructuralCoherence(["irgendein Blocker"], "RESEARCH"), "RESEARCH");
  assert.equal(enforceStructuralCoherence(["irgendein Blocker"], "ASK"), "ASK");
  assert.equal(enforceStructuralCoherence(["irgendein Blocker"], null), null);
});

test("onTool-Dateipfad-Extraktion: nur pfadartige Argumente werden als Datei gemeldet", async () => {
  // Die Extraktionslogik lebt inline in core/agent.mjs; wir pruefen hier den
  // Vertrag über das Verhalten der Regex (gleiche Regeln wie im Modul).
  const looksLikePath = (v) => {
    if (typeof v !== "string" || !v.trim()) return false;
    if (/[\\/\\\\]/.test(v)) return true;
    return /^[^\s"']+\.\w{1,10}$/.test(v.trim());
  };
  assert.equal(looksLikePath("src/app.js"), true, "Pfad mit Separator");
  assert.equal(looksLikePath("app.js"), true, "Datei mit Endung");
  assert.equal(looksLikePath("Login-Problem"), false, "Suchbegriff ist keine Datei");
  assert.equal(looksLikePath('{"a":1}'), false, "JSON ist keine Datei");
  assert.equal(looksLikePath("job-1788234473210"), false, "ID ist keine Datei");
  assert.equal(looksLikePath(""), false);
});

test("Loop-Anker: parseScopeDivergence + Persistenz-Semantik (UI-107)", async () => {
  const { parseScopeDivergence, parseVerdict, enforceResearchContract } = await mod("core/verdict.mjs");
  // RESEARCH-Vertrag: konkret benanntes fehlendes Datum bleibt RESEARCH,
  // pauschales „brauche mehr Informationen“ wird fail-closed auf PLAN.
  assert.equal(enforceResearchContract("BEFUND: Es fehlt die Datei artifacts/geheim.mjs:12, die ich nicht lesen kann.\nVERDICT: RESEARCH", "RESEARCH"), "RESEARCH");
  assert.equal(enforceResearchContract("BEFUND: Ich brauche mehr Informationen.\nVERDICT: RESEARCH", "RESEARCH"), null, "RESEARCH ohne konkret fehlendes Datum = PLAN (fail-closed)");
  assert.equal(enforceResearchContract("BEFUND: fehlt Zugriff auf read_file fuer artifacts/db.mjs\nVERDICT: RESEARCH", "RESEARCH"), "RESEARCH", "fehlende Datei + Tool-Referenz ist konkret");
  assert.equal(enforceResearchContract("BEFUND: nix\nVERDICT: WRITE", "WRITE"), "WRITE", "Nur RESEARCH unterliegt dem Vertrag");
  const home = withTempHome();
  try {
    // Parser-Faelle.
    const div = "## Umsetzungsverstaendnis (FalsifyMe)\n- Ich wuerde zuerst die Whitelist pruefen, dann den Diff gegen den Plan.\nSCOPE-DIVERGENZ: Der USER AGENT will nur die Icon-Raeumung, ich wuerde zusaetzlich die Pfad-Ermittlung gegen den Bootstrap abgleichen\n## Falsifikationsversuche\n...\nVERDICT: WRITE";
    const a = parseScopeDivergence(div);
    assert.equal(a.konform, false);
    assert.ok(a.divergence && a.divergence.length >= 20, "substanzielle Divergenz wird deklariert");
    const ok = "## Umsetzungsverstaendnis (FalsifyMe)\n- Identisches Vorgehen wie eingereicht.\nSCOPE-KONFORM\n## Falsifikationsversuche\n...\nVERDICT: WRITE";
    assert.deepEqual(parseScopeDivergence(ok).divergence, null);
    assert.equal(parseScopeDivergence(ok).konform, true);
    // Rig R10: auch zu KURZE Begruendung setzt den Anker (kein stiller
    // Verlust) — markiert als tooShort, blockt aber weiterhin.
    const short = parseScopeDivergence("## Umsetzungsverstaendnis (FalsifyMe)\nSCOPE-DIVERGENZ: nur kurz\nVERDICT: WRITE");
    assert.equal(short.divergence, "nur kurz");
    assert.equal(short.tooShort, true);
    // Fehlende Sektion = kein Anker (kein Downgrade).
    assert.equal(parseScopeDivergence("## Falsifikationsversuche\nVERDICT: WRITE").text, null);
    // EN-Ueberschrift wird ebenfalls erkannt (Title-Case tolerant).
    assert.ok(parseScopeDivergence("## Implementation Understanding (FalsifyMe)\nSCOPE-DIVERGENZ: Der Plan nennt eine andere Zieldatei als der Header verlangt\nVERDICT: WRITE").divergence);
    // DE-Header mit Umlaut-Schreibweise (verständnis) wird erkannt.
    assert.ok(parseScopeDivergence("## Umsetzungsverständnis (FalsifyMe)\nSCOPE-DIVERGENZ: Die Zieldateien unterscheiden sich vom Header-Wunsch\nVERDICT: WRITE").divergence);
    // Sektion am ENDE ohne folgende ##-Ueberschrift: BEFUND/VERDICT duerfen
    // NICHT als Teil der Sektion gelesen werden (harte Grenzen R10-Befund 1).
    const atEnd = "## Falsifikationsversuche\n1. Widerlegt: racy, bug in `claimNextJob` (artifacts/jobs.mjs)\n## Umsetzungsverstaendnis (FalsifyMe)\n- Gleiches Vorgehen.\nSCOPE-KONFORM\nBEFUND: Alles gut, SCOPE-DIVERGENZ wuerde hier faelschlich zaehlen\nVERDICT: WRITE";
    const ae = parseScopeDivergence(atEnd);
    assert.equal(ae.konform, true, "BEFUND-Text wird nicht mehr in die Sektion gezogen");
    assert.equal(ae.divergence, null, "SCOPE-DIVERGENZ im BEFUND zaehlt nicht als Anker");

    // Persistenz-Semantik: Divergenz setzt, Konform leert, fehlend/unveraendert.
    const { openDb, closeDb } = requireDb();
    const { getScope, updateScopeAfterReview, createScope } = await mod("artifacts/scopes.mjs");
    const db = openDb();
    const { id: sid } = createScope(db, "Test-Header");
    updateScopeAfterReview(db, sid, "PLAN", "Befund", null, "DIVERGENZ-Text >20 Zeichen lang");
    assert.equal(getScope(db, sid).last_divergence, "DIVERGENZ-Text >20 Zeichen lang");
    updateScopeAfterReview(db, sid, "WRITE", "ok", null, null); // konform schliesst
    assert.equal(getScope(db, sid).last_divergence, null);
    updateScopeAfterReview(db, sid, "PLAN", "Befund2", null); // fehlend: keine Aenderung
    assert.equal(getScope(db, sid).last_divergence, null);

    // Downgrade-Bedingung (die run.mjs-Integration koppelt exakt daran).
    assert.equal((parseVerdict(div) === "WRITE" && parseScopeDivergence(div).divergence ? "PLAN" : "WRITE"), "PLAN", "WRITE + Divergenz => PLAN");
    // Sichtbarkeit (UI-107-Prüfung 2026-09-01): die offene Divergenz ist im
    // Artefakt sichtbar — der Punkt, an dem USER-AGENT- und Thinker-Vorschläge
    // auseinanderliegen, muss vor dem nächsten Submit auflösbar bleiben.
    const { artifactView } = await mod("artifacts/scopes.mjs");
    updateScopeAfterReview(db, sid, "PLAN", "Befund3", null, "Zieldatei laut Intent ist lib/x.js, Umsetzung zielt auf src/y.js");
    const view = artifactView(getScope(db, sid), []);
    assert.ok(view.includes("Offene Scope-Divergenz"), "artifactView zeigt den offenen Loop-Anker");
    assert.ok(view.includes("Zieldatei laut Intent"), "Divergenz-Text wird wörtlich gezeigt");
  } finally {
    try { requireDb().closeDb(); } catch { /* Windows-Statement-Timing */ }
    home.cleanup();
  }
});

test("Worker-Start: Orphan-Recovery VOR registerWorker schliesst RUNNING-Waisen des toten Vorgaengers (E2E-Befund 2026-09-01)", async () => {
  const { reapStaleJobs, registerWorker, unregisterWorker, isWorkerAlive, getJob, jobDone } = await mod("artifacts/jobs.mjs");
  const home = withTempHome();
  try {
    const { openDb, closeDb } = requireDb();
    const db = openDb();
    // Kulisse: Vorgaenger im selben Fenster gecrasht (PID lebt nicht mehr,
    // Heartbeat alt) und hat einen RUNNING-Job hinterlassen.
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('worker.1.pid','999999'),('worker.1.ts','2000-01-01T00:00:00.000Z')").run();
    const orphan = createJob(db, { status: "QUEUED" });
    db.prepare("UPDATE jobs SET status = 'RUNNING', window_idx = 1 WHERE id = ?").run(orphan);

    // FIX-Sequenz: erst reap (sieht den toten Vorgaenger), DANN registrieren.
    const reaped = reapStaleJobs(db, 1);
    assert.ok(reaped.includes(orphan), "Reap schliesst die RUNNING-Waise des toten Vorgaengers");
    assert.equal(getJob(db, orphan).status, "ERROR Worker-Abbruch (Recovery)");
    registerWorker(db, 1, process.pid);
    assert.equal(isWorkerAlive(db, 1), true, "Nach Reap+Register lebt der neue Worker");
    unregisterWorker(db, 1);
    closeDb();
  } finally {
    home.cleanup();
  }
});

test("Worker-Start: Register-vor-Reap wuerde den Orphan nicht raeumen (Luecke aus dem E2E, als Kontrast festgenagelt)", async () => {
  const { reapStaleJobs, registerWorker, unregisterWorker, getJob, jobDone } = await mod("artifacts/jobs.mjs");
  const home = withTempHome();
  let db = null;
  const { openDb, closeDb } = requireDb();
  try {
    db = openDb();
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('worker.1.pid','999999'),('worker.1.ts','2000-01-01T00:00:00.000Z')").run();
    const orphan = createJob(db, { status: "QUEUED" });
    db.prepare("UPDATE jobs SET status = 'RUNNING', window_idx = 1 WHERE id = ?").run(orphan);

    // Luecken-Sequenz: registrieren ueberschreibt den toten Vorgaenger, bevor
    // reap die Liveness prueft -> der RUNNING-Job bleibt ewig haengen.
    registerWorker(db, 1, process.pid);
    const reaped = reapStaleJobs(db, 1);
    assert.deepEqual(reaped, [], "Reap sieht den (eigenen) frischen Worker -> kein Reap");
    assert.equal(getJob(db, orphan).status, "RUNNING", "Orphan bleibt haengen (genau der E2E-Zustand)");
    unregisterWorker(db, 1);
    jobDone(db, orphan, null, "Test-Cleanup");
  } finally {
    try { if (db) closeDb(); } catch { /* Windows: Statement-Handles koennen close() blockieren */ }
    home.cleanup();
  }
});

// ── Transient-Retry (Live-E2E 2026-09-03) ───────────────────────────────────
// retryJob war toter Code: cli/run.mjs finalisierte API-Überlastung immer
// direkt per jobDone (ERROR, attempt 1/2, retry_at=NULL) — der zweite
// Versuch wurde nie geplant. Diese Tests nageln den Vertrag fest: transient
// mit Versuchsrest → QUEUED + retry_at (Worker claimt erneut), permanent /
// Limit → final, finale Zustaende unangetastet.
test("retryJob: transient mit Versuchsrest -> QUEUED + retry_at (Worker holt spaeter)", async () => {
  const { retryJob, getJob, jobToRunning } = await mod("artifacts/jobs.mjs");
  const home = withTempHome();
  try {
    const { openDb, closeDb } = requireDb();
    const db = openDb();
    const id = createJob(db, { status: "QUEUED" });
    assert.equal(jobToRunning(db, id, 1), true, "Claim: attempt 1, RUNNING");
    const before = Date.now();
    const out = retryJob(db, id, "API-Überlastung (Stufen 5s/30s/60s erschöpft)", { failureKind: "transient", backoffMs: 60_000 });
    assert.equal(out.retried, true, "transient + attempt < max_attempts -> requeue");
    assert.equal(out.attempt, 1);
    assert.equal(out.maxAttempts, 2);
    const row = getJob(db, id);
    assert.equal(row.status, "QUEUED", "Job wartet erneut in der Queue");
    assert.equal(row.window_idx, null, "Fenster-Zuordnung zurueckgesetzt");
    assert.equal(row.started_at, null, "Start-Zeit zurueckgesetzt");
    assert.equal(row.failure_kind, "transient");
    assert.match(row.error, /API-Überlastung/);
    assert.ok(Date.parse(row.retry_at) >= before + 55_000, `retry_at in der Zukunft: ${row.retry_at}`);
    closeDb();
  } finally {
    home.cleanup();
  }
});

test("retryJob: Worker claimt den requeued Job erst nach retry_at (attempt 2)", async () => {
  const { retryJob, getJob, jobToRunning, claimNextJob, registerWorker, unregisterWorker } = await mod("artifacts/jobs.mjs");
  const home = withTempHome();
  try {
    const { openDb, closeDb } = requireDb();
    const db = openDb();
    registerWorker(db, 1, process.pid);
    const id = createJob(db, { status: "QUEUED" });
    jobToRunning(db, id, 1);
    retryJob(db, id, "Überlastung", { failureKind: "transient", backoffMs: 60_000 });
    // retry_at liegt in der Zukunft -> kein Claim moeglich.
    assert.equal(claimNextJob(db, 1), null, "vor retry_at wird nicht geclaimt");
    // retry_at in die Vergangenheit legen -> Worker holt den Job als Versuch 2.
    db.prepare("UPDATE jobs SET retry_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(id);
    const claimed = claimNextJob(db, 1);
    assert.ok(claimed, "nach retry_at wird geclaimt");
    assert.equal(claimed.id, id);
    assert.equal(claimed.attempt, 2, "zweiter Versuch: attempt 2");
    assert.equal(claimed.status, "RUNNING");
    assert.equal(claimed.retry_at, null, "retry_at beim Claim geleert");
    unregisterWorker(db, 1);
    closeDb();
  } finally {
    home.cleanup();
  }
});

test("retryJob: Versuchs-Limit -> final ERROR (kein Requeue, kein Fake-Verdict)", async () => {
  const { retryJob, getJob, jobToRunning } = await mod("artifacts/jobs.mjs");
  const home = withTempHome();
  try {
    const { openDb, closeDb } = requireDb();
    const db = openDb();
    const id = createJob(db, { status: "QUEUED" });
    jobToRunning(db, id, 1);
    retryJob(db, id, "Überlastung 1", { failureKind: "transient", backoffMs: 0 });
    assert.equal(getJob(db, id).attempt, 1, "requeue laesst attempt unveraendert");
    // Zweiter Lauf scheitert ebenfalls -> jetzt ist das Versuchskonto leer.
    jobToRunning(db, id, 1);
    const out = retryJob(db, id, "Überlastung 2", { failureKind: "transient" });
    assert.equal(out.retried, false);
    assert.equal(out.reason, "attempt-limit");
    const row = getJob(db, id);
    assert.match(row.status, /^ERROR/);
    assert.equal(row.verdict, null, "kein Fake-Verdict");
    assert.equal(row.failure_kind, "transient");
    assert.match(row.error, /Überlastung 2/);
    closeDb();
  } finally {
    home.cleanup();
  }
});

test("retryJob: permanent/aborted -> sofort final, finale Jobs bleiben unangetastet", async () => {
  const { retryJob, getJob, jobToRunning, jobDone } = await mod("artifacts/jobs.mjs");
  const home = withTempHome();
  try {
    const { openDb, closeDb } = requireDb();
    const db = openDb();
    const id = createJob(db, { status: "QUEUED" });
    jobToRunning(db, id, 1);
    const perm = retryJob(db, id, "HTTP 404", { failureKind: "permanent" });
    assert.equal(perm.retried, false);
    assert.match(getJob(db, id).status, /^ERROR/);
    assert.equal(getJob(db, id).failure_kind, "permanent");

    const aborted = createJob(db, { status: "QUEUED" });
    jobToRunning(db, aborted, 1);
    const ab = retryJob(db, aborted, "Abgebrochen", { failureKind: "aborted" });
    assert.equal(ab.retried, false, "Abort ist NICHT retrybar");
    assert.match(getJob(db, aborted).status, /^ERROR/);

    // Finaler Job (DONE WRITE) darf durch retryJob nie umgeschrieben werden.
    const final = createJob(db, { status: "QUEUED" });
    assert.equal(jobDone(db, final, "WRITE", null), true);
    const out = retryJob(db, final, "Überlastung", { failureKind: "transient" });
    assert.equal(out.retried, false);
    assert.equal(out.reason, "final");
    assert.equal(getJob(db, final).status, "DONE WRITE", "finaler Zustand bleibt immutabel");
    assert.equal(getJob(db, final).verdict, "WRITE");
    closeDb();
  } finally {
    home.cleanup();
  }
});

function requireDb() {
  return { openDb: dbModuleOpen.openDb, closeDb: dbModuleOpen.closeDb, setMeta: dbModuleOpen.setMeta };
}
let dbModuleOpen;
test.before(async () => {
  dbModuleOpen = await mod("artifacts/db.mjs");
});

function requireCliJobs() {
  return cliJobs;
}
let cliJobs;
test.before(async () => {
  cliJobs = await mod("cli/jobs.mjs");
});
