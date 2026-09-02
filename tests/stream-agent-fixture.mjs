// FalsifyMe · tests/stream-agent-fixture.mjs
// Deterministischer Kindprozess für den Load-Bearing-Test:
//   runAgent (ECHTE fetchRoundWith/readStream → streamWrite) → process.stdout
//   → (vom Test) createParser onLine → noteLine → snap.output
//
// Simuliert einen NVIDIA-NIM-artigen SSE-Stream: Reasoning kommt als
// Fliesstext OHNE Newlines (der Live-Befund 2026-09-02), Content am Ende mit
// BEFUND/VERDICT. globalThis.fetch wird ersetzt, damit runAgent seinen
// ECHTEN Stream-Pfad (fetchRoundWith + readStream + streamWrite) durchläuft,
// ohne ein Netzwerk zu brauchen. Deterministisch.
import { runAgent } from "../core/agent.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const reason = "word ".repeat(300).trim(); // 1500 Zeichen, KEIN Newline
const encoder = new TextEncoder();

// Baut einen echten SSE-Response (text/event-stream) mit getReader()-fähigem
// body — exakt das, was fetchRoundWith/readStream von `fetch` erwartet.
function mockFetch(/* url, init */) {
  const chunks = [];
  const step = 40;
  for (let i = 0; i < reason.length; i += step) {
    chunks.push(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reason.slice(i, i + step) } }] })}\n\n`));
  }
  chunks.push(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "BEFUND: kein Fehler nachgewiesen.\nVERDICT: PLAN\n" } }] })}\n\n`));
  chunks.push(encoder.encode("data: [DONE]\n\n"));
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return Promise.resolve(new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  }));
}

globalThis.fetch = mockFetch;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fm-agent-"));

// KEIN fetchRound-Override: runAgent nutzt seine echte fetchRoundWith →
// readStream → streamWrite (realer Pfad, kein Mock auf dieser Ebene).
const result = await runAgent({
  systemPrompt: "System",
  userContent: "User",
  model: "test-model",
  apiKey: "test-key",
  apiBase: "http://localhost",
  maxToolRounds: 1,
  reasoningEffort: "high",
  timeoutMs: 5000,
  root,
  whitelist: [],
});

// streamWrite puffert in echtes process.stdout (realer Pfad). Kurze Pause,
// damit der modul-lokale Stream-Timer geflusht hat, dann Exit.
await new Promise((r) => setTimeout(r, 300));
process.stdout.write("\nFM-RESULT:" + JSON.stringify({ content: result.content.slice(0, 60), toolRounds: result.toolRounds }) + "\n");
process.exit(0);
