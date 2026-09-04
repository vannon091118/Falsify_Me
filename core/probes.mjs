// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/probes.mjs – Probe-Vertrag (strukturierte Prüfaufträge)
// -----------------------------------------------------------------------------
// P0-Cutover „Probe-basierte WRITE-Entscheidung“ (Revision 5, 2026-09-02):
// Prosa-Evidenz (hasChallengeEvidence) suchte Evidenz im Fließtext – Form-Slop
// passierte das Gate. Ersetzt durch ein strukturiertes Protokoll:
//
//   Thinker   erzeugt ein Probe-Set (requirement_ref = Original-H_i-IDs aus
//             splitRequirement des HEADER-/Anforderungstexts, 1:1-Spans)
//   Validator validateProbeSet – NUR formal/strukturell: Schema, requirement_ref
//             ∈ H1..Hn (keine Paraphrase), Coverage (jede H_i ≥ 1 Probe),
//             Target existiert & in Root+Whitelist, Anti-Vakuum-Minima
//             (Müllfilter, KEIN Qualitätsbeweis), keine Doppel-IDs, Enum.
//   Twin      führt JEDE Probe aus (core/twin.mjs runProbeExecution) und
//             liefert je Probe { probe_id, status, evidence } mit
//             status ∈ BESTAETIGT | WIDERSPRUCH | UNKLAR (semantische
//             Ausführbarkeit – der Twin ist der EINZIGE Semantik-Exekutor).
//   Gate      computeVerdict entscheidet NUR aus Resultaten + Evidence +
//             bestehenden harten Gates → WRITE | PLAN (fail-closed).
//
// Schichten-Trennung (unverhandelbar): Der Validator beweist KEINE
// linguistische Qualität; parseVerdict-WRITE ist nur Kandidat – Release NUR
// über das voll bestätigte Probe-Set. Der Header-Anker ist nicht intelligent,
// aber ehrlich: vager Ein-Satz-Header → H1 (mit ≥ 1 Probe Coverage-erfüllt).
// Reine Funktionen + read-only Existenzprüfungen; kein DB-Zugriff, kein
// Schreiben, keine Verdict-Hoheit außer dieser einen WRITE/PLAN-Funktion.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { twinEvidenceOk, twinOwnFalsificationOk } from "./twin-evidence.mjs";

/** Erlaubte Probe-Klassen (Enum – unbekannte Werte invalidieren die Probe). */
export const PROBE_CLASSES = Object.freeze([
  "claim-check",   // Vertrag/Verhalten: behauptetes Verhalten wird geprüft
  "edge-case",     // Grenzen und unerwartete Eingaben (leer, null, extrem, dupliziert)
  "regression",    // Bestehendes Verhalten bricht; Caller/API-/Schema-Verträge
  "security",      // Injection, Pfad-Traversal, Secrets, AuthZ-Lücken, unsichere Defaults
  "contract",      // API-/Schema-/Aufrufer-Verträge über die Iteration hinaus
]);

/** ProbeResult-Statuswerte des Twin – NUR BESTAETIGT trägt eine Freigabe. */
export const PROBE_STATUSES = Object.freeze(["BESTAETIGT", "WIDERSPRUCH", "UNKLAR"]);

/** Tail-Merge-Kappe: mehr Einheiten werden an die letzte kappt-Einheit gemerged. */
export const TAIL_MERGE_CAP = 12;

/** Anti-Vakuum-Minima (Müllfilter – niemals ein Qualitätsbeweis, P0-Regel 3). */
export const CLAIM_MIN = 16;
export const CHECK_MIN = 24;

// ── Requirement-Splitter: HEADER/Anforderungstext → H1..Hn (Original-Spans) ──

const SENTENCE_END = new Set([".", "!", "?"]);
// Abkürzungen, die KEIN Satzende sind (kleingeschrieben verglichen, ≤ 4 Zeichen).
const ABBREVIATIONS = new Set([
  "z", "b", "zb", "d", "dh", "e", "g", "eg", "i", "ie", "etc", "usw", "vgl",
  "ca", "ff", "vs", "sog", "insb", "inkl", "mind", "abs", "nr", "art", "u",
  "ua", "s", "ggf", "evtl", "bzw",
]);

/** True, wenn der Punkt-Token ein Listenmarker ("1.") oder eine Abkürzung ist. */
function markerOrAbbrev(token) {
  const t = token.trim();
  if (/^\d{1,4}\.$/.test(t)) return true;                 // Listenmarker "1." / "12."
  const lastWord = t.split(/\s+/).pop() ?? "";
  const bare = lastWord.replace(/\.+$/, "").toLowerCase();
  return bare.length > 0 && bare.length <= 4 && ABBREVIATIONS.has(bare);
}

/** Eine Zeile → Einheiten an Satzenden und Semikolons (Punkt bleibt im Span). */
function splitLine(line) {
  const out = [];
  let cur = "";
  const push = () => { const t = cur.trim(); if (t) out.push(t); cur = ""; };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    cur += ch;
    if (ch === ";") { push(); continue; }
    if (SENTENCE_END.has(ch)) {
      const next = line[i + 1];
      if (next === undefined || /\s/.test(next)) {
        if (ch === "." && markerOrAbbrev(cur)) continue;  // "z. B." / "1." trennen nicht
        push();
      }
    }
  }
  push();
  return out;
}

const isMeaningful = (u) => u.length >= 3 && /\w/.test(u);

/**
 * Zerlegt den Anforderungstext deterministisch in Prüfeinheiten H1..Hn.
 * Grenzen: Satzenden (./!/? + Whitespace), Semikolons, Aufzählungs- und
 * Zeilengrenzen. Original-Spans bleiben 1:1 erhalten (keine Paraphrase).
 * Mini-Fragmente ("z.", "1.", Killer-Reste) werden vorwärts an die nächste
 * Einheit gemerged (rückwärts am Ende). Mehr als TAIL_MERGE_CAP Einheiten
 * werden an die letzte Einheit angehangen (Tail-Merge-Kappe).
 * Vager Ein-Satz-Header → genau H1 (Coverage mit ≥ 1 Probe erfüllbar).
 * @param {string} source HEADER (User-Input 1:1) oder Plan-Text (Direkt-Run)
 * @returns {{id: string, text: string}[]}
 */
export function splitRequirement(source) {
  const text = String(source || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const units = [];
  for (const rawLine of text.split("\n")) {
    for (const seg of splitLine(rawLine.trim())) units.push(seg);
  }
  // Mini-Fragmente vorwärts mergen (rückwärts am Ende); Reihenfolge stabil.
  const merged = [];
  let pending = "";
  for (const u of units) {
    if (isMeaningful(u)) {
      merged.push(pending ? `${pending} ${u}` : u);
      pending = "";
    } else {
      pending = pending ? `${pending} ${u}` : u;
    }
  }
  if (pending) {
    if (merged.length) merged[merged.length - 1] += ` ${pending}`;
    else merged.push(pending.trim());
  }
  // Fallback: nichts Zerlegbares (z. B. reine Symbole) → ganzer Text als H1.
  if (!merged.length) return text ? [{ id: "H1", text }] : [];
  // Tail-Merge-Kappe: der Rest wandert deterministisch an die letzte Einheit.
  const capped = merged.length > TAIL_MERGE_CAP
    ? [...merged.slice(0, TAIL_MERGE_CAP - 1), merged.slice(TAIL_MERGE_CAP - 1).join(" ")]
    : merged;
  return capped.map((t, i) => ({ id: `H${i + 1}`, text: t }));
}

/** 1:1-Span-Form einer Prüfeinheit (Referenz-Form für Prompt + Twin). */
export function spanOf(requirement) {
  return `<${requirement.id}>${requirement.text}</${requirement.id}>`;
}

/** Alle H_i-Spans als Liste (Prompt-Abschnitt + Twin-Kontext). */
export function renderRequirementList(requirements) {
  return requirements.map(spanOf).join("\n");
}

// ── Probe-Set-Extraktion (Thinker-Antwort → JSON-Objekt) ─────────────────────

/**
 * Extrahiert das Probe-Set aus der Thinker-Antwort: der LETZTE ```json-Fence
 * mit "probes"-Schlüssel. Kein Fence / kaputtes JSON / kein Array → ok:false
 * (fail-closed: WRITE ohne gültiges Probe-Set wird deterministisch PLAN).
 * @param {string} content
 * @returns {{ok: boolean, probes: any[], error: string|null}}
 */
export function parseProbeSet(content) {
  const text = String(content || "");
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((m) => m[1])
    .filter((b) => /"probes"\s*:/.test(b));
  if (!fences.length) {
    return { ok: false, probes: [], error: "kein ```json-Probe-Set-Block mit \"probes\" gefunden" };
  }
  try {
    const data = JSON.parse(fences[fences.length - 1]);
    if (!data || !Array.isArray(data.probes)) {
      return { ok: false, probes: [], error: "Probe-Set ohne probes-Array" };
    }
    return { ok: true, probes: data.probes, error: null };
  } catch (e) {
    return { ok: false, probes: [], error: `Probe-Set-JSON kaputt: ${e.message}` };
  }
}

// ── Validator (NUR formal/strukturell – keine Semantik, keine Qualität) ──────

/** Lob-/Zustimmungs-Vokabular im claim → invalid (Müllfilter, P0-Regel 3). */
const PRAISE = new RegExp(
  [
    "(?:ist|sieht|wirkt|bleibt|looks?|seems?)\\s+(?:korrekt|correct|gut|good|fine|ok|okay|sauber|solid|richtig|right|clean)",
    "(?:keine|no)\\s+(?:fehler|errors?|probleme|problems?|issues?|bugs?|l\\u00fccken|gaps?|m\\u00e4ngel|defects?|schw\\u00e4chen|vulnerabilit(?:y|ies))(?:\\s+(?:gefunden|found|vorhanden|present|detected|here|at\\s+all))?",
    "alles\\s+(?:korrekt|correct|gut|good|in\\s+ordnung)",
    "all\\s+good|nothing\\s+wrong|no\\s+concerns?",
    // bestätig*-Familie (Live-E2E 2026-09-04): echte Selbst-Bestätigung ist Lob
    // („Ich/Wir bestätigen …“, „Bestätigt:“). KEIN Lob ist der legitime
    // Prüfauftrag „… Tests, die bestätigen, dass X rendert / dass Y nicht
    // rendert“ – deshalb Wortgrenzen (kein Substring-Treffer im Infinitiv
    // „bestätigen“) UND eine dass-Objektklausel-Ausnahme.
    "(?:^|[\\s,])(?:ich|wir)\\s+bestätig(?:e|en|st|te|ten|tet)\\b",
    "\\bbestätig(?:e|st|t|te|ten|tet)\\b(?!\\s*[.,]?\\s+dass\\b)",
    "\\bbestaetig(?:e|st|t|te|ten|tet)\\b(?!\\s*[.,]?\\s+dass\\b)",
    "confirmed\\s+correct",
    "funktioniert\\s+(?:alles|fehlerfrei|einwandfrei)",
    "works\\s+(?:perfectly|as\\s+expected|fine)",
    "passt\\s+alles|well\\s+done|sauber\\s+umgesetzt|kein\\s+befund",
  ].join("|"),
  "i",
);

/**
 * Read-only Existenzprüfung unter dem Root (Semantik wie core/tools.mjs /
 * evidence.mjs resolveRel: exakter Pfad, sonst case-insensitiver Segment-Walk).
 */
function resolveUnderRoot(root, rel) {
  try {
    const exact = path.join(root, rel);
    if (fs.existsSync(exact)) return exact;
    let cur = path.resolve(root);
    for (const part of rel.split("/").filter(Boolean)) {
      const entry = fs.readdirSync(cur, { withFileTypes: true })
        .find((e) => e.name.toLowerCase() === part.toLowerCase());
      if (!entry) return null;
      cur = path.join(cur, entry.name);
    }
    return fs.existsSync(cur) ? cur : null;
  } catch { return null; }
}

/**
 * Target-Härte: relativ, kein ..-Ausbruch, existiert unter Root, und (bei
 * Whitelist-Vertrag) in der Zugriffs-Whitelist (gleiche Lesart wie
 * core/tools.mjs checkWhitelist: exakt oder unterhalb eines Eintrags).
 * @returns {string|null} Problem-Beschreibung oder null wenn ok
 */
function checkTarget(target, { root, whitelist }) {
  if (!target) return "fehlt";
  if (path.isAbsolute(target)) return "ist ein absoluter Pfad (nur relative Pfade unter dem Root)";
  const parts = target.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.includes("..")) return "verlässt das Zielprojekt (..)";
  const rel = parts.join("/");
  if (root && !resolveUnderRoot(root, rel)) return `existiert nicht unter dem Root: ${rel}`;
  if (Array.isArray(whitelist) && whitelist.length) {
    const norm = rel.toLowerCase();
    const ok = whitelist.some((w) => {
      const n = String(w).replace(/\\/g, "/").toLowerCase();
      return norm === n || norm.startsWith(`${n}/`);
    });
    if (!ok) return `ist nicht in der Zugriffs-Whitelist: ${rel}`;
  }
  return null;
}

/**
 * Validiert ein Probe-Set NUR formal/strukturell (Schichten-Trennung: hier
 * entsteht KEINE semantische/linguistische Aussage – dafür sind Twin und Gate
 * zuständig). Coverage-Härte: jede H_i braucht ≥ 1 Probe, sonst ok:false
 * (deterministisch PLAN – keine „nicht prüfbar“-Ausnahme).
 * @param {any[]} probes              geparste Probe-Objekte (parseProbeSet)
 * @param {Object} o
 * @param {string} o.requirementSource HEADER (Scope) oder Plan-Text (Direkt-Run)
 * @param {string} [o.root]           Arbeitsverzeichnis (Target-Existenz)
 * @param {string[]} [o.whitelist]    Zugriffs-Whitelist (Target-Härte)
 * @returns {{ok: boolean, reasons: string[], probes: any[]}} probes = die
 *   formal gültigen Proben (nur relevant, wenn ok)
 */
export function validateProbeSet(probes, { requirementSource, root = null, whitelist = [] } = {}) {
  const reasons = [];
  const requirements = splitRequirement(requirementSource);
  if (!Array.isArray(probes) || probes.length === 0) {
    return { ok: false, reasons: ["Probe-Set leer oder kein Array"], probes: [] };
  }
  const validRefs = new Set(requirements.map((r) => r.id));
  const covered = new Set();
  const seen = new Set();
  const valid = [];
  probes.forEach((p, i) => {
    const where = `Probe[${i}]`;
    let probeInvalid = false;
    const mark = (msg) => { reasons.push(`${where}: ${msg}`); probeInvalid = true; };
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      mark("kein Probe-Objekt");
      return;
    }
    const id = String(p.id ?? "").trim();
    if (!id) mark("id fehlt");
    else if (seen.has(id)) mark(`doppelte id "${id}"`);
    else seen.add(id);
    const ref = String(p.requirement_ref ?? "").trim();
    if (!validRefs.has(ref)) {
      mark(`requirement_ref "${ref}" ist keine Original-Anforderungs-ID (nur H1..H${requirements.length}, keine Paraphrase)`);
    } else {
      covered.add(ref);
    }
    const cls = String(p.class ?? "").trim();
    if (!PROBE_CLASSES.includes(cls)) {
      mark(`unbekannte class "${cls}" (erlaubt: ${PROBE_CLASSES.join(", ")})`);
    }
    const target = String(p.target ?? "").trim();
    const targetProblem = checkTarget(target, { root, whitelist });
    if (targetProblem) mark(`target ${targetProblem}`);
    const claim = String(p.claim ?? "").trim();
    if (claim.length < CLAIM_MIN) mark(`claim zu kurz (Anti-Vakuum-Minimum ${CLAIM_MIN} Zeichen)`);
    else if (PRAISE.test(claim)) mark("claim ist Bestätigungs-/Lob-Formulierung (Proben sind Prüfaufträge, keine Urteile)");
    const check = String(p.check ?? "").trim();
    if (check.length < CHECK_MIN) mark(`check zu kurz (konkrete ausführbare Prüfanweisung, Minimum ${CHECK_MIN} Zeichen)`);
    if (!probeInvalid) valid.push({ id, requirement_ref: ref, class: cls, target, claim, check });
  });
  // Coverage-Härte (P0-Regel 1): jede H_i ≥ 1 Probe – sonst PLAN, keine Ausnahme.
  for (const r of requirements) {
    if (!covered.has(r.id)) {
      const short = r.text.length > 60 ? `${r.text.slice(0, 60)}…` : r.text;
      reasons.push(`Coverage: ${r.id} hat keine Probe (${short})`);
    }
  }
  return { ok: reasons.length === 0, reasons, probes: valid };
}

// ── Evidence-Gate pro Probe (bestehende Regel-6-Semantik, pro Probe angewendet)

/**
 * Wendet die bestehende Evidence-Semantik (twinEvidenceOk +
 * twinOwnFalsificationOk) auf EIN einzelnes ProbeResult an: eine BESTAETIGT-
 * Probe braucht nachgewiesenes eigenes Lesen (host-aufgezeichnete Tool-Runden)
 * UND eine verifizierbare eigene Referenz im Evidence-Text; Zitat-Aussagen
 * (`datei:zeile` → „…“) müssen wörtlich stimmen (anchoredFileLine).
 * WIDERSPRUCH/UNKLAR sind nicht pruefpflichtig (verweigern ohnehin).
 * @param {{probe_id: string, status: string, evidence: string}} result
 * @param {{error: string|null, toolRounds: number, toolEvidence: any[]}} twinRun
 * @param {{root: string, whitelist: string[]}} opts
 * @returns {boolean}
 */
export function probeEvidenceOk(result, twinRun, opts = {}) {
  if (result?.status !== "BESTAETIGT") return true;
  const asTwin = {
    verdict: "BESTAETIGT",
    error: twinRun?.error ?? null,
    toolRounds: twinRun?.toolRounds ?? 0,
    toolEvidence: twinRun?.toolEvidence ?? [],
    befund: result?.evidence ?? "",
    content: result?.evidence ?? "",
  };
  return twinEvidenceOk(asTwin, opts) && twinOwnFalsificationOk(asTwin, opts);
}

// ── Deterministisches Gate (die EINZIGE WRITE-Quelle des Cutovers) ───────────

/**
 * P0-Gate: entscheidet NUR aus Resultaten + Evidence + bestehenden harten
 * Gates (Schichten-Trennung: keine Probe-Logik in core/verdict.mjs).
 *
 *   1. Probe-Set geparst + formal gültig (Coverage H1..Hn, Müllfilter)? sonst PLAN
 *   2. Twin ausgeführt (vollständiges ProbeResult[])?                   sonst PLAN
 *   3. Jede Pflicht-Probe BESTAETIGT?                                   sonst PLAN
 *   4. Jede Bestätigung mit gültiger Evidence (evidenceOk)?             sonst PLAN
 *   5. Harte Gates grün (structural, Divergenz-Anker, Dateien während
 *      der Prüfung unverändert)?                                        sonst PLAN
 *   → WRITE (Exit 0 über exitCodeOf; Verdict in den bestehenden Review-Commit)
 *
 * Fail-closed: alles andere ist PLAN mit Grundliste. Keine „nicht prüfbar“-
 * Ausnahme, kein Override.
 * @param {Object} o
 * @param {string|null} [o.parseError]       parseProbeSet-Fehler (WRITE ohne Probe-Set)
 * @param {{ok: boolean, reasons: string[], probes: any[]}|null} [o.validation]
 * @param {Array<{probe_id: string, status: string, evidence?: string, evidenceOk?: boolean}>|null} [o.results]
 * @param {string[]} [o.structuralBlocks]    feasibility-Blocker (Regel 5)
 * @param {string|null} [o.divergence]       SCOPE-DIVERGENZ-Anker (Regel 7)
 * @param {boolean} [o.filesUnchanged]       Whitelist-Dateien während der Prüfung unverändert
 * @returns {{verdict: "WRITE"|"PLAN", reasons: string[]}}
 */
export function computeVerdict({ parseError = null, validation = null, results = null, structuralBlocks = [], divergence = null, filesUnchanged = true } = {}) {
  const reasons = [];
  // 1) Probe-Set gültig? Ohne validierte Probe-Liste gibt es keine
  // autorisierte Ergebnis-Menge, selbst wenn der Twin formal Ergebnisse liefert.
  if (parseError) reasons.push(`Probe-Set unlesbar: ${parseError}`);
  if (!validation?.ok) {
    if (validation?.reasons?.length) {
      for (const r of validation.reasons) reasons.push(`Probe-Set: ${r}`);
    } else {
      reasons.push("Probe-Set nicht validiert (keine autorisierte Probe-Liste)");
    }
  }
  // 2) Twin ausgeführt (vollständiges ProbeResult[])?
  if (!parseError && (!Array.isArray(results) || results.length === 0)) {
    reasons.push("Gegenprüfung fehlgeschlagen: kein ProbeResult geliefert (Twin nicht ausgeführt)");
  }
  if (Array.isArray(results) && results.length) {
    const expected = new Set(validation?.ok ? validation.probes.map((p) => p.id) : []);
    const seen = new Set();
    for (const r of results) {
      const probeId = String(r?.probe_id ?? "").trim();
      if (!probeId) {
        reasons.push("ProbeResult ohne probe_id (→ UNKLAR)");
        continue;
      }
      if (seen.has(probeId)) {
        reasons.push(`Probe ${probeId}: doppeltes ProbeResult (→ UNKLAR)`);
      } else {
        seen.add(probeId);
      }
      if (validation?.ok && !expected.has(probeId)) {
        reasons.push(`Probe ${probeId}: unbekannte probe_id (nicht im validierten Probe-Set)`);
      }
    }
    if (validation?.ok) {
      for (const p of validation.probes) {
        if (!seen.has(p.id)) reasons.push(`Probe ${p.id}: fehlt im ProbeResult (→ UNKLAR)`);
      }
    }
    // 3) Jede Pflicht-Probe BESTAETIGT? 4) Jede Bestätigung mit gültiger Evidence?
    for (const r of results) {
      const probeId = String(r?.probe_id ?? "?").trim() || "?";
      if (r?.status !== "BESTAETIGT") {
        const ev = r?.evidence ? ` – ${String(r.evidence).slice(0, 120)}` : "";
        reasons.push(`Probe ${probeId}: ${r?.status ?? "UNBEKANNT"}${ev}`);
      } else if (r?.evidenceOk !== true) {
        reasons.push(`Probe ${probeId}: BESTAETIGT ohne explizit bestätigte Evidence (kein eigenes Lesen/keine verifizierte Referenz nachgewiesen)`);
      }
    }
  }
  // 5) Bestehende harte Gates.
  if (Array.isArray(structuralBlocks) && structuralBlocks.length) {
    reasons.push(`Strukturelle Kohärenz: ${structuralBlocks[0]}${structuralBlocks.length > 1 ? ` (+${structuralBlocks.length - 1} weitere)` : ""}`);
  }
  if (divergence) reasons.push(`SCOPE-DIVERGENZ: ${String(divergence).slice(0, 120)}`);
  if (filesUnchanged === false) reasons.push("Dateien wurden während der Prüfung verändert (Gate: Prüf-Basis unverändert)");
  return { verdict: reasons.length ? "PLAN" : "WRITE", reasons };
}
