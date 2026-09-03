// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/bootstrap.test.mjs – Bootstrap-Module
// Deckt die Review-Fehler ab: Install-Pfad (Paket-Root), persistente
// Instruction-Datei (Enforcement), reale Skill-Pfade, Plattform-Ehrlichkeit.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const B = (p) => pathToFileURL(path.join(ROOT, "cli", "bootstrap", p)).href;

test("detect: codebuff/bash/powershell/generic", async () => {
  const { detectAgent } = await import(B("detect.mjs"));
  assert.equal(detectAgent({ CODEBUFF_HOME: "/x" }, "win32").type, "codebuff");
  assert.equal(detectAgent({ FREEBUFF_SESSION: "1" }, "win32").type, "codebuff");
  assert.equal(detectAgent({ SHELL: "/bin/bash" }, "linux").type, "bash");
  assert.equal(detectAgent({ PSModulePath: "C:", SHELL: "" }, "win32").type, "powershell");
  assert.equal(detectAgent({}, "linux").type, "generic");
  // PowerShell-Marker ohne win32 ist NICHT powershell
  assert.equal(detectAgent({ PSModulePath: "C:" }, "linux").type, "generic");
});

test("install: Pfad auf Paket-Root (install.mjs liegt im Root, nicht in cli/)", async () => {
  const { packageRoot, runInstall } = await import(B("install.mjs"));
  assert.equal(packageRoot, ROOT, "packageRoot muss Repo-Root sein");
  assert.ok(fs.existsSync(path.join(packageRoot, "install.mjs")), "install.mjs im Paket-Root");

  // ROOT-CAUSE-TEST (Bug, 2026-09-01): runInstall darf install.mjs NICHT
  // still mit --no-desktop aufrufen - der Bootstrap ist als Vollinstallation
  // dokumentiert (README "INSTALL + BOOTSTRAP"). Desktop-Icons nur bei
  // explizitem noDesktop:true unterdruecken.
  const { installArgs } = await import(B("install.mjs"));
  assert.deepEqual(installArgs(false), [path.join(ROOT, "install.mjs")],
    "Default: KEIN --no-desktop - Icons werden wie bei node install.mjs erzeugt");
  assert.deepEqual(installArgs(true), [path.join(ROOT, "install.mjs"), "--no-desktop"],
    "explizites noDesktop:true unterdrueckt Icons (Agent-Kontext)");

  // Fehlender install.mjs -> sauberes { ok:false }, kein Crash
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bs-root-"));
  const r = runInstall({ root: fakeRoot, dryRun: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /install\.mjs nicht gefunden/);

  // dryRun greift, ohne zu spawnen
  const d = runInstall({ root: ROOT, dryRun: true });
  assert.equal(d.ok, true);
  assert.equal(d.dryRun, true);
});

test("instructions: persistente Datei wird REAL geschrieben (Enforcement)", async () => {
  const { writeInstruction, instructionTarget, skillPaths } = await import(B("instructions.mjs"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bs-home-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bs-proj-"));

  // codebuff -> AGENTS.md im Projekt-Root
  const t1 = instructionTarget("codebuff", { root, homeDir: home });
  assert.equal(t1, path.join(root, "AGENTS.md"));
  // bash/powershell -> Home-Datei
  assert.equal(instructionTarget("bash", { root, homeDir: home }),
    path.join(home, ".falsifyme-instructions.sh"));
  assert.equal(instructionTarget("powershell", { root, homeDir: home }),
    path.join(home, ".falsifyme-instructions.ps1"));
  // generic -> FALSIFYME-WORKFLOW.md im Root
  assert.equal(instructionTarget("generic", { root, homeDir: home }),
    path.join(root, "FALSIFYME-WORKFLOW.md"));

  const { coreDir } = { coreDir: path.join(home, ".Falsify_Core") };
  const res = await writeInstruction({ type: "codebuff", label: "X" }, { root, homeDir: home, coreDir });
  assert.ok(fs.existsSync(res.target), "Instruction-Datei existiert nach Bootstrap");
  const text = fs.readFileSync(res.target, "utf8");
  // Reale Pfade (Fehler 3 des Reviews): ~/.agents/skills/...
  const { skillsDir, falsiflowSkillDir } = skillPaths(home);
  assert.ok(text.includes(skillsDir), "Instruction enthaelt realen Skills-Pfad");
  assert.ok(text.includes(falsiflowSkillDir), "Instruction enthaelt realen FalsiFlow-Pfad");
  assert.ok(!text.includes("{{"), "keine unersetzten Platzhalter");
  // bash-Template erzeugt valides Bash
  const resBash = await writeInstruction({ type: "bash", label: "Y" }, { root, homeDir: home, coreDir });
  assert.ok(fs.existsSync(resBash.target));
});

test("instructions: Modus-Kopfzeile (UI-075) – PFLICHT/optional, nie still", async () => {
  const { writeInstruction, modeHeader } = await import(B("instructions.mjs"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bs-mode-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bs-mode-proj-"));
  const coreDir = path.join(home, ".Falsify_Core");

  // Explizit PFLICHT + global -> Kopfzeile dokumentiert
  const p = await writeInstruction({ type: "codebuff", label: "X" }, { root, homeDir: home, coreDir, mode: "PFLICHT", reichweite: "global" });
  const textP = fs.readFileSync(p.target, "utf8");
  assert.ok(textP.includes("<!-- FALSIFYME-MODUS: global · PFLICHT -->"), "PFLICHT-Kopfzeile (md)");

  // Default ohne Modus -> optional + Marker (keine stille Aktivierung)
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "bs-mode-proj2-"));
  const d = await writeInstruction({ type: "codebuff", label: "X" }, { root: root2, homeDir: home, coreDir });
  const textD = fs.readFileSync(d.target, "utf8");
  assert.ok(textD.includes("<!-- FALSIFYME-MODUS: projekt · optional -->"), "Default = optional, dokumentiert");

  // sh/ps1-Format: #-Kommentar
  assert.equal(modeHeader("bash", { mode: "PFLICHT", reichweite: "projekt" }), "# FALSIFYME-MODUS: projekt · PFLICHT");
  assert.equal(modeHeader("powershell", { mode: "optional", reichweite: "aus" }), "# FALSIFYME-MODUS: aus · optional");
  assert.equal(modeHeader("generic", { mode: "optional", reichweite: "projekt" }), "<!-- FALSIFYME-MODUS: projekt · optional -->");

  // Keine unersetzten Platzhalter in allen Formaten
  const { renderTemplate } = await import(B("instructions.mjs"));
  for (const type of ["codebuff", "bash", "powershell", "generic"]) {
    const t = renderTemplate(type, {
      SKILLS: "/s", FALSIFLOW_SKILL: "/f", CORE: "/c", ROOT: "/r",
      MODE_HEADER: modeHeader(type, { mode: "optional", reichweite: "projekt" }),
    });
    assert.ok(!t.includes("{{"), `${type}: keine unersetzten Platzhalter`);
  }
});

test("bootstrapFlags: --mode/--reichweite werden geparst und validiert", async () => {
  const { bootstrapFlags } = await import(pathToFileURL(path.join(ROOT, "cli", "bootstrap.mjs")).href);
  const f = bootstrapFlags(["--mode=pflich", "--reichweite=global", "--skip-dock"]);
  assert.equal(f.mode, "PFLICHT");
  assert.equal(f.reichweite, "global");
  assert.equal(f.skipDock, true);
  const o = bootstrapFlags(["--mode=optional"]);
  assert.equal(o.mode, "optional");
  assert.equal(o.reichweite, undefined, "ohne --reichweite bleibt Default dem Aufrufer ueberlassen");
  assert.throws(() => bootstrapFlags(["--mode=unsicher"]), /Ungueltiger --mode/);
  assert.throws(() => bootstrapFlags(["--reichweite=ueberall"]), /Ungueltige --reichweite/);
});

test("bootstrap: dry-run schreibt weder Instruction noch Home-Datei", async () => {
  const { runBootstrap } = await import(B("main.mjs"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bs-dry-home-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bs-dry-root-"));
  fs.writeFileSync(path.join(root, "install.mjs"), "", "utf8");
  const result = await runBootstrap({ root, homeDir: home, dryRun: true, skipDock: true });
  assert.equal(result.ok, true);
  assert.equal(result.instruction.target, "(dry-run)");
  assert.equal(fs.readdirSync(root).length, 1, "Dry-run darf den Root nicht erweitern");
  assert.equal(fs.readdirSync(home).length, 0, "Dry-run darf das Home nicht veraendern");
});

test("apikey: leerer FALSIFY_HOME = kein Key; Key an beliebiger Namensposition zaehlt", async () => {
  const saved = process.env.FALSIFY_HOME;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bs-keyhome-"));
  process.env.FALSIFY_HOME = tmp;
  const origLog = console.log;
  console.log = () => {}; // headless-Guidance unterdruecken (nur Struktur testen)
  try {
    const { hasApiKey, ensureApiKeyAtBootstrap } = await import(B("apikey.mjs"));
    assert.equal(hasApiKey(), false, "leere Home: ehrlich kein Key");
    const r = await ensureApiKeyAtBootstrap({ interactive: false });
    assert.equal(r.configured, false);
    assert.equal(r.mode, "headless");
    // Key an ZWEITER Namensposition (OPENAI statt Default-NVIDIA) muss zaehlen:
    fs.writeFileSync(path.join(tmp, ".env"), "OPENAI_API_KEY=sk-test-123\n", "utf8");
    assert.equal(hasApiKey(), true, "beliebiger Name der Key-Liste zaehlt (loadApiKey)");
  } finally {
    console.log = origLog;
    if (saved === undefined) delete process.env.FALSIFY_HOME;
    else process.env.FALSIFY_HOME = saved;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("dock: Plattform-Ehrlichkeit + Retry-Poll (kein Fake-Erfolg)", async () => {
  const { startDock } = await import(B("dock.mjs"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bs-dock-"));
  const coreDir = path.join(home, ".Falsify_Core");

  // Linux/macOS: NICHT "Dock gestartet" behaupten
  const linux = await startDock({ coreDir }, {
    platform: "linux", pollSeconds: 1, sleep: async () => {},
    runPowerShell: () => { throw new Error("darf nicht aufgerufen werden"); },
  });
  assert.equal(linux.ok, false);
  assert.equal(linux.unsupportedPlatform, true);

  // Windows-Pfad ohne start-dock.cmd -> klarer Fehler, kein Fake
  const win = await startDock({ coreDir }, {
    platform: "win32", pollSeconds: 1, sleep: async () => {},
    runPowerShell: () => {},
  });
  assert.equal(win.ok, false);
  assert.match(win.error, /start-dock\.cmd nicht gefunden/);

  // Erfolgsfall: runPowerShell wird aufgerufen, Poll findet RUNNING
  fs.mkdirSync(path.join(coreDir, "ui"), { recursive: true });
  fs.writeFileSync(path.join(coreDir, "ui", "start-dock.cmd"), "rem test", "utf8");
  let psCalled = 0;
  let polls = 0;
  const ok = await startDock({ coreDir }, {
    platform: "win32",
    pollSeconds: 5,
    sleep: async () => { polls++; },
    runPowerShell: () => { psCalled++; },
    // checkOnce nutzt spawnSync - wir koennen es nicht injizieren, also
    // simulieren wir RUNNING ueber den echten --check nicht, sondern
    // erwarten hier den Timeout-Pfad (ehrlich) und pruefen psCalled.
  });
  assert.equal(psCalled, 1, "PowerShell-Start genau einmal aufgerufen");
  assert.equal(ok.ok, false, "ohne echten RUNNING-Worker kein Fake-Erfolg");
  assert.ok(polls >= 5, "Retry-Poll wurde durchlaufen");
});
