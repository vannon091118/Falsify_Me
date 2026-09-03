// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/feasibility.mjs – Umsetzbarkeits-Puffer (Intent → Execution)
// -----------------------------------------------------------------------------
// Deterministischer, read-only Check VOR jedem API-Call (Falsifikations-Modul,
// UI-078 revidiert). Der Scope-Header (= gesendeter User-Input 1:1, der
// Intent) ist der Anker; der eingereichte Plan/diff wird gegen die REALITAET
// (Dateien unter root, Whitelist) geprueft.
// Ergebnis: { feasible, blocks[], findings[] } – die Hinweise gehen als
// KONTEXT an den Falsifikations-Agent (Thinker), der die Ausgangsbehauptungen des USER AGENT
// selbst falsifiziert. Dieser Check erteilt KEIN Verdict und schliesst KEINEN
// Job (kein jobDone/addFinding) – Verdict-Hoheit liegt ausschliesslich beim
// unabhängigen Betrachter (Modellpfad). RESEARCH bleibt ein
// Falsifikations-Modul der Datenbeschaffung, nie ein Urteil dieses Pre-Checks.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";

/** Severity-Typen (Paritaet zu tui/state.mjs-Findings). */
export const SEV = { CRITICAL: "critical", WARNING: "warning", INFO: "discovered" };

/**
 * Prueft die Umsetzbarkeit einer Einreichung gegen Intent + Realitaet.
 * Reine Funktion: Verzeichnisexistenz via injizierbarem fsLayer (Tests).
 *
 * @param {Object} o
 * @param {string} [o.header]     Scope-Header = User-Input 1:1 (Intent-Anker)
 * @param {string} o.planText     eingereichter Plan-/Iterations-Text
 * @param {string} o.root         Arbeitsverzeichnis (Aufloesung gegen Realitaet)
 * @param {string[]} [o.whitelist] Zugriffs-Whitelist des Jobs
 * @param {boolean} [o.hasDiff]   true: WRITE-Review (diff vorliegend) – auch
 *                                dann muessen die Whitelist-Dateien existieren
 * @returns {{feasible:boolean, blocks:string[], findings:{severity:string,text:string}[]}}
 */
export function checkFeasibility({ header, planText, root, whitelist = [], hasDiff = false, diffText = null } = {}) {
  const blocks = [];
  const findings = [];
  const base = path.resolve(root || process.cwd());
  const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
  const norm = (p) => String(p || "").replace(/^\/|\\/g, "").replace(/\\/g, "/").replace(/^\.\//, "");
  const whitelistSet = new Set(whitelist.map(norm).filter(Boolean));

  // ── (0b) Strukturelle Kohärenz (Regel 5): Diff ────────────────────────────
  // Berührte Dateien aus dem Diff – müssen im Zugriffsrahmen liegen, sonst
  // ist die Einreichung selbst widersprüchlich (sie ändert, was sie nicht
  // ändern darf). Kein Verdict-Steuerwort (E2E-Befund 3).
  const diffFiles = [];
  if (diffText && String(diffText).trim()) {
    for (const m of String(diffText).matchAll(/^[+-]{3} [ab]\/(.+)$/gm)) {
      const f = norm(m[1]);
      if (f && f !== "dev/null" && !diffFiles.includes(f)) diffFiles.push(f);
    }
    for (const m of String(diffText).matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
      const f = norm(m[2]);
      if (f && !diffFiles.includes(f)) diffFiles.push(f);
    }
    const outside = diffFiles.filter((f) => !whitelistSet.has(f));
    if (outside.length) {
      blocks.push(`Der Diff verändert Dateien ausserhalb des Zugriffsrahmens: ${outside.join(", ")} – diese Dateien herausnehmen oder den Zugriffsrahmen anpassen, bevor erneut eingereicht wird.`);
    }
  }

  // ── (1) Plan vorhanden ─────────────────────────────────────────────────────
  if (!planText || !String(planText).trim()) {
    blocks.push("Kein Plan übergeben – ohne Plan gibt es nichts zu prüfen (Plan einreichen).");
    return { feasible: false, blocks, findings };
  }

  // ── (4) Pfadsicherheit in der Whitelist: ..-Traversal / absolute Pfade ────
  for (const f of whitelist) {
    if (f.startsWith("..") || f.includes("/../") || f.includes("\\..\\") || path.isAbsolute(f)) {
      blocks.push(`Whitelist-Eintrag verlässt das Arbeitsverzeichnis: ${f} (nur relative Pfade unter root).`);
    }
  }

  // ── (2) Whitelist-Dateien muessen unter root EXISTIEREN ───────────────────
  const missingWhitelist = [];
  for (const f of whitelist) {
    const abs = path.resolve(base, f);
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      blocks.push(`Whitelist-Eintrag ausserhalb von root: ${f}`);
      continue;
    }
    if (!exists(abs)) missingWhitelist.push(f);
  }
  if (missingWhitelist.length > 0) {      blocks.push(`Diese Dateien der Whitelist existieren nicht unter ${base}: ${missingWhitelist.join(", ")} – die Behauptung ist ohne echte Dateien/korrekte Pfade nicht gegenpruefbar (Daten oder Whitelist ergaenzen).`);
  }

  // ── (3) Plan erwaehnte Datei-Pfade gegen Whitelist + Realitaet ────────────
  // Signalwörter: relative Pfade mit bekannter Datei-Endung oder `path/…`.
  // Höchstens EIN Pfad-Separator: Bündel wie „WIRING/README/PLAN/AGENTS.md"
  // (Doku-Referenzen) sind KEINE Dateipfade (E2E-Falsch-Positiv, 2026-09-01).
  const EXT = /\.(?:js|mjs|cjs|ts|tsx|jsx|py|json|md|sh|ps1|css|html|sql|ya?ml|toml|txt|c|cpp|h|go|rs|java)$/i;
  const mentioned = [...new Set(String(planText).split(/[\s"'`()[\],;]+/).filter((tok) => {
    if (!EXT.test(tok)) return false;
    return tok.split("/").length - 1 <= 1; // max. ein Verzeichnis-Segment
  }))];
  const unknownMentioned = mentioned.filter((tok) => {
    if (whitelistSet.has(tok)) return false;
    const abs = path.resolve(base, tok);
    if (abs !== base && !abs.startsWith(base + path.sep)) return false; // Ausserhalb -> kein Umsetzbarkeits-Block (Sicherheit prüft run.mjs/Agent)
    return !exists(abs); // erwaent, aber nicht vorhanden -> tendenziell fehlgeschlagener Plan
  });
  if (unknownMentioned.length > 0) {
    findings.push({ severity: SEV.WARNING, text: `Plan nennt Dateien, die (noch) nicht unter root existieren: ${unknownMentioned.join(", ")} – Pfade/Annahmen prüfen.` });
  }
  // Existente Dateien AUSSERHALB der Whitelist: der Agent darf sie nicht lesen
  // (Zugriffsrahmen), also ist ein solcher Plan nicht umsetzbar wie geplant.
  const outsideWhitelist = mentioned.filter((tok) => {
    if (whitelistSet.has(tok)) return false;
    const abs = path.resolve(base, tok);
    return abs === base || (abs.startsWith(base + path.sep) && exists(abs));
  });
  if (outsideWhitelist.length > 0) {
    findings.push({ severity: SEV.WARNING, text: `Plan nennt Dateien ausserhalb der Zugriffs-Whitelist (Agent kann sie nicht lesen): ${outsideWhitelist.join(", ")} – Whitelist erweitern oder Plan anpassen.` });
  }

  // ── (5) Plan ↔ Diff-Divergenz (Regel 5): Der Plan nennt konkrete Dateien,
  //      die eingereichte Aenderung betrifft aber KEINE davon — struktureller
  //      Widerspruch zwischen Ankündigung und Umsetzung (Scope-Drift). ───────
  if (diffFiles.length && planText) {
    const planTargets = mentioned.filter((tok) => whitelistSet.has(tok));
    if (planTargets.length && planTargets.every((t) => !diffFiles.includes(t))) {
      blocks.push(`Der Plan nennt ${planTargets.join(", ")}, aber die eingereichte Aenderung betrifft ${diffFiles.join(", ")} – Plan und Aenderung widersprechen sich (Divergenz aufloesen, dann erneut einreichen).`);
    }
  }

  // ── Intent-Drift: Header-Signaturen fehlen komplett im Plan (Literalismus-  ──
  //    Schutz: der Agent arbeitet am eigentlichen Auftrag vorbei, wenn er den
  //    User-Input nicht adressiert). Nur Warnschwelle: mind. 1 signifikantes
  //    Wort muss im Plan wieder vorkommen, sonst PLAN-Hinweis.
  if (header && String(header).trim()) {
    const STOP = new Set(["der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "einem", "einen", "und", "oder", "aber", "nicht", "bitte", "mit", "auf", "für", "fuer", "aus", "von", "beim", "zum", "zur", "im", "in", "an", "am", "als", "es", "ist", "wird", "soll", "dass", "diese", "dieser", "dieses", "the", "a", "an", "of", "to", "and", "or", "for", "with", "please", "install", "installier", "bitte"]);
    const sigHeader = String(header).toLowerCase().split(/[^a-zäöüß0-9]+/i).filter((w) => w.length >= 3 && !STOP.has(w));
    const planLower = String(planText).toLowerCase();
    const matched = sigHeader.filter((w) => planLower.includes(w));
    if (matched.length === 0 && sigHeader.length > 0) {
      findings.push({ severity: SEV.WARNING, text: `Der Plan adressiert keine signifikanten Begriffe des User-Inputs (Header) – Gefahr des Literalismus/Intent-Drift: Plan gegen den eigentlichen Auftrag prüfen (PLAN nötig?).` });
    }
  }

  const feasible = blocks.length === 0;
  return { feasible, blocks, findings };
}