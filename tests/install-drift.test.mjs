// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/install-drift.test.mjs – Install-Drift-Guard (root cause
// 2026-09-04)
// -----------------------------------------------------------------------------
// Der Dock-Worker führt die Runtime aus ~/.Falsify_Core aus; Hardening im
// Repo-Checkout wird erst LIVE, wenn die Installation synchron ist. Ohne Guard
// lief tagelang eine ältere Gate-Logik (PRAISE-False-Positive, fehlender
// selfReview-Frame, fehlende Loop-FM-EVT-Emission). Dieser Test deckt die
// reine Vergleichsfunktion ab (kein Netz, kein echter Core).
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = () => import(pathToFileURL(path.join(ROOT, "cli", "doctor.mjs")).href);

test("installDriftFiles: identische Dateien = kein Drift; Abweichung wird gefunden", async () => {
  const { installDriftFiles } = await mod();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-drift-repo-"));
  const inst = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-drift-inst-"));
  try {
    for (const rel of ["cli/run.mjs", "core/prompt.mjs", "artifacts/jobs.mjs"]) {
      fs.mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true });
      fs.mkdirSync(path.join(inst, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), "identisch");
      fs.writeFileSync(path.join(inst, rel), "identisch");
    }
    assert.deepEqual(installDriftFiles({ repoRoot: repo, installRoot: inst }), []);
    fs.writeFileSync(path.join(inst, "core", "prompt.mjs"), "ANDERS");
    const drift = installDriftFiles({ repoRoot: repo, installRoot: inst });
    assert.deepEqual(drift, ["core/prompt.mjs"], "geänderte Install-Datei = Drift");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(inst, { recursive: true, force: true });
  }
});

test("installDriftFiles: fehlende Install-Datei zählt als Drift, fehlende Repo-Datei wird übersprungen", async () => {
  const { installDriftFiles } = await mod();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-drift-repo2-"));
  const inst = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-drift-inst2-"));
  try {
    fs.mkdirSync(path.join(repo, "core"), { recursive: true });
    fs.writeFileSync(path.join(repo, "core", "prompt.mjs"), "x");
    const drift = installDriftFiles({ repoRoot: repo, installRoot: inst });
    assert.ok(drift.includes("core/prompt.mjs (fehlt in der Installation)"), JSON.stringify(drift));
    // Repo-Datei fehlt (z. B. alte Struktur) → kein Drift, kein Absturz:
    const driftMissingRepo = installDriftFiles({ repoRoot: inst, installRoot: repo });
    assert.deepEqual(driftMissingRepo, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(inst, { recursive: true, force: true });
  }
});