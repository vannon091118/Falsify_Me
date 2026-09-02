// FalsifyMe · tests/agent-stream-output.test.mjs
// Load-Bearing-Claim (E2E-Audit 2026-09-02): Der Verlauf muss durch die
// VOLLSTÄNDIGE Kette fließen, nicht nur `wrapStreamLines` isoliert:
//
//   runAgent (echtes streamWrite/regexStream) → process.stdout
//     → createParser onLine → noteLine → snap.output → OutputView
//
// Der Kindprozess (stream-agent-fixture) führt runAgent gegen einen
// simulierten SSE-Reasoning-Stream OHNE Newlines aus (NIM-Live-Befund). Der
// Test parst dessen stdout mit demselben createParser wie der Worker und
// prüft, dass snap.output mit gewrappten, lesbaren Zeilen gefüllt wird.
// Deterministisch, unabhängig von einem persistierenden Dock-Prozess.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTui } from "../ui/tui.mjs";
import { createParser } from "../ui/tui/parser.mjs";

const FIXTURE = fileURLToPath(new URL("./stream-agent-fixture.mjs", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("load-bearing: echter runAgent-Stream (Kein-Newline-Reasoning) fuellt snap.output lesbar", async () => {
  const ui = await createTui();
  // Ein Job aktiv, Fenster 1 (wie der reale Worker nach dem Claim).
  ui.applyEvent({ t: "job", id: "job-1234-ab", scope: "scope-5678", window: 1 });
  ui.applyEvent({ t: "state", s: "THINKING" });

  const child = spawn(process.execPath, [FIXTURE], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Exakt der Worker-Pfad: Parser routet Nicht-FM-EVT-Zeilen via onLine → noteLine.
  const parser = createParser({
    onEvent: (e) => ui.applyEvent({ ...e, window: 1 }),
    onLine: (l) => ui.noteLine(l),
  });
  child.stdout.on("data", (c) => parser.feed(c.toString()));
  child.stdout.on("end", () => parser.flush());
  child.stderr.on("data", () => {});
  const code = await new Promise((res) => child.on("close", res));
  assert.equal(code, 0, "Fixture ohne Fehler beendet");

  const snap = ui.getSnap();
  assert.ok(snap.output.length > 0, "snap.output ist gefuellt (nicht leer)");

  // Verlauf: gewrappte Lesbarkeit + Inhalt bleibt erhalten (kein Verlust).
  // Der Reasoning-Strom "word word word …" muss als MEHRERE kurze Zeilen
  // (<=110) und nicht als eine Riesen-Zeile im Ring landen.
  const lines = snap.output.map((l) => String(l)).filter((l) => !l.startsWith("FM-RESULT"));
  assert.ok(lines.length >= 2, `mehrere Verlauf-Zeilen (got ${lines.length})`);
  for (const l of lines) assert.ok(l.length <= 110, `keine Zeile laenger als 110 (got ${l.length})`);

  const joined = lines.join(" ");
  assert.ok(joined.includes("word word"), "Reasoning-Inhalt ist im Verlauf erhalten (kein Verlust)");
  assert.ok(!joined.includes("wordword"), "Wortgrenzen intakt (kein Mid-Word-Verschmelzen)");

  ui.finish(0); // Plain-Tui-Timer beenden (sonst haelt der re-arming Timer den Loop offen)
});
