// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/prompt.test.mjs – Prompt-Texte sind DATEN (Root-Cause-Fix)
// -----------------------------------------------------------------------------
// Der frühere Aufbau (Template-Literale in core/prompt.mjs) zerbrach bei
// Backticks/`${}` im Prompt-Text (SyntaxError -> 5 Testfails). Seit dem
// Root-Cause-Fix leben die System-Prompts als Markdown-Daten in
// core/prompt-text/*.md — ein Prompt-Edit kann prompt.mjs strukturell nicht
// mehr brechen. Dieser Test sichert: Exporte laden, Vertrags-Marker bleiben
// erhalten (DE/EN + Evil-Twin), und buildUserContent (weiterhin Code mit
// echter Interpolation) rendert Diff-Fences korrekt.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_DE,
  SYSTEM_EN,
  SYSTEM_EVILTWIN_DE,
  SYSTEM_EVILTWIN_EN,
  buildUserContent,
} from "../core/prompt.mjs";

const ALL = [SYSTEM_DE, SYSTEM_EN, SYSTEM_EVILTWIN_DE, SYSTEM_EVILTWIN_EN];

test("Prompt-Texte sind Daten: alle vier System-Prompts laden nicht-leer", () => {
  for (const p of ALL) {
    assert.ok(typeof p === "string" && p.trim().length > 500, `Prompt zu kurz oder leer (${p.length})`);
  }
});

test("Vertrags-Marker bleiben in den Daten erhalten (DE/EN)", () => {
  assert.match(SYSTEM_DE, /## Falsifikationsversuche/);
  assert.match(SYSTEM_DE, /VERDICT: PLAN \| RESEARCH \| WRITE \| ASK/);
  assert.match(SYSTEM_DE, /BEFUND:/);
  assert.match(SYSTEM_EN, /## Falsification attempts/);
  assert.match(SYSTEM_EN, /VERDICT: PLAN \| RESEARCH \| WRITE \| ASK/);
  assert.match(SYSTEM_EN, /BEFUND:/);
});

test("Evil-Twin-Vertrag: Gegenrolle + Output-Vertrag in beiden Sprachen", () => {
  for (const p of [SYSTEM_EVILTWIN_DE, SYSTEM_EVILTWIN_EN]) {
    assert.match(p, /BESTAETIGT \| WIDERSPRUCH \| UNKLAR/);
    assert.match(p, /BEFUND:/);
    assert.match(p, /Evil Twin/);
  }
  // Fail-closed-Prinzip ist Teil der Daten (Prompt darf nie weich werden):
  for (const p of [SYSTEM_EVILTWIN_DE, SYSTEM_EVILTWIN_EN]) {
    assert.match(p, /UNKLAR/);
    assert.match(p, /lesen|reading/i);
  }
});

test("buildUserContent bleibt Code: Interpolation + Diff-Fences korrekt", () => {
  const uc = buildUserContent({
    header: "H",
    phase: "write",
    lastBefund: "B",
    findings: [{ round: 1, mode: "write", verdict: "PLAN", befund: "F1" }],
    subPrompt: "Anker",
    planText: "Plan-Text",
    diffText: "diff --git a/x b/x",
    root: "/r",
    whitelist: ["x.js"],
    feasibilityNotes: ["Hinweis 1"],
    agentIntent: "Verständnis",
    affected: ["a.js"],
  });
  assert.match(uc, /```diff/);
  assert.match(uc, /Plan-Text/);
  assert.match(uc, /## Agent-Verständnis/);
  assert.match(uc, /Hinweis 1/);
});

test("Fehlende Prompt-Datei schlägt laut fehl (fail-fast statt stiller Leere)", async () => {
  // Der Loader ist nicht exportiert – wir prüfen den Effekt über einen
  // dynamischen Import auf einen temporären Modul-Schnipsel mit kaputtem Pfad.
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-prompt-"));
  try {
    fs.mkdirSync(path.join(tmp, "prompt-text"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "loader.mjs"),
      `import { readFileSync } from "node:fs";\n` +
        `const promptText = (name) => readFileSync(new URL("./prompt-text/" + name + ".md", import.meta.url), "utf8").trim();\n` +
        `export const P = promptText("fehlt");\n`
    );
    await assert.rejects(
      () => import(pathToFileURL(path.join(tmp, "loader.mjs")).href),
      (e) => /ENOENT|missing|unable/i.test(String(e?.message))
    );
  } finally {
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); break; }
      catch { await new Promise((r) => setTimeout(r, 50)); }
    }
  }
});