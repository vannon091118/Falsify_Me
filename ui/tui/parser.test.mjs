import { test } from "node:test";
import assert from "node:assert/strict";
import { createParser, stripAnsi, MARKER } from "./parser.mjs";

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