import { canonicalRoot, rootBinding, validateAnchorForRoot } from "../core/identity.mjs";
import { nowIso } from "./db.mjs";

export function getProject(db, projectId) {
  return db.prepare("SELECT * FROM projects WHERE project_id = ?").get(projectId);
}

export function getCheckout(db, checkoutId) {
  return db.prepare("SELECT * FROM checkouts WHERE checkout_id = ?").get(checkoutId);
}

export function getCheckoutForRoot(db, root) {
  return db.prepare("SELECT * FROM checkouts WHERE bound_root = ?").get(canonicalRoot(root));
}

/**
 * Persist one validated anchor and its checkout binding atomically. The normal
 * path is intentionally immutable; rebind is an explicit lifecycle operation.
 */
export function bindAnchor(db, anchor, root, { allowExisting = false, allowRebind = false } = {}) {
  if (!anchor?.ok) throw new Error(anchor?.message || "Anchor ist nicht validiert.");
  const boundRoot = canonicalRoot(root);
  if (anchor.value.rootBinding !== rootBinding(boundRoot) || anchor.value.rootName !== boundRoot.split(/[\\\\/]/).at(-1)) {
    throw new Error("Anchor-Root-Bindung passt nicht zum übergebenen Root.");
  }
  const existingCheckout = getCheckout(db, anchor.value.checkoutId);
  if (existingCheckout && existingCheckout.project_id !== anchor.value.projectId) {
    throw new Error("Anchor-Identität gehört zu einem anderen logischen Projekt.");
  }
  if (existingCheckout && !allowRebind && (
    existingCheckout.bound_root !== boundRoot ||
    existingCheckout.root_binding !== anchor.value.rootBinding
  )) {
    throw new Error("Anchor-Identität ist bereits an einen anderen Projekt-Root gebunden.");
  }
  if (existingCheckout && !allowExisting && (
    existingCheckout.anchor_digest !== anchor.value.digest ||
    existingCheckout.records_digest !== anchor.value.recordsDigest
  )) {
    throw new Error("Anchor-Synchronisation weicht von SQLite ab; nur ein expliziter Rebind darf sie ändern.");
  }
  const otherRoot = getCheckoutForRoot(db, boundRoot);
  if (otherRoot && otherRoot.checkout_id !== anchor.value.checkoutId) {
    throw new Error("Dieser Root ist bereits an eine andere Checkout-Identität gebunden.");
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const createdAt = anchor.value.createdAt || nowIso();
    if (!getProject(db, anchor.value.projectId)) {
      db.prepare("INSERT INTO projects(project_id, created_at) VALUES(?, ?)").run(anchor.value.projectId, createdAt);
    }
    if (!existingCheckout) {
      db.prepare(
        "INSERT INTO checkouts(checkout_id, project_id, bound_root, root_name, root_binding, anchor_digest, records_digest, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(anchor.value.checkoutId, anchor.value.projectId, boundRoot, anchor.value.rootName, anchor.value.rootBinding, anchor.value.digest, anchor.value.recordsDigest, createdAt, nowIso());
    } else {
      db.prepare("UPDATE checkouts SET bound_root = ?, anchor_digest = ?, records_digest = ?, root_name = ?, root_binding = ?, updated_at = ? WHERE checkout_id = ?")
        .run(boundRoot, anchor.value.digest, anchor.value.recordsDigest, anchor.value.rootName, anchor.value.rootBinding, nowIso(), anchor.value.checkoutId);
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original failure */ }
    throw error;
  }
  return getCheckout(db, anchor.value.checkoutId);
}

export function assertAnchorBinding(db, validated) {
  if (!validated?.ok) throw new Error(validated?.message || "Anchor-Prüfung fehlgeschlagen.");
  const row = getCheckout(db, validated.value.checkoutId);
  if (!row) throw new Error("Anchor ist nicht in FalsifyMe registriert. Erst `falsify anchor init` ausführen.");
  if (row.project_id !== validated.value.projectId || row.bound_root !== canonicalRoot(validated.root) || row.root_binding !== validated.value.rootBinding) {
    throw new Error("Anchor- und SQLite-Projektbindung widersprechen sich.");
  }
  if (row.anchor_digest !== validated.value.digest || row.records_digest !== validated.value.recordsDigest) {
    throw new Error("Anchor-Synchronisation weicht von SQLite ab.");
  }
  return row;
}

/**
 * Single pre-session identity gate. It reads the one project anchor, validates
 * its cryptographic payload and root binding, then compares it with SQLite.
 * This function never creates, repairs, or rebinds state.
 */
export function requireProjectIdentity(db, root) {
  const validated = validateAnchorForRoot(root);
  if (!validated.ok) {
    throw new Error(`${validated.message} (erst "falsify anchor init --root \\"${canonicalRoot(root)}\\"")`);
  }
  const checkout = assertAnchorBinding(db, validated);
  return { anchor: validated, checkout };
}

export function assertScopeCheckout(scope, checkoutId, { requireBound = true } = {}) {
  if (!scope?.checkout_id && requireBound) {
    throw new Error("Scope ist nicht an einen Projektanker gebunden; historische Scopes werden nicht still übernommen.");
  }
  if (scope?.checkout_id && scope.checkout_id !== checkoutId) {
    throw new Error("Scope gehört zu einer anderen Checkout-Identität.");
  }
}

export function checkProjectConsistency(db) {
  const violations = [];
  for (const row of db.prepare("SELECT * FROM checkouts").all()) {
    if (row.bound_root !== canonicalRoot(row.bound_root)) violations.push(`checkout ${row.checkout_id}: bound_root ist nicht kanonisch`);
    if (row.root_binding !== rootBinding(row.bound_root)) violations.push(`checkout ${row.checkout_id}: root_binding widerspricht bound_root`);
    const duplicate = db.prepare("SELECT checkout_id FROM checkouts WHERE bound_root = ? AND checkout_id <> ?").get(row.bound_root, row.checkout_id);
    if (duplicate) violations.push(`checkout ${row.checkout_id}: Root doppelt mit ${duplicate.checkout_id}`);
  }
  for (const row of db.prepare(
    "SELECT s.id, s.checkout_id FROM scopes s LEFT JOIN checkouts c ON c.checkout_id = s.checkout_id WHERE s.checkout_id IS NOT NULL AND c.checkout_id IS NULL"
  ).all()) {
    violations.push(`scope ${row.id}: unbekannte Checkout-Identität ${row.checkout_id}`);
  }
  for (const row of db.prepare(
    "SELECT j.id, j.checkout_id FROM jobs j LEFT JOIN checkouts c ON c.checkout_id = j.checkout_id WHERE j.checkout_id IS NOT NULL AND c.checkout_id IS NULL"
  ).all()) {
    violations.push(`job ${row.id}: unbekannte Checkout-Identität ${row.checkout_id}`);
  }
  const jobsWithRoot = db.prepare(
    "SELECT j.id, j.checkout_id, j.root, c.bound_root FROM jobs j JOIN checkouts c ON c.checkout_id = j.checkout_id WHERE j.root IS NOT NULL"
  ).all();
  for (const row of jobsWithRoot) {
    if (canonicalRoot(row.root) !== row.bound_root) {
      violations.push(`job ${row.id}: Root weicht von Checkout ${row.checkout_id} ab`);
    }
  }
  for (const row of db.prepare(
    "SELECT j.id, j.checkout_id, s.checkout_id AS scope_checkout_id FROM jobs j JOIN scopes s ON s.id = j.scope_id WHERE j.checkout_id IS NOT NULL AND s.checkout_id IS NOT NULL AND j.checkout_id <> s.checkout_id"
  ).all()) {
    violations.push(`job ${row.id}: Job- und Scope-Checkout widersprechen sich`);
  }
  return { ok: violations.length === 0, violations };
}

export function enforceProjectConsistency(db) {
  const result = checkProjectConsistency(db);
  if (!result.ok) throw new Error("Projektidentität inkonsistent:\n- " + result.violations.join("\n- "));
}

export function registerValidatedAnchor(db, validated) {
  const row = bindAnchor(db, validated, validated.root, { allowExisting: false });
  enforceProjectConsistency(db);
  return row;
}
