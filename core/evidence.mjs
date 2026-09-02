import fs from "node:fs";
import path from "node:path";
import { parseBefund } from "./verdict.mjs";

const { existsSync } = fs;
const EVIDENCE_FILE_EXT = /\.(?:js|mjs|cjs|ts|tsx|jsx|py|json|md|sh|ps1|css|html|sql|ya?ml|toml|txt|c|cpp|h|go|rs|java)$/i;
const EVIDENCE_SYMBOL = /`([A-Za-z_$][\w.$-]{2,})`/g;
const EVIDENCE_FILE_LINE = /(?:^|[\s(,;`])([\w./-]+\.(?:jsx?|mjs|cjs|tsx?|py|json|md|sh|ps1|go|rs|java)):(\d+)(?:-\d+)?/i;
const EVIDENCE_PATH = /[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]+/;
const REFUTATION = /widerlegt?|widerlegung|refuted|verletzt|violates?|bricht|brea?ks|umgehung|umgangen|bypass|race|racy|bug|luecke|lücke|gap|flaw|angreifbar|unsicher|unsafe|kaputt|broken|falsch|wrong|fehlt|missing|inkonsistent|inconsistent|unzureichend|insufficient|risiko|risik|gefahr|danger|crash|absturz|leak|ausbruch|escape|gegenteil|contrary|angreif|attack|schwach|weak|zuwenig|zu wenig|nicht funktioniert|fails?/i;
const NEGATION_SINK = /\b(?:kein(?:e|er|em|en)?\s+(?:fehler|gefunden|luecke|lücke|bug|problem|schwachstelle|schwaechen|risiko|anhaltspunkt|verstoss|widerspruch|gegenteil)|no\s+(?:errors?|issues?|problems?|bugs?|gaps?|flaws?|vulnerabilit(?:y|ies)|concerns?|defects?|lücken|luecken)\b(?:\s+(?:found|detected|present|here|at\s+all))?|nothing\s+wrong|all\s+good|looks?\s+correct|seems?\s+(?:correct|fine|ok|okay|good|right)|\bis\s+(?:correct|fine|ok|okay|good|right|solid))\b/gi;

function hasRefutation(text, evidenceType) {
  const t = String(text || "").replace(NEGATION_SINK, " ");
  const tokens = new Set();
  for (const m of t.matchAll(new RegExp(REFUTATION.source, "gi"))) tokens.add(m[0].toLowerCase());
  if (tokens.size >= 2) return true;
  return tokens.size === 1 && evidenceType === "datei-zeile";
}

export function extractAttemptBundles(section) {
  const bundles = [];
  let current = null;
  for (const raw of String(section || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const isHeader = /^#{1,6}\s+\S/.test(line);
    const bare = line.replace(/^#{1,6}\s+/, "").replace(/^\*{1,3}\s+/, "");
    const isListItem = /^(?:\d+\.|[-*])\s+\S/.test(bare);
    if (isHeader || isListItem) {
      current = { text: (isListItem ? bare.replace(/^(?:\d+\.|[-*])\s+/, "") : bare).trim() };
      bundles.push(current);
    } else if (current) current.text += " " + line;
  }
  return bundles;
}

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

function fileTextCache(root) {
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

export function evidenceOf(attempt, { whitelist = [], root = null, cache } = {}) {
  const read = root ? (cache instanceof Function ? cache : fileTextCache(root)) : null;
  const lm = String(attempt || "").match(EVIDENCE_FILE_LINE);
  if (lm && EVIDENCE_FILE_EXT.test(lm[1])) {
    if (!root || !resolveRel(root, lm[1])) return null;
    const lineNo = Number(lm[2]);
    const lines = read(lm[1]);
    if (!lines || lineNo < 1 || lineNo > lines.split(/\r?\n/).length) return null;
    return "datei-zeile";
  }
  if (whitelist.some((w) => String(attempt).includes(w))) return "whitelist";
  for (const m of String(attempt || "").matchAll(EVIDENCE_SYMBOL)) {
    if (!read) return null;
    for (const w of whitelist) {
      const text = read(w);
      if (text && text.includes(m[1])) return "symbol";
    }
  }
  const pm = String(attempt || "").match(EVIDENCE_PATH);
  if (pm && EVIDENCE_FILE_EXT.test(pm[0]) && root && resolveRel(root, pm[0])) return "pfad-existiert";
  return null;
}

export function hasChallengeEvidence(content, opts = {}) {
  const c = String(content || "");
  const m = c.match(/##\s*Falsifikationsversuche/i);
  if (!m) return false;
  const rest = c.slice(m.index + m[0].length);
  const nextHeading = rest.search(/\n#{1,2}\s+\S/);
  const section = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
  const cache = opts?.root ? fileTextCache(opts.root) : null;
  return extractAttemptBundles(section).some((b) => {
    if (b.text.length < 10) return false;
    const ev = evidenceOf(b.text, { ...opts, cache });
    return !!ev && hasRefutation(b.text, ev);
  });
}

export function enforceWriteChallenge(content, verdict, opts = {}) {
  const v = String(verdict || "").toUpperCase();
  return v === "WRITE" && !hasChallengeEvidence(content, opts) ? null : v || null;
}

const MISSING_DATA = /(?:fehlt|fehlend|benötigt|benoetigt|brauche|brauchen|nicht vorhanden|nicht lesbar|kein zugriff|keine? (?:datei|daten)|missing|need|required|not (?:found|available)|cannot? read|kein zugriff)/i;
const CONCRETE_REF = /(?:[\w./-]+\.\w+:\d+|[\w./-]+\.(?:js|mjs|cjs|ts|tsx|py|json|md|sh|ps1|txt|sql|go|rs|java)\b|read_file|list_dir|glob)/i;
export function enforceResearchContract(content, verdict) {
  if (String(verdict || "").toUpperCase() !== "RESEARCH") return verdict;
  const befund = parseBefund(String(content || "")) || "";
  return MISSING_DATA.test(befund) && CONCRETE_REF.test(befund) ? "RESEARCH" : null;
}

const RESEARCH_ADD_EXT = /\.(?:js|mjs|cjs|ts|tsx|jsx|py|json|md|sh|ps1|css|html|sql|ya?ml|toml|txt|c|cpp|h|go|rs|java)$/i;
export function extractResearchAdditions(content, { root = null, max = 20 } = {}) {
  const found = new Set();
  const CAND = /(?:^|[^\w./\\:-])((?:[\w.-]+\/)+[\w.-]+\.\w{1,12}|[\w.-]+\.\w{1,12})/g;
  for (const m of String(content || "").matchAll(CAND)) {
    const p = m[1].replace(/\\/g, "/").replace(/^\.\//, "");
    if (!p || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.split("/").includes("..") || !RESEARCH_ADD_EXT.test(p)) continue;
    if (root && !existsSync(path.join(root, p))) continue;
    found.add(p);
  }
  return [...found].slice(0, Math.max(1, Number(max) || 20));
}

export function enforceStructuralCoherence(blocks = [], verdict) {
  const v = String(verdict || "").toUpperCase();
  return v === "WRITE" && Array.isArray(blocks) && blocks.length ? "PLAN" : v || null;
}

export function findingSeverity(verdict) {
  const v = String(verdict || "").toUpperCase();
  if (v === "WRITE") return "discovered";
  if (v === "PLAN" || v === "RESEARCH" || v === "ASK") return "warning";
  return "critical";
}
