import fs from "node:fs";
import path from "node:path";
import { isSelfReviewRoot, ensureSelfReviewWhitelist } from "./selfreview.mjs";

export function resolveProjectContext(rootArg, filesArg, cwd = process.cwd()) {
  const explicitRoot = rootArg != null;
  const root = path.resolve(rootArg || cwd);
  const selfReview = isSelfReviewRoot(root);
  const requested = String(filesArg || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (explicitRoot && !selfReview && !requested.length) {
    return { root, files: [], selfReview: false, accessMode: "foreign-empty", requiresFiles: true };
  }
  const checked = ensureSelfReviewWhitelist(root, requested);
  return {
    root,
    files: checked.files,
    selfReview: selfReview || checked.added.length > 0,
    accessMode: checked.files.length ? "allowlist" : "whole-root",
    requiresFiles: false,
  };
}

export function validateProjectFiles(root, files) {
  const normalized = [];
  for (const file of files) {
    if (!file || path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) {
      throw new Error(`Datei verlässt das Zielprojekt: ${file}`);
    }
    const abs = path.resolve(root, file);
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`Datei ausserhalb des Zielprojekts: ${file}`);
    if (!fs.existsSync(abs)) throw new Error(`Datei nicht gefunden unter Zielprojekt: ${file}`);
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(abs);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error(`Symlink-Ziel außerhalb des Zielprojekts: ${file}`);
    normalized.push(file.replace(/\\/g, "/"));
  }
  return [...new Set(normalized)];
}
