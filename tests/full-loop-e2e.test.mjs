// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/full-loop-e2e.test.mjs – Produktions-Loop E2E (TASK-019)
// -----------------------------------------------------------------------------
// Beweist die volle Kette OHNE manuellen Re-Submit:
//   Thinker (WRITE + Probe-Set) → Evil Twin (BESTAETIGT mit echter Tool-
//   Evidence) → deterministisches Gate → v1-Handoff persistiert →
//   Fake-USER-AGENT ändert ECHT src/app.js → `falsify handoff complete`
//   konsumiert den Writer-Report → Child-Job automatisch in der Queue.
//
// Kein Mock des Gates: die ganze Pipeline läuft echt; nur der HTTP-Endpunkt
// ist lokal deterministisch gefaked (bestehendes probe-e2e-Muster).
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

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-fullloop-proj-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src", "app.js"),
    "export function add(a, b) {\n  return a + b;\n}\n\nexport function clip(v, max) {\n  if (v > max) return max;\n  return v;\n}\n\n",
  );
  return dir;
}

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

function runCli({ home, args, apiBase, entry = "run", ui = false }) {
  const script = entry === "run" ? path.join(ROOT, "cli", "run.mjs") : path.join(ROOT, "cli", "main.mjs");
  const child = spawn(process.execPath, [script, ...args], {
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
      // UI-124: FM-EVT-Marker nur anfordern, wenn der Test sie behauptet.
      ...(ui ? { FALSIFY_UI: "1", FALSIFY_WINDOW: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { out += c; });
  return { outP: new Promise((res) => child.stdout.on("close", () => res(out))), doneP: new Promise((res) => child.on("close", res)) };
}

// Thinker-WRITE wie in probe-e2e (echtes Probe-Set, H1/H2-Abdeckung).
function thinkerWrite() {
  return [
    "BEFUND: Die Umsetzung erfüllt beide Anforderungen; die Gegenprobe bestätigt die Argumentgrenzen nicht als verletzt.",
    "",
    "## Umsetzungsverstaendnis (FalsifyMe)",
    "SCOPE-KONFORM: Die Iteration adressiert genau die Anforderungen des Headers.",
    "",
    "```json",
    JSON.stringify({
      probes: [
        { id: "P1", requirement_ref: "H1", class: "claim-check", target: "src/app.js", claim: "add addiert beide Argumente ohne Runden.", check: "Lies src/app.js und pruefe, dass add a und b ohne Transformation summiert." },
        { id: "P2", requirement_ref: "H2", class: "edge-case", target: "src/app.js", claim: "clip klemmt Werte ueber dem Maximum auf max.", check: "Lies src/app.js und pruefe, dass clip bei v > max genau max zurueckgibt." },
      ],
    }),
    "```",
    "",
    "VERDICT: WRITE",
  ].join("\n");
}

function executorConfirm() {
  return [
    "Ich habe beide Proben selbst gegen src/app.js ausgefuehrt (read_file).",
    "```json",
    JSON.stringify({
      results: [
        { probe_id: "P1", status: "BESTAETIGT", evidence: "Eigene Gegenprobe: `src/app.js:2` → \"  return a + b;\" – add summiert direkt." },
        { probe_id: "P2", status: "BESTAETIGT", evidence: "Eigene Gegenprobe: clip gibt bei v > max max zurueck (Zeile 6 gelesen)." },
      ],
    }),
    "```",
    "VERDICT: KEINS – Urteilskraft trägt ausschließlich der Probe-Block oben.",
  ].join("\n");
}

test("Full-Loop E2E: WRITE-Gate → Handoff → externer Write → automatisches Re-Review-Child", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-fullloop-home-"));
  process.env.FALSIFY_HOME = tmp;
  const project = tempProject();
  const { openDb, closeDb } = await mod("artifacts/db.mjs");
  const identity = await mod("core/identity.mjs");
  const projects = await mod("artifacts/projects.mjs");
  const scopes = await mod("artifacts/scopes.mjs");

  const anchor = identity.initAnchor(project);
  assert.equal(anchor.ok, true, anchor.message);
  const identityDb = openDb();
  projects.bindAnchor(identityDb, anchor, project);
  closeDb();

  let round = 0;
  const server = await fakeApi(() => {
    round++;
    if (round === 1) return { content: thinkerWrite() };
    if (round === 2) return { toolCalls: [{ name: "read_file", arguments: { path: "src/app.js" } }] };
    return { content: executorConfirm() };
  });
  const apiBase = `http://127.0.0.1:${server.address().port}/v1`;

  try {
    // 1. Scope anlegen (echte CLI).
    const db = openDb();
    const scope = scopes.createScope(db, "Die Funktion add addiert zwei Zahlen. Die Funktion clip klemmt Werte auf ein Maximum.", { checkoutId: anchor.value.checkoutId });
    const scopeId = scope.id;
    closeDb();

    // 2. Direkt-Run bis zum WRITE-Verdict (echte Pipeline, kein Gate-Mock).
    const run = runCli({ home: tmp, apiBase, entry: "run", ui: true, args: ["--scope", scopeId, "--root", project, "--files", "src/app.js", "--no-wait", "Iteration: add und clip implementiert (src/app.js), beide Anforderungen erfuellt."] });
    const out = await run.outP;
    const code = await run.doneP;
    assert.equal(code, 0, `WRITE-Lauf muss Exit 0 sein.\n=== AUSGABE ===\n${out}`);
    assert.match(out, /HANDOFF_ID=(\S+)/);
    // UI-124: LOOP-State aus dem ECHTEN Pipeline-Out behaupten (Dock-Beweis
    // aus echten Zuständen, nicht aus Fixtures/DB allein).
    assert.match(out, /FM-EVT: \{"t":"loop","s":"WRITE_AUTHORIZED"/, "WRITE_AUTHORIZED als FM-EVT im Run-Out");
    const handoffId = out.match(/HANDOFF_ID=(\S+)/)[1].replace(/\x1b\[0m/, "").trim();

    // Parent-Job ist im Loop WRITE_AUTHORIZED (vom Handoff-Pfad gesetzt).
    const jobsMod = await mod("artifacts/jobs.mjs");
    const loops = await mod("artifacts/loops.mjs");
    const db2 = openDb();
    const parent = db2.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(parent.status, "DONE WRITE");
    assert.equal(parent.loop_state, "WRITE_AUTHORIZED");
    assert.equal(parent.handoff_id, handoffId);
    assert.ok(parent.header_digest, "header_digest persistiert");
    closeDb();

    // 3. Fake-USER-AGENT ändert ECHT die Datei (der einzige Writer).
    const beforeDigest = parent.change_digest;
    fs.writeFileSync(path.join(project, "src", "app.js"), "export function add(a, b) {\n  return a + b;\n}\n\nexport function clip(v, max) {\n  if (v > max) return max;\n  return v;\n}\n\nexport function nowPresent() { return true; }\n");

    // 4. Writer-Report bauen (so wie es der externe Agent liefert) und einreichen.
    const changes = await mod("core/changes.mjs");
    const handoffPath = path.join(tmp, "logs", `handoff-${parent.id}.json`);
    const handoff = JSON.parse(fs.readFileSync(handoffPath, "utf8"));
    const allowedFiles = ["src/app.js"];
    const after = changes.snapshotRoot(project, allowedFiles);
    const comparison = changes.compareSnapshots(handoff.before_snapshot, after, { allowedFiles });
    assert.equal(comparison.changed, true, "echte Änderung nachweisbar");
    const report = {
      handoff_id: handoffId,
      job_id: parent.id,
      scope_id: scopeId,
      checkout_id: parent.checkout_id,
      writer_id: "fake-external-agent",
      before_digest: beforeDigest,
      after_digest: comparison.after_digest,
      changed_files: comparison.changed_files,
      diff_digest: comparison.diff_digest,
      write_status: "COMPLETED",
    };
    const reportFile = path.join(tmp, "report.json");
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");

    // 5. `falsify handoff complete` – der automatische Re-Review-Pfad.
    const hc = runCli({ home: tmp, apiBase, entry: "main", ui: true, args: ["handoff", "complete", "--file", reportFile, "--root", project] });
    const hcOut = await hc.outP;
    const hcCode = await hc.doneP;
    assert.equal(hcCode, 0, `handoff complete muss Exit 0 sein.\n=== AUSGABE ===\n${hcOut}`);
    assert.match(hcOut, /HANDOFF_OK=/);
    // UI-124: RE_REVIEW_QUEUED als FM-EVT im handoff-complete-Out.
    assert.match(hcOut, /FM-EVT: \{"t":"loop","s":"RE_REVIEW_QUEUED"/, "RE_REVIEW_QUEUED als FM-EVT im Complete-Out");
    const childId = (hcOut.match(/RE_REVIEW_JOB_ID=(\S+)/) || [])[1];
    assert.ok(childId, "Child-Job-ID gemeldet");

    // 6. Korrelation + kein manueller Re-Submit: das Child existiert nur durch
    // den Handoff-Pfad und trägt die komplette Rückverfolgbarkeit (TASK-013).
    const db3 = openDb();
    const child = jobsMod.getJob(db3, childId);
    assert.ok(child, "Child-Job existiert");
    assert.equal(child.parent_job_id, parent.id);
    assert.equal(child.handoff_id, handoffId);
    assert.equal(child.change_digest, comparison.diff_digest);
    assert.equal(child.scope_id, scopeId);
    assert.equal(child.checkout_id, parent.checkout_id);
    assert.equal(child.header_digest, parent.header_digest);
    assert.equal(child.review_iteration, 1);
    assert.equal(child.loop_state, "RE_REVIEW_QUEUED");
    assert.equal(child.status, "QUEUED", "Child wartet in der EINEN Queue");
    // Append-only Loop-Historie vollständig.
    const parentEvents = loops.listLoopEvents(db3, parent.id);
    const types = parentEvents.map((e) => e.event_type);
    assert.ok(types.includes("submitted"), "submitted-Event");
    assert.ok(types.includes("handoff_emitted"), "handoff_emitted");
    assert.ok(types.includes("change_captured"), "change_captured");
    assert.ok(types.includes("re_review_queued"), "re_review_queued");
    // Event-Kette ist lückenlos: previous.to_state == current.from_state, in
    // INSERT-Reihenfolge via rowid (die Audit-Spur folgt der Realität).
    const chain = db3.prepare("SELECT event_type, from_state, to_state FROM loop_events WHERE job_id = ? ORDER BY rowid ASC").all(parent.id);
    for (let i = 1; i < chain.length; i++) {
      if (chain[i].from_state && chain[i - 1].to_state) {
        assert.equal(chain[i].from_state, chain[i - 1].to_state, `Event-Kette bei ${chain[i].event_type}`);
      }
    }
    // 6a. Kausale Loop-Kette am echten Child (TASK-011): der tatsächliche
    // Worker-Claim (claimNextJob) schiebt RE_REVIEW_QUEUED → RE_REVIEW_RUNNING;
    // erst der persistierte finale NICHT-WRITE-Verdict schließt den Loop auf
    // DONE. Beides sind echte Runtime-Zustände, keine TUI-Leuchtschilder.
    const claimedChild = jobsMod.claimNextJob(db3, 1, scopeId);
    assert.equal(claimedChild.id, childId, "Child wird von der echten Claim-Funktion übernommen");
    assert.equal(claimedChild.loop_state, "RE_REVIEW_RUNNING", "Claim setzt RE_REVIEW_RUNNING");
    assert.equal(claimedChild.status, "RUNNING");
    jobsMod.jobDone(db3, childId, "PLAN", null);
    // jobDone vollzieht die DONE-Transition atomar (finaler Job-Zustandsübergang
    // → GENAU EINE Loop-Transition) — kein separater Aufruf mehr nötig.
    assert.equal(loops.getLoopState(db3, childId), "DONE", "finaler NICHT-WRITE-Verdict setzt DONE");
    const childEvents = loops.listLoopEvents(db3, childId).map((e) => e.event_type);
    assert.ok(childEvents.includes("claim_start"), "claim_start-Event");
    assert.ok(childEvents.includes("loop_done"), "loop_done-Event");
    closeDb();

    // 6b. Coder-Brief (Twin→Coder-Übergabepunkt): aus dem ECHTEN, von der
    // Pipeline erzeugten Handoff rendert `falsify handoff brief` die
    // Arbeitsanweisung — mit Whitelist, Basis-Digest und Twin-Ergebnis.
    const br = runCli({ home: tmp, apiBase, entry: "main", args: ["handoff", "brief", "--job-id", parent.id] });
    const brOut = await br.outP;
    const brCode = await br.doneP;
    assert.equal(brCode, 0, `handoff brief muss Exit 0 sein.\n=== AUSGABE ===\n${brOut}`);
    assert.match(brOut, /CODER-BRIEF/);
    assert.match(brOut, /src\/app\.js/, "Whitelist-Datei im Brief");
    assert.match(brOut, /BESTAETIGT/, "Twin-Probe-Ergebnis im Brief");
    assert.match(brOut, /handoff complete/, "Rückgabepflicht im Brief");

    // 7. Zweite Auslieferung desselben Reports ist idempotent.
    const hc2 = runCli({ home: tmp, apiBase, entry: "main", args: ["handoff", "complete", "--file", reportFile, "--root", project] });
    await hc2.outP;
    const hc2Code = await hc2.doneP;
    assert.equal(hc2Code, 0);
    const db4 = openDb();
    const childCount = db4.prepare("SELECT COUNT(*) AS n FROM jobs WHERE parent_job_id = ?").get(parent.id);
    assert.equal(childCount.n, 1, "kein zweites Child bei Duplikat-Delivery");
    closeDb();
  } finally {
    server.close();
    closeDb();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (process.env.FALSIFY_HOME === tmp) delete process.env.FALSIFY_HOME;
  }
});
