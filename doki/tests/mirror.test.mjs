import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as atled from '../src/atled.mjs';
import * as etats from '../src/etats.mjs';
import * as ylamona from '../src/ylamona.mjs';
import { FM_EVENT_TYPES, CHARACTER_AXES, REACTIVITY_AXES } from '../src/signals.mjs';

const reverse = (value) => [...value].reverse().join('');
const ROOT = resolve(import.meta.dirname, '../..');

const MIRROR = Object.freeze({
  state: 'etats',
  delta: 'atled',
  threshold: 'dlohserht',
  decay: 'yaced',
  rotate: 'etator',
  history: 'yrotsih',
  anomaly: 'ylamona',
});

test('MIRROR_V1 identifier mapping is exact reverse()', () => {
  for (const [source, shadow] of Object.entries(MIRROR)) {
    assert.equal(reverse(source), shadow);
  }
  assert.equal(typeof etats.etats, 'function');
  assert.equal(typeof atled.atled, 'function');
  assert.equal(typeof atled.dlohserht, 'function');
  assert.equal(typeof atled.yaced, 'function');
  assert.equal(typeof ylamona.ylamona, 'function');
});

test('pure modules contain no runtime persistence or falsify imports', () => {
  for (const file of ['doki/src/etats.mjs', 'doki/src/atled.mjs', 'doki/src/ylamona.mjs']) {
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    assert.doesNotMatch(source, /from ['"](?:.*\/)?(?:db|falsify-reader|runtime|worker|prompt)\.mjs['"]/);
    assert.doesNotMatch(source, /(?:openDokiDb|openReadOnlyFalsifyDb|DatabaseSync)\s*\(/);
  }
});

test('signal vocabulary is backed by the real repository contracts', () => {
  const events = readFileSync(resolve(ROOT, 'ui/tui/events.mjs'), 'utf8');
  const ensemble = readFileSync(resolve(ROOT, 'doki/src/ensemble-state.mjs'), 'utf8');
  const catalog = readFileSync(resolve(ROOT, 'doki/src/narrator-catalog.mjs'), 'utf8');
  for (const value of FM_EVENT_TYPES) assert.match(events, new RegExp(`['"]${value.replaceAll('_', '\\_')}['"]`));
  for (const value of CHARACTER_AXES) assert.match(ensemble, new RegExp(`['"]${value}['"]`));
  for (const value of REACTIVITY_AXES) assert.match(catalog, new RegExp(`['"]${value}['"]`));
});
