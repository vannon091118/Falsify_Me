// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/verdict.mjs – BEFUND-/VERDICT-/SUBPROMPT-Parsing
// -----------------------------------------------------------------------------
// Endblöcke: BEFUND: <Gesamtbefund>, VERDICT: PLAN | RESEARCH | WRITE und
// SUBPROMPT: <genau 3 Zeilen> – der Modell-eigene Prompt-Update (Fallback
// gegen Drift).
// ─────────────────────────────────────────────────────────────────────────────

export function parseVerdict(content) {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^VERDICT:\s*(PLAN|RESEARCH|WRITE)\b/i);
    if (m) {
      const v = m[1].toUpperCase();
      return v;
    }
  }
  return null;
}

/**
 * Challenge-Nachweis (Anti-Self-Check-Bias, Thinker): Der Review muss den
 * Falsifikationsversuch belegen (Struktur "## Falsifikationsversuche" oder
 * eine BEFUND-Zeile). Ohne diesen Beleg ist WRITE ein Rubber-Stamp und wird
 * als UNKNOWN behandelt (keine Freigabe).
 */
export function hasChallengeEvidence(content) {
  const c = String(content || "");
  return /##\s*Falsifikationsversuche/i.test(c) || /BEFUND:\s*\S+/i.test(c);
}

/** Echte Finding-Severity je Verdict (info/warning/critical, UI-065-Befund 3). */
export function findingSeverity(verdict) {
  const v = String(verdict || "").toUpperCase();
  if (v === "WRITE") return "discovered";
  if (v === "PLAN" || v === "RESEARCH") return "warning";
  return "critical";
}

/**
 * Erzwingt den Challenge-Nachweis vor WRITE: WRITE ohne Beleg -> null
 * (UNKNOWN, keine Freigabe); sonst das (großgeschriebene) Verdict.
 */
export function enforceWriteChallenge(content, verdict) {
  const v = String(verdict || "").toUpperCase();
  if (v === "WRITE" && !hasChallengeEvidence(content)) return null;
  return v || null;
}

export function parseBefund(content) {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^BEFUND:\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Extrahiert den SUBPROMPT-Block: die (bis zu) 3 Zeilen NACH der letzten
 * "SUBPROMPT:"-Zeile. Das ist der vom Modell aktualisierte FalsifyMe-Prompt
 * (Prompt-Anpassung + wichtiger Scope-Kontext) – Fallback gegen Drift.
 * @returns {string|null} die 3 Zeilen, mit "\n" verbunden (oder null)
 */
export function parseSubPrompt(content) {
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^SUBPROMPT:\s*$/i.test(lines[i])) { idx = i; break; }
  }
  if (idx === -1) return null;
  const taken = [];
  for (let i = idx + 1; i < lines.length && taken.length < 3; i++) {
    if (lines[i]) taken.push(lines[i]);
  }
  return taken.length ? taken.join("\n") : null;
}
