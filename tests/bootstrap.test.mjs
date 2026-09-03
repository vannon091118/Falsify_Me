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

test("bootstrap: dry-run OHNE --skip-dock startet KEIN Dock (UI-139, side-effect-frei)", async () => {
  const { runBootstrap } = await import(B("main.mjs"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bs-dry-nodock-home-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bs-dry-nodock-root-"));
  fs.writeFileSync(path.join(root, "install.mjs"), "", "utf8");
  const origLog = console.log;
  console.log = () => {}; // Dock-Log raushalten (nur Struktur testen)
  try {
    // Vor UI-139 startete dry-run ohne --skip-dock den echten Dock-Pfad
    // (startDock kannte kein dryRun) - auf installierten Maschinen mit
    // gestopptem Worker ein echtes Start-Process-Fenster.
    const result = await runBootstrap({ root, homeDir: home, dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.dock.skipped, true, "dry-run darf das Dock nie starten - nur skipped=true");
    assert.equal(fs.readdirSync(home).length, 0, "Dry-run darf das Home nicht veraendern");
  } finally {
    console.log = origLog;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dockSummaryLine: skip/dry-run behauptet nie 'gestartet und bestaetigt' (UI-139)", async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, "cli", "bootstrap.mjs")).href);
  const { dockSummaryLine } = mod;
  assert.equal(dockSummaryLine({ ok: true, startedAfterSeconds: 3 }), "  Dock         : gestartet und bestaetigt");
  assert.equal(dockSummaryLine({ ok: true, alreadyRunning: true }), "  Dock         : laeuft bereits (RUNNING)");
  assert.equal(dockSummaryLine({ ok: true, skipped: true }), "  Dock         : uebersprungen (--skip-dock)");
  assert.equal(dockSummaryLine({ ok: true, skipped: true, skippedBecause: "dry-run" }), "  Dock         : uebersprungen (dry-run)");
  assert.equal(dockSummaryLine(null), null, "kein Dock-Resultat: keine Zeile erfinden");
  assert.equal(dockSummaryLine({ ok: false, unsupportedPlatform: true }), "  Dock         : Windows-only \u2013 headless Worker: node ui/worker.mjs");
  assert.equal(dockSummaryLine({ ok: false, error: "Timeout" }), "  Dock         : nicht bestaetigt (Timeout) \u2013 manuell: ui/start-dock.cmd");
});

// ─────────────────────────────────────────────────────────────────────────────
// UI-144: fehlende ~/.agents/skills/falsifyme ist KEINE dangling warning.
// Der Bootstrap repariert die Anlage selbst (idempotent, aus dem Repo-Root)
// und meldet ehrlich; ohne Quelle gibt es die konkreten Kommandos statt
// eines stillen Verweises. install.mjs verifiziert den Skill-Marker.
// ─────────────────────────────────────────────────────────────────────────────
test("skills-repair: fehlende Skills werden aus dem Repo-Root nachinstalliert (idempotent)", async () => {
  const { writeInstruction, ensureAgentSkillsInstalled } = await import(B("instructions.mjs"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bs-skill-repair-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bs-skill-proj-"));
  const coreDir = path.join(home, ".Falsify_Core");
  try {
    // Keine ~/.agents/skills vorhanden.
    const res = await writeInstruction({ type: "codebuff", label: "X" }, { root, homeDir: home, coreDir });
    assert.equal(res.skillsInstalled, true, "Repair hat die Skills installiert");
    assert.equal(res.skillsRepaired, true, "Repair-Weg wurde gegangen (nicht schon vorhanden)");
    assert.ok(fs.existsSync(res.skillsDir + "/agent-skill-falsify.sh"), "Skill-Marker existiert nach Repair");
    assert.ok(fs.existsSync(res.falsiflowSkillDir + "/SKILL.md"), "FalsiFlow-SKILL.md nach Repair");
    // Idempotenz: zweiter Lauf geht den Repair-Weg NICHT mehr (schon da).
    const res2 = await writeInstruction({ type: "codebuff", label: "X" }, { root, homeDir: home, coreDir });
    assert.equal(res2.skillsInstalled, true);
    assert.equal(res2.skillsRepaired, false, "zweiter Lauf: nichts zu reparieren (idempotent)");
    // Direkter Aufruf ohne writeInstruction liefert denselben Vertrag.
    const direct = await ensureAgentSkillsInstalled({ homeDir: home });
    assert.equal(direct.ok, true);
    assert.equal(direct.repaired, false, "direkter Aufruf nach bestehender Anlage: repaired=false");
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("skills-repair: fehlende Quelle -> { ok:false, error } statt stiller Nichts-Tun", async () => {
  const { ensureAgentSkillsInstalled } = await import(B("instructions.mjs"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bs-skill-nosrc-"));
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bs-skill-fakeroot-"));
  try {
    const r = await ensureAgentSkillsInstalled({ homeDir: home, packageRoot: fakeRoot });
    assert.equal(r.ok, false);
    assert.equal(r.repaired, false);
    assert.match(r.error, /Skill-Quelle nicht gefunden/);
    assert.ok(!fs.existsSync(path.join(home, ".agents", "skills")), "ohne Quelle wird NICHTS angelegt");
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    fs.rmSync(fakeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("skills-repair: install.mjs-Vertrag – Marker-Prüfung im Quelltext fixiert (kein Behaupten ohne Verifikation)", async () => {
  const src = fs.readFileSync(path.join(ROOT, "install.mjs"), "utf8");
  assert.match(src, /Agent-Skill-Marker fehlt nach Kopie/, "install.mjs verifiziert die Skill-Kopie (fail-fast statt Behauptung)");
  assert.match(src, /skillMarker/, "Marker-Pfad ist benannt und geprüft");
});

test("skillsSummaryLine: OK/NACHINSTALLIERT/FEHLT als eigene Zeile (UI-146)", async () => {
  // bootstrap.mjs liegt in cli/ (nicht cli/bootstrap/) — dockSummaryLine-Export.
  const mod = await import(pathToFileURL(path.join(ROOT, "cli", "bootstrap.mjs")).href);
  const { skillsSummaryLine } = mod;
  // Reihenfolge wie bei Dock (UI-139-Merkregel): dry-run zuerst pruefen —
  // das dry-run-Objekt traegt skillsInstalled:false, ok-First waere FEHLT.
  assert.equal(skillsSummaryLine({ target: "(dry-run)", skillsInstalled: false }),
    "  Skills       : uebersprungen (dry-run)");
  // Bestand vorhanden -> OK.
  assert.equal(skillsSummaryLine({ target: "/x/AGENTS.md", skillsInstalled: true, skillsRepaired: false }),
    "  Skills       : OK (vorhanden)");
  // Im selben Lauf repariert -> NACHINSTALLIERT.
  assert.equal(skillsSummaryLine({ target: "/x/AGENTS.md", skillsInstalled: true, skillsRepaired: true }),
    "  Skills       : NACHINSTALLIERT (aus Paket-Root repariert)");
  // Fehlt + Reparatur-Error -> FEHLT mit Grund + Reparatur-Kommando.
  const err = skillsSummaryLine({ target: "/x/AGENTS.md", skillsInstalled: false, skillsRepairError: "Skill-Quelle nicht gefunden: /x/skills" });
  assert.match(err, /^  Skills       : FEHLT \(Skill-Quelle nicht gefunden/);
  assert.match(err, /falsify doctor --repair-skills/);
  // Fehlt ohne Fehler -> FEHLT mit Reparatur-Kommando.
  const plain = skillsSummaryLine({ target: "/x/AGENTS.md", skillsInstalled: false });
  assert.match(plain, /FEHLT/);
  assert.match(plain, /falsify doctor --repair-skills/);
  // Kein Instruction-Resultat -> null (keine erfundene Zeile).
  assert.equal(skillsSummaryLine(null), null);
  assert.equal(skillsSummaryLine(undefined), null);
});

test("skillsSummaryLine: main() druckt die Skills-Zeile VOR der Dock-Zeile (Verdrahtung)", async () => {
  const src = fs.readFileSync(path.join(ROOT, "cli", "bootstrap.mjs"), "utf8");
  const skillsIdx = src.indexOf("skillsSummaryLine(instruction)");
  const dockIdx = src.indexOf("const dockLine = dockSummaryLine(dock)");
  assert.ok(skillsIdx !== -1, "Skills-Zeile wird im Summary gedruckt");
  assert.ok(dockIdx !== -1);
  assert.ok(skillsIdx < dockIdx, "Skills-Zeile kommt vor der Dock-Zeile");
});

// ─────────────────────────────────────────────────────────────────────────────
// UI-147: Preflight repariert Skills/Anker/Key VOR jeder Instruction-Write.
// Die dangling-warnings-Klasse (Instruction verweist auf Pfade, die erst
// NACH dem Schreiben repariert wuerden) ist strukturell weg: runPreflight
// laeuft VOR writeInstruction, und der Key wird GENAU EINMAL geprueft.
// ─────────────────────────────────────────────────────────────────────────────
test("preflight: repariert fehlende Skills + Anker + Key-Guide VOR Instruction (idempotent)", async () => {
  const savedHome = process.env.FALSIFY_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bs-pf-home-"));
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bs-pf-proj-"));
  const dbHome = fs.mkdtempSync(path.join(os.tmpdir(), "bs-pf-db-"));
  process.env.FALSIFY_HOME = dbHome;
  const origLog = console.log;
  console.log = () => {}; // Key-Guide/Agent-Zeilen raushalten
  try {
    const { runPreflight } = await import(B("main.mjs"));
    // 1) Preflight ohne vorhandene Skills -> repariert aus dem Repo-Root.
    const r = await runPreflight({ root: ROOT, homeDir: home, targetRoot, dryRun: false, interactive: false, skipDock: true });
    assert.equal(r.ok, true, "Preflight ok");
    assert.equal(r.skills.ok, true);
    assert.equal(r.skills.repaired, true, "fehlende Skills wurden NACHinstalliert");
    assert.ok(fs.existsSync(path.join(home, ".agents", "skills", "falsifyme", "agent-skill-falsify.sh")), "Skill-Marker nach Preflight");
    assert.equal(r.anchor.ok, true, "Anker initiiert");
    assert.ok(fs.existsSync(path.join(targetRoot, "FalsifyME.md")), "Anker-Datei existiert VOR Instruction-Write");
    assert.equal(r.key.configured, false, "leere Key-Home ehrlich: kein Key (Guide statt Fake)");
    assert.equal(r.key.mode, "headless");
    // 2) Idempotenz: zweiter Lauf repariert nicht erneut.
    const r2 = await runPreflight({ root: ROOT, homeDir: home, targetRoot, dryRun: false, interactive: false, skipDock: true });
    assert.equal(r2.skills.repaired, false, "zweiter Preflight: nichts zu reparieren");
  } finally {
    console.log = origLog;
    if (savedHome === undefined) delete process.env.FALSIFY_HOME;
    else process.env.FALSIFY_HOME = savedHome;
    for (const d of [home, targetRoot, dbHome]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("preflight: fail-closed ohne Skill-Quelle -> KEINE Instruction-Write danach", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bs-pf-nosrc-home-"));
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bs-pf-nosrc-proj-"));
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bs-pf-nosrc-root-"));
  try {
    const { runPreflight } = await import(B("main.mjs"));
    const r = await runPreflight({ root: fakeRoot, homeDir: home, targetRoot, dryRun: false });
    assert.equal(r.ok, false);
    assert.equal(r.failed, "skills");
    assert.match(r.error, /Skill-Quelle nicht gefunden/);
    assert.ok(!fs.existsSync(path.join(targetRoot, "FalsifyME.md")), "ohne Skills ok=false bleibt der Anker unberuehrt (Abbruch VOR Schritt 2)");
  } finally {
    for (const d of [home, targetRoot, fakeRoot]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("preflight-Verdrahtung: runBootstrap ruft Preflight VOR writeInstruction, Key genau einmal (kein Doppel-Dialog)", async () => {
  const src = fs.readFileSync(path.join(ROOT, "cli", "bootstrap", "main.mjs"), "utf8");
  const pfIdx = src.indexOf("runPreflight(");
  const wIdx = src.indexOf("writeInstruction(");
  assert.ok(pfIdx !== -1 && wIdx !== -1, "runPreflight und writeInstruction vorhanden");
  assert.ok(pfIdx < wIdx, "PREFLIGHT laeuft VOR jeder Instruction-Write (dangling-warnings-Klasse weg)");
  // Der Key wird NUR im Preflight geprueft — ein zweiter ensureApiKeyAtBootstrap
  // nach dem Dock wuerde auf interaktiven Systemen doppelt fragen. Kommentar-
  // Erwaehnungen zaehlen nicht: geprueft wird der CALL ("…AtBootstrap(").
  const callHits = src.split("ensureApiKeyAtBootstrap(").length - 1;
  const rbIdx = src.indexOf("export async function runBootstrap");
  const lastCallIdx = src.lastIndexOf("ensureApiKeyAtBootstrap(");
  assert.equal(callHits, 1, "genau EIN ensureApiKeyAtBootstrap-Call (im Preflight)");
  assert.ok(rbIdx !== -1 && lastCallIdx !== -1 && lastCallIdx < rbIdx, "kein Key-Call in runBootstrap (kein Doppel-Dialog nach dem Dock)");
  // Die Skills-Reparatur-Aussage des Preflight wird ins Instruction-Objekt
  // uebernommen (sonst zeigt die Summary nach Repair nie NACHINSTALLIERT).
  assert.match(src, /skillsInstalled: preflight\.skills\?\.ok === true/);
  assert.match(src, /skillsRepaired: Boolean\(preflight\.skills\?\.repaired\)/);
  assert.match(src, /key: preflight\.key/);
});

// ─────────────────────────────────────────────────────────────────────────────
// UI-148: Veraltete ~/.agents-Skills werden AKTUALISIERT (nicht nur gemeldet).
// ensureAgentSkillsInstalled ueberschreibt eine Anlage, deren Konfig-Version
// aelter als die Quelle ist (oder deren Konfig/Version fehlt) — repaired=true
// nur bei tatsaechlicher Kopie; nie zurueckstufen (installed > source bleibt).
// ─────────────────────────────────────────────────────────────────────────────
test("skills-refresh: veraltete Skill-Anlage wird auf die Quell-Version gebracht (nie Downgrade)", async () => {
  const { ensureAgentSkillsInstalled } = await import(B("instructions.mjs"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bs-skill-refresh-"));
  const srcVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "skills", "agent-skill-falsify.config.json"), "utf8")).version;
  const cfgPath = () => path.join(home, ".agents", "skills", "falsifyme", "agent-skill-falsify.config.json");
  try {
    // 1) Erstinstallation aus dem Repo-Root.
    const first = await ensureAgentSkillsInstalled({ homeDir: home, packageRoot: ROOT });
    assert.equal(first.ok, true);
    assert.equal(first.repaired, true);
    assert.ok(fs.existsSync(cfgPath()), "Konfig (Version-Marker) wird mitkopiert");
    // 2) Anlage kuenstlich veralten lassen (0.0.1) -> Refresh ersetzt sie.
    const old = JSON.parse(fs.readFileSync(cfgPath(), "utf8"));
    old.version = "0.0.1";
    fs.writeFileSync(cfgPath(), JSON.stringify(old), "utf8");
    const refreshed = await ensureAgentSkillsInstalled({ homeDir: home, packageRoot: ROOT });
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.repaired, true, "veraltete Anlage wird repariert");
    assert.equal(refreshed.refreshed, true, "Refresh-Weg ist markiert");
    assert.equal(refreshed.fromVersion, "0.0.1");
    assert.equal(refreshed.toVersion, srcVersion);
    const now = JSON.parse(fs.readFileSync(cfgPath(), "utf8"));
    assert.equal(now.version, srcVersion, "installierte Version entspricht wieder der Quelle");
    // 3) Idempotent: gleiche Version -> kein weiterer Refresh.
    const again = await ensureAgentSkillsInstalled({ homeDir: home, packageRoot: ROOT });
    assert.equal(again.repaired, false, "aktueller Stand: nichts zu tun");
    // 4) Nie zurueckstufen: installierte Version NEUER als Quelle -> unangetastet.
    const fut = JSON.parse(fs.readFileSync(cfgPath(), "utf8"));
    fut.version = "99.0.0";
    fs.writeFileSync(cfgPath(), JSON.stringify(fut), "utf8");
    const noDowngrade = await ensureAgentSkillsInstalled({ homeDir: home, packageRoot: ROOT });
    assert.equal(noDowngrade.repaired, false, "neuere installierte Anlage wird nicht ueberschrieben");
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("skills-refresh: Konfig/Version fehlt in der installierten Anlage -> Refresh stellt sie her", async () => {
  const { ensureAgentSkillsInstalled } = await import(B("instructions.mjs"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bs-skill-nocfg-"));
  try {
    // Marker vorhanden (sh), aber KEINE Versions-Konfig -> Anlage ist
    // unvollstaendig/veraltet: Refresh kopiert die Konfig nach.
    const dir = path.join(home, ".agents", "skills", "falsifyme");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "agent-skill-falsify.sh"), "# alter Stand ohne Konfig\n", "utf8");
    const r = await ensureAgentSkillsInstalled({ homeDir: home, packageRoot: ROOT });
    assert.equal(r.ok, true);
    assert.equal(r.refreshed, true, "fehlende Konfig loest Refresh aus");
    assert.ok(fs.existsSync(path.join(dir, "agent-skill-falsify.config.json")), "Konfig nach Refresh vorhanden");
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UI-149: AGENTS.md-Ebene — jeder ausgelieferte Instruction-Kanal traegt die
// Reparatur-Regel: Startup-Skill-Check-Fehler -> GENAU EINMAL `falsify
// doctor --repair-skills`, BEVOR onboard/der erste Pflicht-Check startet.
// ─────────────────────────────────────────────────────────────────────────────
test("instructions: Repair-Regel (doctor --repair-skills VOR Onboarding) ist in ALLEN Template-Kanaelen", async () => {
  const templates = ["agents-codebuff.md", "generic.md", "bash.sh", "powershell.ps1"];
  for (const t of templates) {
    const text = fs.readFileSync(path.join(ROOT, "cli", "bootstrap", "templates", t), "utf8");
    assert.match(text, /falsify doctor --repair-skills/, `${t}: Reparatur-Kommando genannt`);
    assert.match(text, /GENAU EINMAL/, `${t}: genau-einmal-Semantik`);
    assert.match(text, /BEVOR/, `${t}: Vor-Reihenfolge (vor onboard/erstem Check)`);
    assert.match(text, /Kein Onboarding auf kaputter/, `${t}: kein Onboarding auf kaputter Anlage`);
  }
  // Die eigene AGENTS.md (dieses Repos) traegt dieselbe Regel — der Agent
  // im FalsifyMe-Checkout handelt genauso wie der User-Agent im Zielprojekt.
  const agentsMd = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  assert.match(agentsMd, /falsify doctor --repair-skills/, "Repo-AGENTS.md nennt das Reparatur-Kommando");
  assert.match(agentsMd, /GENAU EINMAL/, "Repo-AGENTS.md: genau-einmal-Semantik");
  assert.match(agentsMd, /BEVOR er `falsify onboard`/, "Repo-AGENTS.md: Reparatur VOR onboard");
});
