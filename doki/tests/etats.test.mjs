// Der Kern: die EINE zentrale Maschine. Leiter, Grenz-Regel, Provenienz,
// Determinismus, ehrliche Entscheidungen (kein Fake-Relevant), q_table bleibt
// Relikt (wird hier NICHT beruehrt).
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, boundaryObservation, eventSignal, patternKey, ladderReach, LADDER, PROMPT_RELEVANCE_CAP } from '../src/signals.mjs';
import { step, run, digestOf, yrotsih } from '../src/etats.mjs';
import { DLOHSERHT_DEFAULT } from '../src/atled.mjs';
import { retired, RETIREMENT } from '../src/ylamona.mjs';

test('Grenz-Regel: Ereignis ohne Produzenten-Identitaet ist kein Ereignis (fail-closed)', () => {
  assert.throws(() => boundaryObservation({ event_type: 'finding' }), /source_event_id/);
  const ok = boundaryObservation({ source_event_id: 'FM-EVT:abc', event_type: 'finding', payload: { severity: 'critical' } });
  assert.equal(ok.source_event_id, 'FM-EVT:abc');
});

test('Signal-Ableitung: echte FM-EVT-Felder, null statt Fiktion', () => {
  assert.equal(eventSignal({ event_type: 'boot' }), null, 'boot ist beobachtet, aber kein narratives Signal');
  const f = eventSignal(boundaryObservation({ source_event_id: 'x', event_type: 'finding', payload: { severity: 'critical' } }));
  assert.equal(f.kind, 'finding');
  assert.equal(f.severity, 'critical');
  assert.equal(f.care, 'ATTACK');
  const v = eventSignal(boundaryObservation({ source_event_id: 'y', event_type: 'verdict', payload: { v: 'WRITE' } }));
  assert.equal(v.code, 'WRITE');
  assert.equal(eventSignal(boundaryObservation({ source_event_id: 'z', event_type: 'verdict', payload: { v: 'FANTASIE' } })), null, 'unbekannter Code = kein Signal');
});

test('Muster-Schluessel: phase/verdict/wave deterministisch', () => {
  assert.equal(patternKey({ phase: 'PLAN', verdict: 'PLAN', wave: 'scan' }), 'p:PLAN|v:PLAN|w:scan');
  assert.equal(patternKey(), 'p:-|v:-|w:-');
});

test('Leiter: genau eine Stufe je Schritt, sonst fail-closed', () => {
  assert.deepEqual([...LADDER], ['OBSERVED', 'PERSISTED', 'DERIVED', 'NARRATIVELY_RELEVANT']);
  assert.equal(ladderReach('OBSERVED', 'PERSISTED'), true);
  assert.equal(ladderReach('OBSERVED', 'DERIVED'), false, 'zwei Stufen ueberspringen ist verboten');
  assert.equal(ladderReach('PERSISTED', 'PERSISTED'), false);
});

test('Provenienz: DEFAULT-Werte erzeugen keine Wirkung (Startzustand ist keine Nachricht)', () => {
  const s = initialState();
  const before = digestOf(s);
  // 'output'-Ereignis: kein narratives Signal → keine Bewegung, keine Wirkung.
  const r = step(s, { source_event_id: 'e1', event_type: 'output', payload: { line: 'hallo' } });
  assert.equal(Object.keys(r.atleds).length, 0, 'ohne narratives Signal keine Achsen-Bewegung');
  assert.equal(r.impacts.length, 0);
  assert.equal(digestOf(r.etats) !== before, true, 'Leiter/seen bewegen sich trotzdem (ehrlich beobachtet)');
});

test('Echte Bewegung: finding(critical) wirkt auf irritation, Impact ist Messgroesse mit Evidenz', () => {
  const r = step(initialState(), { source_event_id: 'FM-EVT:f1', event_type: 'finding', payload: { severity: 'critical' } });
  const m = r.atleds.irritation;
  assert.ok(m, 'irritation bewegt sich');
  assert.equal(m.provenance, 'OBSERVED');
  assert.equal(m.effective, true);
  assert.ok(m.atled > DLOHSERHT_DEFAULT, 'critical bewegt ueber die Standard-Schwelle');
  const im = r.impacts.find((x) => x.feature === 'irritation');
  assert.ok(im);
  assert.deepEqual(im.evidence_refs, ['FM-EVT:f1'], 'Wirkung traegt echte Grenz-Evidenz');
  assert.equal(im.contradiction, 'HIGH', 'finding = ATTACK → Widerspruch sichtbar, aber nur als Messfeld');
  // Messgroesse, keine Wahrheit: das etats speichert NUR Achsenwerte, keine Prosa.
  assert.equal(JSON.stringify(r.etats).includes('Drama'), false);
});

test('Primitive sind strukturiert und textfrei', () => {
  const r = run(initialState(), [
    { source_event_id: 'a', seq: 1, event_type: 'finding', payload: { severity: 'warning' } },
    { source_event_id: 'b', seq: 2, event_type: 'loop', payload: { s: 'WRITE_AUTHORIZED' } },
    { source_event_id: 'c', seq: 3, event_type: 'verdict', payload: { v: 'WRITE' } },
  ]);
  for (const s of r.steps) {
    for (const p of s.primitives) {
      assert.equal(typeof p.primitive, 'string');
      assert.ok(Array.isArray(p.evidence_refs));
      assert.ok('pattern_key' in p);
      // Kein freier Text im Primitive: Felder sind Schluessel/Referenzen/Zahlen.
      // Erlaubte String-Felder sind NUR feste Vokabular-Schluessel (keine Prosa).
      const STRING_KEYS = ['primitive', 'rule_version', 'pattern_key', 'feature', 'state', 'code', 'severity', 'kind'];
      for (const [k, v] of Object.entries(p)) {
        if (STRING_KEYS.includes(k)) continue; // Schluessel, keine Prosa
        const t = v === null ? 'null' : typeof v;
        assert.ok(Array.isArray(v) || ['number', 'object', 'boolean', 'null', 'undefined'].includes(t), `Primitive-Feld ${k} traegt freien Text (${t})`);
      }
    }
  }
  const kinds = r.steps.flatMap((s) => s.primitives.map((p) => p.primitive));
  assert.ok(kinds.includes('CONTRADICTION'));
  assert.ok(kinds.includes('CLAIM'));
  assert.ok(kinds.includes('STATUS_SHIFT'));
});

test('Anomalie: grosse Bewegung OHNE Evidenz-Referenz ist UNBACKED_MOVE', async () => {
  const { unbackedMove } = await import('../src/ylamona.mjs');
  assert.equal(unbackedMove({ moved: true, effective: true, atled: 0.4, feature: 'trust' }, { evidenceRefs: ['ref-1'] }), null, 'belegt = keine Anomalie');
  const rec = unbackedMove({ moved: true, effective: true, atled: 0.4, feature: 'trust' }, { evidenceRefs: [] });
  assert.equal(rec?.kind, 'UNBACKED_MOVE');
});

test('Entscheidung ist ehrlich: kein Fake-Relevant vor dem Relevanz-Filter', () => {
  const r = step(initialState(), { source_event_id: 'x1', event_type: 'finding', payload: { severity: 'critical' } });
  assert.equal(r.decision.prompt_relevant, false, 'NARRATIVELY_RELEVANT ist verdient, nicht gesetzt');
  assert.equal(r.decision.relevance_cap, PROMPT_RELEVANCE_CAP);
  // Und die Leiter des Signals steht NUR auf OBSERVED.
  assert.equal(Object.values(r.etats.ladder).every((v) => v === 'OBSERVED'), true);
});

test('Determinismus: gleiche Beobachtungen → gleicher etats-Digest', () => {
  const obs = [
    { source_event_id: 'o1', seq: 1, event_type: 'job', payload: { id: 'J1' } },
    { source_event_id: 'o2', seq: 2, event_type: 'finding', payload: { severity: 'warning' } },
    { source_event_id: 'o3', seq: 3, event_type: 'verdict', payload: { v: 'PLAN' } },
  ];
  const a = run(initialState(), obs);
  const b = run(initialState(), obs);
  assert.equal(digestOf(a.etats), digestOf(b.etats));
  // Ordnungs-Regel: seq entscheidet, nicht Array-Reihenfolge (wie bridge.sortObservations).
  const shuffled = run(initialState(), [...obs].reverse());
  assert.equal(digestOf(shuffled.etats), digestOf(a.etats), 'Reihenfolge-invariant bei konsistenter seq');
});

test('yrotsih (history gespiegelt): Besuche ehrlich gezaehlt — Replay statt Call wird anreichbar', () => {
  const obs = { source_event_id: 'r1', seq: 1, event_type: 'verdict', payload: { v: 'PLAN' } };
  const a = run(initialState(), [obs, { ...obs, source_event_id: 'r2', seq: 2 }]);
  const h = yrotsih(a.etats);
  const pk = patternKey({ verdict: 'PLAN' });
  assert.equal(h.visits[pk], 2, 'zweiter Besuch desselben Musters = visits 2 (ehrlicher Satz)');
});

test('Ruhestand: 3 Anomalien in 2+ Laeufen entzieht Recall, Evidenz-Spur bleibt', () => {
  const anomalies = [
    { run_id: 'R1', kind: 'UNBACKED_MOVE' },
    { run_id: 'R1', kind: 'NO_MATCH' },
    { run_id: 'R2', kind: 'UNBACKED_MOVE' },
  ];
  assert.equal(retired(anomalies), true);
  assert.equal(retired(anomalies.slice(0, 2)), false, '2 Anomalien reichen nicht');
  const oneRun = [{ run_id: 'R1', kind: 'UNBACKED_MOVE' }, { run_id: 'R1', kind: 'NO_MATCH' }, { run_id: 'R1', kind: 'NO_SIGNAL' }];
  assert.equal(retired(oneRun), false, 'nie alles aus EINEM Lauf');
  assert.equal(RETIREMENT.n, 3);
});

test('q_table bleibt Relikt: der reine Kern beruehrt sie NICHT', async () => {
  // Struktur-Check: kein Kern-Modul referenziert q_table/qlearning.
  for (const f of ['signals.mjs', 'atled.mjs', 'ylamona.mjs', 'blocks.mjs', 'etats.mjs']) {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.ok(!text.includes('q_table'), `${f} rührt q_table an`);
    assert.ok(!text.includes('qlearning'), `${f} rührt qlearning an`);
  }
});
