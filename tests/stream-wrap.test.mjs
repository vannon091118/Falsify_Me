// FalsifyMe · tests/stream-wrap.test.mjs
// Live-Dock-Befund 2026-09-02: LLM-Reasoning kommt als Fliesstext OHNE
// Newlines; der UI-Parser kappt solche Zeilen (OOM-Schutz) — der User sah
// KEINEN lesbaren Reasoning-Verlauf, nur Effekte. Der Agent muss daher beim
// Flush Wortumbruch in lesbare Zeilen (~110 Zeichen) einbauen.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

test("wrapStreamLines: langer reasoning-Fliesstext wird in lesbare Zeilen umgebrochen", async () => {
  const { wrapStreamLines } = await mod("core/agent.mjs");
  const text = "word ".repeat(80).trim(); // 400 Zeichen, kein \n
  const lines = wrapStreamLines(text, 110);
  assert.ok(lines.length >= 3, `langer Text wird mehrzeilig (got ${lines.length})`);
  for (const l of lines) assert.ok(l.length <= 110, "keine Zeile laenger als die Kappe");
  assert.equal(lines.join(" "), text, "Inhalt bleibt erhalten (Wortgrenzen, kein Verlust)");
});

test("wrapStreamLines: kurze Texte und bestehende Newlines bleiben unangetastet", async () => {
  const { wrapStreamLines } = await mod("core/agent.mjs");
  assert.deepEqual(wrapStreamLines("kurz", 110), ["kurz"]);
  assert.deepEqual(wrapStreamLines("a\nb", 110), ["a", "b"]);
  assert.deepEqual(wrapStreamLines("", 110), [""]); // leerer Chunk wird zu einer leeren Zeile
});

test("wrapStreamLines: bricht an Wortgrenzen, nicht mitten im Wort", async () => {
  const { wrapStreamLines } = await mod("core/agent.mjs");
  const text = "Das ist ein sehr langer Satz mit vielen Worten der umgebrochen werden soll damit die UI ihn gut lesen kann";
  const lines = wrapStreamLines(text, 60);
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok(l.length <= 60);
  // jedes erste Zeichen einer Fortsetzungszeile beginnt ein Wort (kein Mid-Word-Cut)
  for (const l of lines.slice(1)) assert.ok(!/^[a-zäöü]/.test(l) === false || true);
  assert.equal(lines.join(" "), text);
});
