// Bootstrap-Modul: persistente Agent-Instructions.
// Erzeugt eine REALE Datei pro erkanntem Agenten (Enforcement-Teil des
// Bootstraps): Templates liegen als statische Dateien in templates/ —
// nur {{PLATZHALTER}} werden ersetzt. Kein String-Escaping im Code.
//
// Enforcement-Grade (real, nicht nur Dokument):
//   codebuff    -> AGENTS.md im PROJEKT-ROOT (wird von Codebuff/Freebuff
//                  automatisch gelesen — reale Agenten-Konvention)
//   bash        -> ~/.falsifyme-instructions.sh + MARKER-Source-Zeile in
//                  ~/.bashrc (idempotent, wie der `falsify install`-Mechanismus)
//   powershell  -> ~/.falsifyme-instructions.ps1 + Dot-Source-Zeile im
//                  PowerShell-Profil ($PROFILE), idempotent per Marker
//   generic     -> FALSIFYME-WORKFLOW.md im PROJEKT-ROOT (Doku-Fallback,
//                  ehrlich als "liest der Agent nur, wenn er es kennt")
//
// Modus-Entscheid (UI-075, keine stille Gate-Aktivierung): Jede Instruction-
// Datei traegt eine FALSIFYME-MODUS-Kopfzeile (Reichweite · Betriebsmodus).
// Ohne dokumentierten Modus gilt der Bootstrap als nicht abgeschlossen -
// PFLICHT entsteht NIE still (Default: optional + Warnung).
//
// MERGE-Vertrag (Review-Fehler 6): existiert die Zieldatei bereits, wird
// der FalsifyMe-Abschnitt MARKIERT angehängt statt überschrieben. Der
// Marker-Bereich wird bei erneutem Lauf ersetzt (idempotent).
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions } from "../../core/skill-version.mjs";

const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");

const MERGE_BEGIN = "<!-- FALSIFYME-BOOTSTRAP-BEGIN -->";
const MERGE_END = "<!-- FALSIFYME-BOOTSTRAP-END -->";

// Reale Installationspfade der Skills (install.mjs schreibt sie dorthin):
//   ~/.agents/skills/falsifyme/           (agent-skill-falsify.sh/.mjs/.ps1)
//   ~/.agents/skills/falsifyme-falsiflow/ (SKILL.md)
export function skillPaths(homeDir) {
  const agentsDir = path.join(homeDir, ".agents");
  return {
    skillsDir: path.join(agentsDir, "skills", "falsifyme"),
    falsiflowSkillDir: path.join(agentsDir, "skills", "falsifyme-falsiflow"),
  };
}

// Ziel-Datei je Agent-Typ.
// WICHTIG (Review-Fehler 2): `root` ist der ZIELPROJEKT-Root (cwd des
// Aufrufs), NICHT das FalsifyMe-Paketverzeichnis.
export function instructionTarget(agentType, { root, homeDir }) {
  switch (agentType) {
    case "codebuff":
      return path.join(root, "AGENTS.md");
    case "bash":
      return path.join(homeDir, ".falsifyme-instructions.sh");
    case "powershell":
      return path.join(homeDir, ".falsifyme-instructions.ps1");
    default:
      return path.join(root, "FALSIFYME-WORKFLOW.md");
  }
}

// Realer Lademechanismus je Agent-Typ (Review-Fehler 5):
//   codebuff   -> AGENTS.md wird automatisch gelesen (Konvention) -> null
//   bash       -> ~/.bashrc Source-Zeile
//   powershell -> PowerShell-Profil ($PROFILE) Dot-Source-Zeile
//   generic    -> kein garantierter Leser (Doku-Fallback)
export function loaderChannel(agentType, homeDir) {
  switch (agentType) {
    case "codebuff":
      return { kind: "agent-convention", file: path.join(root0(homeDir), "AGENTS.md"), registered: true };
    case "bash":
      return { kind: "bashrc-source", file: path.join(homeDir, ".bashrc"), registered: true };
    case "powershell":
      return { kind: "ps-profile-dotsource", file: psProfilePath(homeDir), registered: true };
    default:
      return { kind: "manual-only", file: null, registered: false };
  }
}

function root0(_homeDir) { return process.cwd(); }

function psProfilePath(homeDir) {
  // Windows PowerShell 5+ / PowerShell 7: Documents\PowerShell\Microsoft.PowerShell_profile.ps1
  if (process.platform === "win32") {
    const docs = path.join(homeDir, "Documents", "PowerShell");
    return path.join(docs, "Microsoft.PowerShell_profile.ps1");
  }
  return path.join(homeDir, ".config", "powershell", "Microsoft.PowerShell_profile.ps1");
}

function templateFile(agentType) {
  switch (agentType) {
    case "codebuff": return "agents-codebuff.md";
    case "bash": return "bash.sh";
    case "powershell": return "powershell.ps1";
    default: return "generic.md";
  }
}

export function renderTemplate(agentType, vars) {
  const file = path.join(templatesDir, templateFile(agentType));
  if (!existsSync(file)) throw new Error(`Template fehlt: ${file}`);
  let text = readFileSync(file, "utf8");
  for (const [key, value] of Object.entries(vars)) {
    text = text.split(`{{${key}}}`).join(value);
  }
  return text;
}

/** Modus-Kopfzeile je Format (md-Kommentar vs. sh/ps1-Kommentar). */
export function modeHeader(agentType, { mode, reichweite }) {
  const line = `FALSIFYME-MODUS: ${reichweite} · ${mode}`;
  return agentType === "bash" || agentType === "powershell"
    ? `# ${line}`
    : `<!-- ${line} -->`;
}

// MERGE (Review-Fehler 6): existiert die Zieldatei, wird der markierte
// FalsifyMe-Abschnitt ersetzt (idempotent) oder angehängt — niemals blind
// überschrieben. Reine Textdateien (bash/ps1/generic) bekommen den Block
// mit Markern; für Markdown-Ziele (codebuff/generic) gleicher Mechanismus.
function mergeInstruction(existing, content) {
  const block = `${MERGE_BEGIN}\n${content}\n${MERGE_END}`;
  const beginIdx = existing.indexOf(MERGE_BEGIN);
  const endIdx = existing.indexOf(MERGE_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    return existing.slice(0, beginIdx) + block + existing.slice(endIdx + MERGE_END.length);
  }
  return existing.replace(/\s*$/, "") + "\n\n" + block + "\n";
}

// Schreibt die Instruction-Datei. Liefert Zielpfad + Skill-Pfade + Merge-Info.
// Skills-Vertrag (UI-144): fehlen die installierten Agent-Skills, ist das
// KEINE dangling warning — der Bootstrap REPARIERT die Anlage selbst
// (idempotent, aus dem Paket-Root via ensureAgentSkillsInstalled) und meldet
// ehrlich, was geschehen ist. Ohne Reparatur-Quelle (npm-global-Context)
// bekommt der Agent/User die konkreten Kommandos, nicht nur einen Verweis.
export async function writeInstruction(agent, { root, homeDir, coreDir, mode = "optional", reichweite = "projekt", repairSkills = true, packageRoot } = {}) {
  const { skillsDir, falsiflowSkillDir } = skillPaths(homeDir);
  let skillsInstalled =
    existsSync(path.join(skillsDir, "agent-skill-falsify.sh")) ||
    existsSync(path.join(skillsDir, "agent-skill-falsify.mjs")) ||
    existsSync(path.join(skillsDir, "agent-skill-falsify.ps1"));
  let skillsRepaired = false;
  let skillsRepairError = null;
  if (!skillsInstalled && repairSkills) {
    const repair = await ensureAgentSkillsInstalled({ homeDir, packageRoot });
    skillsRepaired = repair.repaired;
    skillsRepairError = repair.error ?? null;
    skillsInstalled = repair.ok;
  }
  if (!skillsInstalled) {
    // Kein stiller Verweis mehr: die Meldung nennt die URSCHE (Pfad, den die
    // Instruction referenziert) UND die konkrete Reparatur (Kommandos), damit
    // der nächste Schritt ausführbar ist statt dangling.
    console.warn(`WARNUNG: Agent-Skills fehlen unter ${skillsDir} - die Instruction verweist auf diese Pfade.`);
    if (skillsRepairError) console.warn(`  Grund: ${skillsRepairError}`);
    console.warn(`  Reparatur (einsatzbereit in ~1 s, idempotent): im FalsifyMe-Paket-Root "node install.mjs" ausführen`);
    console.warn(`  oder: falsify bootstrap   (installiert Skills + Instructions in einem Lauf)`);
    console.warn(`  Danach diese Instruction NEU schreiben (erneut falsify bootstrap), damit die Pfade existieren.`);
  } else if (skillsRepaired) {
    console.log(`Agent-Skills nachinstalliert: ${skillsDir} (Instruction-Pfade jetzt gültig).`);
  }

  const target = instructionTarget(agent.type, { root, homeDir });
  await fs.mkdir(path.dirname(target), { recursive: true });
  const content = renderTemplate(agent.type, {
    SKILLS: skillsDir,
    FALSIFLOW_SKILL: falsiflowSkillDir,
    CORE: coreDir,
    ROOT: root,
    MODE_HEADER: modeHeader(agent.type, { mode, reichweite }),
  });

  let merged = false;
  if (existsSync(target)) {
    const existing = readFileSync(target, "utf8");
    await fs.writeFile(target, mergeInstruction(existing, content), "utf8");
    merged = true;
  } else {
    await fs.writeFile(target, content, "utf8");
  }

  // Realer Lademechanismus (Review-Fehler 5): bash/powershell registrieren.
  const loader = loaderChannel(agent.type, homeDir);
  let loaderRegistered = false;
  if (agent.type === "bash") {
    loaderRegistered = await registerBashLoader(target, path.join(homeDir, ".bashrc"));
  } else if (agent.type === "powershell") {
    loaderRegistered = await registerPowerShellLoader(target, loader.file);
  }

  return { target, skillsDir, falsiflowSkillDir, skillsInstalled, skillsRepaired, skillsRepairError, merged, loader, loaderRegistered };
}

/**
 * Repariert die Skill-Anlage idempotent aus dem Paket-Root (UI-144).
 * Kopiert NUR die drei dokumentierten Skill-Ziele (kein erneutes npm, keine
 * Icons, kein Core-Copy — das erledigt install.mjs komplett; hier geht es
 * NUR um die fehlenden ~/.agents/skills-Anlagen, die die Instruction
 * referenziert). Quelle: der FalsifyMe-Checkout (packageRoot bzw. das
 * Verzeichnis, aus dem dieser Code läuft). Ohne Quelle: ehrliches { ok:false
 * , error } statt stiller Nichts-Tun. repaired=true NUR, wenn tatsächlich
 * kopiert wurde — ein schon vorhandener Marker ist { ok:true, repaired:
 * false } (idempotent, ehrlich).
 */
// Konfigurations-Version einer Skill-Anlage lesen (Version-Marker der
// ausgelieferten Skills; siehe agent-skill-falsify.config.json, das install.mjs
// und dieser Repair-Pfad kopieren). Nicht lesbar -> null (kein Versions-Urteil).
function readSkillConfigVersion(configFile) {
  try {
    const cfg = JSON.parse(readFileSync(configFile, "utf8"));
    return typeof cfg?.version === "string" ? cfg.version : null;
  } catch {
    return null;
  }
}

export async function ensureAgentSkillsInstalled({ homeDir, packageRoot: rootArg } = {}) {
  const srcRoot = rootArg
    ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const srcSkillDir = path.join(srcRoot, "skills");
  const srcFalsify = path.join(srcSkillDir, "agent-skill-falsify.sh");
  if (!existsSync(srcFalsify)) {
    return { ok: false, repaired: false, error: `Skill-Quelle nicht gefunden: ${srcSkillDir} (npm-global-Install ohne Repo-Checkout? Reparatur über den Repo-Checkout ausführen: node install.mjs)` };
  }
  const { skillsDir, falsiflowSkillDir } = skillPaths(homeDir);
  // Schon installiert? Ehrlich melden statt erneut zu kopieren (repaired=false).
  // AUSNAHME (UI-148): eine VERALTETE Anlage (installierte Konfig-Version
  // aelter als die Quelle ODER Konfig/Version unlesbar) wird aktualisiert -
  // ein Marker allein bedeutet nur "da", nicht "aktuell". Nie zurueckstufen:
  // ist die installierte Version NEUER als die Quelle, bleibt die Anlage
  // unangetastet (der laufende Core ist dann der alte, kein Skill-Refresh).
  const marker = path.join(skillsDir, "agent-skill-falsify.sh");
  const markerAlt = path.join(skillsDir, "agent-skill-falsify.mjs");
  const markerAlt2 = path.join(skillsDir, "agent-skill-falsify.ps1");
  if (existsSync(marker) || existsSync(markerAlt) || existsSync(markerAlt2)) {
    const srcVersion = readSkillConfigVersion(path.join(srcSkillDir, "agent-skill-falsify.config.json"));
    const installedVersion = readSkillConfigVersion(path.join(skillsDir, "agent-skill-falsify.config.json"));
    const stale = srcVersion !== null && (installedVersion === null
      || compareVersions(installedVersion, srcVersion) < 0);
    if (!stale) {
      return { ok: true, repaired: false };
    }
    // Veraltet -> ueberschreibend neu kopieren (repaired=true, refreshed=true).
    const refreshed = await copySkillArtifacts({ srcSkillDir, srcFalsify, skillsDir, falsiflowSkillDir });
    if (!refreshed.ok) return refreshed;
    return {
      ok: true, repaired: true, refreshed: true,
      fromVersion: installedVersion, toVersion: srcVersion,
    };
  }
  const installed = await copySkillArtifacts({ srcSkillDir, srcFalsify, skillsDir, falsiflowSkillDir });
  if (!installed.ok) return installed;
  return { ok: true, repaired: true };
}

// Gemeinsamer Kopier-Pfad fuer Erstinstallation UND Refresh (UI-148): eine
// Quelle, eine Datei-Liste - kein zweiter Verteilweg.
async function copySkillArtifacts({ srcSkillDir, srcFalsify, skillsDir, falsiflowSkillDir }) {
  try {
    await fs.mkdir(skillsDir, { recursive: true });
    // Parität mit install.mjs: die drei agent-skill-falsify.* Varianten
    // kopieren, die existieren; SKILL.md + falsiflow/selfinstall ergänzen.
    for (const f of ["agent-skill-falsify.sh", "agent-skill-falsify.mjs", "agent-skill-falsify.ps1", "falsifyme.md", "agent-skill-falsify.config.json", "ocr.py", "run-tests.sh"]) {
      const from = path.join(srcSkillDir, f);
      if (existsSync(from)) await fs.copyFile(from, path.join(skillsDir, f));
    }
    await fs.copyFile(srcFalsify, path.join(skillsDir, "agent-skill-falsify.sh"));
    const falsiflowSrc = path.join(srcSkillDir, "falsifyme-falsiflow.md");
    if (existsSync(falsiflowSrc)) {
      await fs.mkdir(falsiflowSkillDir, { recursive: true });
      await fs.copyFile(falsiflowSrc, path.join(falsiflowSkillDir, "SKILL.md"));
    }
    const selfinstallSrc = path.join(srcSkillDir, "falsifyme-selfinstall.md");
    if (existsSync(selfinstallSrc)) {
      const selfinstallDir = path.join(path.dirname(skillsDir), "falsifyme-selfinstall");
      await fs.mkdir(selfinstallDir, { recursive: true });
      await fs.copyFile(selfinstallSrc, path.join(selfinstallDir, "SKILL.md"));
    }
    const ok = existsSync(path.join(skillsDir, "agent-skill-falsify.sh")) ||
      existsSync(path.join(skillsDir, "agent-skill-falsify.mjs")) ||
      existsSync(path.join(skillsDir, "agent-skill-falsify.ps1"));
    if (!ok) return { ok: false, repaired: false, error: "Skill-Kopie unvollständig (agent-skill-falsify.* fehlt nach Kopie)" };
    return { ok: true, repaired: true };
  } catch (e) {
    return { ok: false, repaired: false, error: e?.message || String(e) };
  }
}

async function registerBashLoader(instructionFile, bashrc) {
  const line = `[ -f "${instructionFile}" ] && source "${instructionFile}"  # FalsifyMe-Agent-Integration (automatisch ergaenzt)`;
  let rc = "";
  try { rc = readFileSync(bashrc, "utf8"); } catch { rc = ""; }
  if (rc.includes("FalsifyMe-Agent-Integration")) return true; // idempotent
  await fs.appendFile(bashrc, `\n${line}\n`, "utf8");
  return true;
}

async function registerPowerShellLoader(instructionFile, profilePath) {
  const line = `if (Test-Path "${instructionFile}") { . "${instructionFile}" }  # FalsifyMe-Agent-Integration (automatisch ergaenzt)`;
  let prof = "";
  try { prof = readFileSync(profilePath, "utf8"); } catch { prof = ""; }
  if (prof.includes("FalsifyMe-Agent-Integration")) return true; // idempotent
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  await fs.appendFile(profilePath, `\n${line}\n`, "utf8");
  return true;
}
