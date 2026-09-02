// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/tool-evidence.test.mjs
// Tool-Evidence als objektive Wahrheit des "eigenes Lesen"-Nachweises (Regel 6):
// Ein BESTAETIGT des Twins ist erst belastbar, wenn der Host einen erfolgreichen
// erlaubten read_file-Aufruf DES Twins aufgezeichnet hat. Modelltext (Zitat,
// Datei:Zeile) ist Diagnose, kein Beweis.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-tool-evidence-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "app.js"), "export const app = true;\n");
  return dir;
}

test("twinOwnFalsificationOk: erfolgreicher erlaubter read_file trägt die Freigabe – ohne Zitat", async () => {
  const { twinOwnFalsificationOk } = await mod("core/twin-evidence.mjs");
  const dir = tempProject();
  try {
    const twin = { verdict: "BESTAETIGT", toolRounds: 2, befund: "Hält nach eigener Prüfung.", content: "BEFUND: Hält.\nVERDICT: BESTAETIGT" };
    const evidence = [{ tool: "read_file", path: "src/app.js", allowed: true, success: true }];
    assert.equal(twinOwnFalsificationOk(twin, { root: dir, whitelist: ["src/app.js"], toolEvidence: evidence }), true,
      "eigener erfolgreicher read_file ist objektiver Lektüre-Nachweis");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("twinOwnFalsificationOk: perfektes wörtliches Zitat ohne eigenen Tool-Aufruf wird abgelehnt", async () => {
  const { twinOwnFalsificationOk } = await mod("core/twin-evidence.mjs");
  const dir = tempProject();
  try {
    const quote = "export const app = true;";
    const twin = {
      verdict: "BESTAETIGT", toolRounds: 2,
      befund: `src/app.js:1 → "${quote}"`,
      content: `BEFUND: src/app.js:1 → "${quote}"\nVERDICT: BESTAETIGT`,
    };
    assert.equal(twinOwnFalsificationOk(twin, { root: dir, whitelist: ["src/app.js"], toolEvidence: [] }), false,
      "Nachlese/Erraten ohne eigenen Tool-Aufruf ist keine eigene Falsifikation");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("twinOwnFalsificationOk: fehlgeschlagene oder nicht erlaubte read_file zählen nicht; list_dir/glob allein nicht", async () => {
  const { twinOwnFalsificationOk } = await mod("core/twin-evidence.mjs");
  const dir = tempProject();
  try {
    const twin = { verdict: "BESTAETIGT", toolRounds: 3, befund: "Hält.", content: "BEFUND: Hält.\nVERDICT: BESTAETIGT" };
    const opts = { root: dir, whitelist: ["src/app.js"] };
    const cases = [
      [{ tool: "read_file", path: "../secret.txt", allowed: false, success: false }],
      [{ tool: "read_file", path: "src/app.js", allowed: true, success: false, error: "Whitelist" }],
      [{ tool: "list_dir", path: ".", allowed: true, success: true }],
      [{ tool: "glob", pattern: "**/*.js", allowed: true, success: true }],
    ];
    for (const evidence of cases) {
      assert.equal(twinOwnFalsificationOk(twin, { ...opts, toolEvidence: evidence }), false,
        `nicht belastbar: ${JSON.stringify(evidence)}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runAgent zeichnet erfolgreiche Tool-Aufrufe als toolEvidence auf (realer Runner)", async () => {
  const { runAgent } = await mod("core/agent.mjs");
  const dir = tempProject();
  try {
    const calls = [
      { id: "c1", name: "read_file", arguments: JSON.stringify({ path: "src/app.js" }) },
    ];
    const runnerRound = (idx) => ({
      content: idx === 0 ? "" : "BEFUND: fertig.\nVERDICT: PLAN",
      toolCalls: idx === 0 ? calls : [],
      usage: {},
      finish: idx === 0 ? "tool_calls" : "stop",
    });
    let idx = 0;
    const out = await runAgent({
      systemPrompt: "sys", userContent: "user",
      model: "m", apiKey: "k", apiBase: "https://unit.invalid",
      root: dir, whitelist: ["src/app.js"],
      fetchRound: async () => runnerRound(idx++),
    });
    assert.ok(Array.isArray(out.toolEvidence), "runAgent liefert toolEvidence");
    const read = out.toolEvidence.find((e) => e.tool === "read_file" && e.path === "src/app.js");
    assert.ok(read, "read_file-Aufruf wurde aufgezeichnet");
    assert.equal(read.success, true);
    assert.equal(read.allowed, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runTwinCheck reicht toolEvidence des Twin-Runs weiter", async () => {
  const { runTwinCheck } = await mod("core/twin.mjs");
  const evidence = [{ tool: "read_file", path: "src/app.js", allowed: true, success: true }];
  const out = await runTwinCheck({
    planText: "P", claims: "C", model: "m", apiKey: "k", apiBase: "https://unit.invalid",
    root: ".", whitelist: ["src/app.js"],
    runner: async () => ({ content: "BEFUND: Hält.\nVERDICT: BESTAETIGT", toolRounds: 1, usage: {}, toolEvidence: evidence }),
  });
  assert.deepEqual(out.toolEvidence, evidence, "Twin-Evidence kommt unverändert beim Gate an");
});
