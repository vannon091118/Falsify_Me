// FalsifyMe · tests/verdict.test.mjs
// Verdict-Parsing-Vertrag:auch wenn das Modell das Verdict als Markdown-Überschrift
// schreibt („## VERDICT: PLAN“ bzw. „## VERDICT“ + Wert in Folgezeile), muss das
// Parsing es erkennen — sonst endet ein fachlich korrektes Urteil als UNBEKANNT
// (Live-E2E-Befund 2026-09-02, Dock-Session).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

test("parseVerdict erkennt VERDICT: am Zeilenanfang (Bestand)", async () => {
  const { parseVerdict } = await mod("core/verdict.mjs");
  assert.equal(parseVerdict("Analyse …\nBEFUND: x\nVERDICT: PLAN"), "PLAN");
  assert.equal(parseVerdict("VERDICT: WRITE"), "WRITE");
  assert.equal(parseVerdict("kein Verdict hier"), null);
});

test("parseVerdict erkennt Überschriften-Form „## VERDICT: PLAN“ (E2E-Befund)", async () => {
  const { parseVerdict } = await mod("core/verdict.mjs");
  assert.equal(parseVerdict("## Befund\nDie Umsetzung wirft TypeError statt RangeError.\n\n## VERDICT\nPLAN\n\n## SUBPROMPT\n…"), "PLAN",
    "## VERDICT + Wert in Folgezeile muss erkannt werden");
  assert.equal(parseVerdict("## VERDICT: PLAN\nRest"), "PLAN",
    "## VERDICT: PLAN in einer Zeile muss erkannt werden");
  assert.equal(parseVerdict("# Prüfung\n## VERDICT: WRITE\n"), "WRITE",
    "jede Markdown-Überschriftenebene zählt");
});

test("parseVerdict erkennt fette Markdown-Form „**VERDICT:** PLAN“ (Live-E2E 2026-09-04, Job 1eq1ug)", async () => {
  const { parseVerdict } = await mod("core/verdict.mjs");
  assert.equal(parseVerdict("Analyse …\n**BEFUND:** Lücke real.\n**VERDICT:** PLAN\n**SUBPROMPT:** …"), "PLAN",
    "**VERDICT:** PLAN am Zeilenanfang (fett) muss erkannt werden — sonst UNBEKANNT trotz klarem Urteil");
  assert.equal(parseVerdict("## Befund\nDie Umsetzung wirft TypeError.\n\n**VERDICT:** WRITE\n"), "WRITE");
  assert.equal(parseVerdict("*VERDICT: RESEARCH*"), "RESEARCH", "einzelnes Sternchen ebenso");
  assert.equal(parseVerdict("text **VERDICT: WRITE** mitten im Satz"), null,
    "inline-Verdict bleibt ausgeschlossen (kein Zeilenanfang)");
});

test("parseVerdict bleibt fail-closed: zweideutige/leere Formen bleiben null", async () => {
  const { parseVerdict } = await mod("core/verdict.mjs");
  assert.equal(parseVerdict("## VERDICT\n\n## SUBPROMPT\n…"), null,
    "## VERDICT ohne Wert ist kein Urteil");
  assert.equal(parseVerdict("text VERDICT: WRITE mitten im Satz"), null,
    "Verdict mitten im Text ist kein Zeilen-Urteil");
  assert.equal(parseVerdict("## VERDICT: UNSINN\n"), null, "unbekanntes Wort bleibt null");
});

test("parseBefund erkennt „## Befund“-Überschrift + Absatz als Fallback (E2E-Befund)", async () => {
  const { parseBefund } = await mod("core/verdict.mjs");
  const content = "## Befund\nDie Umsetzung lässt bei Symbolen einen TypeError zu – ein klarer Verstoß.\n\n## VERDICT: PLAN";
  assert.equal(parseBefund(content), "Die Umsetzung lässt bei Symbolen einen TypeError zu – ein klarer Verstoß.",
    "Überschriften-Absatz trägt den Befund, wenn keine BEFUND:-Zeile existiert");
  assert.equal(parseBefund("BEFUND: klassische Zeile"), "klassische Zeile");
  assert.equal(parseBefund("gar nichts"), null);
});
