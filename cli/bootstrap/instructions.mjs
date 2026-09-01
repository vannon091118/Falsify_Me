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
// MERGE-Vertrag (Review-Fehler 6): existiert die Zieldatei bereits, wird
// der FalsifyMe-Abschnitt MARKIERT angehängt statt überschrieben. Der
// Marker-Bereich wird bei erneutem Lauf ersetzt (idempotent).
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
export async function writeInstruction(agent, { root, homeDir, coreDir }) {
  const { skillsDir, falsiflowSkillDir } = skillPaths(homeDir);
  const skillsInstalled =
    existsSync(path.join(skillsDir, "agent-skill-falsify.sh")) ||
    existsSync(path.join(skillsDir, "agent-skill-falsify.mjs")) ||
    existsSync(path.join(skillsDir, "agent-skill-falsify.ps1"));
  if (!skillsInstalled) {
    console.warn("WARNUNG: Agent-Skills nicht unter ~/.agents/skills/falsifyme gefunden - Instruction verweist auf Pfade, die nach der Installation existieren sollten.");
  }

  const target = instructionTarget(agent.type, { root, homeDir });
  await fs.mkdir(path.dirname(target), { recursive: true });
  const content = renderTemplate(agent.type, {
    SKILLS: skillsDir,
    FALSIFLOW_SKILL: falsiflowSkillDir,
    CORE: coreDir,
    ROOT: root,
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

  return { target, skillsDir, falsiflowSkillDir, skillsInstalled, merged, loader, loaderRegistered };
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
