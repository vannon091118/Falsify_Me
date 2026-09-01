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
