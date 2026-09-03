// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/protocols.mjs – strukturierte 10X-Protokoll-Validatoren
// -----------------------------------------------------------------------------
// CHANGE_GATE_10X (A1..A10) und FALSIFICATION_RECORD_10X (F1..F10) sind hier
// erstmals RUNTIME-Gates (vorher nur Prompt-/Doku-Vertrag). Sie liefern NUR
// Validität + Evidenz-Prüfung — KEIN Verdict, KEINE Queue (RISK-005): die
// Freigabe-Entscheidung bleibt ausschließlich beim bestehenden finalen Gate
// (core/probes.mjs computeVerdict + cli/run.mjs), das diese Resultate als
// weitere harte Hürde einbezieht (TASK-017).
//
// Fail-closed: fehlende Felder, Fantasie-Pfade/Zeilen (nicht im Root vorhanden
// bzw. Zeile existiert nicht), widersprüchliche Ergebnisse oder ungestützte
// JA/Proof/Test-Behauptungen machen das Protokoll ungültig.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";

const CHANGE_GATE_FIELDS = Object.freeze(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"]);
const FALSIFICATION_FIELDS = Object.freeze(["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Prüft Datei:Zeile-Referenzen ("path/to/file.ts:42") gegen Root und Whitelist.
 * Fantasie-Symbole/Pfade/Zeilen failen (SEC-002). Returns Array von Gründen.
 */
function verifyAnchoredRefs(text, { root, whitelist = null } = {}) {
  const reasons = [];
  const refs = String(text || "").match(/[^\s`'"(]*[^\s`'"():]*\.?[A-Za-z0-9_./\\-]+\.(mjs|js|ts|md|json|sh|ps1|py):\d+/g) || [];
  for (const ref of refs) {
    const clean = ref.replace(/[.,;)]+$/, "");
    const m = clean.match(/^(.*?):(\d+)$/);
    if (!m) continue;
    const rel = m[1].replace(/^\.\//, "").replace(/\\/g, "/");
    const lineNo = Number(m[2]);
    const abs = path.resolve(root, rel);
    const relNorm = path.relative(path.resolve(root), abs).replace(/\\/g, "/");
    if (!relNorm || relNorm.startsWith("../") || path.isAbsolute(relNorm)) {
      reasons.push(`Referenz verlässt den Root: ${clean}`);
      continue;
    }
    if (whitelist && whitelist.length && !whitelist.map((w) => String(w).replace(/\\/g, "/")).includes(relNorm)) {
      reasons.push(`Referenz außerhalb der Whitelist: ${clean}`);
      continue;
    }
    let content;
    try { content = fs.readFileSync(abs, "utf8"); }
    catch { reasons.push(`Referenz-Datei existiert nicht: ${clean}`); continue; }
    const lineCount = content.split(/\r?\n/).length;
    if (!(lineNo >= 1 && lineNo <= lineCount)) {
      reasons.push(`Referenz-Zeile existiert nicht (${relNorm}:${lineNo}, Datei hat ${lineCount} Zeilen)`);
    }
  }
  return reasons;
}

/**
 * Validiert einen CHANGE_GATE_10X-Record: alle A1..A10 müssen JA sein, jedes
 * mit Proof + Test. JA ohne substanziellen Proof/Test failt.
 */
export function validateChangeGate(record, { root, whitelist = null } = {}) {
  const reasons = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, reasons: ["CHANGE_GATE_10X ist kein Objekt"] };
  }
  for (const field of CHANGE_GATE_FIELDS) {
    const entry = record[field];
    if (!entry || typeof entry !== "object") {
      reasons.push(`${field} fehlt (Objekt mit answer/proof/test erwartet)`);
      continue;
    }
    const answer = String(entry.answer || "").trim().toUpperCase();
    if (answer !== "JA") {
      reasons.push(`${field} ist nicht JA (${answer || "leer"}) — Blockierung zwingend`);
      continue;
    }
    if (!isNonEmptyString(entry.proof) || entry.proof.trim().length < 10) {
      reasons.push(`${field}: JA ohne substanziellen Proof (<10 Zeichen)`);
    }
    if (!isNonEmptyString(entry.test) || entry.test.trim().length < 5) {
      reasons.push(`${field}: JA ohne reproduzierbaren Test`);
    }
  }
  if (reasons.length === 0) {
    // Evidenz-Verankerung: Datei:Zeile-Referenzen im Proof müssen real sein.
    const proofs = CHANGE_GATE_FIELDS.map((f) => String(record[f]?.proof || "")).join("\n");
    reasons.push(...verifyAnchoredRefs(proofs, { root, whitelist }));
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Validiert einen FALSIFICATION_RECORD_10X-Record: alle F1..F10 füllen,
 * F6 (Evidence) braucht eine verifizierbare Datei:Zeile-/Pfad-Referenz,
 * F8 (Unexamined area) und F9 (Residual risk) dürfen nicht geleugnet werden
 * („keine“/leer failt), F10 braucht eine begründete Entscheidung.
 */
export function validateFalsificationRecord(record, { root, whitelist = null } = {}) {
  const reasons = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, reasons: ["FALSIFICATION_RECORD_10X ist kein Objekt"] };
  }
  for (const field of FALSIFICATION_FIELDS) {
    if (!isNonEmptyString(record[field])) {
      reasons.push(`${field} fehlt oder ist leer`);
    }
  }
  if (reasons.length) return { ok: false, reasons };
  // F6 braucht echte verifizierbare Referenzen (keine Fantasie-Evidenz).
  const f6Refs = verifyAnchoredRefs(String(record.F6), { root, whitelist });
  const f6HasPathRef = /[A-Za-z0-9_./\\-]+\.(mjs|js|ts|md|json|sh|ps1|py):\d+/.test(String(record.F6));
  if (!f6HasPathRef) reasons.push("F6 (Evidence) enthält keine Datei:Zeile-Referenz");
  reasons.push(...f6Refs);
  // F8/F9: Ehrlichkeit erzwingen — „keine“ als pauschale Abwiegelform failt.
  if (/^(keine|none|nichts|n\/a|-)$/i.test(String(record.F8).trim())) {
    reasons.push("F8 (Unexamined area) darf nicht pauschal 'keine' sein");
  }
  if (/^(keine|none|nichts|n\/a|-)$/i.test(String(record.F9).trim())) {
    reasons.push("F9 (Residual risk) darf nicht pauschal 'keine' sein");
  }
  // F10 braucht eine klare Entscheidung (WRITE oder Blockade-Begründung).
  if (!/^(WRITE|BLOCKED|HINDERNIS)/i.test(String(record.F10).trim())) {
    reasons.push("F10 (Release decision) braucht WRITE oder eine explizite Blockade-Begründung");
  }
  return { ok: reasons.length === 0, reasons };
}


