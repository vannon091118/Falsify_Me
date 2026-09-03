// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/handoff.mjs – versionierter externer Übergabe-Vertrag
// -----------------------------------------------------------------------------
// Der Handoff ist die EINZIGE Maschinensprache zwischen interner Prüfung
// (Thinker → Evil Twin → technisches Gate) und dem externen USER AGENT
// (dem einzigen Repository-Writer). Kein Freitext-Parsing, kein zweites
// Verdict: der Handoff BESCHREIBT die Freigabe, er autorisiert sie nicht
// selbst — die Autorisierung bleibt beim technischen Gate (core/probes.mjs
// computeVerdict), das der Handoff nur NACH bestandenem Gate erzeugt.
//
// Fail-closed: fehlende/unbekannte Felder, ungültige Enums, korrupte Probe-/
// Evidence-Daten, Korrelations-Widersprüche, Secrets oder THINKER-Reasoning
// machen den Handoff ungültig (SEC-001).
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";

export const HANDOFF_VERSION = 1;
const HANDOFF_STATES = Object.freeze(["WRITE_AUTHORIZED", "WAITING_FOR_AGENT"]);
const REQUIRED_ACTIONS = Object.freeze(["APPLY_WRITE"]);
const PROBE_STATUSES = Object.freeze(["BESTAETIGT", "WIDERSPRUCH", "UNKLAR"]);

// Pflichtfelder des kanonischen v1-Handoffs (TASK-006/TASK-008-Korrelation).
const REQUIRED_FIELDS = Object.freeze([
  "version", "handoff_id", "job_id", "scope_id", "parent_job_id", "checkout_id",
  "iteration_id", "verdict", "phase", "reasons", "probe_results", "twin_evidence",
  "required_action", "next_state", "before_snapshot", "allowed_files",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Verdichtet die technische Gate-Ausgabe in den kanonischen v1-Handoff.
 * Wird NUR nach bestandenem Gate aufgerufen (cli/run.mjs) — die Prosa des
 * Modells und parseVerdict() allein erzeugen niemals einen Handoff (REQ-007).
 */
export function buildHandoff({ jobId, scopeId, parentJobId = null, checkoutId, iterationId, verdict, phase, reasons = [], probeResults = [], twinEvidence = null, beforeSnapshot, allowedFiles = [] }) {
  return {
    version: HANDOFF_VERSION,
    handoff_id: `handoff-${sha256(`${jobId}:${iterationId}:${Date.now()}:${Math.random()}`).slice(0, 24)}`,
    job_id: jobId ?? null,
    scope_id: scopeId ?? null,
    parent_job_id: parentJobId ?? null,
    checkout_id: checkoutId ?? null,
    iteration_id: iterationId ?? null,
    verdict: String(verdict || "").toUpperCase(),
    phase: phase ?? null,
    reasons: (reasons || []).map((r) => String(r).slice(0, 500)),
    probe_results: (probeResults || []).map((p) => ({
      probe_id: p?.probe_id ?? null,
      requirement_ref: p?.requirement_ref ?? null,
      status: String(p?.status || "UNKLAR").toUpperCase(),
      evidenceOk: Boolean(p?.evidenceOk),
      reason: String(p?.reason || "").slice(0, 500),
    })),
    twin_evidence: twinEvidence
      ? { tool_rounds: Number(twinEvidence.tool_rounds) || 0, file_refs: (twinEvidence.file_refs || []).slice(0, 50) }
      : null,
    required_action: "APPLY_WRITE",
    next_state: "WRITE_AUTHORIZED",
    // before_snapshot ist der Content-Snapshot aus core/changes.mjs (keine
    // mtimes — nur Pfade + sha256 + Git-HEAD). Secrets kann er nicht tragen.
    before_snapshot: beforeSnapshot ?? null,
    allowed_files: [...(allowedFiles || [])],
  };
}

/**
 * Strikte v1-Validierung. Liefert { ok, reasons }. Jede Abweichung — fehlende
 * Felder, fremde Version, falsche Enums, nicht-bestandene Proben, Secrets/
 * Reasoning-Signaturen, Korrelations-Brüche — fail-closed (REQ-008, SEC-001).
 */
export function validateHandoff(handoff, { expected = {} } = {}) {
  const reasons = [];
  if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
    return { ok: false, reasons: ["Handoff ist kein Objekt"] };
  }
  const known = new Set(REQUIRED_FIELDS);
  for (const key of Object.keys(handoff)) {
    if (!known.has(key)) reasons.push(`Unbekanntes Feld: ${key}`);
  }
  for (const field of REQUIRED_FIELDS) {
    const value = handoff[field];
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
      // parent_job_id ist beim ersten Loop-Durchlauf erlaubt null.
      if (field === "parent_job_id" && handoff.parent_job_id === null) continue;
      reasons.push(`Pflichtfeld fehlt/leer: ${field}`);
    }
  }
  if (handoff.version !== HANDOFF_VERSION) reasons.push(`version muss ${HANDOFF_VERSION} sein`);
  if (handoff.verdict !== "WRITE") reasons.push(`verdict muss WRITE sein (ist: ${handoff.verdict})`);
  if (!HANDOFF_STATES.includes(handoff.next_state)) reasons.push(`next_state unbekannt: ${handoff.next_state}`);
  if (!REQUIRED_ACTIONS.includes(handoff.required_action)) reasons.push(`required_action unbekannt: ${handoff.required_action}`);
  if (handoff.next_state === "WRITE_AUTHORIZED" && handoff.required_action !== "APPLY_WRITE") {
    reasons.push("WRITE_AUTHORIZED erfordert required_action APPLY_WRITE");
  }
  if (!Array.isArray(handoff.probe_results) || handoff.probe_results.length === 0) {
    reasons.push("probe_results muss ein nicht-leeres Array sein");
  } else {
    for (const p of handoff.probe_results) {
      if (!p || typeof p !== "object") { reasons.push("probe_results-Eintrag ist kein Objekt"); continue; }
      if (!isNonEmptyString(p.probe_id)) reasons.push("probe_id fehlt");
      if (p.status !== "BESTAETIGT") reasons.push(`Probe ${p.probe_id} ist nicht BESTAETIGT (Freigabe unmöglich)`);
      if (p.evidenceOk !== true) reasons.push(`Probe ${p.probe_id} trägt keine verifizierte Evidence`);
    }
  }
  if (!Array.isArray(handoff.allowed_files) || handoff.allowed_files.length === 0) {
    reasons.push("allowed_files muss eine nicht-leere Liste sein");
  }
  // SEC-001: keine Key-Werte, keine Authorization-Header, kein THINKER-Reasoning.
  const blob = JSON.stringify(handoff).toLowerCase();
  if (/(authorization|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9]{16,}|api[_-]?key\s*[:=]\s*['"][a-z0-9])/.test(blob)) {
    reasons.push("Handoff enthält verdächtige Secret-/Header-Signaturen");
  }
  // Korrelation gegen erwartete Bindungen (vom Konsumenten vorgegeben).
  for (const [field, want] of Object.entries(expected)) {
    if (want !== undefined && want !== null && handoff[field] !== want) {
      reasons.push(`Korrelation fehlgeschlagen: ${field} = ${handoff[field]} (erwartet: ${want})`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** Kanonische Serialisierung (deterministisch, JSON) für Persistenz/Ausgabe. */
export function serializeHandoff(handoff) {
  return JSON.stringify(handoff, null, 2);
}

/**
 * RENDER CODER BRIEF (minimaler Twin→Coder-Übergabepunkt, RED-Fact-Finding
 * §14.133): verdichtet den BEREITS PERSISTIERTEN Handoff in die Arbeits-
 * anweisung für den externen Coding-Agent. Liest NUR aus dem Handoff —
 * erzeugt keine neue Wahrheit, keine Verdict-Hoheit, keinen Loop-Zustand:
 * der Coder konsumiert (REQ-004), FalsifyMe bleibt der einzige Owner von
 * Verdict (computeVerdict), Findings (SQLite) und Loop (artifacts/loops.mjs).
 * Pure: keine I/O, deterministisch aus dem Handoff ableitbar.
 *
 * @returns {{ok:true, brief:string} | {ok:false, reason:string}}
 */
export function renderCoderBrief(handoff) {
  const v = validateHandoff(handoff);
  if (!v.ok) return { ok: false, reason: `Handoff ungültig – kein Coder-Brief (fail-closed): ${v.reasons[0]}` };
  const lines = [];
  lines.push("# CODER-BRIEF (FalsifyMe-Freigabe v1)");
  lines.push("");
  lines.push(`Handoff: ${handoff.handoff_id}`);
  lines.push(`Job:     ${handoff.job_id}`);
  if (handoff.scope_id) lines.push(`Scope:   ${handoff.scope_id}`);
  lines.push(`Phase:   ${handoff.phase}`);
  lines.push("");
  lines.push("## Auftrag");
  lines.push("");
  lines.push("Die Falsifikation (Thinker + Evil Twin, Probe-Exekution mit echter");
  lines.push("Evidence) hat die Ausgangsbehauptung BESTÄTIGT. Du bist der einzige");
  lines.push("Writer: setze die freigegebene Änderung jetzt um — NUR in den");
  lines.push("unten gelisteten Dateien, ausgehend vom gelisteten Basiszustand.");
  lines.push("");
  lines.push("## Erlaubte Dateien (Whitelist — jede andere Änderung wird abgelehnt)");
  lines.push("");
  for (const f of handoff.allowed_files) lines.push(`- ${f}`);
  lines.push("");
  lines.push(`Basiszustand (before_digest): ${handoff.before_snapshot?.digest ?? "-"}`);
  if (handoff.before_snapshot?.git_head) lines.push(`Git-HEAD der Basis: ${handoff.before_snapshot.git_head}`);
  lines.push("");
  lines.push("## Falsifikations-Ergebnis (Evil Twin, Probe-Exekution)");
  lines.push("");
  for (const p of handoff.probe_results) {
    lines.push(`- [${p.status}] ${p.probe_id}${p.requirement_ref ? ` (${p.requirement_ref})` : ""}: ${p.reason || "-"}`);
  }
  if (handoff.twin_evidence) {
    lines.push("");
    lines.push(`Gegenprüfer-Evidence: ${handoff.twin_evidence.tool_rounds} Tool-Runde(n), ${handoff.twin_evidence.file_refs?.length ?? 0} Datei-Referenz(en).`);
  }
  if (Array.isArray(handoff.reasons) && handoff.reasons.length) {
    lines.push("");
    lines.push("## Befund (Thinker)");
    lines.push("");
    for (const r of handoff.reasons) lines.push(`- ${r}`);
  }
  lines.push("");
  lines.push("## Nach der Umsetzung (Pflicht)");
  lines.push("");
  lines.push("Melde die Änderung zurück, damit das Re-Review automatisch startet:");
  lines.push("");
  lines.push("Du musst die Report-Digests nicht von Hand bauen — FalsifyMe misst den");
  lines.push("Repo-Zustand selbst und füllt den Report vor (nur deine Absicht fehlt):");
  lines.push("");
  lines.push("  falsify handoff report --job-id <job-id> --root <projekt-root>");
  lines.push("          [--out report.json] [--writer-id <dein-id>]");
  lines.push("");
  lines.push("Dann den Report einreichen (Re-Review startet automatisch):");
  lines.push("");
  lines.push("  falsify handoff complete --file <report.json> --root <projekt-root>");
  lines.push("");
  lines.push("Report-Pflichtfelder: handoff_id, job_id, scope_id, checkout_id,");
  lines.push("writer_id, before_digest, after_digest, changed_files, diff_digest,");
  lines.push("write_status (COMPLETED|NO_CHANGE|ABORTED). FalsifyMe misst die");
  lines.push("Digests selbst nach — ein von Hand erfundener Report ist wertlos;");
  lines.push("NO_CHANGE und Änderungen außerhalb der Whitelist beenden den Loop");
  lines.push("fail-closed (LOOP_BLOCKED) statt ein Re-Review zu starten.");
  return { ok: true, brief: lines.join("\n") };
}


