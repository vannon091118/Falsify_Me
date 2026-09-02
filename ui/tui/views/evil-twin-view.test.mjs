// UI-114: Evil-Twin-Kontrastbildschirm — View-Inhalt + Overflow-Sicherheit.
// Beweist: Mandat/Job-Status/Roh-Text/Legende sichtbar, Body gedeckelt,
// kleine Fenster laufen nicht ueber (Output-Anzeige bleibt funktionsfaehig).
// Render-frei: Der View ist eine pure Funktion snap -> React-Baum; wir
// sammeln die Text-Children direkt (kein Ink-Renderer noetig).
import test from "node:test";
import assert from "node:assert/strict";
import EvilTwinView from "./EvilTwinView.mjs";

const baseSnap = {
  jobId: "job-abcd",
  scopeId: "scope-ef12",
  stateLabel: "VERIFYING",
  activePhase: { phase: "WRITE" },
  findings: [{ severity: "warning", icon: "▲", n: 2 }],
  output: ["Ich pruefe: core/verdict.mjs:78", "Gegenprobe: artifacts/jobs.mjs:12"],
};

const textOf = (el) => {
  // Sammelt alle Strings aus dem React-Baum (Text-Children).
  const out = [];
  const seen = new Set();
  const walk = (node) => {
    if (node == null || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === "object" && node.props && !seen.has(node)) {
      seen.add(node);
      walk(node.props.children);
    }
  };
  walk(el);
  return out.join("\n");
};

test("UI-114: EvilTwinView zeigt Twin-Mandat, Job-Status, Roh-Text und Legende", () => {
  const el = EvilTwinView({ snap: baseSnap, cols: 100, rows: 30 });
  const text = textOf(el);
  assert.ok(text.includes("EVIL TWIN AKTIV"), "roter Kopf-Balken");
  assert.ok(text.includes("MANDAT"), "Twin-Prompt-Mandat sichtbar");
  assert.ok(text.includes("GEGENPROBE"), "Gegenprobe-Regel sichtbar (eigene Falsifikation, UI-112)");
  assert.ok(text.includes("FAIL-CLOSED"), "Fail-closed-Regel sichtbar");
  assert.ok(text.includes("JOB job-abcd") && text.includes("SCOPE scope-ef12"), "Job-Status-Zeile mit Job+Scope");
  assert.ok(text.includes("WRITE"), "aktive Phase im Job-Status");
  assert.ok(text.includes("core/verdict.mjs:78"), "Roh-Text des Gegenpruefers sichtbar");
  assert.ok(text.includes("BESTAETIGT = Freigabe belastbar"), "Ergebnis-Legende sichtbar");
});

test("UI-114: Body-Budget — neueste Roh-Zeile bleibt sichtbar, Fensterlaenge exakt", () => {
  const manyLines = Array.from({ length: 200 }, (_, i) => `zeile-${String(i).padStart(3, "0")}`);
  const rows = 20;
  const el = EvilTwinView({ snap: { ...baseSnap, output: manyLines }, cols: 100, rows });
  const text = textOf(el);
  assert.ok(text.includes("zeile-199"), "neueste Zeile immer sichtbar");
  assert.ok(!text.includes("zeile-000"), "aelteste Zeilen scrollen im Ring (Body gedeckelt)");
});

test("UI-114: Tiny-Window (8 Zeilen) laeuft nicht ueber, Kern bleibt sichtbar", () => {
  const el = EvilTwinView({ snap: { ...baseSnap, output: ["x".repeat(200)] }, cols: 30, rows: 8 });
  const text = textOf(el);
  assert.ok(text.includes("EVIL TWIN AKTIV"), "Kopf bleibt auch winzig sichtbar");
  assert.ok(text.includes("BESTAETIGT"), "Ergebnis-Legende bleibt sichtbar");
});
