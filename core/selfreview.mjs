// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/selfreview.mjs – Self-Review-Scope-Regel (kein Blinder Fleck)
// -----------------------------------------------------------------------------
// Regel (Nutzer-Vorgabe 2026-09-01, E2E-Befund 1 aus Iteration 5):
//   Self-Review darf keinen blinden Bereich erzeugen – wenn FalsifyMe sich
//   selbst prüft, müssen die für die Prüfung relevanten eigenen Kernkomponenten
//   im Prüf-Scope liegen. Eine Whitelist darf nicht dazu führen, dass gerade
//   der Prüfmechanismus unsichtbar bleibt.
//
// Umsetzung: reine, read-only Funktionen. ERKENNUNG über Marker des eigenen
// Checkouts unter <root> (nicht über Konfiguration, nicht über Pfad-Strings):
// existieren `artifacts/db.mjs`, `core/tools.mjs` und `cli/run.mjs` unter dem
// Arbeitsverzeichnis, wird die Kern-Whitelist automatisch ergänzt (Vereinigung
// mit der expliziten --files-Liste). Es werden NUR tatsächlich existierende
// Dateien ergänzt (feasibility blockt sonst mit „existieren nicht unter root").
// Fremdprojekte (ohne Marker) bleiben unverändert – nie Zugriffserweiterung
// außerhalb der Selbstprüfung.
//
// KEIN BLINDER BEREICH (Rig-Review 2026-09-01): Die Liste muss den GANZEN
// Prüfmechanismus enthalten – auch das Evil-Twin-Gate (core/twin.mjs) und die
// Prompt-Daten (core/prompt-text/*.md = die Prüf-Regeln, unter denen der
// Reviewer läuft). Werden neue Prüf-Prompt-Dateien ergänzt, gehören sie hier
// mit auf (sonst ist genau der Prüfmechanismus im Self-Review unsichtbar).
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";

/**
 * Kern-Komponenten der Prüfung (Prüf-Pipeline + Queue-Wahrheit + Vertrag):
 * darf KEINE blinden Bereiche enthalten – genau diese Liste kontrolliert der
 * Self-Review-Scope. Neben der Ausführungs-Pipeline gehören AUSDRÜCKLICH
 * auch das Evil-Twin-Gate (core/twin.mjs) und die Prompt-Daten
 * (core/prompt-text/system-*.md = die Prüf-Regeln als Daten) dazu: ein
 * Self-Review muss gerade diese Teile lesen können, sonst bleibt der
 * Prüfmechanismus unsichtbar (Regel 1, Rig-Review 2026-09-01).
 * Installations-/Deinstallations-Tools (uninstall.mjs, cli/bootstrap/*) sind
 * bewusst NICHT dabei: sie sind kein Prüfmechanismus und bleiben bei Bedarf
 * via --files explizit ergänzbar.
 */
export const SELF_REVIEW_CORE = [
  // Queue-Wahrheit (einzige Persistenz-Zentrale)
  "artifacts/db.mjs", "artifacts/jobs.mjs", "artifacts/scopes.mjs", "artifacts/invariants.mjs",
  // Prüf-Pipeline (Ausführung + Verdict-Hoheit)
  "cli/run.mjs", "cli/jobs.mjs", "cli/main.mjs", "cli/falsify.sh", "cli/help.mjs",
  "core/agent.mjs", "core/config.mjs", "core/feasibility.mjs", "core/keys.mjs",
  "core/prompt.mjs", "core/ratelimit.mjs", "core/selfreview.mjs", "core/settings.mjs",
  "core/tools.mjs", "core/twin.mjs", "core/verdict.mjs",
  // Prompt-Daten = die Prüf-Regeln (DE/EN + Evil-Twin) – neuer Prüf-Prompt
  // gehört hier mit auf, sonst ist der Prüfmechanismus unsichtbar (Regel 1).
  "core/prompt-text/system-de.md", "core/prompt-text/system-en.md",
  "core/prompt-text/system-eviltwin-de.md", "core/prompt-text/system-eviltwin-en.md",
  // Zustands-Surface (Scope-Lifecycle schreibt Scope-Zustand) + Vertragsprüfung
  "cli/scope.mjs", "cli/doctor.mjs",
  // Verarbeitung + Vertrag (Doku als Vertrag)
  "ui/worker.mjs", "README.md", "AGENTS.md", "WIRING.md", "ui/PLAN.md",
];

/** Marker des eigenen Checkouts – Existenz aller drei = Erkennung. */
const MARKERS = ["artifacts/db.mjs", "core/tools.mjs", "cli/run.mjs"];

/** True, wenn <root> ein FalsifyMe-Checkout ist (Selbstprüfung). */
export function isSelfReviewRoot(root) {
  return MARKERS.every((f) => fs.existsSync(path.join(root, f)));
}

/**
 * Whitelist für den Job: explizite --files-Liste, bei erkannter Selbstprüfung
 * ergänzt um die existierenden Kern-Komponenten (Union). Reine Funktion.
 * @param {string} root   Arbeitsverzeichnis (resolve vorher)
 * @param {string[]} files explizite Whitelist (relativ zu root)
 * @returns {{files: string[], added: string[]}} files = finale Liste, added =
 *   die automatisch ergänzten Kern-Komponenten (für die ehrliche Ausgabe)
 */
export function ensureSelfReviewWhitelist(root, files = []) {
  const base = [...new Set(files.map((f) => f.trim()).filter(Boolean))];
  if (!isSelfReviewRoot(root)) return { files: base, added: [] };
  const added = SELF_REVIEW_CORE.filter((f) => !base.includes(f) && fs.existsSync(path.join(root, f)));
  return { files: [...base, ...added], added };
}