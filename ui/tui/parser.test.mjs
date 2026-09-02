import { test } from "node:test";
import assert from "node:assert/strict";
import { createParser, stripAnsi, MARKER, MAX_PARTIAL, MAX_LINE } from "./parser.mjs";

test("parser: Marker-Zeilen -> Events, Rest -> Roh-Zeilen", () => {
  const events = [];
  const lines = [];
  const p = createParser({ onEvent: (e) => events.push(e), onLine: (l) => lines.push(l) });
  p.feed(`plain line 1\n${MARKER} {"t":"state","s":"THINKING"}\nplain 2\n`);
  assert.deepEqual(events, [{ t: "state", s: "THINKING" }]);
  assert.deepEqual(lines, ["plain line 1", "plain 2"]);
});

test("parser: Chunk-Grenzen mitten in Zeilen (Teilzeilen-Puffer)", () => {
  const events = [];
  const lines = [];
  const p = createParser({ onEvent: (e) => events.push(e), onLine: (l) => lines.push(l) });
  p.feed(`${MARKER} {"t":"job","id":"a`);
  p.feed(`bc"}`);
  p.feed("\nrest");
  p.flush();
  assert.deepEqual(events, [{ t: "job", id: "abc" }]);
  assert.deepEqual(lines, ["rest"]);
});

test("parser: ANSI wird gestrippt, CR entfernt", () => {
  const lines = [];
  const p = createParser({ onLine: (l) => lines.push(l) });
  p.feed("\x1b[32mgreen\x1b[0m\r\n\x1b[1mbold\x1b[22m\r\n");
  assert.deepEqual(lines, ["green", "bold"]);
});

test("parser: kaputte Marker-Zeile faellt als Zeile durch", () => {
  const events = [];
  const lines = [];
  const p = createParser({ onEvent: (e) => events.push(e), onLine: (l) => lines.push(l) });
  p.feed(`${MARKER} not-json\n`);
  p.flush();
  assert.equal(events.length, 0);
  assert.ok(lines.length === 1);
});

test("stripAnsi: OSC-Sequenz und nackte ESC", () => {
  assert.equal(stripAnsi("a\x1b]0;TITLE\x07b"), "ab");
  assert.equal(stripAnsi("x\x1b[2Jy"), "xy");
});

test("parser: Marker mitten in Zeile wird erkannt", () => {
  const events = [];
  const p = createParser({ onEvent: (e) => events.push(e) });
  p.feed(`\x1b[36m${MARKER} {"t":"finding","severity":"warning"}\x1b[0m\n`);
  assert.deepEqual(events, [{ t: "finding", severity: "warning" }]);
});

test("OOM-B10: Teilzeilen-Puffer ist byte-begrenzt (Stream ohne \\n wächst unendlich)", () => {
  // Ein LLM-Reasoning-Stream kann Minutenlang Fliesstext OHNE Newline
  // liefern — vorher wuchs `partial` ungebunden (empirisch: 7,8 MB Input
  // -> 133 MB Heap). Mit der Kappe bleibt der Puffer auf MAX_PARTIAL/2
  // gedeckelt und das Ende (die livedaten) bleibt erhalten.
  const lines = [];
  const p = createParser({ onLine: (l) => lines.push(l) });
  const chunk = "x".repeat(4096);
  for (let i = 0; i < 2000; i++) p.feed(chunk); // ~7,8 MB ohne ein einziges \n
  p.flush();
  // Flush verarbeitet den Rest als EINE Zeile, aber auf MAX_LINE gekürzt.
  assert.equal(lines.length, 1);
  assert.ok(lines[0].length <= MAX_LINE, `Zeile auf ${MAX_LINE} gekürzt, war aber ${lines[0].length}`);
});

test("OOM-B10: Anzeige-Zeilen über MAX_LINE werden gekürzt, Events bleiben intakt", () => {
  const lines = [];
  const events = [];
  const p = createParser({ onEvent: (e) => events.push(e), onLine: (l) => lines.push(l) });
  // Riesige Roh-Zeile (kein Marker) -> onLine gekürzt.
  p.feed("y".repeat(MAX_LINE + 50_000) + "\n");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, MAX_LINE, "Anzeige-Zeile auf MAX_LINE gekürzt");
  // Grosses, aber LEGITIMES Event-Payload (> MAX_LINE) bleibt intakt —
  // die Kappe greift nur auf dem onLine-Pfad, nie auf dem Event-Pfad.
  const bigPayload = JSON.stringify({ t: "files", n: 3, list: ["a".repeat(20_000), "b", "c"] });
  p.feed(`${MARKER} ${bigPayload}\n`);
  assert.equal(events.length, 1);
  assert.equal(events[0].t, "files");
  assert.equal(events[0].list[0].length, 20_000, "Event-Payload unverändert");
});