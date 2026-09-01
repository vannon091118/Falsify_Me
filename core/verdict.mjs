// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/verdict.mjs – BEFUND-/VERDICT-/SUBPROMPT-Parsing
// -----------------------------------------------------------------------------
// Endblöcke: BEFUND: <Gesamtbefund>, VERDICT: PLAN | RESEARCH | WRITE | ASK
// und SUBPROMPT: <genau 3 Zeilen> – der Modell-eigene Prompt-Update (Fallback
// gegen Drift). ASK = Aufgaben-Mehrdeutigkeit (Etage 2, UI-082): Die Aufgabe
// selbst ist unklar, nicht die Umsetzung – Rückfrage an den User nötig.
// Regel 2 (UI-098): Challenge-Evidenz ist semantisch — ein vorhandenes
// ## Falsifikationsversuche-Feld ist kein Nachweis; jeder Versuch braucht
// eine konkrete, überprüfbare Referenz (evidenceOf).
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";

const { existsSync } = fs;

export function parseVerdict(content) {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^VERDICT:\s*(PLAN|RESEARCH|WRITE|ASK)\b/i);
    if (m) {
      const v = m[1].toUpperCase();
      return v;
    }
  }
  return null;
}

/**
 * Exit-Code je Verdict (Vertrag aus README/falsify.sh):
 *   0 = WRITE (Freigabe) · 1 = PLAN/RESEARCH (Loop) · 5 = ASK (User-Rückfrage) ·
 *   3 = kein Verdict / Fehler
 */
export function exitCodeOf(verdict) {
  const v = String(verdict || "").toUpperCase();
  if (v === "WRITE") return 0;
  if (v === "PLAN" || v === "RESEARCH") return 1;
  if (v === "ASK") return 5;
  return 3;
}

/**
 * Empirische Evidenz eines Falsifikationsversuchs (Regel 2, UI-098):
 * Der Versuch muss eine KONKRETE, ÜBERPRÜFBARE Referenz tragen — kein
 * Syntax-Feld, sondern ein Token, das FalsifyMe gegen die Realität prüfen
 * kann. Akzeptierte Token (mindestens EINER je Versuch):
 *   1. Datei:Zeile — z. B. `core/verdict.mjs:23` oder `cli/run.mjs:236-240`
 *   2. zitiertes Symbol — Backtick-Identifier wie `claimNextJob` (≥3 Zeichen)
 *   3. Dateipfad aus der Whitelist ODER relative Pfadform mit Endung
 *   Überprüfbar heißt: genannte Pfade müssen in der Whitelist liegen oder
 *   unter <root> existieren (wird mit <whitelist>/<root> erzwungen; ohne
 *   beide Optionen zaehlt nur die Pfad-/Symbolform).
 * „Geprüft: keine Fehler" ohne jede Referenz ist KEIN Nachweis.
 */
const EVIDENCE_FILE_EXT = /\.(?:js|mjs|cjs|ts|tsx|jsx|py|json|md|sh|ps1|css|html|sql|ya?ml|toml|txt|c|cpp|h|go|rs|java)$/i;
const EVIDENCE_SYMBOL = /`([A-Za-z_$][\w.$-]{2,})`/g;
const EVIDENCE_FILE_LINE = /(?:^|[\s(,;])([\w./-]+\.(?:jsx?|mjs|cjs|tsx?|py|json|md|sh|ps1|go|rs|java)):(\d+)(?:-\d+)?/i;
const EVIDENCE_PATH = /[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]+/;

// WIDERLEGUNGS-ZWANG (Rig-Review 2026-09-01): Ein Falsifikationsversuch muss
// eine Widerlegung formulieren – reine Bestätigungen („ist korrekt", „keine
// Fehler gefunden") sind KEIN Nachweis, auch nicht mit angehängtem Pfad.
const REFUTATION = /widerlegt?|widerlegung|refuted|verletzt|violates?|bricht|brea?ks|umgehung|umgangen|bypass|race|racy|bug|luecke|lücke|gap|flaw|angreifbar|unsicher|unsafe|kaputt|broken|falsch|wrong|fehlt|missing|inkonsistent|inconsistent|unzureichend|insufficient|risiko|risik|gefahr|danger|crash|absturz|leak|ausbruch|escape|gegenteil|contrary|angreif|attack|schwach|weak|zuwenig|zu wenig|nicht funktioniert|fails?/i;
// Negations-Senke: „keine Fehler/Lücken/Bugs …" ist KEINE Widerlegung.
const NEGATION_SINK = /\bkein(?:e|er|em|en)?\s+(?:fehler|gefunden|luecke|lücke|bug|problem|schwachstelle|schwaechen|risiko|anhaltspunkt|verstoss|widerspruch|gegenteil)\b/gi;

function hasRefutation(text) {
  return REFUTATION.test(String(text || "").replace(NEGATION_SINK, " "));
}

/**
 * Zerlegt den Abschnitt in Versuch-BÜNDEL: Eine nummerierte/Bullet-Zeile
 * beginnt ein Bündel, Folgezeilen (bis zur nächsten Bündel-/Abschnittszeile)
 * gehören dazu – die Evidenz darf in der Folgezeile stehen (Rig-2026-09-01:
 * nur die Listen-Zeile zu lesen blockte echte Versuche strukturell).
 */
export function extractAttemptBundles(section) {
  const bundles = [];
  let current = null;
  for (const raw of String(section || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(?:\d+\.|[-*])\s+\S/.test(line)) {
      current = { text: line.replace(/^(?:\d+\.|[-*])\s+/, "").trim() };
      bundles.push(current);
    } else if (current) {
      current.text += " " + line;
    }
  }
  return bundles;
}

/** Liest Whitelist-Dateien (Cache) für Symbol-/Zeilen-Verifikation. */
function fileTextCache(root, whitelist) {
  const cache = new Map();
  return (file) => {
    if (cache.has(file)) return cache.get(file);
    let txt = null;
    try {
      const abs = path.isAbsolute(file) ? file : path.join(root, file);
      txt = fs.readFileSync(abs, "utf8");
      if (txt.length > 200000) txt = null; // wie read_file: nur erste 200 KB
    } catch { /* nicht lesbar */ }
    cache.set(file, txt);
    return txt;
  };
}

/**
 * Evidenz-Typ eines Falsifikations-BÜNDELS – nur VERIFIZIERTE Referenzen
 * zählen (Rig-2026-09-01): Whitelist-Datei wörtlich; Backtick-Symbole NUR,
 * wenn sie tatsächlich im Code vorkommen (whitelisted Dateien, root nötig);
 * Datei:Zeile NUR, wenn Datei existiert UND die Zeile existiert; Pfadform
 * NUR, wenn die Datei existiert. Ohne root ist nur die Whitelist-Referenz
 * überprüfbar. Fantasie-Symbole und Fantasie-Zeilenummern zählen nicht.
 */
export function evidenceOf(attempt, { whitelist = [], root = null } = {}) {
  const read = root ? fileTextCache(root, whitelist) : null;
  // 1. Datei:Zeile — die stärkste Referenz wird STRIKT verifiziert (Datei UND
  //    Zeile müssen existieren). Ein Whitelist-Token im selben Bündel darf
  //    eine Fantasie-Zeilenummer nicht „erben" (Rig-2026-09-01).
  const lm = attempt.match(EVIDENCE_FILE_LINE);
  if (lm && EVIDENCE_FILE_EXT.test(lm[1])) {
    if (!root) return null;
    const file = lm[1];
    if (!existsSync(path.join(root, file))) return null;
    const lineNo = Number(lm[2]);
    const lines = read(file);
    if (!lines || lineNo < 1 || lineNo > lines.split(/\r?\n/).length) return null;
    return "datei-zeile";
  }
  // 2. Whitelist-Datei wörtlich (nur wenn keine stärkere, verifikationspflichtige
  //    Referenz im Spiel ist).
  if (whitelist.some((w) => attempt.includes(w))) return "whitelist";
  // 3. Zitierte Symbole — nur wenn sie tatsächlich im Code vorkommen.
  for (const m of String(attempt || "").matchAll(EVIDENCE_SYMBOL)) {
    const sym = m[1];
    if (!read) return null; // ohne root ist kein Symbol verifizierbar
    for (const w of whitelist) {
      const txt = read(w);
      if (txt && txt.includes(sym)) return "symbol";
    }
  }
  // 4. relative Pfadform — nur wenn die Datei existiert.
  const pm = attempt.match(EVIDENCE_PATH);
  if (pm && EVIDENCE_FILE_EXT.test(pm[0]) && root && existsSync(path.join(root, pm[0]))) {
    return "pfad-existiert";
  }
  return null;
}

/**
 * Challenge-Nachweis (Anti-Self-Check-Bias, Thinker): Der Review muss die
 * Coder-Annahme ANGRIFFEN und die Widerlegung mit konkreter, VERIFIZIERTER
 * Evidenz begründen (Regel 2, Rig-Review 2026-09-01):
 *   1. Widerlegung: das Bündel muss eine Widerlegung formulieren
 *      (Bestätigungen wie „ist korrekt"/„keine Fehler gefunden" sind KEIN
 *      Nachweis – auch nicht mit angehängtem Pfad).
 *   2. Evidenz: Whitelist-Datei wörtlich, im Code existierendes Symbol,
 *      existierende Datei:Zeile oder existierender Pfad.
 * „BEFUND: …" allein zählt nie; ein Formular-Feld ebenso wenig. Ohne Beleg
 * ist WRITE ein Rubber-Stamp und wird als UNKNOWN behandelt (keine Freigabe).
 * @param {Object} [opts] { whitelist: string[], root: string|null }
 */
export function hasChallengeEvidence(content, opts = {}) {
  const c = String(content || "");
  const m = c.match(/##\s*Falsifikationsversuche/i);
  if (!m) return false;
  const rest = c.slice(m.index + m[0].length);
  const nextHeading = rest.search(/\n#{1,6}\s+\S/);
  const section = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
  return extractAttemptBundles(section).some((b) => b.text.length >= 10 && hasRefutation(b.text) && evidenceOf(b.text, opts));
}

/** Echte Finding-Severity je Verdict (info/warning/critical, UI-065-Befund 3). */
export function findingSeverity(verdict) {
  const v = String(verdict || "").toUpperCase();
  if (v === "WRITE") return "discovered";
  if (v === "PLAN" || v === "RESEARCH" || v === "ASK") return "warning";
  return "critical";
}

/**
 * Erzwingt den Challenge-Nachweis vor WRITE: WRITE ohne substanziellen,
 * evidenzgetragenen Falsifikationsversuch -> null (UNKNOWN, keine Freigabe);
 * sonst das (großgeschriebene) Verdict. Die Evidence-Auswertung kann die
 * Whitelist + Root des Jobs erhalten, um Referenzen zu verifizieren.
 * @param {Object} [opts] siehe hasChallengeEvidence
 */
export function enforceWriteChallenge(content, verdict, opts = {}) {
  const v = String(verdict || "").toUpperCase();
  if (v === "WRITE" && !hasChallengeEvidence(content, opts)) return null;
  return v || null;
}

/**
 * Regel 5 (UI-103): Ein formales Gate macht keine kaputte Basis „grün".
 * WRITE ist nur belastbar, wenn die Einreichung selbst strukturell kohärent
 * ist — stehen deterministische Blocker dagegen (fehlende Whitelist-Dateien,
 * Pfad-Traversal, Diff ausserhalb des Zugriffsrahmens, Plan↔Diff-Divergenz),
 * bleibt PLAN korrekt: WRITE wird auf PLAN heruntergestuft.
 * @param {string[]} blocks harte Feasibility-Blocker der Einreichung
 * @returns {string} "WRITE" | "PLAN" | das übergebene Verdict
 */
export function enforceStructuralCoherence(blocks = [], verdict) {
  const v = String(verdict || "").toUpperCase();
  if (v === "WRITE" && Array.isArray(blocks) && blocks.length) return "PLAN";
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
