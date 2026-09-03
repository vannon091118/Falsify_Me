// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/uninstall.test.mjs – Vollständige Deinstallation
// -----------------------------------------------------------------------------
// Ziel: „als wäre FalsifyMe nie da gewesen". Isolierter Fake-Home (via
// FALSIFY_UNINSTALL_HOME, nur Tests) – die echte Benutzerumgebung (Profile,
// Desktop, npm-Shims) wird NIE angefasst.
// Deckt ab: dry-run (nichts ändern), Marker-Zeilen aus .bashrc/.bash_profile/
// .profile/PowerShell-Profil (dot-source „FalsifyMe-Agent-Integration“ UND
// PATH-Einträge „Falsify-CLI“), Instruction-Dateien, Skills, Core, Private +
// Key-Backup, AGENTS.md-/FALSIFYME-WORKFLOW.md-Marker, .gitignore-Block und
// Identitäts-Anker FalsifyME.md (--project-root), Idempotenz.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixtureHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-uninstall-"));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-uninstall-proj-"));
  // Shell-/Profil-Dateien mit beiden Marker-Typen + fremden Zeilen.
  const bashLines = [
    "# meine eigene config",
    'export PATH="$HOME/.Falsify_Core/cli:$PATH"  # Falsify-CLI v2 (falsify submit|wait|scope|jobs|state|...) – automatisch ergaenzt',
    '[ -f "$HOME/.falsifyme-instructions.sh" ] && source "$HOME/.falsifyme-instructions.sh"  # FalsifyMe-Agent-Integration (automatisch ergaenzt)',
    "export FOO=bar",
  ].join("\n") + "\n";
  fs.mkdirSync(path.join(home, "Documents", "PowerShell"), { recursive: true });
  fs.writeFileSync(path.join(home, ".bashrc"), bashLines);
  fs.writeFileSync(path.join(home, ".bash_profile"), 'export PATH="/x/Falsify-CLI-tool:$PATH"\n');
  fs.writeFileSync(path.join(home, ".profile"), "export PATH=$PATH:whatever\n");
  fs.writeFileSync(path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"), ". $HOME/.falsifyme-instructions.ps1  # FalsifyMe-Agent-Integration (automatisch ergaenzt)\n");
  // Instruction + Skills + Core + Private.
  fs.writeFileSync(path.join(home, ".falsifyme-instructions.sh"), "# FALSIFYME-MODUS: projekt · optional\n");
  fs.writeFileSync(path.join(home, ".falsifyme-instructions.ps1"), "# FALSIFYME-MODUS: projekt · optional\n");
  fs.mkdirSync(path.join(home, ".agents", "skills", "falsifyme"), { recursive: true });
  fs.writeFileSync(path.join(home, ".agents", "skills", "falsifyme", "agent-skill-falsify.sh"), "#!/usr/bin/env bash\n");
  fs.mkdirSync(path.join(home, ".agents", "skills", "falsifyme-falsiflow"), { recursive: true });
  fs.writeFileSync(path.join(home, ".agents", "skills", "falsifyme-falsiflow", "SKILL.md"), "# FalsiFlow\n");
  fs.mkdirSync(path.join(home, ".agents", "skills", "falsifyme-selfinstall"), { recursive: true });
  fs.writeFileSync(path.join(home, ".agents", "skills", "falsifyme-selfinstall", "SKILL.md"), "# SelfInstall\n");
  fs.mkdirSync(path.join(home, ".Falsify_Core", "cli"), { recursive: true });
  fs.writeFileSync(path.join(home, ".Falsify_Core", "install-location.json"), "{}");
  fs.mkdirSync(path.join(home, ".Falsify_Private", "logs"), { recursive: true });
  fs.writeFileSync(path.join(home, ".Falsify_Private", ".env"), "NVIDIA_API_KEY=sk-secret\nOPENAI_API_KEY=\n");
  // Projekt-Marker: AGENTS.md/FALSIFYME-WORKFLOW.md, .gitignore-Block, Anker.
  fs.writeFileSync(path.join(proj, "AGENTS.md"), [
    "# Projekt",
    "<!-- FALSIFYME-BOOTSTRAP-BEGIN -->",
    "# FALSIFYME-MODUS: projekt · optional",
    "<!-- FALSIFYME-BOOTSTRAP-END -->",
    "## Ende",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(proj, "FALSIFYME-WORKFLOW.md"), "<!-- FALSIFYME-BOOTSTRAP-BEGIN -->\nx\n<!-- FALSIFYME-BOOTSTRAP-END -->\n");
  fs.writeFileSync(path.join(proj, ".gitignore"), [
    "# node_modules",
    "# >>> FalsifyMe (lokal – nicht committen) <<<",
    "/FalsifyME.md",
    "# <<< FalsifyMe (lokal) <<<",
    "# custom",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(proj, "FalsifyME.md"), "# Identitaetsanker (lokal)\n");
  return { home, proj };
}

function runUninstall(args, home, proj) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "uninstall.mjs"), ...args], {
    cwd: ROOT,
    env: { ...process.env, FALSIFY_UNINSTALL_HOME: home },
    encoding: "utf8",
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function cleanup(...dirs) {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
}

test("uninstall --dry-run: zeigt an, aendert NICHTS", () => {
  const { home, proj } = fixtureHome();
  try {
    const r = runUninstall(["--dry-run", "--project-root", proj], home, proj);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Dry-Run abgeschlossen/);
    // Nichts entfernt:
    assert.ok(fs.existsSync(path.join(home, ".bashrc")));
    assert.ok(fs.existsSync(path.join(home, ".Falsify_Core")));
    assert.ok(fs.existsSync(path.join(home, ".Falsify_Private")));
    assert.ok(fs.existsSync(path.join(home, ".agents", "skills", "falsifyme")));
    assert.ok(fs.existsSync(path.join(proj, "FalsifyME.md")));
    assert.ok(fs.existsSync(path.join(proj, "AGENTS.md")));
    assert.match(fs.readFileSync(path.join(home, ".bashrc"), "utf8"), /Falsify-CLI/);
    assert.match(fs.readFileSync(path.join(proj, ".gitignore"), "utf8"), /FalsifyMe \(lokal/);
    assert.ok(!fs.existsSync(path.join(home, ".Falsify.env.uninstall-backup")), "kein Key-Backup im Dry-Run");
  } finally { cleanup(home, proj); }
});

test("uninstall: Marker (PATH + dot-source), Skills, Core, Private, Projekt-Marker, Anker – alles weg", () => {
  const { home, proj } = fixtureHome();
  try {
    const r = runUninstall(["--project-root", proj], home, proj);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /rückabgewickelt/);

    // Profile: fremde Zeilen bleiben, alle Falsify-Marker-Zeilen weg.
    for (const f of [".bashrc", ".bash_profile", ".profile"]) {
      const text = fs.readFileSync(path.join(home, f), "utf8");
      assert.ok(!text.includes("Falsify-CLI"), `${f}: PATH-Marker entfernt`);
      assert.ok(!text.includes("FalsifyMe-Agent-Integration"), `${f}: dot-source entfernt`);
    }
    const bashrc = fs.readFileSync(path.join(home, ".bashrc"), "utf8");
    assert.ok(bashrc.includes("# meine eigene config"), "fremde .bashrc-Zeile bleibt");
    assert.ok(bashrc.includes("export FOO=bar"), "fremde .bashrc-Zeile bleibt (2)");
    const ps = fs.readFileSync(path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"), "utf8");
    assert.ok(!ps.includes("FalsifyMe"), "PowerShell-Profil: dot-source entfernt");

    // Instruction-Dateien + Skills + Core + Private weg.
    assert.ok(!fs.existsSync(path.join(home, ".falsifyme-instructions.sh")));
    assert.ok(!fs.existsSync(path.join(home, ".falsifyme-instructions.ps1")));
    assert.ok(!fs.existsSync(path.join(home, ".agents", "skills", "falsifyme")));
    assert.ok(!fs.existsSync(path.join(home, ".agents", "skills", "falsifyme-falsiflow")));
    assert.ok(!fs.existsSync(path.join(home, ".agents", "skills", "falsifyme-selfinstall")));
    assert.ok(!fs.existsSync(path.join(home, ".Falsify_Core")));
    assert.ok(!fs.existsSync(path.join(home, ".Falsify_Private")));

    // Key-Backup NUR im isolierten Home (mit Inhalt).
    const backup = path.join(home, ".Falsify.env.uninstall-backup");
    assert.ok(fs.existsSync(backup), "Key-Backup angelegt");
    assert.match(fs.readFileSync(backup, "utf8"), /NVIDIA_API_KEY=sk-secret/);

    // Projekt: Marker-Blöcke + Anker weg, fremder Inhalt bleibt.
    const agents = fs.readFileSync(path.join(proj, "AGENTS.md"), "utf8");
    assert.ok(!agents.includes("FALSIFYME-BOOTSTRAP"), "AGENTS.md-Block entfernt");
    assert.ok(agents.includes("# Projekt") && agents.includes("## Ende"), "AGENTS.md-Rest bleibt");
    assert.ok(!fs.existsSync(path.join(proj, "FALSIFYME-WORKFLOW.md")) || !fs.readFileSync(path.join(proj, "FALSIFYME-WORKFLOW.md"), "utf8").includes("FALSIFYME-BOOTSTRAP"), "WORKFLOW-Block entfernt");
    const gi = fs.readFileSync(path.join(proj, ".gitignore"), "utf8");
    assert.ok(!gi.includes("FalsifyMe"), ".gitignore-Block entfernt");
    assert.ok(gi.includes("# node_modules") && gi.includes("# custom"), ".gitignore-Rest bleibt");
    assert.ok(!fs.existsSync(path.join(proj, "FalsifyME.md")), "Anker entfernt");
  } finally { cleanup(home, proj); }
});

test("uninstall: zweiter Lauf ist idempotent (nichts zu tun, Exit 0)", () => {
  const { home, proj } = fixtureHome();
  try {
    const first = runUninstall(["--project-root", proj], home, proj);
    assert.equal(first.code, 0, first.out);
    const second = runUninstall(["--project-root", proj], home, proj);
    assert.equal(second.code, 0, second.out);
    assert.match(second.out, /nichts zu tun/);
  } finally { cleanup(home, proj); }
});

test("uninstall --keep-env: FALSIFY_HOME (Private) bleibt, Rest wird entfernt", () => {
  const { home, proj } = fixtureHome();
  try {
    const r = runUninstall(["--keep-env", "--project-root", proj], home, proj);
    assert.equal(r.code, 0, r.out);
    assert.ok(fs.existsSync(path.join(home, ".Falsify_Private")), "Private bleibt mit --keep-env");
    assert.ok(!fs.existsSync(path.join(home, ".Falsify_Core")), "Core entfernt");
    assert.ok(!fs.existsSync(path.join(home, ".agents", "skills", "falsifyme")), "Skills entfernt");
    assert.ok(!fs.existsSync(path.join(home, ".Falsify.env.uninstall-backup")), "kein Backup bei --keep-env (nichts entfernt)");
  } finally { cleanup(home, proj); }
});
// ── User-Test-Befund 2026-09-03: sich selbst kennen + QUEUED ohne Worker ────
import { spawn } from "node:child_process";

function runCliMain(args, home, cwd = ROOT) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "cli", "main.mjs"), ...args], {
      cwd, env: { ...process.env, FALSIFY_HOME: home }, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    child.on("close", (code) => resolve({ code, out }));
  });
}

test("CLI kennt sich selbst: falsify --version/-v/version liefert die package.json-Version", async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  for (const flag of ["--version", "-v", "version"]) {
    const r = await runCliMain([flag], os.tmpdir());
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out.trim(), pkg.version, `--version über ${flag}`);
  }
  const sh = spawnSync("bash", [path.join(ROOT, "cli", "falsify.sh"), "--version"], { encoding: "utf8", cwd: ROOT });
  assert.equal(String(sh.stdout).trim(), pkg.version, "bash-Einstieg liefert dieselbe Version");
});

test("status/jobs QUEUED ohne lebenden Worker: ehrlicher Hinweis statt Schweigen", async () => {
  const { openDb, closeDb } = await import(pathToFileURL(path.join(ROOT, "artifacts", "db.mjs")).href);
  const { createJob } = await import(pathToFileURL(path.join(ROOT, "artifacts", "jobs.mjs")).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-status-"));
  process.env.FALSIFY_HOME = tmp;
  try {
    const db = openDb();
    const id = createJob(db, { scopeId: null, payload: "P", root: ROOT, files: "a.js", mode: "plan" });
    closeDb();
    const r = await runCliMain(["status", id], tmp);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /QUEUED/);
    assert.match(r.out, /Kein Worker mit frischem Heartbeat/);
    assert.match(r.out, /falsify worker start 1/);
    assert.match(r.out, /start-dock\.cmd|ui[\\/]worker\.mjs/);
    // Zweiter Kanal: `falsify jobs` warnt ebenfalls bei Queue-Last ohne Worker.
    const j = await runCliMain(["jobs"], tmp);
    assert.match(j.out, /Kein Worker mit frischem Heartbeat/);
    // Dritter Kanal: doctor nennt denselben Befund (nur bei Queue-Last hart).
    const d = await runCliMain(["doctor"], tmp);
    assert.match(d.out, /Kein Worker aktiv, aber 1 Job\(s\) QUEUED/);
    assert.match(d.out, /falsify worker start 1/);
  } finally {
    try { closeDb(); } catch { /* egal */ }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
  }
});

test("doctor erkennt registrierten Hintergrund-Worker (Headless zählt, eine Liveness-Wahrheit)", async () => {
  const { openDb, closeDb } = await import(pathToFileURL(path.join(ROOT, "artifacts", "db.mjs")).href);
  const { registerWorker, heartbeatWorker } = await import(pathToFileURL(path.join(ROOT, "artifacts", "jobs.mjs")).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-doctor-w-"));
  process.env.FALSIFY_HOME = tmp;
  try {
    const db = openDb();
    registerWorker(db, 1, process.pid); // „Headless-Worker": Registrierung + frischer Heartbeat
    heartbeatWorker(db, 1);
    closeDb();
    const d = await runCliMain(["doctor"], tmp);
    // Exit-Code ist hier egal (isoliertes Home ohne Key/Twin liefert begründet
    // Exit 2) – entscheidend ist die ehrliche Worker-Erkennung in der Ausgabe.
    assert.match(d.out, /Worker: 1 aktiv/);
    assert.match(d.out, /Hintergrund- oder Dock-Fenster zählen gleichermaßen/);
    // Status/quartiere denselben Befund ein: kein „Kein Worker"-Fehlalarm.
    const j = await runCliMain(["jobs"], tmp);
    assert.doesNotMatch(j.out, /Kein Worker mit frischem Heartbeat/);
  } finally {
    try { closeDb(); } catch { /* egal */ }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
  }
});

test("doctor: abgelaufener Heartbeat eines registrierten Workers wird ehrlich gemeldet", async () => {
  const { openDb, closeDb } = await import(pathToFileURL(path.join(ROOT, "artifacts", "db.mjs")).href);
  const { registerWorker } = await import(pathToFileURL(path.join(ROOT, "artifacts", "jobs.mjs")).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-doctor-stale-"));
  process.env.FALSIFY_HOME = tmp;
  try {
    const db = openDb();
    registerWorker(db, 1, process.pid);
    // Herzschlag künstlich altern (> WORKER_STALE_MS = 15 s): direkt in meta.
    const { setMeta } = await import(pathToFileURL(path.join(ROOT, "artifacts", "db.mjs")).href);
    setMeta(db, "worker.1.ts", new Date(Date.now() - 60_000).toISOString());
    closeDb();
    const d = await runCliMain(["doctor"], tmp);
    assert.match(d.out, /Herzschlag abgelaufen/);
    assert.match(d.out, /falsify worker start 1/);
  } finally {
    try { closeDb(); } catch { /* egal */ }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// doctor: Agent-Skills-Check + --repair-skills (UI-144-Abgleich, 2026-09-03).
// Die Checks laufen gegen ein INJIZIERTES homeDir (nie echtes ~/.agents) —
// dieselben Funktionen, die doctor mit os.homedir() aufruft.
// ─────────────────────────────────────────────────────────────────────────────
test("doctor: Agent-Skill-Marker-Check meldet fehlende Anlage ehrlich", async () => {
  const doctor = await import(pathToFileURL(path.join(ROOT, "cli", "doctor.mjs")).href);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-doctor-skills-missing-"));
  try {
    const before = doctor.checkAgentSkillMarkers(home);
    assert.equal(before.ok, false, "ohne Anlage: ok=false");
    assert.equal(before.present.length, 0, "kein Marker vorhanden");
    assert.equal(before.dir, path.join(home, ".agents", "skills", "falsifyme"));
    // Eine der drei Varianten genügt der Verweis-Semantik (sh/mjs/ps1).
    fs.mkdirSync(path.join(home, ".agents", "skills", "falsifyme"), { recursive: true });
    fs.writeFileSync(path.join(home, ".agents", "skills", "falsifyme", "agent-skill-falsify.sh"), "# skill\n");
    const after = doctor.checkAgentSkillMarkers(home);
    assert.equal(after.ok, true, "sh-Marker vorhanden -> ok");
    assert.ok(after.present.includes("agent-skill-falsify.sh"));
    assert.equal(after.missing.length, 2, "die anderen beiden Varianten fehlen, aber eine genügt (Verweis-Semantik)");
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("doctor: repairAgentSkillMarkers installiert idempotent aus dem Paket-Root (eine Quelle)", async () => {
  const doctor = await import(pathToFileURL(path.join(ROOT, "cli", "doctor.mjs")).href);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-doctor-skills-repair-"));
  try {
    const r = await doctor.repairAgentSkillMarkers({ homeDir: home, packageRoot: ROOT });
    assert.equal(r.ok, true, r.error || "Repair ok");
    const check = doctor.checkAgentSkillMarkers(home);
    assert.equal(check.ok, true, "nach Repair: Marker vorhanden");
    assert.ok(check.present.includes("agent-skill-falsify.sh"), "sh-Marker kopiert");
    // Idempotent: zweiter Repair ohne Nebeneffekt.
    const r2 = await doctor.repairAgentSkillMarkers({ homeDir: home, packageRoot: ROOT });
    assert.equal(r2.ok, true);
    assert.equal(r2.repaired, false, "zweiter Lauf: bereits installiert (repaired=false)");
    // Fehlende Quelle -> ehrlicher Fehler statt stiller Nichts-Tun.
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-doctor-skills-nosrc-"));
    try {
      const bad = await doctor.repairAgentSkillMarkers({ homeDir: home, packageRoot: emptyRoot });
      assert.equal(bad.ok, false);
      assert.match(bad.error, /Skill-Quelle nicht gefunden/);
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("doctor: --repair-skills Pfad ist verdrahtet (main.mjs reicht Args durch)", async () => {
  // Der CLI-Pfad `falsify doctor --repair-skills` trifft den echten os.homedir()
  // — hier nur der Verdrahtungs-Nachweis: runDoctor akzeptiert das Flag und
  // main.mjs reicht Argumente weiter (kein echte Reparatur im Test).
  const main = fs.readFileSync(path.join(ROOT, "cli", "main.mjs"), "utf8");
  assert.match(main, /runDoctor\(args\.slice\(1\)\)/, "main.mjs reicht doctor-Args durch");
  const falsifySh = fs.readFileSync(path.join(ROOT, "cli", "falsify.sh"), "utf8");
  assert.match(falsifySh, /doctor "\$\@"/, "falsify.sh reicht doctor-Args durch");
  const doctorSrc = fs.readFileSync(path.join(ROOT, "cli", "doctor.mjs"), "utf8");
  assert.match(doctorSrc, /--repair-skills/, "runDoctor kennt das Reparatur-Flag");
  assert.match(doctorSrc, /checkAgentSkillMarkers\(os\.homedir\(\)\)/, "doctor prüft die Marker gegen den Nutzer-Home");
});

// ─────────────────────────────────────────────────────────────────────────────
// doctor: Agent-Skill-VERSION gegen die Runtime (UI-148, 2026-09-03).
// vorhanden != aktuell: doctor liest den Version-Marker der installierten
// ~/.agents-Skills (agent-skill-falsify.config.json) und vergleicht ihn mit
// package.json des laufenden Core. Kein Versions-Urteil ohne lesbare Konfig.
// ─────────────────────────────────────────────────────────────────────────────
test("doctor: agentSkillVersion liest den Versions-Marker; fehlende Konfig = ehrlich ok:false", async () => {
  const doctor = await import(pathToFileURL(path.join(ROOT, "cli", "doctor.mjs")).href);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-doctor-skillver-"));
  const dir = path.join(home, ".agents", "skills", "falsifyme");
  try {
    // Keine Anlage -> kein Versions-Urteil (fail-closed).
    const none = doctor.agentSkillVersion(home);
    assert.equal(none.ok, false);
    assert.match(none.error, /Konfig-Datei fehlt/);
    assert.equal(none.file, path.join(dir, "agent-skill-falsify.config.json"));
    // Marker da, Konfig da -> Version lesbar.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "agent-skill-falsify.sh"), "# skill\n");
    fs.writeFileSync(path.join(dir, "agent-skill-falsify.config.json"), JSON.stringify({ name: "FalsifyMe Agent Skill", version: "0.9.0" }), "utf8");
    const ok = doctor.agentSkillVersion(home);
    assert.equal(ok.ok, true);
    assert.equal(ok.version, "0.9.0");
    // Kaputtes Versionsfeld -> ok:false statt stilles Raten.
    fs.writeFileSync(path.join(dir, "agent-skill-falsify.config.json"), JSON.stringify({ version: "kaputt" }), "utf8");
    const bad = doctor.agentSkillVersion(home);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /ungueltig/);
    // Kein Versions-Urteil bei kaputtem JSON.
    fs.writeFileSync(path.join(dir, "agent-skill-falsify.config.json"), "{ kein json", "utf8");
    const corrupt = doctor.agentSkillVersion(home);
    assert.equal(corrupt.ok, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("doctor: Sektion 7 vergleicht die Skill-Version gegen die Runtime (Drift = Problem)", async () => {
  const doctorSrc = fs.readFileSync(path.join(ROOT, "cli", "doctor.mjs"), "utf8");
  // Der Versions-Vergleich ist verdrahtet: compareVersions gegen pkg.version,
  // aelter -> bad() mit der EINEN Aktualisierungs-Kommandozeile.
  assert.match(doctorSrc, /compareVersions\(skillVersion\.version, runtimeVersion\)/, "Semantischer Versions-Vergleich");
  assert.match(doctorSrc, /sind ÄLTER als der installierte Core/, "aelter -> Warnung");
  assert.match(doctorSrc, /falsify doctor --repair-skills/, "Reparatur-Kommando im Text");
  assert.match(doctorSrc, /agentSkillVersion\(os\.homedir\(\)\)/, "Version gegen den Nutzer-Home gelesen");
  assert.match(doctorSrc, /sind NEUER als der laufende Core/, "neuer -> ehrliche Warnung (Core aktualisieren)");
  // Die Reparatur-Kommandozeile kann Veraltetes wirklich aktualisieren:
  // ensureAgentSkillsInstalled kennt den Refresh-Weg (UI-148).
  const instSrc = fs.readFileSync(path.join(ROOT, "cli", "bootstrap", "instructions.mjs"), "utf8");
  assert.match(instSrc, /refreshed: true/, "Refresh-Marker im Rueckgabe-Vertrag");
  assert.match(instSrc, /fromVersion: installedVersion/, "Versions-Uebergang wird ehrlich berichtet");
});

// ─────────────────────────────────────────────────────────────────────────────
// doctor: --repair-all (UI-150, 2026-09-03) — jede auto-fixbare Reparatur in
// Abhaengigkeitsreihenfolge (1. Skills -> 2. Worker-/Queue-Orphans) und danach
// der VOLLSTAENDIGE Standard-Pruefkoerper als Re-Check (kein frueher Return).
// ─────────────────────────────────────────────────────────────────────────────
test("doctor: --repair-all Reihenfolge Skills -> Worker-Orphans -> Re-Check (Verdrahtung)", async () => {
  const src = fs.readFileSync(path.join(ROOT, "cli", "doctor.mjs"), "utf8");
  assert.match(src, /--repair-all/, "runDoctor kennt das repair-all-Flag");
  assert.match(src, /--repair-skills.*!repairAll/, "repair-all ueberstimmt den Skills-Only-Zweig (kein Doppel-Lauf)");
  // Abhaengigkeitsreihenfolge im Quelltext: Skill-Reparatur VOR Worker-Reparatur,
  // danach faellt der Code in den Standard-Pruefkoerper (Re-Check) — kein return.
  // Call-Sites im repair-all-Zweig (Definitionen stehen frueher im File —
  // gezielt auf die AUFRUFE pruefen).
  const s1 = src.indexOf("await runSkillRepair(os.homedir())");
  const s2 = src.indexOf("await runWorkerRepair();");
  const recheck = src.indexOf("Re-Check: der vollstaendige doctor-Pruefkoerper");
  const fallthrough = src.indexOf("const problems = []");
  assert.ok(s1 !== -1 && s2 !== -1 && s1 < s2, "Skills-Schritt laeuft VOR Worker-Schritt");
  assert.ok(recheck !== -1 && fallthrough !== -1 && recheck < fallthrough, "nach den Reparaturen laeuft der Pruefkoerper als Re-Check (kein frueher Return)");
  // Der Worker-/Orphan-Schritt delegiert an den EINEN Kill-Pfad (worker-kill),
  // doctor schreibt nie selbst an die Queue.
  assert.match(src, /repairStaleWorkers/, "doctor ruft die programmatische Orphan-Reparatur aus cli/worker-kill.mjs");
  assert.match(src, /Keine registrierten Worker/, "ehrliche Leer-Meldung im Worker-Schritt");
  const killSrc = fs.readFileSync(path.join(ROOT, "cli", "worker-kill.mjs"), "utf8");
  assert.match(killSrc, /export function repairStaleWorkers/, "worker-kill exportiert die programmatische Reparatur");
  assert.match(killSrc, /reapStaleJobs\(db, MAX_WINDOWS\)/, "Queue-Orphan-Reap laeuft immer (idempotent)");
  assert.match(killSrc, /w\.mine \|\| !w\.orphan/, "nie eigene PID, nie frische Worker");
  // main.mjs/falsify.sh reichen doctor-Args durch (kein neuer Verdrahtungspunkt noetig).
  const main = fs.readFileSync(path.join(ROOT, "cli", "main.mjs"), "utf8");
  assert.match(main, /runDoctor\(args\.slice\(1\)\)/, "main.mjs reicht --repair-all durch");
});
