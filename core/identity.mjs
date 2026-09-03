import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isSelfReviewRoot } from "./selfreview.mjs";

export const ANCHOR_FILE = "FalsifyME.md";
export const ANCHOR_VERSION = "1";
const PROJECT_ID_RE = /^project-[a-f0-9]{32,}$/;
const CHECKOUT_ID_RE = /^checkout-[a-f0-9]{32,}$/;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const RECORD_TYPES = new Set(["user-decision", "notiz", "vorschlag", "sync"]);
const FIELD_ORDER = ["VERSION", "PROJECT_ID", "CHECKOUT_ID", "ROOT_NAME", "ROOT_BINDING", "CREATED_AT", "RECORDS_DIGEST", "ANCHOR_DIGEST"];

function fail(code, message, details = {}) {
  return { ok: false, code, message, ...details };
}

export function canonicalRoot(root) {
  const absolute = path.resolve(String(root || ""));
  try { return fs.realpathSync.native(absolute); }
  catch { return absolute; }
}

export function randomIdentity(prefix) {
  return `${prefix}-${crypto.randomBytes(16).toString("hex")}`;
}

export function rootBinding(root) {
  return digestPayload(canonicalRoot(root));
}

export function digestPayload(payload) {
  return `sha256:${crypto.createHash("sha256").update(String(payload), "utf8").digest("hex")}`;
}

export function canonicalAnchorPayload({ projectId, checkoutId, rootName, rootBinding: binding, createdAt, recordsDigest = digestPayload("") }) {
  return [
    "FALSIFYME-ANCHOR v1",
    `PROJECT_ID=${projectId}`,
    `CHECKOUT_ID=${checkoutId}`,
    `ROOT_NAME=${rootName}`,
    `ROOT_BINDING=${binding}`,
    `CREATED_AT=${createdAt}`,
    `RECORDS_DIGEST=${recordsDigest}`,
  ].join("\n") + "\n";
}

export function canonicalRecord(record) {
  const checked = validateDecisionRecord(record);
  if (!checked.ok) throw new Error(checked.message);
  const r = checked.value;
  return [
    `### Record ${r.id}`,
    `Id: ${r.id}`,
    `Type: ${r.type}`,
    `Source: ${r.source}`,
    `Created: ${r.createdAt}`,
    `Confirmed: ${r.confirmed === true}`,
    `Content: ${r.content.replace(/\r?\n/g, " ")}`,
  ].join("\n");
}

export function recordsDigest(records = []) {
  const canonical = records.map(canonicalRecord).join("\n\n");
  return digestPayload(canonical);
}

export function renderAnchor({ projectId, checkoutId, rootName, root, rootBinding: suppliedBinding, createdAt, records = [], recordsDigest: suppliedDigest }) {
  const binding = root ? rootBinding(root) : suppliedBinding;
  if (!binding) throw new Error("Anchor braucht einen Root oder ROOT_BINDING.");
  const digest = suppliedDigest || recordsDigest(records);
  const payload = canonicalAnchorPayload({ projectId, checkoutId, rootName, rootBinding: binding, createdAt, recordsDigest: digest });
  const body = records.length ? `${records.map(canonicalRecord).join("\n\n")}\n` : "";
  return payload + `ANCHOR_DIGEST=${digestPayload(payload)}\n\n## User-confirmed decision records\n\n${body}`;
}

function parseStrictFields(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const fields = new Map();
  let headerSeen = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === "---") continue;
    if (line === "## User-confirmed decision records") break;
    if (line.startsWith("#")) continue;
    if (line === "FALSIFYME-ANCHOR v1") {
      if (headerSeen) return fail("ANCHOR_DUPLICATE", "Anchor-Version doppelt.");
      headerSeen = true;
      fields.set("VERSION", "1");
      continue;
    }
    const match = /^(PROJECT_ID|CHECKOUT_ID|ROOT_NAME|ROOT_BINDING|CREATED_AT|RECORDS_DIGEST|ANCHOR_DIGEST)=(.*)$/.exec(line);
    if (!match) return fail("ANCHOR_UNKNOWN_FIELD", `Unbekanntes Anchor-Feld: ${line}`);
    const [, key, value] = match;
    if (fields.has(key)) return fail("ANCHOR_DUPLICATE", `Anchor-Feld doppelt: ${key}`);
    if (!value || value.includes("\n")) return fail("ANCHOR_VALUE", `Anchor-Feld leer/ungueltig: ${key}`);
    fields.set(key, value);
  }
  for (const key of FIELD_ORDER) {
    if (!fields.has(key)) return fail("ANCHOR_MISSING", `Anchor-Feld fehlt: ${key}`);
  }
  const value = Object.fromEntries(fields);
  if (value.VERSION !== "1") return fail("ANCHOR_VERSION", "Nicht unterstützte Anchor-Version.");
  if (!PROJECT_ID_RE.test(value.PROJECT_ID)) return fail("ANCHOR_PROJECT_ID", "Ungueltige PROJECT_ID.");
  if (!CHECKOUT_ID_RE.test(value.CHECKOUT_ID)) return fail("ANCHOR_CHECKOUT_ID", "Ungueltige CHECKOUT_ID.");
  if (!DIGEST_RE.test(value.ROOT_BINDING)) return fail("ANCHOR_ROOT_BINDING", "Ungueltige ROOT_BINDING.");
  if (!DIGEST_RE.test(value.RECORDS_DIGEST)) return fail("ANCHOR_RECORDS_DIGEST", "Ungueltiger RECORDS_DIGEST.");
  if (!DIGEST_RE.test(value.ANCHOR_DIGEST)) return fail("ANCHOR_DIGEST", "Ungueltiger Anchor-Digest.");
  if (!value.CREATED_AT || Number.isNaN(Date.parse(value.CREATED_AT))) return fail("ANCHOR_CREATED_AT", "Ungueltiger CREATED_AT.");
  const payload = canonicalAnchorPayload({
    projectId: value.PROJECT_ID,
    checkoutId: value.CHECKOUT_ID,
    rootName: value.ROOT_NAME,
    rootBinding: value.ROOT_BINDING,
    createdAt: value.CREATED_AT,
    recordsDigest: value.RECORDS_DIGEST,
  });
  if (digestPayload(payload) !== value.ANCHOR_DIGEST) return fail("ANCHOR_TAMPERED", "Anchor-Digest stimmt nicht.");
  return {
    ok: true,
    value: {
      projectId: value.PROJECT_ID,
      checkoutId: value.CHECKOUT_ID,
      rootName: value.ROOT_NAME,
      rootBinding: value.ROOT_BINDING,
      createdAt: value.CREATED_AT,
      recordsDigest: value.RECORDS_DIGEST,
      digest: value.ANCHOR_DIGEST,
    },
    payload,
  };
}

export function parseAnchor(text) {
  return parseStrictFields(text);
}

export function readAnchor(root) {
  const resolved = path.resolve(root);
  const file = path.join(resolved, ANCHOR_FILE);
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (error) {
    return fail(error.code === "ENOENT" ? "ANCHOR_MISSING_FILE" : "ANCHOR_UNREADABLE", `Anchor nicht lesbar: ${file}`, { file });
  }
  const parsed = parseAnchor(text);
  return parsed.ok ? { ...parsed, file, root: canonicalRoot(resolved), text } : { ...parsed, file };
}

export function validateAnchorForRoot(root, anchor = readAnchor(root)) {
  if (!anchor?.ok) return anchor || fail("ANCHOR_MISSING_FILE", "Anchor fehlt.");
  const resolved = canonicalRoot(root);
  const expectedName = path.basename(resolved);
  if (anchor.value.rootName !== expectedName) {
    return fail("ANCHOR_ROOT_NAME", `Anchor ROOT_NAME passt nicht zum Ziel-Root: ${anchor.value.rootName} != ${expectedName}`, { anchor });
  }
  if (anchor.value.rootBinding !== rootBinding(resolved)) {
    return fail("ANCHOR_ROOT_BINDING", "Anchor ist an einen anderen Checkout-Root gebunden.", { anchor });
  }
  const recordSection = parseDecisionRecords(anchor.text || "");
  if (!recordSection.ok) return recordSection;
  if (recordsDigest(recordSection.records) !== anchor.value.recordsDigest) {
    return fail("ANCHOR_RECORDS_TAMPERED", "Decision-Records stimmen nicht mit RECORDS_DIGEST überein.", { anchor, records: recordSection.records });
  }
  return { ok: true, ...anchor, root: resolved, records: recordSection.records };
}

const GITIGNORE_BEGIN = "# >>> FalsifyMe (lokal – nicht committen) <<<";
const GITIGNORE_END = "# <<< FalsifyMe (lokal) <<<";

// FalsifyME.md ist CHECKOUT-lokal (PROJECT_ID/CHECKOUT_ID/Root-Binding/
// Records). Wird er mitcommittet, erben fremde Kopien eine fremde Bindung
// (Foreign-Project-Gate!) und das Repo wird mit FalsifyMe-interner Identitaet
// verschmutzt. Deshalb traegt FalsifyMe den Anker bei JEDER Erzeugung in die
// Projekt-.gitignore ein (markierter Block, idempotent; User-Ticket
// 2026-09-03: „damit das User-Projekt FalsifyMe nicht mitpusht").
// Best-effort: schlaegt die .gitignore-Pflege fehl, bleibt der
// Anker-Vertrag unberuehrt (der Anker selbst ist das Vertragsobjekt).
function gitIgnoreBody() {
  return [
    GITIGNORE_BEGIN,
    "# Identitaetsanker ist checkout-lokal (PROJECT_ID/CHECKOUT_ID/Records) -",
    `# niemals committen/pushen (fremde Kopien erben sonst deine Bindung).`,
    `/${ANCHOR_FILE}`,
    GITIGNORE_END,
  ].join("\n");
}

export function ensureAnchorGitIgnored(root) {
  try {
    // Selbstpruefung des FalsifyMe-Repos: NIE das eigene .gitignore mutieren
    // (Tests/CI ankern das Produkt-Repo selbst; der Ignore-Block gehoert nur
    // in USER-Projekte, nicht in das FalsifyMe-Repo).
    if (isSelfReviewRoot(root)) return { ok: true, skipped: "self-review-root" };
    const resolved = canonicalRoot(root);
    const file = path.join(resolved, ".gitignore");
    let existing = "";
    try { existing = fs.readFileSync(file, "utf8"); } catch { /* fehlt noch */ }
    const body = gitIgnoreBody();
    const beginIdx = existing.indexOf(GITIGNORE_BEGIN);
    const endIdx = existing.indexOf(GITIGNORE_END);
    let next;
    if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
      next = existing.slice(0, beginIdx) + body + existing.slice(endIdx + GITIGNORE_END.length);
    } else {
      const base = existing.replace(/\s*$/, "");
      next = (base ? `${base}\n\n` : "") + body + "\n";
    }
    fs.writeFileSync(file, next, "utf8");
    return { ok: true, file };
  } catch {
    return { ok: false }; // Anker-Vertrag nicht blockieren
  }
}

export function initAnchor(root, { projectId = randomIdentity("project"), checkoutId = randomIdentity("checkout"), createdAt = new Date().toISOString(), records = [] } = {}) {
  const resolved = canonicalRoot(root);
  const file = path.join(resolved, ANCHOR_FILE);
  const text = renderAnchor({ projectId, checkoutId, rootName: path.basename(resolved), root: resolved, createdAt, records });
  try {
    fs.writeFileSync(file, text, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") {
      ensureAnchorGitIgnored(resolved); // Anker existiert schon: Ignore trotzdem sicherstellen
      return validateAnchorForRoot(resolved);
    }
    return fail("ANCHOR_INIT", `Anchor konnte nicht angelegt werden: ${error.message}`, { file });
  }
  ensureAnchorGitIgnored(resolved);
  return validateAnchorForRoot(resolved);
}

export function appendDecisionRecord(root, record) {
  const checked = validateDecisionRecord(record);
  if (!checked.ok) return checked;
  const resolved = canonicalRoot(root);
  const lockFile = path.join(resolved, `${ANCHOR_FILE}.lock`);
  let lock;
  try {
    lock = fs.openSync(lockFile, "wx");
  } catch (error) {
    return fail(error.code === "EEXIST" ? "ANCHOR_BUSY" : "ANCHOR_LOCK", error.code === "EEXIST"
      ? "Anchor wird bereits geändert; Vorgang fail-closed abgebrochen."
      : `Anchor-Sperre konnte nicht angelegt werden: ${error.message}`);
  }
  try {
    const current = validateAnchorForRoot(resolved);
    if (!current.ok) return current;
    if (current.records.some((existing) => existing.id === checked.value.id)) {
      return fail("RECORD_DUPLICATE", `Decision-Record-ID existiert bereits: ${checked.value.id}`);
    }
    const next = renderAnchor({
      projectId: current.value.projectId,
      checkoutId: current.value.checkoutId,
      rootName: current.value.rootName,
      rootBinding: current.value.rootBinding,
      createdAt: current.value.createdAt,
      records: [...current.records, checked.value],
    });
    try { fs.writeFileSync(current.file, next, "utf8"); }
    catch (error) { return fail("ANCHOR_RECORD_WRITE", `Decision-Record konnte nicht gespeichert werden: ${error.message}`); }
    return validateAnchorForRoot(resolved);
  } finally {
    try { fs.closeSync(lock); } catch { /* egal */ }
    try { fs.unlinkSync(lockFile); } catch { /* egal */ }
  }
}

export function validateDecisionRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return fail("RECORD_SHAPE", "Decision-Record ist kein Objekt.");
  if (!RECORD_TYPES.has(record.type)) return fail("RECORD_TYPE", "Unbekannter Decision-Record-Typ.");
  if (typeof record.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(record.id)) return fail("RECORD_ID", "Decision-Record braucht eine sichere ID.");
  if (typeof record.content !== "string" || !record.content.trim() || /[\r\n]/.test(record.content)) return fail("RECORD_CONTENT", "Decision-Record-Inhalt darf keine Zeilenumbrüche enthalten.");
  if (typeof record.source !== "string" || !record.source.trim() || /[\r\n]/.test(record.source)) return fail("RECORD_SOURCE", "Decision-Record-Provenienz darf keine Zeilenumbrüche enthalten.");
  if (typeof record.createdAt !== "string" || !record.createdAt.trim() || Number.isNaN(Date.parse(record.createdAt))) return fail("RECORD_TIME", "Decision-Record braucht einen gültigen Zeitstempel.");
  if (record.confirmed !== true) return fail("RECORD_CONFIRMATION", "Decision-Record braucht explizite Bestätigung (--confirm).");
  return { ok: true, value: { ...record, confirmed: record.confirmed === true } };
}

export function parseDecisionRecords(text) {
  const source = String(text || "").replace(/\r\n?/g, "\n");
  const marker = /^## User-confirmed decision records\s*$/im.exec(source);
  if (!marker) return { ok: true, records: [] };
  const section = source.slice(marker.index + marker[0].length).split(/^## /m)[0];
  const lines = section.split("\n");
  const records = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) { index += 1; continue; }
    if (!/^### Record /.test(lines[index].trim())) {
      return fail("RECORD_UNKNOWN_FIELD", `Ungültiger Decision-Record-Block: ${lines[index].trim()}`);
    }
    const record = {};
    const seen = new Set();
    index += 1;
    while (index < lines.length && !/^### Record /.test(lines[index].trim())) {
      const line = lines[index].trim();
      index += 1;
      if (!line) continue;
      const match = /^([A-Za-z]+):\s*(.*)$/.exec(line);
      if (!match) return fail("RECORD_UNKNOWN_FIELD", `Ungültige Decision-Record-Zeile: ${line}`);
      const key = { Type: "type", Id: "id", Source: "source", Created: "createdAt", Confirmed: "confirmed", Content: "content" }[match[1]];
      if (!key) return fail("RECORD_UNKNOWN_FIELD", `Unbekanntes Decision-Record-Feld: ${match[1]}`);
      if (seen.has(key)) return fail("RECORD_DUPLICATE_FIELD", `Decision-Record-Feld doppelt: ${match[1]}`);
      seen.add(key);
      record[key] = key === "confirmed" ? match[2].toLowerCase() === "true" : match[2];
    }
    const checked = validateDecisionRecord(record);
    if (!checked.ok) return checked;
    records.push(checked.value);
  }
  return { ok: true, records };
}

export function renderDecisionRecord(record) {
  return canonicalRecord(record);
}
