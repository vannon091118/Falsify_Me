// FalsifyMe 2.0 · core/verdict.mjs – compatibility facade
// Verdict-/Befund-Parsing remains here; gate implementations live in focused modules.

// Führende Markdown-Betonung („**VERDICT:** PLAN“) vor dem Matchen entfernen —
// Live-E2E 2026-09-04 (Job 1eq1ug): das Modell schrieb das Urteil fett, der
// Parser blieb UNBEKANNT, obwohl ein klares „VERDICT: PLAN“ vorlag. Der
// mid-Sentence-Fall („text VERDICT: WRITE mitten im Satz“) bleibt durch die
// ^-Ankerung ausgeschlossen.
function normLine(l) {
  // Entfernt Betonungs-Marker (Markdown **/*/__/_/***) als DELIMITER — nur
  // dort, wo sie an Nicht-Leerzeichen grenzen: „**VERDICT:** PLAN“ →
  // „VERDICT: PLAN“, „*VERDICT: RESEARCH*“ → „VERDICT: RESEARCH“. Der
  // mid-Sentence-Fall („text VERDICT: WRITE mitten im Satz“) bleibt durch
  // die ^-Ankerung der Erkennungs-Regexe ausgeschlossen.
  return l
    .trim()
    .replace(/\*{1,3}(?=\S)/g, "")
    .replace(/(?<=\S)\*{1,3}(?=$|[^\S])/g, "")
    .replace(/\*{1,3}(?=$|[^\S])/g, "")
    .replace(/_{1,3}(?=\S)/g, "")
    .replace(/(?<=\S)_{1,3}(?=$|[^\S])/g, "")
    .replace(/_{1,3}(?=$|[^\S])/g, "");
}

export function parseVerdict(content) {
  const lines = String(content || "").split(/\r?\n/).map(normLine).filter(Boolean);
  // 1) klassische Zeilenform, letzte gewinnt
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/^#{0,3}\s*VERDICT:\s*(PLAN|RESEARCH|WRITE|ASK)\b/i);
    if (match) return match[1].toUpperCase();
  }
  // 2) Überschriften-Form „## VERDICT“ mit Wert in der nächsten Zeile
  //    (Live-E2E 2026-09-02: Modelle schreiben das Urteil als Markdown-
  //    Überschrift — fail-closed wäre hier fälschlich UNBEKANNT)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^#{1,3}\s*VERDICT\s*$/i.test(lines[i])) {
      for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
        const m2 = lines[j].match(/^(PLAN|RESEARCH|WRITE|ASK)\b/i);
        if (m2) return m2[1].toUpperCase();
        if (/^#{1,3}\s|^BEFUND:|^SUBPROMPT:/i.test(lines[j])) break;
      }
    }
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
  const lines = String(content || "").split(/\r?\n/).map(normLine).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/^BEFUND:\s*(.+)$/i);
    if (match) return match[1].trim();
  }
  // Fallback: „## Befund“-Überschrift + erster Absatz (Live-E2E 2026-09-02:
  // Modelle schreiben den Befund als Markdown-Absatz ohne BEFUND:-Zeile)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^#{1,3}\s*Befund\s*$/i.test(lines[i])) {
      const para = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^#{1,3}\s|^BEFUND:|^VERDICT:|^SUBPROMPT:/i.test(lines[j])) break;
        para.push(lines[j]);
        if (para.join(" ").length > 40) break; // erster sinnvoller Absatz reicht
      }
      const text = para.join(" ").trim();
      if (text) return text;
    }
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
