#!/usr/bin/env node
// FalsifyMe · core/skill-version.mjs – Skill-Version + Installationsintegrität
// -----------------------------------------------------------------------------
// Eine Quelle fuer die ausgelieferten Skill-Artefakte: package.json version plus
// dieser kanonische Datei-Mapping. Die Installationsmanifest-Datei ist nur ein
// unveränderlicher Prüfbeleg der Installation, keine zweite Policy-Quelle.
//
// Regeln:
//   - Jeder installierte Skill muss exakt zur Paketversion passen.
//   - Jede erwartete Datei wird per SHA-256 geprüft.
//   - Ein Skill-Inhaltswechsel ohne Versionswechsel wird beim Re-Install
//     abgewiesen.
//   - Der Check liest nur; nur install.mjs schreibt das Manifest.
// -----------------------------------------------------------------------------
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_MANIFEST_SCHEMA = 1;
export const SKILL_MANIFEST_NAME = "skill-manifest.json";

// source = Repo-/Paketpfad, target = Pfad relativ zu ~/.agents/skills.
// Dieses Mapping ist absichtlich explizit: keine stillen Zusatz-Skills und kein
// Verzeichnis-Guessing als Autorität.
export const SKILL_FILES = Object.freeze([
  { source: "skills/agent-skill-falsify.config.json", target: "falsifyme/agent-skill-falsify.config.json" },
  { source: "skills/agent-skill-falsify.mjs", target: "falsifyme/agent-skill-falsify.mjs" },
  { source: "skills/agent-skill-falsify.sh", target: "falsifyme/agent-skill-falsify.sh" },
  { source: "skills/agent-skill-falsify.ps1", target: "falsifyme/agent-skill-falsify.ps1" },
  { source: "skills/falsifyme.md", target: "falsifyme/falsifyme.md" },
  { source: "skills/falsifyme-falsiflow.md", target: "falsifyme-falsiflow/SKILL.md" },
  { source: "skills/falsifyme-selfinstall.md", target: "falsifyme/falsifyme-selfinstall.md" },
  { source: "skills/falsifyme-selfinstall.md", target: "falsifyme-selfinstall/SKILL.md" },
  { source: "skills/falsifyme-selfinstall-evals/evals.json", target: "falsifyme/falsifyme-selfinstall-evals/evals.json" },
]);

function packagePath(root) {
  return path.join(root, "package.json");
}

export function readPackageVersion(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath(root), "utf8"));
    if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
      throw new Error(`package.json version ist ungueltig: ${pkg.version}`);
    }
    return pkg.version;
  } catch (error) {
    throw new Error(`Paketversion nicht lesbar (${packagePath(root)}): ${error.message}`);
  }
}

function digestFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sourceFiles(root) {
  return SKILL_FILES.map(({ source, target }) => {
    const file = path.join(root, source);
    if (!fs.existsSync(file)) throw new Error(`Skill-Datei fehlt: ${file}`);
    return { source, target, sha256: digestFile(file) };
  });
}

function configSkillVersion(root) {
  const configPath = path.join(root, "skills", "agent-skill-falsify.config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config.version;
  } catch (error) {
    throw new Error(`Skill-Konfiguration nicht lesbar (${configPath}): ${error.message}`);
  }
}

/** Erstellt den kanonischen Installationsbeleg aus dem Paket-Checkout. */
export function buildSkillManifest({ sourceRoot, packageVersion } = {}) {
  const root = path.resolve(sourceRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const version = packageVersion || readPackageVersion(root);
  const configVersion = configSkillVersion(root);
  if (configVersion !== version) {
    throw new Error(`Skill-Version ${configVersion} != Paketversion ${version}; Skill-Aenderung braucht einen Version-Bump.`);
  }
  return {
    schema: SKILL_MANIFEST_SCHEMA,
    packageVersion: version,
    skillVersion: version,
    files: sourceFiles(root),
  };
}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`${label} nicht lesbar (${file}): ${error.message}`); }
}

export function readSkillManifest(file) {
  return readJson(file, "Skill-Manifest");
}

export function skillManifestPath(coreDir) {
  return path.join(coreDir, SKILL_MANIFEST_NAME);
}

function atomicWriteJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

/** Schreibt den einzigen Installationsbeleg atomar in den Falsify-Core. */
export function writeSkillManifest({ sourceRoot, coreDir, packageVersion } = {}) {
  const manifest = buildSkillManifest({ sourceRoot, packageVersion });
  fs.mkdirSync(coreDir, { recursive: true });
  atomicWriteJson(skillManifestPath(coreDir), manifest);
  return manifest;
}

function canonicalEntries(manifest) {
  if (!manifest || manifest.schema !== SKILL_MANIFEST_SCHEMA || !Array.isArray(manifest.files)) return null;
  const expected = new Map(SKILL_FILES.map((f) => [`${f.source}\0${f.target}`, f]));
  if (manifest.files.length !== expected.size) return null;
  const seen = new Set();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.source !== "string" || typeof entry.target !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) return null;
    const key = `${entry.source}\0${entry.target}`;
    if (!expected.has(key) || seen.has(key)) return null;
    seen.add(key);
  }
  return manifest.files;
}

// Semantischer Vergleich (1 = a neuer, -1 = a aelter, 0 = gleich). Exportiert,
// damit doctor die installierten ~/.agents-Skills gegen die Runtime-version
// vergleichen kann — EINE Vergleichs-Quelle (UI-148).
export function compareVersions(a, b) {
  const parse = (v) => String(v).replace(/-.*/, "").split(".").map(Number);
  const av = parse(a); const bv = parse(b);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1;
  return String(a).localeCompare(String(b));
}

/**
 * Re-Install-Gate: unveränderte Skills dürfen dieselbe Version behalten;
 * geänderte Skills müssen eine höhere/neue Paketversion tragen.
 */
export function validateSkillVersionTransition({ previousManifest, nextManifest }) {
  if (!previousManifest) return { ok: true, changed: true, reason: "Erstinstallation" };
  const previous = canonicalEntries(previousManifest);
  const next = canonicalEntries(nextManifest);
  if (!previous || !next) return { ok: false, reason: "Vorheriges oder neues Skill-Manifest ist ungueltig" };
  const before = new Map(previous.map((e) => [`${e.source}\0${e.target}`, e.sha256]));
  const contentChanged = next.some((e) => before.get(`${e.source}\0${e.target}`) !== e.sha256);
  const versionChanged = previousManifest.packageVersion !== nextManifest.packageVersion
    || previousManifest.skillVersion !== nextManifest.skillVersion;
  if (contentChanged && !versionChanged) {
    return { ok: false, reason: `Skill-Inhalt geaendert, aber Version bleibt ${nextManifest.packageVersion}; package.json + Skill-Version bump erforderlich` };
  }
  if (compareVersions(nextManifest.packageVersion, previousManifest.packageVersion) < 0) {
    return { ok: false, reason: `Skill-Version darf nicht zurueckgehen (${previousManifest.packageVersion} -> ${nextManifest.packageVersion})` };
  }
  return { ok: true, changed: contentChanged || versionChanged, reason: contentChanged ? "Skill-Version aktualisiert" : "Skill-Inhalt unveraendert" };
}

function result(ok, version, failures, checked, mode) {
  return { ok, version: version || null, failures, checked, mode };
}

function listFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(file).map((child) => path.join(entry.name, child)));
    else if (entry.isFile()) files.push(entry.name);
  }
  return files;
}

/** Prüft eine bereits installierte Core-/Agent-Skill-Kopie read-only. */
export function verifyInstalledSkills({ coreDir, installedSkillsRoot } = {}) {
  const core = path.resolve(coreDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const skillsRoot = path.resolve(installedSkillsRoot || path.join(os.homedir(), ".agents", "skills"));
  const failures = [];
  let manifest;
  try {
    manifest = readSkillManifest(skillManifestPath(core));
  } catch (error) {
    return result(false, null, [error.message], 0, "installed");
  }
  const entries = canonicalEntries(manifest);
  if (!entries) failures.push("Skill-Manifest-Schema oder Datei-Mapping ist ungueltig");

  let packageVersion = null;
  try { packageVersion = readPackageVersion(core); }
  catch (error) { failures.push(error.message); }
  if (packageVersion && manifest.packageVersion !== packageVersion) {
    failures.push(`Manifest-Version ${manifest.packageVersion} != installierte Paketversion ${packageVersion}`);
  }
  if (manifest.skillVersion !== manifest.packageVersion) failures.push("Skill-Version und Manifest-Paketversion widersprechen sich");

  let checked = 0;
  const expectedTargets = new Set((entries || []).map((entry) => entry.target.replaceAll("\\", "/")));
  const ownedDirs = new Set((entries || []).map((entry) => entry.target.split(/[\\/]/)[0]));
  for (const entry of entries || []) {
    const file = path.join(skillsRoot, entry.target);
    try {
      if (!fs.statSync(file).isFile()) throw new Error("keine Datei");
      const actual = digestFile(file);
      checked++;
      if (actual !== entry.sha256) failures.push(`Skill geaendert oder falsche Version: ${entry.target}`);
    } catch {
      failures.push(`Skill fehlt: ${entry.target}`);
    }
  }
  for (const dir of ownedDirs) {
    const ownedRoot = path.join(skillsRoot, dir);
    for (const file of listFiles(ownedRoot)) {
      const target = path.join(dir, file).replaceAll("\\", "/");
      if (!expectedTargets.has(target)) failures.push(`Unerwartete Skill-Datei: ${target}`);
    }
  }
  return result(failures.length === 0, manifest.packageVersion, failures, checked, "installed");
}

/** Prüft den Quell-Checkout, wenn noch keine Benutzerinstallation vorliegt. */
export function verifySourceSkills({ sourceRoot } = {}) {
  try {
    const manifest = buildSkillManifest({ sourceRoot });
    return result(true, manifest.packageVersion, [], manifest.files.length, "source");
  } catch (error) {
    return result(false, null, [error.message], 0, "source");
  }
}

/**
 * Startup-Ermittlung: installierte Core-Kopie = Manifestpflicht; ein Repo-
 * Checkout ohne install-location.json wird gegen seine Quellen geprüft.
 */
export function verifySkillsAtStartup({ runtimeRoot, homeDir = os.homedir() } = {}) {
  const runtime = path.resolve(runtimeRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const locationFile = path.join(runtime, "install-location.json");
  const manifestFile = skillManifestPath(runtime);
  if (fs.existsSync(locationFile) || fs.existsSync(manifestFile)) {
    let location = {};
    if (fs.existsSync(locationFile)) {
      try { location = readJson(locationFile, "Installationspfad"); }
      catch (error) { return result(false, null, [error.message], 0, "installed"); }
    }
    return verifyInstalledSkills({
      coreDir: runtime,
      installedSkillsRoot: location.skillsDir || path.join(homeDir, ".agents", "skills"),
    });
  }
  return verifySourceSkills({ sourceRoot: runtime });
}

export function assertSkillsAtStartup(options = {}) {
  const check = verifySkillsAtStartup(options);
  if (!check.ok) {
    throw new Error(`Skill-Installation nicht verifiziert (Version ${check.version || "unbekannt"}): ${check.failures.join("; ")}`);
  }
  return check;
}

export function formatSkillCheck(check) {
  if (!check.ok) return `SKILLS ERROR: ${check.failures.join("; ")}`;
  return `SKILLS OK: Version ${check.version} · ${check.checked} Dateien geprüft (${check.mode})`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = verifySkillsAtStartup();
  if (!check.ok) {
    console.error(formatSkillCheck(check));
    process.exit(3);
  }
  // --startup-check ist absichtlich bei Erfolg still: kein CLI-Ausgabe-Rauschen.
  if (!process.argv.includes("--quiet")) console.log(formatSkillCheck(check));
}
