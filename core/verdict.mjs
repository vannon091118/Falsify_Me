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
// Backtick ist ein zulaessiges Praefix: Markdown-Code-Spans („`datei:zeile`“)
// sind die native Form der Falsifikations-Referenzen (RunDance-Befund 7).
const EVIDENCE_FILE_LINE = /(?:^|[\s(,;`])([\w./-]+\.(?:jsx?|mjs|cjs|tsx?|py|json|md|sh|ps1|go|rs|java)):(\d+)(?:-\d+)?/i;
const EVIDENCE_PATH = /[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]+/;

// WIDERLEGUNGS-ZWANG (Rig-Review 2026-09-01): Ein Falsifikationsversuch muss
// eine Widerlegung formulieren – reine Bestätigungen („ist korrekt", „keine
// Fehler gefunden") sind KEIN Nachweis, auch nicht mit angehängtem Pfad.
const REFUTATION = /widerlegt?|widerlegung|refuted|verletzt|violates?|bricht|brea?ks|umgehung|umgangen|bypass|race|racy|bug|luecke|lücke|gap|flaw|angreifbar|unsicher|unsafe|kaputt|broken|falsch|wrong|fehlt|missing|inkonsistent|inconsistent|unzureichend|insufficient|risiko|risik|gefahr|danger|crash|absturz|leak|ausbruch|escape|gegenteil|contrary|angreif|attack|schwach|weak|zuwenig|zu wenig|nicht funktioniert|fails?/i;
// Negations-Senke: „keine Fehler/Lücken/Bugs …" ist KEINE Widerlegung.
const NEGATION_SINK = /\b(?:kein(?:e|er|em|en)?\s+(?:fehler|gefunden|luecke|lücke|bug|problem|schwachstelle|schwaechen|risiko|anhaltspunkt|verstoss|widerspruch|gegenteil)|no errors? found|nothing wrong)\b/gi;

/**
 * Widerlegungs-Zwang (RunDance-Befund 7, 2026-09-01): EIN einzelnes
 * Widerlegungs-Token + angehängter Whitelist-Pfad ist ein Rubber-Stamp
 * („Widerlegt: `claimNextJob` (artifacts/jobs.mjs)“ trägt keine inhaltliche
 * Widerlegung). Es braucht mindestens ZWEI unterschiedliche Widerlegungs-
 * Token ODER ein Token MIT verifizierter Datei:Zeile (die stärkste Evidenz
 * kompensiert ein einziges Token – der Produktpfad übergibt immer root,
 * RunDance-Befund 3 entkräftet).
 */
function hasRefutation(text, evidenceType) {
  const t = String(text || "").replace(NEGATION_SINK, " ");
  const tokens = new Set();
  for (const m of t.matchAll(new RegExp(REFUTATION.source, "gi"))) tokens.add(m[0].toLowerCase());
  if (tokens.size >= 2) return true;
  return tokens.size === 1 && evidenceType === "datei-zeile";
}

/**
 * Zerlegt den Abschnitt in Versuch-BÜNDEL: Eine nummerierte/Bullet-Zeile
 * beginnt ein Bündel (auch als Markdown-Header „### N. …“ oder „**N. …**“
 * formatiert – E2E-Befund 2026-09-01: der Thinker strukturierte Versuche
 * als ###-Untertitel, das Gate sah null Bündel und degradierte eine
 * evidenzgetragene Widerlegung zu UNKNOWN), Folgezeilen (bis zur nächsten
 * Bündel-/Abschnittszeile) gehören dazu – die Evidenz darf in der
 * Folgezeile stehen (Rig-2026-09-01: nur die Listen-Zeile zu lesen blockte
 * echte Versuche strukturell). Widerlegungs-/Evidenz-Semantik bleibt
 * unverändert streng – erweitert wird nur die FORMAT-Erkennung.
 */
export function extractAttemptBundles(section) {
  const bundles = [];
  let current = null;
  for (const raw of String(section || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // JEDE ###-Kopfzeile startet ein Bündel (nummeriert ODER benannt —
    // RunDance-Befund 2026-09-01: „### Widerlegung: …“ ohne Nummer blieb
    // unsichtbar, und der Falsifikations-Abschnitt endet nur an #/##).
    // Markdown-Deko entfernen, dann ist die Listen-Form („1. …“) prüfbar.
    const isHeader = /^#{1,6}\s+\S/.test(line);
    const bare = line.replace(/^#{1,6}\s+/, "").replace(/^\*{1,3}\s+/, "");
    const isListItem = /^(?:\d+\.|[-*])\s+\S/.test(bare);
    if (isHeader || isListItem) {
      current = { text: (isListItem ? bare.replace(/^(?:\d+\.|[-*])\s+/, "") : bare).trim() };
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
  // Harte Abschnittsgrenzen sind NUR #/##-Überschriften: „### N.“-Untertitel
  // der Versuche gehören ZUM Abschnitt (E2E-Befund 2026-09-01 – sonst endet
  // die Sektion schon beim ersten Versuch und alle evidenzgetragenen
  // Widerlegungen werden unsichtbar).
  const nextHeading = rest.search(/\n#{1,2}\s+\S/);
  const section = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
  return extractAttemptBundles(section).some((b) => {
    if (b.text.length < 10) return false;
    const ev = evidenceOf(b.text, opts);
    return !!ev && hasRefutation(b.text, ev);
  });
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
 * RESEARCH-Vertrag (2026-09-01): VERDICT: RESEARCH ist nur belastbar, wenn
 * der BEFUND KONKRET benennt, welches Datum fehlt (Datei:Zeile, konkrete
 * Datei/Datum). Pauschales „brauche mehr Informationen“ ist kein RESEARCH —
 * der Guard stuft es fail-closed auf null (PLAN) herunter, damit der Loop
 * mit einer präzisen Frage weiterarbeitet statt mit einem Datensammel-
 * Lauf ins Leere zu gehen.
 */
const MISSING_DATA = /(?:fehlt|fehlend|benötigt|benoetigt|brauche|brauchen|nicht vorhanden|nicht lesbar|kein zugriff|keine? (?:datei|daten)|missing|need|required|not (?:found|available)|cannot? read|kein zugriff)/i;
const CONCRETE_REF = /(?:[\w./-]+\.\w+:\d+|[\w./-]+\.(?:js|mjs|cjs|ts|tsx|py|json|md|sh|ps1|txt|sql|go|rs|java)\b|read_file|list_dir|glob)/i;

export function enforceResearchContract(content, verdict) {
  if (String(verdict || "").toUpperCase() !== "RESEARCH") return verdict;
  const befund = parseBefund(String(content || "")) || "";
  const hasMissing = MISSING_DATA.test(befund) && CONCRETE_REF.test(befund);
  return hasMissing ? "RESEARCH" : null;
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
/**
 * Loop-Anker (UI-107, 2026-09-01): Die Umsetzungsvorschläge der BEIDEN
 * Agents — Coder (agent_intent aus der Einreichung) und Thinker (eigene
 * „## Umsetzungsverstaendnis (FalsifyMe)“-Sektion) — müssen an EINEM Punkt
 * dividiert werden, damit der Task-Scope praezisiert wird. Der Thinker
 * deklariert das Ergebnis seiner Gegenueberstellung pflichtbewusst:
 *   SCOPE-KONFORM                     -> kein Unterschied
 *   SCOPE-DIVERGENZ: <Grund>          -> Abweichung mit substanzieller
 *                                        Begruendung (>20 Zeichen, sonst
 *                                        wird sie nicht als Anker gezählt)
 * Liefert { text, konform, divergence|null }. Fehlt die Sektion komplett,
 * gibt es keinen Anker (kein Downgrade – nur DEKLARIERTE Divergenz blockt).
 */
export function parseScopeDivergence(content) {
  const c = String(content || "");
  // DE mit ae- und ae-umlaut-Schreibweise, EN Title-Case-tolerant (Rig R10).
  const m = c.match(/##\s*(?:Umsetzungsverst(?:aendnis|ändnis)|Implementation understanding)\s*\(?FalsifyMe\)?/i);
  if (!m) return { text: null, konform: false, divergence: null };
  const rest = c.slice(m.index + m[0].length);
  // Harte Abschnittsgrenzen: naechste #/##/###-Ueberschrift ODER die
  // Terminal-Marker BEFUND:/VERDICT:/SUBPROMPT: — sonst schluckt die Sektion
  // bei ans-Ende-platziertem Anker den Rest der Antwort (Rig R10, Befund 1).
  const nextHeading = rest.search(/\n(?:#{1,3}\s+\S|BEFUND:\s|VERDICT:\s|SUBPROMPT:\s)/);
  const section = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
  const div = section.match(/SCOPE-DIVERGENZ:\s*(.+)$/im);
  if (div) {
    // JEDE Deklaration setzt den Anker (kein stiller Verlust) — eine zu vage
    // Begruendung (<20 Zeichen) wird markiert, blockt aber weiterhin (Rig R10,
    // Befund 4: konform:false ohne divergence war eine stille Inkonsistenz).
    const d = div[1].trim();
    return { text: section, konform: false, divergence: d, tooShort: d.length < 20 };
  }
  if (/SCOPE-KONFORM/i.test(section)) return { text: section, konform: true, divergence: null, tooShort: false };
  return { text: section, konform: false, divergence: null, tooShort: false };
}

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
