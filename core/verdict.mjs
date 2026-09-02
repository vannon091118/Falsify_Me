// FalsifyMe 2.0 · core/verdict.mjs – compatibility facade
// Verdict-/Befund-Parsing remains here; gate implementations live in focused modules.

export function parseVerdict(content) {
  const lines = String(content || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/^VERDICT:\s*(PLAN|RESEARCH|WRITE|ASK)\b/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

export function exitCodeOf(verdict) {
  const value = String(verdict || "").toUpperCase();
  if (value === "WRITE") return 0;
  if (value === "PLAN" || value === "RESEARCH") return 1;
  if (value === "ASK") return 5;
  return 3;
}

export function parseBefund(content) {
  const lines = String(content || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/^BEFUND:\s*(.+)$/i);
    if (match) return match[1].trim();
  }
  return null;
}

export function parseScopeDivergence(content) {
  const text = String(content || "");
  const match = text.match(/##\s*(?:Umsetzungsverst(?:aendnis|ändnis)|Implementation understanding)\s*\(?FalsifyMe\)?/i);
  if (!match) return { text: null, konform: false, divergence: null };
  const rest = text.slice(match.index + match[0].length);
  const nextHeading = rest.search(/\n(?:#{1,3}\s+\S|BEFUND:\s|VERDICT:\s|SUBPROMPT:\s)/);
  const section = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
  const divergence = section.match(/SCOPE-DIVERGENZ:\s*(.+)$/im);
  if (divergence) {
    const value = divergence[1].trim();
    return { text: section, konform: false, divergence: value, tooShort: value.length < 20 };
  }
  if (/SCOPE-KONFORM/i.test(section)) return { text: section, konform: true, divergence: null, tooShort: false };
  return { text: section, konform: false, divergence: null, tooShort: false };
}

export function parseSubPrompt(content) {
  const lines = String(content || "").split(/\r?\n/).map((l) => l.trim());
  let index = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^SUBPROMPT:\s*$/i.test(lines[i])) { index = i; break; }
  }
  if (index === -1) return null;
  const result = [];
  for (let i = index + 1; i < lines.length && result.length < 3; i++) if (lines[i]) result.push(lines[i]);
  return result.length ? result.join("\n") : null;
}

export {
  extractAttemptBundles,
  evidenceOf,
  hasChallengeEvidence,
  enforceWriteChallenge,
  enforceResearchContract,
  extractResearchAdditions,
  enforceStructuralCoherence,
  findingSeverity,
} from "./evidence.mjs";

export {
  twinEvidenceOk,
  anchoredFileLine,
  twinOwnFalsificationOk,
} from "./twin-evidence.mjs";
