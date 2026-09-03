import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function canonicalPath(root, file) {
  const absolute = path.resolve(root, file);
  const relative = path.relative(path.resolve(root), absolute).replace(/\\/g, "/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) return null;
  return relative;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function gitInfo(root) {
  try {
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const status = execFileSync("git", ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const paths = status.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean).map((entry) => entry.includes(" -> ") ? entry.split(" -> ").at(-1) : entry).map((entry) => entry.replace(/\\/g, "/"));
    return { head, status, paths };
  } catch {
    return { head: null, status: null, paths: [] };
  }
}

/**
 * Read-only content snapshot. The digest is content-based and deterministic;
 * mtime is deliberately excluded from the identity of a repository state.
 */
export function snapshotRoot(root, files = []) {
  const base = path.resolve(root);
  const normalized = [...new Set((files || []).map((file) => canonicalPath(base, file)).filter(Boolean))].sort();
  const entries = [];
  for (const file of normalized) {
    const absolute = path.join(base, file);
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile()) continue;
      const content = fs.readFileSync(absolute);
      entries.push({ path: file, sha256: sha256(content), size: content.length });
    } catch {
      entries.push({ path: file, missing: true });
    }
  }
  const git = gitInfo(base);
  const canonical = JSON.stringify({ entries, gitHead: git.head });
  return { root: base, entries, git_head: git.head, git_status: git.status, git_paths: git.paths, digest: sha256(canonical) };
}

export function compareSnapshots(before, after, { allowedFiles = [] } = {}) {
  const beforeEntries = new Map((before?.entries || []).map((entry) => [entry.path, entry]));
  const afterEntries = new Map((after?.entries || []).map((entry) => [entry.path, entry]));
  const paths = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])].sort();
  const changedFiles = paths.filter((file) => JSON.stringify(beforeEntries.get(file) || null) !== JSON.stringify(afterEntries.get(file) || null));
  const allowed = new Set((allowedFiles || []).map((file) => String(file).replace(/\\/g, "/")));
  const unauthorized = changedFiles.filter((file) => allowed.size && !allowed.has(file));
  const diffDigest = sha256(JSON.stringify({ before: before?.digest || null, after: after?.digest || null, changedFiles }));
  return {
    changed: changedFiles.length > 0,
    changed_files: changedFiles,
    unauthorized_files: unauthorized,
    diff_digest: diffDigest,
    before_digest: before?.digest || null,
    after_digest: after?.digest || null,
  };
}

export function validateChangeReport(report, { handoff, after, allowedFiles = [] } = {}) {
  const reasons = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) return { ok: false, reasons: ["Write-Report ist kein Objekt"] };
  for (const field of ["handoff_id", "job_id", "scope_id", "checkout_id", "writer_id", "before_digest", "after_digest", "changed_files", "diff_digest", "write_status"]) {
    if (report[field] === undefined || report[field] === null || (typeof report[field] === "string" && !report[field].trim())) reasons.push(`Pflichtfeld fehlt: ${field}`);
  }
  if (!Array.isArray(report.changed_files)) reasons.push("changed_files muss ein Array sein");
  const comparison = compareSnapshots(handoff?.before_snapshot, after, { allowedFiles });
  const actualFiles = JSON.stringify(comparison.changed_files);
  const reportedFiles = JSON.stringify((report.changed_files || []).map((file) => String(file).replace(/\\/g, "/")).sort());
  if (report.handoff_id !== handoff?.handoff_id) reasons.push("Handoff-ID stimmt nicht");
  if (report.job_id !== handoff?.job_id) reasons.push("Job-ID stimmt nicht");
  if (report.scope_id !== handoff?.scope_id) reasons.push("Scope-ID stimmt nicht");
  if (report.checkout_id !== handoff?.checkout_id) reasons.push("Checkout-ID stimmt nicht");
  if (report.before_digest !== handoff?.before_snapshot?.digest) reasons.push("before_digest stimmt nicht mit dem Handoff-Snapshot überein");
  if (report.after_digest !== comparison.after_digest) reasons.push("after_digest stimmt nicht mit dem aktuellen Repository-Zustand überein");
  if (reportedFiles !== JSON.stringify(comparison.changed_files)) reasons.push(`changed_files stimmen nicht mit dem Content-Vergleich überein (gemeldet=${reportedFiles}, echt=${actualFiles})`);
  if (report.diff_digest !== comparison.diff_digest) reasons.push("diff_digest stimmt nicht mit dem Content-Vergleich überein");
  if (comparison.unauthorized_files.length) reasons.push(`unerlaubte Änderung außerhalb der Whitelist: ${comparison.unauthorized_files.join(", ")}`);
  if (!["COMPLETED", "NO_CHANGE", "ABORTED"].includes(String(report.write_status).toUpperCase())) reasons.push("write_status ist unbekannt");
  return { ok: reasons.length === 0, reasons, comparison };
}
