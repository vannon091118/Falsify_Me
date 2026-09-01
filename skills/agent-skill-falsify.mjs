#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// AGENT SKILL: FalsfyME Pflicht-Check (Node.js Modul) · FalsifyMe 2.0
// -----------------------------------------------------------------------------
// SCOPE-PROTOKOLL (nicht verhandelbar):
//   1. PLAN ist IMMER die Init-Aktion eines Scopes. Der Agent zitiert den
//      User-Input 1:1 – er wird zum HEADER des Prompts (falsify scope new).
//      Der HEADER bleibt in allen Scope-bezogenen Prompts (nie umformulieren).
//   2. 1 Scope = 1 Artefakt (in SQLite), aktualisiert von FalsifyMe mit
//      Key-Infos: User-Input, letzter vollständiger zusammenfassender Befund,
//      ALLE Befunde. Jeder Job startet das Modell NEU (Context = nur 1 Scope).
//   3. Loop bis Scope erfüllt (das LETZTE Review entscheidet):
//      - VERDICT: PLAN     → Plan überarbeiten (HEADER behalten), erneut einreichen
//      - VERDICT: RESEARCH → FalsifyMe braucht weitere Daten: read-only
//                            recherchieren, Befunde ergänzen, erneut einreichen
//      - VERDICT: WRITE    → FREIGABE: READ-ONLY → WRITE. Jetzt umsetzen, dann
//                            die Umsetzung erneut reviewen (WRITE-/REVIEW-Loop)
//   4. FalsifyMe selbst bleibt ABSOLUT read-only zum Projekt.
//   5. Nach dem finalen Review endet der Modellkontext; der nächste Scope
//      startet frisch im selben Fenster (getrennt, kein Vermischen).
//
// Verwendung (Agent-intern):
//   import { falsifyMandatoryCheck } from './agent-skill-falsify.mjs';
//   const result = await falsifyMandatoryCheck({
//     scopeId: 'scope-…',            // Pflicht bei Loop-Fortsetzung
//     userInput: '…',                // Pflicht beim Scope-Start (1:1 als HEADER)
//     planFile: 'plan.txt',
//     rootDir: '/path/to/project',
//     files: ['app.js', 'lib/auth.js'],
//     diffFile: 'changes.patch'      // optional
//   });
//
//   if (result.verdict === 'WRITE') {
//     // Freigabe: READ-ONLY → WRITE – jetzt umsetzen
//   } else {
//     // PLAN → Plan überarbeiten · RESEARCH → read-only recherchieren
//     // result.reason enthält die Kritik / den Datenbedarf
//   }
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const V2_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Typen ──────────────────────────────────────────────────────────────────
/**
 * @typedef {Object} FalsifyCheckOptions
 * @property {string} planFile - Pfad zur Plan-/Iterations-Datei (PFLICHT)
 * @property {string} rootDir - Arbeitsverzeichnis (PFLICHT)
 * @property {string[]} files - Zugriffs-Whitelist (PFLICHT)
 * @property {string} [diffFile] - Pfad zur Diff-Datei (optional)
 * @property {string} [lang] - Sprache: 'de' oder 'en' (optional, default: 'de')
 * @property {string} [scopeId] - Scope-ID (Pflicht bei Loop-Fortsetzung)
 * @property {string} [userInput] - User-Input 1:1 – wird HEADER (Pflicht beim Scope-Start)
 */

/**
 * @typedef {Object} FalsifyCheckResult
 * @property {boolean} passed - true nur bei VERDICT: WRITE (Freigabe)
 * @property {string} jobId - ID des Jobs
 * @property {string} scopeId - ID des Scopes
 * @property {string} verdict - 'WRITE', 'PLAN', 'RESEARCH', 'ERROR' oder 'UNBEKANNT'
 * @property {string} reason - Begründung aus der Kritik / Datenbedarf
 * @property {string} protocolPath - Hinweis auf das Protokoll (DB: falsify log <job-id>)
 * @property {number} exitCode - Exit-Code (0=WRITE, 1=PLAN/RESEARCH, 3=Fehler)
 */

// ── Hilfsfunktionen ────────────────────────────────────────────────────────
function log(level, msg) {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: 'ℹ️ ',
    ok: '✅',
    warn: '⚠️ ',
    error: '❌',
    step: '🔄'
  }[level] || '  ';
  console.log(`${prefix} [${timestamp}] ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runNode(args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: V2_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; if (capture) return; process.stdout.write(d); });
    child.stderr.on('data', d => { stderr += d; process.stderr.write(d); });
    child.on('close', code => resolve({ exitCode: code, stdout, stderr }));
    child.on('error', reject);
  });
}

function runBash(args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', args, { cwd: V2_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; if (capture) return; process.stdout.write(d); });
    child.stderr.on('data', d => { stderr += d; process.stderr.write(d); });
    child.on('close', code => resolve({ exitCode: code, stdout, stderr }));
    child.on('error', reject);
  });
}

// ── Worker-Fenster sicherstellen (bis zu 3 Fenster, IMMER offen lassen!) ────
async function ensureDockWindow() {
  log('step', 'Prüfe ob Falsify-Worker-Fenster offen sind...');

  const check = await runNode([path.join(V2_DIR, 'ui', 'worker.mjs'), '--check'], { capture: true });
  if (/RUNNING/.test(check.stdout)) {
    const pids = [...check.stdout.matchAll(/RUNNING (\d+)/g)].map(m => m[1]);
    log('ok', `Falsify-Fenster laufen bereits (${pids.length} Worker: PID ${pids.join(', ')})`);
    return true;
  }

  log('warn', 'Kein Falsify-Fenster offen – öffne Fenster (IMMER sichtbar!)...');
  // FENSTER MÜSSEN IMMER SICHTBAR SEIN: niemals headless starten.
  const startCmd = path.join(V2_DIR, 'ui', 'start-dock.cmd');
  if (!fs.existsSync(startCmd)) {
    throw new Error('start-dock.cmd fehlt – Falsify-Fenster müssen IMMER sichtbar sein (ui/start-dock.cmd [1|2|3]). Kein headless Start erlaubt.');
  }
  // start-dock.cmd öffnet ein SICHTBARES Fenster (wt.exe neuer Tab bzw. Konsolenfenster).
  spawn('cmd.exe', ['/c', 'start', '', startCmd], { cwd: V2_DIR, detached: true, stdio: 'ignore' }).unref();

  const maxWait = 30;
  for (let waited = 0; waited < maxWait; waited++) {
    await sleep(1000);
    const c = await runNode([path.join(V2_DIR, 'ui', 'worker.mjs'), '--check'], { capture: true });
    if (/RUNNING/.test(c.stdout)) {
      log('ok', 'Falsify-Fenster gestartet - Fenster bleiben offen');
      return true;
    }
  }
  throw new Error('Falsify-Worker konnte nicht gestartet werden');
}

// ── Scope sicherstellen: PLAN ist IMMER die Init-Aktion ────────────────────
async function ensureScope(scopeId, userInput) {
  if (scopeId) return scopeId;
  if (!userInput) {
    throw new Error('Beim Scope-Start ist userInput Pflicht (User-Input 1:1 – wird zum HEADER). Bei Loop-Fortsetzung scopeId angeben.');
  }
  log('step', 'PLAN = Init: Scope anlegen – User-Input wird 1:1 zum HEADER...');
  const r = await runNode([path.join(V2_DIR, 'cli', 'main.mjs'), 'scope', 'new', userInput], { capture: true });
  const m = r.stdout.match(/SCOPE_ID=(\S+)/);
  if (!m) throw new Error(`Scope konnte nicht angelegt werden: ${r.stdout || r.stderr}`);
  log('ok', `Scope angelegt: ${m[1]} (HEADER = User-Input 1:1)`);
  return m[1];
}

// ── Hauptfunktion ──────────────────────────────────────────────────────────
/**
 * Führt einen FalsfyME Pflicht-Check durch (Scope-Protokoll).
 * @param {FalsifyCheckOptions} options
 * @returns {Promise<FalsifyCheckResult>}
 */
export async function falsifyMandatoryCheck(options) {
  const { planFile, rootDir, files, diffFile, lang = 'de', scopeId, userInput } = options;

  if (!planFile || !rootDir || !files || files.length === 0) {
    throw new Error('planFile, rootDir und files sind Pflicht');
  }
  if (!fs.existsSync(planFile)) {
    throw new Error(`Plan-Datei nicht gefunden: ${planFile}`);
  }

  // ── 0. Fenster sicherstellen (bis zu 3, IMMER offen!) ─────────────────────
  await ensureDockWindow();

  // ── 0b. Scope: beim Start anlegen (PLAN = Init, HEADER = User-Input 1:1) ──
  const scope = await ensureScope(scopeId, userInput);

  log('step', 'FalsfyME Pflicht-Check wird gestartet...');
  log('info', `Scope: ${scope}`);
  log('info', `Plan: ${planFile}`);
  log('info', `Root: ${rootDir}`);
  log('info', `Dateien: ${files.join(', ')}`);
  if (diffFile) log('info', `Diff: ${diffFile}`);

  // ── 1+2. Job einreichen + blockierend warten (PFLICHT) ───────────────────
  log('step', 'Falsify-Check wird ausgeführt (blockierend – wartet auf Verdict)...');

  const checkArgs = [
    path.join(V2_DIR, 'cli', 'falsify.sh'),
    'submit',
    '--plan-file', planFile,
    '--root', rootDir,
    '--files', files.join(','),
    '--scope', scope,
  ];
  if (diffFile) checkArgs.push('--diff-file', diffFile);

  const { exitCode, stdout } = await runBash(checkArgs);
  const submitOutput = stdout;

  const jobIdMatch = submitOutput.match(/JOB_ID=([\w-]+)/);
  const jobId = jobIdMatch ? jobIdMatch[1] : 'unknown';

  // Verdict aus der blockierenden Warteschleife extrahieren
  const verdictMatch = submitOutput.match(/\bDONE (PLAN|RESEARCH|WRITE|UNBEKANNT)\b/i);
  let verdict = verdictMatch ? verdictMatch[1].toUpperCase() : null;
  if (!verdict) {
    const st = await runNode([path.join(V2_DIR, 'cli', 'main.mjs'), 'status', jobId], { capture: true });
    const m = st.stdout.match(/^DONE (\w+)/m);
    verdict = m ? m[1].toUpperCase() : (exitCode === 0 ? 'WRITE' : exitCode === 1 ? 'PLAN' : 'ERROR');
  }

  const passed = verdict === 'WRITE';

  // ── 3. Ergebnis aus der DB lesen (Kritik / Datenbedarf) ──────────────────
  let reason = '';
  const proto = await runNode([path.join(V2_DIR, 'cli', 'main.mjs'), 'log', jobId], { capture: true });
  const ergebnisIdx = proto.stdout.indexOf('### Ergebnis');
  if (ergebnisIdx >= 0) {
    reason = proto.stdout.slice(ergebnisIdx + '### Ergebnis'.length).replace(/^\s*\(volle Antwort\)\s*/, '').trim();
  }
  if (!reason) reason = submitOutput.split('\n').filter(Boolean).slice(-6).join('\n');

  if (passed) {
    log('ok', `VERDICT: WRITE → Freigabe: READ-ONLY → WRITE (Scope ${scope})`);
    log('info', `Protokoll: falsify log ${jobId}`);
  } else if (verdict === 'RESEARCH') {
    log('warn', 'VERDICT: RESEARCH → FalsifyMe braucht weitere Daten. Read-only recherchieren, Befunde ergänzen, erneut einreichen.');
    log('info', `Datenbedarf/Kritik: falsify log ${jobId}`);
  } else if (verdict === 'PLAN') {
    log('error', 'VERDICT: PLAN → Iteration überarbeiten (HEADER behalten), erneut einreichen.');
    log('info', `Kritik: falsify log ${jobId}`);
  } else {
    log('error', `VERDICT: ${verdict} → nicht freigegeben.`);
  }

  return {
    passed,
    jobId,
    scopeId: scope,
    verdict,
    reason,
    protocolPath: `(SQLite) falsify log ${jobId}`,
    exitCode
  };
}

// ── CLI-Modus ──────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`AGENT SKILL: FalsfyME Pflicht-Check (Node.js) · FalsifyMe 2.0

SCOPE-PROTOKOLL: PLAN ist IMMER Init (User-Input 1:1 als HEADER). Loop bis Scope
erfuellt: PLAN → überarbeiten · RESEARCH → read-only recherchieren · WRITE → Freigabe.

Verwendung:
  node agent-skill-falsify.mjs --user-input "<User-Input 1:1>" --plan plan.txt --root /path --files "a.js,b.js"
  node agent-skill-falsify.mjs --scope <scope-id> --plan plan.txt --root /path --files "a.js,b.js"   (Loop)

Optionen:
  --user-input <text>  User-Input 1:1 – wird HEADER des Scopes (beim Start Pflicht)
  --scope <id>         Scope-ID (bei Loop-Fortsetzung Pflicht)
  --plan <datei>       Plan-/Iterations-Datei (PFLICHT)
  --root <verz>        Arbeitsverzeichnis (PFLICHT)
  --files <liste>      Zugriffs-Whitelist, kommagetrennt (PFLICHT)
  --diff <datei>       Diff der Iteration (optional)
  --lang <de|en>       Sprache (optional, default: de)
  -h, --help           Diese Hilfe

Exit-Codes: 0=WRITE (Freigabe) · 1=PLAN/RESEARCH (Loop) · 3=Fehler`);
    process.exit(0);
  }

  const options = { planFile: null, rootDir: null, files: [], diffFile: null, lang: 'de', scopeId: null, userInput: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--plan': options.planFile = args[++i]; break;
      case '--root': options.rootDir = args[++i]; break;
      case '--files': options.files = args[++i].split(',').map(f => f.trim()).filter(Boolean); break;
      case '--diff': options.diffFile = args[++i]; break;
      case '--lang': options.lang = args[++i]; break;
      case '--scope': options.scopeId = args[++i]; break;
      case '--user-input': options.userInput = args[++i]; break;
    }
  }

  if (!options.planFile || !options.rootDir || options.files.length === 0) {
    console.error('Fehler: --plan, --root und --files sind Pflicht');
    process.exit(2);
  }

  try {
    const result = await falsifyMandatoryCheck(options);
    process.exit(result.exitCode);
  } catch (e) {
    console.error(`Fehler: ${e.message}`);
    process.exit(3);
  }
}
