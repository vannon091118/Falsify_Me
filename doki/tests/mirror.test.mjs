// MIRROR_V1 Freeze-Vertrag + Reinheits-Vertrag + Vokabular-Drift.
// Prueft: (1) gespiegelte Identifier paarweise exakt, (2) der reine Kern
// importiert KEIN FalsifyMe-Modul und macht KEIN I/O, (3) die Signal-Kataloge
// spiegeln die echten Quelldateien (statisch gelesen — der Kern selbst bleibt
// importfrei gegen FalsifyMe).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
// Windows: dynamischer ESM-Import braucht file://-URLs (keine nackten c:-Pfade).
const src = (p) => pathToFileURL(join(here, '..', 'src', p)).href;
const srcPath = (p) => join(here, '..', 'src', p);
const repo = (p) => join(here, '..', '..', p);
const read = (p) => readFileSync(p, 'utf8');
// Lesen von Kern-Quelldateien: Pfad-Variante.
const readSrc = (p) => readFileSync(srcPath(p), 'utf8');

// ── MIRROR_V1: A → reverse(A) ───────────────────────────────────────────────
const MIRROR_PAIRS = [
  ['state', 'etats'],
  ['delta', 'atled'],
  ['threshold', 'dlohserht'],
  ['decay', 'yaced'],
  ['rotate', 'etator'],
  ['history', 'yrotsih'],
  ['anomaly', 'ylamona'],
];

test('MIRROR_V1: jeder DOKI-Identifier ist exakt reverse(Falsify-Identifier)', () => {
  const rev = (s) => [...s].reverse().join('');
  for (const [falsify, doki] of MIRROR_PAIRS) {
    assert.equal(rev(falsify), doki, `Spiegel bricht: ${falsify} → erwartet ${rev(falsify)}, gefunden ${doki}`);
  }
});

test('MIRROR_V1: gespiegelte Operatoren existieren als Exporte mit gleicher Arity-Semantik', async () => {
  const rev = (s) => [...s].reverse().join('');
  const etats = await import(src('etats.mjs'));
  const atled = await import(src('atled.mjs'));
  // state↔etats: der Kern traegt den gespiegelten Namen (Modul etats.mjs)
  assert.equal(rev('state'), 'etats');
  assert.equal(typeof etats.step, 'function', 'state → rule → next state (eine Schrittfunktion)');
  assert.equal(typeof etats.yrotsih, 'function', 'history ist gespiegelt als yrotsih');
  // delta↔atled: atled(prev, next, axes) — gleiche Eingabedomaene (Werte), gleiche Ausgabe (Bewegung)
  assert.equal(atled.atled.length, 3, 'atled: (prev, next, axes) — gleiche Arity-Semantik wie eine Delta-Funktion');
  const move = atled.atled({ trust: { value: 0.5, provenance: 'OBSERVED' } }, { trust: { value: 0.75, provenance: 'OBSERVED' } }, ['trust']);
  assert.equal(move.trust.moved, true);
  assert.equal(atled.dlohserht(0.3, 0.25), true, 'threshold wirkt als Schwelle');
  assert.equal(atled.yaced(1.0, 0.5), 0.5, 'decay wirkt als Abkling');
});

// ── Reinheit: kein FalsifyMe-Import, kein I/O im reinen Kern ────────────────
const CORE = ['signals.mjs', 'atled.mjs', 'ylamona.mjs', 'blocks.mjs', 'etats.mjs'];

test('Reinheit: der reine Kern importiert kein FalsifyMe-Modul und macht kein I/O', () => {
  for (const file of CORE) {
    const text = readSrc(file);
    for (const forbidden of ['../artifacts', '../core', '../cli', '../ui', 'node:fs', 'node:sqlite', 'node:crypto']) {
      assert.ok(!text.includes(forbidden), `${file} importiert ${forbidden} — Reinheit verletzt`);
    }
    // Der Kern darf nur hash.mjs + eigene Kern-Module importieren.
    const imports = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const im of imports) {
      assert.ok(
        im.startsWith('./') || im === 'node:crypto',
        `${file} importiert Fremdes: ${im}`);
      assert.ok(
        ['./signals.mjs', './atled.mjs', './ylamona.mjs', './blocks.mjs', './etats.mjs', './hash.mjs', './narrator-catalog.mjs'].includes(im),
        `${file} importiert Nicht-Kern: ${im}`);
    }
  }
});

test('Reinheit: kein fetch/LLM/DB-Vokabular im reinen Kern', () => {
  for (const file of CORE) {
    const text = readSrc(file);
    for (const word of ['fetch(', 'DatabaseSync', 'INSERT INTO', 'UPDATE ', 'FALSIFY_API', 'DOKI_API']) {
      assert.ok(!text.includes(word), `${file} enthaelt ${word} — reine Logik verletzt`);
    }
  }
});

// ── Vokabular-Drift: Katalog spiegelt echte Quelldateien ────────────────────
test('Vokabular-Drift: FM_EVT_TYPES spiegelt ui/tui/events.mjs EVENT_TYPES', async () => {
  const uiText = read(repo(join('ui', 'tui', 'events.mjs')));
  const m = uiText.match(/EVENT_TYPES = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'EVENT_TYPES in ui/tui/events.mjs gefunden');
  const uiVocab = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  const { FM_EVT_TYPES } = await import(src('signals.mjs'));  assert.deepEqual([...FM_EVT_TYPES], uiVocab, 'DOKI-Signal-Katalog weicht vom FM-EVT-Vertrag ab');
});

test('Vokabular-Drift: CHARACTER_AXES spiegelt ensemble-state.mjs, REACTIVITY spiegelt narrator-catalog.mjs', async () => {
  const ensText = readSrc('ensemble-state.mjs');
  const mAxes = ensText.match(/CHARACTER_AXES = Object\.freeze\(\[([\s\S]*?)\]\)/);
  const uiAxes = [...mAxes[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  const catText = readSrc('narrator-catalog.mjs');
  const mRe = catText.match(/REACTIVITY_AXES = Object\.freeze\(\[([\s\S]*?)\]\)/);
  const catRe = [...mRe[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  const signals = await import(src('signals.mjs'));
  assert.deepEqual([...signals.CHARACTER_AXES], uiAxes);
  assert.deepEqual([...signals.REACTIVITY], catRe);
});

test('Vokabular-Drift: LOOP_STATES spiegeln artifacts/loops.mjs, VERDICT spiegelt ui/tui/verdict.mjs', async () => {
  const loopText = read(repo(join('artifacts', 'loops.mjs')));
  const mLoop = loopText.match(/LOOP_STATES = Object\.freeze\(\[([\s\S]*?)\]\)/);
  const loopVocab = [...mLoop[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
  const verdictText = read(repo(join('ui', 'tui', 'verdict.mjs')));
  const mV = verdictText.match(/const MAP = Object\.freeze\(\{([\s\S]*?)\}\);/);
  const verdictVocab = [...mV[1].matchAll(/^\s*([A-Z_]+):/gm)].map((x) => x[1]);
  const signals = await import(src('signals.mjs'));
  assert.deepEqual([...signals.LOOP_STATES], loopVocab);
  assert.deepEqual([...signals.VERDICT_CODES], verdictVocab);
});

test('User-Kanal ist ehrlich: Quelle NONE bis ein echter Kanal existiert', async () => {
  const { USER_CHANNEL_SOURCE, USER_ACTIONS } = await import(src('signals.mjs'));
  assert.equal(USER_CHANNEL_SOURCE, 'NONE');
  assert.ok(USER_ACTIONS.length >= 4);
});
