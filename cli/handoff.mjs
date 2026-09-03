// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/handoff.mjs – `falsify handoff complete` (TASK-008)
// -----------------------------------------------------------------------------
// Der externe USER AGENT (einziger Repository-Writer) meldet nach seiner
// Umsetzung den Write-Report zurück. FalsifyMe konsumiert und validiert ihn
// (Identität, Handoff-Korrelation, Before/After-Content, Whitelist, Digests),
// vollzieht die Loop-Übergänge und reichert GENAU EINEN Re-Review-Job über
// die einzige Queue an (artifacts/handoff.mjs completeHandoff). FalsifyMe
// schreibt selbst NIE die Implementierung (REQ-004).
//
// Verwendung:
//   falsify handoff complete --file report.json --root <projekt-root>
//
// Report-Felder (v1): handoff_id, job_id, scope_id, checkout_id, writer_id,
//   before_digest, after_digest, changed_files, diff_digest, write_status
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { openDb, closeDb, falsifyHome } from "../artifacts/db.mjs";

// UI-123: Loop-Zustand dem Dock spiegeln (FM-EVT-Protokoll wie cli/run.mjs).
// Nur mit FALSIFY_UI=1 sichtbar; ohne UI-Flag bleibt die CLI-Ausgabe unverändert.
const UI_EVTS = process.env.FALSIFY_UI === "1";
const emitLoop = (s) => { if (UI_EVTS) console.log("FM-EVT: " + JSON.stringify({ t: "loop", s, window: 1 })); };
import { getJob, jobFilesList } from "../artifacts/jobs.mjs";
import { snapshotRoot, compareSnapshots, validateChangeReport } from "../core/changes.mjs";
import * as handoffCore from "../core/handoff.mjs";
import { completeHandoff } from "../artifacts/handoff.mjs";
import { getLoopState } from "../artifacts/loops.mjs";
import { enforceQueueConsistency } from "../artifacts/invariants.mjs";

const HELP = `falsify handoff – externer Write-Übergabepunkt (Re-Review wird automatisch eingereicht)

Verwendung:
  falsify handoff brief --job-id <job-id>    Arbeitsanweisung für den externen
                                             Coding-Agent aus dem Handoff rendern
                                             (nur aus dem persistierten Handoff;
                                             fail-closed bei fehlendem/ungültigem Handoff)
  falsify handoff report --job-id <job-id>   Write-Report generieren: FalsifyMe misst
                           --root <projekt-root>  den Repo-Zustand selbst und füllt
                           [--out report.json]    alle Digests/changed_files vor;
                           [--writer-id <id>]     der Agent bezeugt nur Absicht
  falsify handoff complete --file <report.json> --root <projekt-root>

Report-Pflichtfelder:
  handoff_id, job_id, scope_id, checkout_id, writer_id, before_digest,
  after_digest, changed_files, diff_digest, write_status (COMPLETED|NO_CHANGE|ABORTED)`;

/**
 * `falsify handoff brief` – rendert die Coder-Arbeitsanweisung aus dem
 * persistierten Handoff (RED-Fact-Finding §14.133: kleinster Übergabepunkt).
 * Liest NUR; erzeugt keine Wahrheit, ändert keinen Zustand, startet nichts.
 */
function handoffBrief(args) {
  let jobId = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--job-id") jobId = args[++i];
    else { console.error(`FEHLER: Unbekannte Option: ${args[i]} (--job-id ist Pflicht)`); process.exit(2); }
  }
  if (!jobId) { console.error("FEHLER: --job-id <job-id> ist Pflicht."); process.exit(2); }
  const { renderCoderBrief } = handoffCore;
  const db = openDb();
  try {
    const job = getJob(db, jobId);
    if (!job) { console.error(`FEHLER: Job nicht gefunden: ${jobId}`); closeDb(); process.exit(2); }
    if (!job.handoff_id) {
      console.error(`FEHLER: Job trägt keinen Handoff (kein WRITE_AUTHORIZED-Lauf): ${jobId}`);
      closeDb(); process.exit(3);
    }
    const handoffPath = path.join(falsifyHome(), "logs", `handoff-${job.id}.json`);
    let handoff = null;
    try { handoff = JSON.parse(fs.readFileSync(handoffPath, "utf8")); }
    catch { /* fehlt → fail-closed unten */ }
    if (!handoff) {
      console.error(`FEHLER: Handoff nicht gefunden (${handoffPath}) – kein Coder-Brief ohne validen Handoff.`);
      closeDb(); process.exit(3);
    }
    if (handoff.handoff_id !== job.handoff_id) {
      console.error("FEHLER: Handoff-/Job-Korrelation fehlgeschlagen (stale oder fremdes Handoff).");
      closeDb(); process.exit(3);
    }
    const rendered = renderCoderBrief(handoff);
    if (!rendered.ok) {
      console.error(`FEHLER: ${rendered.reason}`);
      closeDb(); process.exit(3);
    }
    closeDb();
    console.log(rendered.brief);
    process.exit(0);
  } catch (e) {
    console.error(`FEHLER: ${e.message}`);
    closeDb();
    process.exit(3);
  }
}

/**
 * `falsify handoff report` – Write-Report generieren (UI-137, 2026-09-03).
 * Der externe Coding-Agent kann die Report-Digests (before/after/diff,
 * changed_files) nicht von Hand kennen – FalsifyMe misst den Repo-Zustand
 * selbst (dieselben snapshotRoot/compareSnapshots-Funktionen, die `complete`
 * zur Validierung nutzt) und fuellt alle maschinenmessbaren Felder vor.
 * Der Agent bezeugt nur noch Absicht: writer_id (+ write_status bei
 * NO_CHANGE/ABORTED). Read-only: kein DB-Write, kein Loop-Uebergang, kein
 * FM-EVT-Event. Der Report erteilt KEINE Freigabe – `falsify handoff
 * complete` bleibt der einzige, unveraenderte Gate (validateChangeReport).
 */
function handoffReport(args) {
  let jobId = null;
  let root = null;
  let out = "report.json";
  let writerId = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--job-id") jobId = args[++i];
    else if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--out") out = args[++i];
    else if (args[i] === "--writer-id") writerId = args[++i];
    else { console.error(`FEHLER: Unbekannte Option: ${args[i]} (--job-id und --root sind Pflicht; --out und --writer-id optional)`); process.exit(2); }
  }
  if (!jobId) { console.error("FEHLER: --job-id <job-id> ist Pflicht."); process.exit(2); }
  if (!root) { console.error("FEHLER: --root <projekt-root> ist Pflicht."); process.exit(2); }

  const db = openDb();
  try {
    const job = getJob(db, jobId);
    if (!job) { console.error(`FEHLER: Job nicht gefunden: ${jobId}`); closeDb(); process.exit(2); }
    if (!job.handoff_id) {
      console.error(`FEHLER: Job traegt keinen Handoff (kein WRITE_AUTHORIZED-Lauf): ${jobId}`);
      closeDb(); process.exit(3);
    }
    const handoffPath = path.join(falsifyHome(), "logs", `handoff-${job.id}.json`);
    let handoff = null;
    try { handoff = JSON.parse(fs.readFileSync(handoffPath, "utf8")); }
    catch { /* fehlt → fail-closed unten */ }
    if (!handoff) {
      console.error(`FEHLER: Handoff nicht gefunden (${handoffPath}) – kein Report ohne validen Handoff.`);
      closeDb(); process.exit(3);
    }
    if (handoff.handoff_id !== job.handoff_id) {
      console.error("FEHLER: Handoff-/Job-Korrelation fehlgeschlagen (stale oder fremdes Handoff).");
      closeDb(); process.exit(3);
    }
    // Whitelist-Bindung wie `complete` (SEC-002): die Parent-Whitelist ist der
    // autorisierte Zugriffsrahmen für den Content-Vergleich.
    const allowedFiles = jobFilesList(job);
    const rootDir = path.resolve(root === "." ? process.cwd() : root);
    const after = snapshotRoot(rootDir, allowedFiles.length ? allowedFiles : null);
    const comparison = compareSnapshots(handoff.before_snapshot, after, { allowedFiles });
    const report = {
      handoff_id: handoff.handoff_id,
      job_id: handoff.job_id,
      scope_id: handoff.scope_id,
      checkout_id: handoff.checkout_id,
      writer_id: writerId ?? "",
      before_digest: comparison.before_digest,
      after_digest: comparison.after_digest,
      changed_files: comparison.changed_files,
      diff_digest: comparison.diff_digest,
      write_status: "COMPLETED",
    };
    const outPath = path.resolve(out);
    if (fs.existsSync(outPath)) {
      console.error(`FEHLER: Report existiert bereits: ${outPath} – nichts ueberschrieben (bestehenden Report pruefen oder --out neu waehlen).`);
      closeDb(); process.exit(2);
    }
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    // Ehrliche Ausgabe: WAS gemessen wurde, WO der Report liegt, WAS fehlt.
    console.log(`HANDOFF_REPORT=${outPath}`);
    console.log(`Scope: ${handoff.scope_id ?? "–"} · Job: ${handoff.job_id ?? "–"} · Handoff: ${handoff.handoff_id}`);
    if (comparison.unauthorized_files.length) {
      console.warn(`⚠ Aenderung ausserhalb der Whitelist: ${comparison.unauthorized_files.join(", ")} – ` +
        `falsify handoff complete wird diesen Report ablehnen (Whitelist: ${allowedFiles.join(", ") || "–"}).`);
    } else if (comparison.changed_files.length) {
      console.log(`Geaenderte Dateien (${comparison.changed_files.length}):`);
      for (const f of comparison.changed_files) console.log(`  · ${f}`);
    } else {
      console.log("Keine Aenderung an den Whitelist-Dateien – wenn das beabsichtigt ist, write_status auf \"NO_CHANGE\" setzen.");
    }
    if (!writerId) console.warn("writer_id ist leer – vor `falsify handoff complete` ausfuellen (oder --writer-id <id> angeben).");
    console.log("Der Report erteilt KEINE Freigabe: `falsify handoff complete --file <report> --root <root>` bleibt der einzige Gate (misst selbst nach).");
    closeDb();
    process.exit(0);
  } catch (e) {
    console.error(`FEHLER: ${e.message}`);
    closeDb();
    process.exit(3);
  }
}

export async function runHandoff(args) {
  const sub = args[0];
  if (sub === "-h" || sub === "--help" || !sub) {
    console.log(HELP);
    process.exit(sub ? 0 : 2);
  }
  if (sub === "brief") return handoffBrief(args.slice(1));
  if (sub === "report") return handoffReport(args.slice(1));
  if (sub !== "complete") {
    console.error(`FEHLER: Unbekannter handoff-Befehl: ${sub} (nur 'brief' | 'report' | 'complete')`);
    process.exit(2);
  }
  let file = null;
  let root = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--file") file = args[++i];
    else if (args[i] === "--root") root = args[++i];
    else { console.error(`FEHLER: Unbekannte Option: ${args[i]}`); process.exit(2); }
  }
  if (!file) { console.error("FEHLER: --file <report.json> ist Pflicht."); process.exit(2); }
  if (!root) { console.error("FEHLER: --root <projekt-root> ist Pflicht."); process.exit(2); }

  let report;
  try { report = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { console.error(`FEHLER: Report nicht lesbar (${file}): ${e.message}`); process.exit(2); }
  // NODE-REVIEW-2026-09-03: Der Agent-Report ist UNTRUSTED — getJob(db,
  // report.job_id) läuft VOR validateChangeReport. Ohne Guard trifft ein
  // fehlender/kein-String job_id (oder ein ganz kaputtes Report-Objekt) die
  // node:sqlite-Bind-Falle ("Provided value cannot be bound...", irreführend,
  // Exit 3) bzw. einen TypeError — Pflichtfeld-Verletzungen gehören aber zur
  // ehrlichen Exit-2-Vertragsklasse (wie --job-id auf CLI-Ebene). Guard VOR
  // jedem DB-Zugriff, fail-closed; valid geformte Reports passieren unangetastet.
  if (typeof report?.job_id !== "string" || !report.job_id.trim()) {
    console.error("FEHLER: Report-Pflichtfeld job_id fehlt oder ist kein nicht-leerer String (Abbruch VOR jedem DB-Zugriff).");
    process.exit(2);
  }

  const db = openDb();
  try {
    const job = getJob(db, report.job_id);
    if (!job) { console.error(`FEHLER: Job nicht gefunden: ${report.job_id}`); closeDb(); process.exit(2); }
    // Identitäts-/Whitelist-Bindung: die Whitelist des Parent-Jobs ist der
    // autorisierte Zugriffsrahmen für die Change-Verifikation (SEC-002).
    const allowedFiles = jobFilesList(job);
    const rootDir = path.resolve(root === "." ? process.cwd() : root);
    const after = snapshotRoot(rootDir, allowedFiles.length ? allowedFiles : null);
    // Handoff laden (vom WRITE-Lauf persistiert).
    // falsifyHome() (nicht env-Abhängig mit ""-Fallback): ohne FALSIFY_HOME
    // würde der Pfad sonst cwd-relativ und verfehlt den WRITE-Lauf-Speicherort.
    const handoffPath = path.join(falsifyHome(), "logs", `handoff-${job.id}.json`);
    let handoff = null;
    try { handoff = JSON.parse(fs.readFileSync(handoffPath, "utf8")); }
    catch { /* fehlt → Korrelation fail-closed unten */ }
    if (!handoff) {
      console.error(`FEHLER: Handoff nicht gefunden (${handoffPath}) – kein Re-Review ohne validen Handoff.`);
      closeDb(); process.exit(3);
    }
    if (job.change_digest && handoff.before_snapshot?.digest && job.change_digest !== handoff.before_snapshot.digest) {
      console.error("FEHLER: Basis-Digest des Jobs weicht vom Handoff-Before-Snapshot ab (stale Handoff).");
      closeDb(); process.exit(3);
    }
    // before_snapshot aus dem Handoff + gemessener After-Zustand → Vergleich.
    const comparison = compareSnapshots(handoff.before_snapshot, after, { allowedFiles });
    const validation = validateChangeReport(report, { handoff, after, allowedFiles });
    if (!validation.ok) {
      console.error("FEHLER: Write-Report ungültig – kein Re-Review (fail-closed):");
      for (const r of validation.reasons) console.error(`  · ${r}`);
      closeDb(); process.exit(3);
    }
    // Re-Review-Job erbt den Job-Snapshot des Parents (TASK-004: Konfiguration
    // bleibt über den ganzen Loop hinweg eingefroren).
    const parentCfg = job.runtime_config ? JSON.parse(job.runtime_config) : null;
    const result = completeHandoff(db, {
      report,
      handoff,
      changeComparison: comparison,
      allowedFiles,
      reReviewJob: {
        payload: `Re-Review (Iteration ${report.iteration_label || 2}): Umsetzung des externen Writers verifizieren. Changed: ${comparison.changed_files.join(", ")}`,
        root: rootDir,
        files: allowedFiles.join(","),
        runtimeConfig: parentCfg,
        mode: "write",
      },
    });
    if (!result.ok) {
      console.error("FEHLER: Handoff-Completion abgelehnt:");
      for (const r of result.reasons) console.error(`  · ${r}`);
      closeDb(); process.exit(3);
    }
    enforceQueueConsistency(db);
    // Loop-Zustand nach der Completion spiegeln (ehrt auch LOOP_BLOCKED/ABORTED).
    const finalLoopState = getLoopState(db, report.job_id);
    if (finalLoopState) emitLoop(finalLoopState);
    console.log(`HANDOFF_OK=${report.handoff_id}`);
    console.log(result.idempotent
      ? `IDEMPOTENT=true  (bereits verarbeitet – kein zweites Re-Review)`
      : `RE_REVIEW_JOB_ID=${result.re_review_job_id}`);
    console.log(`Loop-State: ${getLoopState(db, report.job_id)}`);
    if (result.re_review_job_id) {
      console.log(`Re-Review eingereicht: falsify status ${result.re_review_job_id}`);
    }
    closeDb();
    process.exit(0);
  } catch (e) {
    console.error(`FEHLER: ${e.message}`);
    closeDb();
    process.exit(3);
  }
}
