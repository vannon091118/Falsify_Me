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
import { fileURLToPath } from "node:url";

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