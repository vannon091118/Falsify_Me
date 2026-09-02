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
// Audit-Befund 8/9 (2026-09-01): EN-Lücken — „no gap and no flaw“, „no issues
// detected“, „all good“, „looks correct“, „no vulnerabilities“ sind REINE
// Bestätigungen, aber ihre Wörter (gap, flaw, …) sind REFUTATION-Tokens und
// liessen einen Rubber-Stamp durch. Die Senke neutralisiert sie, damit
// hasRefutation keine Widerlegung mehr sieht.
// Live-Probe-Fix (Checklisten-Audit 2026-09-01): Die Senke verlangte nach dem
// Defekt-Nomen zwingend Whitespace (\s+(found|detected|…)?) — komma-sequenzierte
// Negationen wie „no gap, no flaw, no issue — solid“ scheiterten an \s+ und
// passierten das Gate. Das Suffix ist jetzt voll optional (\b-gebunden).
const NEGATION_SINK = /\b(?:kein(?:e|er|em|en)?\s+(?:fehler|gefunden|luecke|lücke|bug|problem|schwachstelle|schwaechen|risiko|anhaltspunkt|verstoss|widerspruch|gegenteil)|no\s+(?:errors?|issues?|problems?|bugs?|gaps?|flaws?|vulnerabilit(?:y|ies)|concerns?|defects?|lücken|luecken)\b(?:\s+(?:found|detected|present|here|at\s+all))?|nothing\s+wrong|all\s+good|looks?\s+correct|seems?\s+(?:correct|fine|ok|okay|good|right)|\bis\s+(?:correct|fine|ok|okay|good|right|solid))\b/gi;

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

/**
 * Löst eine relative Pfadangabe case-insensitiv gegen <root> auf (Audit-Befund
 * 2026-09-01): EVIDENCE_FILE_LINE matcht mit /i („Core/Verdict.mjs:23“), aber
 * existsSync path.join(root, file) ist auf Linux case-sensitiv — ein echter
 * Thinker-Beweis mit falscher Gross-/Kleinschreibung wurde verworfen. Erst
 * exakt, dann case-insensitiv je Segment auflösen; nicht auflösbar → null.
 */
function resolveRel(root, rel) {
  try {
    const readFileLike = (p) => { try { if (existsSync(p)) return p; } catch { /* egal */ } return null; };
    let p = path.isAbsolute(rel) ? rel : path.join(root, rel);
    const exact = readFileLike(p);
    if (exact) return exact;
    const parts = String(rel).split(/[\/\\]/).filter(Boolean);
    let cur = path.resolve(root);
    for (const part of parts) {
      let entry = null;
      const want = part.toLowerCase();
      for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
        if (e.name.toLowerCase() === want) { entry = e.name; break; }
      }
      if (!entry) return null;
      cur = path.join(cur, entry);
    }
    return existsSync(cur) ? cur : null;
  } catch { return null; }
}

/** Liest Whitelist-Dateien (Cache) für Symbol-/Zeilen-Verifikation. */
function fileTextCache(root, whitelist) {
  const cache = new Map();
  return (file) => {
    if (cache.has(file)) return cache.get(file);
    let txt = null;
    try {
      const abs = resolveRel(root, file);
      if (abs) txt = fs.readFileSync(abs, "utf8");
      if (txt && txt.length > 200000) txt = null; // wie read_file: nur erste 200 KB
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
export function evidenceOf(attempt, { whitelist = [], root = null, cache } = {}) {
  // Cache-Hoisting (Audit-Befund 2026-09-01): EIN Cache pro hasChallengeEvidence-
  // Call wird weitergereicht — sonst erzeugt jedes Bündel eine frische Map und
  // liest dieselben Dateien N× neu. Ohne mitgegebenen cache (Direct-Aufrufe) fällt
  // evidenceOf auf einen frischen Cache zurück (Verhalten unverändert).
  const read = root ? (cache instanceof Function ? cache : fileTextCache(root, whitelist)) : null;
  // 1. Datei:Zeile — die stärkste Referenz wird STRIKT verifiziert (Datei UND
  //    Zeile müssen existieren, case-insensitiv aufgelöst). Ein Whitelist-Token
  //    darf eine Fantasie-Zeilenummer nicht „erben" (Rig-2026-09-01).
  const lm = attempt.match(EVIDENCE_FILE_LINE);
  if (lm && EVIDENCE_FILE_EXT.test(lm[1])) {
    if (!root) return null;
    const file = lm[1];
    if (!resolveRel(root, file)) return null;
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
  // 4. relative Pfadform — nur wenn die Datei existiert (case-insensitiv).
  const pm = attempt.match(EVIDENCE_PATH);
  if (pm && EVIDENCE_FILE_EXT.test(pm[0]) && root && resolveRel(root, pm[0])) {
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
  // Cache-Hoisting: EIN Cache fuer ALLE Bündel (Audit-Befund 2026-09-01 —
  // sonst N frische Maps und N× Datei-Reads).
  const cache = opts?.root ? fileTextCache(opts.root, opts.whitelist || []) : null;
  return extractAttemptBundles(section).some((b) => {
    if (b.text.length < 10) return false;
    const ev = evidenceOf(b.text, { ...opts, cache });
    return !!ev && hasRefutation(b.text, ev);
  });
}

/**
 * Twin-Evidenz-Gate (Regel 6, Rig-Review 2026-09-01): „BESTAETIGT ohne
 * eigenes Lesen ist VERBOTEN“ ist nur Prompt-Level — DETERMINISTISCH
 * erzwungen wird es hier. Eine Freigabe ist erst belastbar, wenn der Twin
 * nachweisbar selbst gelesen hat (mind. 1 Tool-Runde = read_file/list_dir/
 * glob wirklich ausgefuehrt) ODER eine verifizierbare Referenz im
 * Befund/Content traegt (Datei:Zeile, Whitelist-Datei, existierender Pfad —
 * evidenceOf). BESTAETIGT ohne beides ist keine unabhaengige Bestaetigung
 * -> false (fail-closed, run.mjs stuft auf PLAN). WIDERSPRUCH/UNKLAR sind
 * nicht pruefpflichtig (sie verweigern die Freigabe ohnehin) -> true.
 */
export function twinEvidenceOk(twin, { root = null, whitelist = [] } = {}) {
  if (!twin || twin.verdict !== "BESTAETIGT") return true;
  if (twin.error) return false;
  if (Number(twin.toolRounds) >= 1) return true;
  const text = `${twin.befund || ""}\n${twin.content || ""}`;
  return evidenceOf(text, { root, whitelist }) !== null;
}

// Globale Variante der Datei:Zeile-Referenz für matchAll (Basis-Regex ohne /g
// wird für Einzel-Match genutzt — hier die identische Form als globale Kopie).
const EVIDENCE_FILE_LINE_G = new RegExp(EVIDENCE_FILE_LINE.source, "gi");

/**
 * Verifizierbare Datei:Zeile-Referenz im Text (Audit-Befund 10, 2026-09-01):
 * true, wenn MINDESTENS EINE Datei:Zeile-Referenz im Text real existiert
 * (Datei unter <root> auffindbar — case-insensitiv via resolveRel — UND die
 * Zeilennummer innerhalb der Datei liegt). Fantasie-Zeilen zählen nicht.
 */
function hasVerifiableFileLine(text, { root, cache }) {
  if (!root) return false;
  for (const m of String(text || "").matchAll(EVIDENCE_FILE_LINE_G)) {
    const file = m[1];
    if (!EVIDENCE_FILE_EXT.test(file)) continue;
    if (!resolveRel(root, file)) continue;
    const lineNo = Number(m[2]);
    const txt = cache instanceof Function ? cache(file) : fileTextCache(root, [])(file);
    if (txt && lineNo >= 1 && lineNo <= txt.split(/\r?\n/).length) return true;
  }
  return false;
}

/**
 * Zitiert die Zeile wörtlich aus einer realen Datei (Audit Pkt 8, 2026-09-01):
 * EVIDENCE_FILE_LINE verifiziert nur EXISTENZ (Datei + Zeilennummer im
 * Bereich) — ein halluzinierender Twin kann jede gültige Nummer angeben,
 * ohne die Zeile je gelesen zu haben. Die ZITAT-Verankerung schließt das:
 * eine Referenz „file:line" gilt nur als SEMANTISCH verankert, wenn der
 * Twin den Zeileninhalt als wörtliches Zitat trägt. Markierungsform
 * (eindeutig, nicht mit normalem Prosa-Syntax kollidierend):
 *   `file:line` → „exakter Zeilentext“
 * (Backtick-Referenz + Backtick-Zitat; das Zitat muss nach Whitespace-
 * Normalisierung dem echten Zeilentext entsprechen — kein
 * Copy-Rounding über mehrere Zeilen, keine Phantasie).
 * @returns {string|null} die verankerte Referenz „file:line" oder null
 */
export function anchoredFileLine(text, { root, whitelist = [], cache } = {}) {
  if (!root) return null;
  const read = cache instanceof Function ? cache : fileTextCache(root, whitelist);
  const t = String(text || "");
  // Zitat-Marker: `file:line` → „…“  (Backticks; Anführungszeichen DE/EN).
  const MARKER = /`([\w./-]+\.(?:jsx?|mjs|cjs|tsx?|py|json|md|sh|ps1|go|rs|java)):(\d+)(?:-\d+)?`\s*(?:→|->|:)?\s*(?:"([^"“”]{1,400})"|“([^”]{1,400})”|„([^“]{1,400})“|'([^'’]{1,400})'|’([^’]{1,400})’)/g;
  for (const m of t.matchAll(MARKER)) {
    const file = m[1];
    const lineNo = Number(m[2]);
    const quote = (m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? "").replace(/\s+/g, " ").trim();
    if (!quote) continue;
    if (!resolveRel(root, file)) continue; // Datei muss real sein
    const txt = read(file);
    if (!txt) continue;
    const lines = txt.split(/\r?\n/);
    if (lineNo < 1 || lineNo > lines.length) continue;
    const actual = lines[lineNo - 1].replace(/\s+/g, " ").trim();
    if (actual && actual === quote) return `${file}:${lineNo}`;
  }
  return null;
}

/**
 * Eigene Falsifikation statt Doppel-Plausibilisierung (Regel 6, Audit-Befund
 * 10, 2026-09-01): Ein Twin, der NUR die eingereichten Widerlegungen
 * nachliest und ihnen zustimmt, teilt sich mit dem Erstprüfer denselben
 * Blindspot — die Gegenprüfung ist dann keine ZWEITE Falsifikation. Eine
 * belastbare BESTAETIGT braucht deshalb NACHWEISBAR beides:
 *   1. eigenes Lesen (>= 1 Tool-Runde — read_file/list_dir/glob wirklich
 *      ausgefuehrt), UND
 *   2. mindestens EINE SEMANTISCH verankerte Referenz im EIGENEN
 *      Befund/Content: die Zeile wird wörtlich zitiert („`file:line` →
 *      „Zeilentext““) und das Zitat stimmt mit der REALen Datei überein
 *      (anchoredFileLine). Beweist, dass der Twin die Zeile tatsächlich
 *      gelesen hat — eine gültige Zeilennummer zu erraten reicht nicht
 *      mehr (Audit Pkt 8: Existenz-Verifikation ist nur syntaktisch).
 * Fail-closed: WIDERSPRUCH/UNKLAR/Fehler sind nicht pruefpflichtig (sie
 * verweigern die Freigabe ohnehin) bzw. blocken (twinEvidenceOk).
 * @returns {boolean} true = Freigabe belastbar, false = fail-closed zu PLAN
 */
export function twinOwnFalsificationOk(twin, { root = null, whitelist = [] } = {}) {
  if (!twin || twin.verdict !== "BESTAETIGT") return true;
  if (twin.error) return false;
  if (Number(twin.toolRounds) < 1) return false; // ohne eigenes Lesen keine Gegenprüfung
  const text = `${twin.befund || ""}\n${twin.content || ""}`;
  const cache = fileTextCache(root, whitelist);
  // Basis-Gate (Fantasie-Referenzen blocken, >=1 Referenz-Form) bleibt:
  if (!twinEvidenceOk(twin, { root, whitelist })) return false;
  // Semantische Verankerung (Pkt 8): die Zeile muss wörtlich ZITIERT sein.
  return anchoredFileLine(text, { root, whitelist, cache }) !== null;
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

/** Bekannte Datei-Endungen der Nachforderungs-Extraktion (keine Fantasie-Worte). */
const RESEARCH_ADD_EXT = /\.(?:js|mjs|cjs|ts|tsx|jsx|py|json|md|sh|ps1|css|html|sql|ya?ml|toml|txt|c|cpp|h|go|rs|java)$/i;

/**
 * UI-094 (dynamische Whitelist-Nachforderung): extrahiert aus einer
 * RESEARCH-Antwort die KONKRET benannten Dateien, die der Thinker fuer die
 * weitere Falsifikation lesen will. Diese werden als research_additions
 * persistiert und beim naechsten Submit automatisch in die Whitelist gemerged
 * (der Einreicher muss befundrelevante Module nicht mehr manuell nachziehen —
 * E2E-Befund 1, bislang Loesung per Konvention).
 *
 * Sicherheit (kein unbeschraenkter Zugriff, UI-094-VERIFY):
 *   - nur relative Pfade (kein Absolut-/Windows-Drive-/URL-Praefix, kein "..")
 *   - nur Pfade mit bekannter Datei-Endung
 *   - dedupliziert + gedeckelt (max, Default 20)
 *   - mit root: nur Dateien, die unter <root> tatsaechlich existieren
 * @returns {string[]}
 */
export function extractResearchAdditions(content, { root = null, max = 20 } = {}) {
  const text = String(content || "");
  const found = new Set();
  // Kandidaten: Pfad mit Verzeichnis-Separator ODER bare Datei mit Endung.
  // Grenze links: Start ODER Nicht-Wort-Zeichen — aber NICHT / \ : (sonst
  // wuerde "https://…" bzw. "C:\x\y.js" als relativ gelesen).
  const CAND = /(?:^|[^\w./\\:-])((?:[\w.-]+\/)+[\w.-]+\.\w{1,12}|[\w.-]+\.\w{1,12})/g;
  for (const m of text.matchAll(CAND)) {
    let p = (m[1] || "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!p || p.startsWith("/") || /^[A-Za-z]:/.test(p)) continue; // absolut / Drive
    if (p.split("/").includes("..")) continue;                     // Traversal
    if (!RESEARCH_ADD_EXT.test(p)) continue;                          // Fantasie-Worte
    if (root && !existsSync(path.join(root, p))) continue;            // muss real existieren
    found.add(p);
  }
  return [...found].slice(0, Math.max(1, Number(max) || 20));
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
