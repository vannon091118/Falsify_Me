import fs from "node:fs";
import path from "node:path";
import { openDb, closeDb } from "../artifacts/db.mjs";
import { bindAnchor, assertAnchorBinding, getCheckout, getCheckoutForRoot } from "../artifacts/projects.mjs";
import {
  appendDecisionRecord,
  canonicalRoot,
  digestPayload,
  initAnchor,
  parseAnchor,
  parseDecisionRecords,
  readAnchor,
  recordsDigest,
  renderAnchor,
  validateAnchorForRoot,
} from "../core/identity.mjs";
import { fail } from "./util.mjs";

function option(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function rootFrom(args) {
  return path.resolve(option(args, "--root") || process.cwd());
}

function persist(root, validated, { allowExisting = false } = {}) {
  if (!validated.ok) fail(validated.message);
  const db = openDb();
  try {
    const row = bindAnchor(db, validated, root, { allowExisting });
    if (!allowExisting) assertAnchorBinding(db, validated);
    return row;
  } finally {
    closeDb();
  }
}

export function runAnchor(args = []) {
  const sub = args[0];
  if (sub === "init") return anchorInit(rootFrom(args.slice(1)));
  if (sub === "check") return anchorCheck(rootFrom(args.slice(1)));
  if (sub === "rebind") return anchorRebind(rootFrom(args.slice(1)));
  if (sub === "clone") return anchorClone(args.slice(1));
  if (sub === "record") return anchorRecord(args.slice(1), rootFrom(args.slice(1)));
  if (sub === "restore") return anchorRestore(rootFrom(args.slice(1)));
  fail("Verwendung: falsify anchor init|check|rebind|restore|clone|record …");
}

function anchorInit(root) {
  const current = readAnchor(root);
  if (current.ok) {
    const validated = validateAnchorForRoot(root, current);
    if (!validated.ok) fail(validated.message);
    persist(root, validated);
    console.log("FALSIFYME_ANCHOR=vorhanden");
    console.log(`PROJECT_ID=${validated.value.projectId}`);
    console.log(`CHECKOUT_ID=${validated.value.checkoutId}`);
    return;
  }
  const created = initAnchor(root);
  if (!created.ok) fail(created.message);
  persist(root, created);
  console.log("FALSIFYME_ANCHOR=angelegt");
  console.log(`PROJECT_ID=${created.value.projectId}`);
  console.log(`CHECKOUT_ID=${created.value.checkoutId}`);
}

function anchorCheck(root) {
  // Fehlende Datei → ehrlicher Hinweis auf den Selbst-Heilungs-Pfad (root
  // cause 2026-09-04: geloeschter Anker blockierte den Submit, nur manuell
  // rekonstruierbar). `restore` regeneriert die Datei aus der DB-Identitaet.
  const raw = readAnchor(root);
  if (!raw.ok) fail(`${raw.message} – Wiederherstellung aus der DB-Identität: falsify anchor restore --root "${canonicalRoot(root)}"`);
  const validated = validateAnchorForRoot(root, raw);
  if (!validated.ok) fail(validated.message);
  const db = openDb();
  try {
    const row = assertAnchorBinding(db, validated);
    console.log("FALSIFYME_ANCHOR=OK");
    console.log(`PROJECT_ID=${row.project_id}`);
    console.log(`CHECKOUT_ID=${row.checkout_id}`);
    console.log(`ROOT=${row.bound_root}`);
    console.log(`RECORDS_DIGEST=${row.records_digest}`);
  } finally {
    closeDb();
  }
}

/**
 * Selbst-Heilung (root cause 2026-09-04): Die physische Anker-Datei ist weg
 * ODER traegt eine unregistrierte Identitaet (z. B. naives `anchor init` nach
 * Dateiverlust erzeugt frische IDs, die nicht in der DB sind). `restore`
 * regeneriert die Datei BYTEGENAU aus der registrierten DB-Identitaet
 * (renderAnchor + bindAnchor) — die Scope-/Checkout-Bindung bleibt unberuehrt.
 * Fail-closed: ohne DB-Identitaet oder mit registrierten Decision-Records
 * (liegen NUR im Anker, nicht rekonstruierbar) wird ehrlich abgelehnt.
 */
function anchorRestore(root) {
  const db = openDb();
  try {
    const bound = getCheckoutForRoot(db, canonicalRoot(root));
    if (!bound) {
      fail(`Keine registrierte Checkout-Identität für ${canonicalRoot(root)} – erst "falsify anchor init --root \"${canonicalRoot(root)}\"" ausführen.`);
    }
    const current = readAnchor(root);
    if (current.ok) {
      const parsed = parseAnchor(current.text);
      if (parsed.ok && parsed.value.checkoutId === bound.checkout_id) {
        const validated = validateAnchorForRoot(root, current);
        if (!validated.ok) fail(validated.message);
        const row = assertAnchorBinding(db, validated);
        console.log("FALSIFYME_ANCHOR=vorhanden");
        console.log(`PROJECT_ID=${row.project_id}`);
        console.log(`CHECKOUT_ID=${row.checkout_id}`);
        return;
      }
      console.log(`FALSIFYME_ANCHOR=ersetzt (vorhandene Datei trägt ${parsed.ok ? `unregistrierte Identität ${parsed.value.checkoutId}` : "keine parsebare Identität"}, DB-Identität ${bound.checkout_id})`);
    } else {
      console.log(`FALSIFYME_ANCHOR=wiederhergestellt (Datei fehlte: ${current.message})`);
    }
    // Decision-Records existieren NUR im Anker — ist die Datei weg, sind sie
    // nicht aus der DB rekonstruierbar (die DB haelt nur den Digest).
    if (bound.records_digest !== digestPayload("")) {
      fail(`Anker-Datei fehlt, aber es sind Decision-Records registriert (records_digest=${bound.records_digest}). Records liegen NUR im Anker und können nicht aus der DB rekonstruiert werden – Anker manuell wiederherstellen oder Decision-Records neu anlegen.`);
    }
    const rendered = renderAnchor({
      projectId: bound.project_id,
      checkoutId: bound.checkout_id,
      rootName: bound.root_name,
      root: bound.bound_root,
      createdAt: bound.created_at,
      records: [],
    });
    fs.writeFileSync(path.join(canonicalRoot(root), "FalsifyME.md"), rendered, "utf8");
    const validated = validateAnchorForRoot(root);
    if (!validated.ok) fail(validated.message);
    const row = assertAnchorBinding(db, validated);
    console.log(`PROJECT_ID=${row.project_id}`);
    console.log(`CHECKOUT_ID=${row.checkout_id}`);
    console.log(`ROOT=${row.bound_root}`);
  } finally {
    closeDb();
  }
}

function anchorRebind(root) {
  const raw = readAnchor(root);
  if (!raw.ok) fail(raw.message);
  const parsed = parseAnchor(raw.text);
  if (!parsed.ok) fail(parsed.message);
  const currentBinding = canonicalRoot(root);
  const parsedRecords = parseDecisionRecords(raw.text);
  if (!parsedRecords.ok) fail(parsedRecords.message);
  const rewritten = renderAnchor({
    projectId: parsed.value.projectId,
    checkoutId: parsed.value.checkoutId,
    rootName: path.basename(currentBinding),
    root: currentBinding,
    createdAt: parsed.value.createdAt,
    records: parsedRecords.records,
  });
  const before = raw.text;
  try {
    // This is the explicit user-authorized operation that changes the physical
    // checkout binding. Normal startup never performs this rewrite.
    fs.writeFileSync(raw.file, rewritten, "utf8");
  } catch (error) {
    fail(`Anchor-Rebind konnte nicht gespeichert werden: ${error.message}`);
  }
  const validated = validateAnchorForRoot(root);
  if (!validated.ok) fail(validated.message);
  let row;
  const db = openDb();
  try {
    row = bindAnchor(db, validated, root, { allowExisting: true, allowRebind: true });
  } catch (error) {
    try { fs.writeFileSync(raw.file, before, "utf8"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    closeDb();
  }
  console.log("FALSIFYME_ANCHOR=REBIND");
  console.log(`PROJECT_ID=${row.project_id}`);
  console.log(`CHECKOUT_ID=${row.checkout_id}`);
  console.log(`ROOT=${row.bound_root}`);
}

function anchorClone(args) {
  const source = path.resolve(option(args, "--from") || "");
  const target = path.resolve(option(args, "--root") || process.cwd());
  if (!source || source === path.resolve(".")) fail("Verwendung: falsify anchor clone --from <bestehender-root> --root <neuer-root>");
  const sourceAnchor = validateAnchorForRoot(source);
  if (!sourceAnchor.ok) fail(sourceAnchor.message);
  const created = initAnchor(target, {
    projectId: sourceAnchor.value.projectId,
    createdAt: new Date().toISOString(),
    records: sourceAnchor.records,
  });
  if (!created.ok) fail(created.message);
  persist(target, created, { allowExisting: false });
  console.log("FALSIFYME_ANCHOR=CLONED");
  console.log(`PROJECT_ID=${created.value.projectId}`);
  console.log(`CHECKOUT_ID=${created.value.checkoutId}`);
  console.log(`ROOT=${canonicalRoot(target)}`);
}

function anchorRecord(args, root) {
  const type = args[0];
  const content = option(args, "--content");
  const source = option(args, "--source");
  const id = option(args, "--id");
  if (!type || content === undefined || source === undefined || id === undefined) {
    fail("Verwendung: falsify anchor record <user-decision|notiz|vorschlag|sync> --id <id> --source <quelle> --content <text> [--confirm] [--root <dir>]");
  }
  // Fail-closed wie jede andere Session-Grenze: Records gibt es nur auf einem
  // existierenden, validierten Anker (der Bootstrap legt ihn an). Ohne Anker
  // würde der Schreibversuch sonst ein konsistenzloses Artefakt erzeugen.
  const anchorFile = path.join(canonicalRoot(root), "FalsifyME.md");
  if (!fs.existsSync(anchorFile)) {
    fail(`Kein Projektanker unter ${canonicalRoot(root)} – erst "falsify anchor init --root "${canonicalRoot(root)}"" ausführen.`);
  }
  const before = fs.readFileSync(anchorFile, "utf8");
  const updated = appendDecisionRecord(root, {
    type,
    id,
    source,
    content,
    createdAt: new Date().toISOString(),
    confirmed: args.includes("--confirm"),
  });
  if (!updated.ok) fail(updated.message);
  const db = openDb();
  try {
    bindAnchor(db, updated, root, { allowExisting: true });
  } catch (error) {
    try { fs.writeFileSync(path.join(canonicalRoot(root), "FalsifyME.md"), before, "utf8"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    closeDb();
  }
  console.log(`RECORD_ID=${id}`);
  console.log(`RECORDS_DIGEST=${updated.value.recordsDigest}`);
}
