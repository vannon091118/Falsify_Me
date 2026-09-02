import fs from "node:fs";
import path from "node:path";
import { evidenceOf } from "./evidence.mjs";

const { existsSync } = fs;
const EVIDENCE_FILE_EXT = /\.(?:js|mjs|cjs|ts|tsx|jsx|py|json|md|sh|ps1|go|rs|java)$/i;
const EVIDENCE_FILE_LINE_G = /(?:^|[\s(,;`])([\w./-]+\.(?:jsx?|mjs|cjs|tsx?|py|json|md|sh|ps1|go|rs|java)):(\d+)(?:-\d+)?/gi;

function resolveRel(root, rel) {
  try {
    const exact = path.isAbsolute(rel) ? rel : path.join(root, rel);
    if (existsSync(exact)) return exact;
    let cur = path.resolve(root);
    for (const part of String(rel).split(/[\\/]/).filter(Boolean)) {
      const entry = fs.readdirSync(cur, { withFileTypes: true }).find((e) => e.name.toLowerCase() === part.toLowerCase());
      if (!entry) return null;
      cur = path.join(cur, entry.name);
    }
    return existsSync(cur) ? cur : null;
  } catch { return null; }
}

function fileTextCache(root, whitelist) {
  const cache = new Map();
  return (file) => {
    if (cache.has(file)) return cache.get(file);
    let text = null;
    try {
      const abs = resolveRel(root, file);
      if (abs) text = fs.readFileSync(abs, "utf8");
      if (text && text.length > 200000) text = null;
    } catch { /* unlesbar */ }
    cache.set(file, text);
    return text;
  };
}

function hasVerifiableFileLine(text, { root, cache }) {
  if (!root) return false;
  for (const m of String(text || "").matchAll(EVIDENCE_FILE_LINE_G)) {
    if (!EVIDENCE_FILE_EXT.test(m[1]) || !resolveRel(root, m[1])) continue;
    const source = cache instanceof Function ? cache(m[1]) : fileTextCache(root, [])(m[1]);
    const lineNo = Number(m[2]);
    if (source && lineNo >= 1 && lineNo <= source.split(/\r?\n/).length) return true;
  }
  return false;
}

/**
 * Objektive Tool-Evidence (Regel 6, Tool-Telemetrie statt Textanalyse):
 * Nur ein vom HOST aufgezeichneter, ERFOLGREICHER read_file-Aufruf auf einer
 * erlaubten Datei beweist eigenes Lesen. list_dir/glob sind nur Erkundung,
 * fehlgeschlagene/blockierte Aufrufe zählen nicht. Der Whitelist-/Root-Check
 * passiert in core/tools.mjs (execTool wirft bei Verstoß) – hier wird nur
 * die Laufzeit-Entscheidung des Hosts ausgewertet, kein Modelltext gedeutet.
 */
function hasOwnReadEvidence(toolEvidence) {
  return Array.isArray(toolEvidence) && toolEvidence.some(
    (e) => e?.tool === "read_file" && e?.success === true && e?.allowed === true,
  );
}

export function twinEvidenceOk(twin, { root = null, whitelist = [], toolEvidence = null } = {}) {
  if (!twin || twin.verdict !== "BESTAETIGT") return true;
  if (twin.error) return false;
  if (hasOwnReadEvidence(toolEvidence ?? twin.toolEvidence)) return true;
  if (Number(twin.toolRounds) >= 1) return true;
  const text = `${twin.befund || ""}\n${twin.content || ""}`;
  return evidenceOf(text, { root, whitelist }) !== null;
}

export function anchoredFileLine(text, { root, whitelist = [], cache } = {}) {
  if (!root) return null;
  const read = cache instanceof Function ? cache : fileTextCache(root, whitelist);
  const MARKER = /`([\w./-]+\.(?:jsx?|mjs|cjs|tsx?|py|json|md|sh|ps1|go|rs|java)):(\d+)(?:-\d+)?`\s*(?:→|->|:)?\s*(?:"([^"“”]{1,400})"|“([^”]{1,400})”|„([^“]{1,400})“|'([^'’]{1,400})'|’([^’]{1,400})’)/g;
  for (const m of String(text || "").matchAll(MARKER)) {
    const quote = (m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? "").replace(/\s+/g, " ").trim();
    if (!quote || !resolveRel(root, m[1])) continue;
    const source = read(m[1]);
    const lines = source?.split(/\r?\n/);
    const lineNo = Number(m[2]);
    if (lines && lineNo >= 1 && lineNo <= lines.length && lines[lineNo - 1].replace(/\s+/g, " ").trim() === quote) return `${m[1]}:${lineNo}`;
  }
  return null;
}

export function twinOwnFalsificationOk(twin, { root = null, whitelist = [], toolEvidence = null } = {}) {
  if (!twin || twin.verdict !== "BESTAETIGT") return true;
  if (twin.error || Number(twin.toolRounds) < 1) return false;
  const ownEvidence = toolEvidence ?? twin.toolEvidence;
  // Objektive Wahrheit: ein erfolgreicher erlaubter read_file DES Twins.
  // Fehlt diese Laufzeit-Evidenz, ist BESTAETIGT Nachlese/Erraten – fail-closed.
  if (!hasOwnReadEvidence(ownEvidence)) return false;
  const cache = fileTextCache(root, whitelist);
  if (!twinEvidenceOk(twin, { root, whitelist })) return false;
  // Zitat-Verankerung als Qualitäts-Gate: Macht der Twin eine `file:line` →
  // "Zitat"-Aussage, muss sie wörtlich stimmen (halluziniertes Zitat blockt).
  // Ohne jede Zitat-Aussage trägt die objektive Tool-Evidence die Freigabe.
  const text = `${twin.befund || ""}\n${twin.content || ""}`;
  const QUOTE_CLAIM = /`[\w./-]+\.(?:jsx?|mjs|cjs|tsx?|py|json|md|sh|ps1|go|rs|java):\d+(?:-\d+)?`\s*(?:→|->|:)?\s*(?:"|“|„|'|’)/;
  if (QUOTE_CLAIM.test(text)) return anchoredFileLine(text, { root, whitelist, cache }) !== null;
  return true;
}
