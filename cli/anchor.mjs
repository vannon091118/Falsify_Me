import fs from "node:fs";
import path from "node:path";
import { openDb, closeDb } from "../artifacts/db.mjs";
import { bindAnchor, assertAnchorBinding, getCheckout } from "../artifacts/projects.mjs";
import {
  appendDecisionRecord,
  canonicalRoot,
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
  fail("Verwendung: falsify anchor init|check|rebind|clone|record …");
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
  const validated = validateAnchorForRoot(root);
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
