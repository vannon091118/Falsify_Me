// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/agent.test.mjs – Timeout-Eskalation (2026-09-01)
// -----------------------------------------------------------------------------
// Deckt ab: eine ueberlastete/hängende API (fetch loest nie auf) eskaliert
// deterministisch — runAgent wirft nach dem Round-Timeout einen kategorisierten
// Fehler („Überlastung (Timeout nach Xs)"), den cli/run.mjs als TIMEOUT-State +
// ERROR-Job (Exit 3) behandelt. Kein Fake-Verdict, kein Endlos-Haenger.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

test("Timeout-Eskalation: haengende API -> kategorisierter Ueberlastungs-Fehler", async () => {
  const { runAgent } = await mod("../core/agent.mjs");
  const realFetch = globalThis.fetch;
  // Hängender Provider: fetch kehrt nie zurueck — der AbortController muss den
  // Round beenden (genau der Zustand „API überlastet"). Der Mock respektiert
  // das signal wie der echte fetch (reject beim Abort).
  globalThis.fetch = (_url, opts) => new Promise((_res, reject) => {
    opts?.signal?.addEventListener("abort", () => reject(opts.signal.reason));
  });
  try {
    await assert.rejects(
      runAgent({
        systemPrompt: "Du bist ein Prüfer.",
        userContent: "Pruefe X.",
        model: "m",
        apiKey: "dummy",
        apiBase: "http://127.0.0.1:1",
        timeoutMs: 200,          // schneller Round-Timeout fuer den Test
        retryBackoffMs: 1,       // schnelle Retries (sonst 4x5s-Schlaf)
        maxToolRounds: 1,
        root: ROOT, whitelist: [],
      }),
      /Überlastung/i,
      "haengende API eskaliert mit Ueberlastungs-Fehler (kein Endlos-Haenger)"
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Stufenleiter: Timeout waechst pro Versuch (5s->30s->60s-Modell), letzte Stufe eskaliert", async () => {
  const { runAgent } = await mod("../core/agent.mjs");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (_url, opts) => new Promise((_res, reject) => {
    opts?.signal?.addEventListener("abort", () => reject(opts.signal.reason));
  });
  try {
    await assert.rejects(
      runAgent({
        systemPrompt: "p", userContent: "c", model: "m", apiKey: "k",
        apiBase: "http://127.0.0.1:1",
        timeoutStagesMs: [100, 200], retryBackoffMs: 1, maxToolRounds: 1,
        root: ROOT, whitelist: [],
      }),
      (e) => {
        const msg = String(e.message);
        return /Stufen .* erschöpft/i.test(msg) && /Stufe 2\/2/i.test(msg);
      },
      "2-Stufen-Leiter: erst 100ms, dann 200ms, danach Eskalation mit Stufenangabe"
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("F-3: 4xx im ersten Round → Retry OHNE reasoning_effort, Tools bleiben erhalten (Twin-Gate)", async () => {
  const { runAgent } = await mod("../core/agent.mjs");
  const bodies = [];
  let calls = 0;
  const override = async (body) => {
    bodies.push(body);
    calls += 1;
    if (calls === 1) throw new Error("HTTP 400: `reasoning_effort` must be one of `none` or `default`");
    return { content: "BEFUND: haelt. VERDICT: WRITE", toolCalls: [], finish: "stop", usage: {} };
  };
  await runAgent({
    systemPrompt: "p", userContent: "c", model: "m", apiKey: "k",
    apiBase: "http://127.0.0.1:1", reasoningEffort: "high",
    timeoutStagesMs: [100, 200], retryBackoffMs: 1, maxToolRounds: 1,
    root: ROOT, whitelist: [],
    fetchRound: override,
  });
  assert.equal(calls, 2, "genau ein Retry nach dem 400");
  assert.equal(bodies[1].reasoning_effort, undefined, "Retry sendet reasoning_effort nicht mehr");
  assert.ok(Array.isArray(bodies[1].tools) && bodies[1].tools.length > 0, "Retry BEHAELT die Tools (Twin-Evidenz-Gate braucht sie)");
  assert.equal(bodies[1].messages[0].role, "system");
});

test("F-3: 4xx bleibt 4xx auch ohne effort → alter Rettungsweg ohne Tools", async () => {
  const { runAgent } = await mod("../core/agent.mjs");
  const bodies = [];
  let calls = 0;
  const override = async (body) => {
    bodies.push(body);
    calls += 1;
    if (calls <= 2) throw new Error("HTTP 400: tools not supported");
    // Verdict enthalten (F-4: verdict-lose Abschlussantworten bohren jetzt nach).
    return { content: "BEFUND: x. VERDICT: PLAN", toolCalls: [], finish: "stop", usage: {} };
  };
  await runAgent({
    systemPrompt: "p", userContent: "c", model: "m", apiKey: "k",
    apiBase: "http://127.0.0.1:1", reasoningEffort: "off",
    timeoutStagesMs: [100, 200], retryBackoffMs: 1, maxToolRounds: 1,
    root: ROOT, whitelist: [],
    fetchRound: override,
  });
  assert.equal(calls, 3, "zwei Retry-Stufen (ohne effort, dann ohne Tools)");
  assert.equal(bodies[1].reasoning_effort, undefined);
  assert.equal(bodies[2].tools, undefined, "zweite Stufe: Tools entfernt wie zuvor dokumentiert");
});

test("F-4: fertige Textantwort OHNE VERDICT -> Nachbohren, Verdict wird geholt", async () => {
  const { runAgent } = await mod("../core/agent.mjs");
  const bodies = [];
  let calls = 0;
  const override = async (body) => {
    bodies.push(body);
    calls += 1;
    if (calls === 1) return { content: "We need to evaluate the plan. Let's read it.", toolCalls: [], finish: "stop", usage: {} };
    return { content: "BEFUND: haelt. VERDICT: WRITE", toolCalls: [], finish: "stop", usage: {} };
  };
  const out = await runAgent({
    systemPrompt: "p", userContent: "c", model: "m", apiKey: "k",
    apiBase: "http://127.0.0.1:1", reasoningEffort: "high",
    timeoutStagesMs: [100, 200], retryBackoffMs: 1, maxToolRounds: 1,
    root: ROOT, whitelist: [],
    fetchRound: override,
  });
  assert.equal(calls, 2, "genau ein Nachbohren bis Verdict da ist");
  assert.match(out.content, /VERDICT: WRITE/);
  assert.equal(bodies[1].tools, undefined, "Nachbohren ohne Tools (Abschluss-Zwang)");
  assert.ok(/VERDICT/.test(bodies[1].messages[bodies[1].messages.length - 1].content), "Nachbohr-Prompt fordert VERDICT");
});

test("F-4: Nachbohren ist bounded (max. 2), verdict-lose letzte Antwort wird ehrlich geliefert", async () => {
  const { runAgent } = await mod("../core/agent.mjs");
  let calls = 0;
  const override = async () => {
    calls += 1;
    return { content: "BEFUND: unvollstaendige Antwort ohne Abschluss.", toolCalls: [], finish: "stop", usage: {} };
  };
  const out = await runAgent({
    systemPrompt: "p", userContent: "c", model: "m", apiKey: "k",
    apiBase: "http://127.0.0.1:1", reasoningEffort: "off",
    timeoutStagesMs: [100, 200], retryBackoffMs: 1, maxToolRounds: 1,
    root: ROOT, whitelist: [],
    fetchRound: override,
  });
  assert.equal(calls, 3, "Original + 2 Nachbohr-Versuche (bounded)");
  assert.doesNotMatch(out.content, /VERDICT\s*:/, "kein erfundenes Verdict - UNBEKANNT bleibt downstream moeglich");
});

test("Deadline-Budget: runAgent rechnet ein Gesamt-Zeitbudget ein (Eskalations-Anker)", async () => {
  const { runAgent } = await mod("../core/agent.mjs");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (_url, opts) => new Promise((_res, reject) => {
    opts?.signal?.addEventListener("abort", () => reject(opts.signal.reason));
  });
  try {
    await assert.rejects(
      runAgent({
        systemPrompt: "p", userContent: "c", model: "m", apiKey: "k",
        apiBase: "http://127.0.0.1:1",
        timeoutMs: 50, retryBackoffMs: 1, maxToolRounds: 2,
        root: ROOT, whitelist: [],
      }),
      (e) => /Überlastung/i.test(String(e.message)) && /Timeout nach \d+s/i.test(String(e.message)),
      "Round-Timeout wird als Ueberlastung mit Sekundenangabe kategorisiert"
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
