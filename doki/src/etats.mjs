// DOKI reiner Kern — DIE EINE zentrale Zustandsmaschine (MIRROR_V1)
// (PLATZHALTER-ETUDE, nicht im Runtime-Pfad).
//
// Verantwortung: der EINZIGE Uebergangs-Kern der narrativen Welt. Input:
// etats + Grenz-Ereignis + deterministische Regeln. Output: Uebergang +
// abgeleitete Werte + Entscheidungen. KEIN DB, KEIN FalsifyMe, KEIN LLM,
// KEIN UI, KEIN User — pure Logik, importfrei ausser den eigenen reinen
// Regel-Bibliotheken.
//
// MIRROR_V1: Falsify state↔DOKI etats, delta↔atled, threshold↔dlohserht,
// decay↔yaced, history↔yrotsih, anomaly↔ylamona. Gleiche Regelstruktur
// (etats → Regel → naechstes etats), gespiegelte Identifier — der
// Freeze-Vertrag lebt in doki/tests/mirror.test.mjs.
//
// Grenze (EVIL-TWIN-PRINZIP in gross): Falsify erreicht DOKI NUR als
// Beobachtung (signals.boundaryObservation). Kein Methodenruf, nie DOKI→Falsify.
// DOKI darf falschliegen: die Interpretationen hier sind Glaube, nicht Wahrheit.

import { RULE_VERSION, initialState, LADDER, PROMPT_RELEVANCE_CAP,
         boundaryObservation, eventSignal, patternKey, ladderReach } from './signals.mjs';
// LADDER/ladderReach bleiben importiert: der Leiter-Vertrag ist Teil der
// Maschinen-Oberflaeche (Vertragspruefung durch Tests, Anhebung nur durch
// echte Persistenz-/Relevanz-Schritte).
import { ATLED_RULE_VERSION, atled, impactsOf } from './atled.mjs';
import { YLAMONA_RULE_VERSION, ylamona } from './ylamona.mjs';
import { BLOCKS_RULE_VERSION, primitivesOf } from './blocks.mjs';
import { digestJson } from './hash.mjs';

export const ETATS_RULE_VERSION = 'doki.etats.v1';

// ── yrotsih (gespiegelt: history) ───────────────────────────────────────────
// Reiner Rueckblick: Muster-Besuche + letzte Schluessel. Kein Schreiben.
export function yrotsih(etats) {
  return Object.freeze({ visits: { ...etats.seen }, last_pattern: etats.last_pattern ?? null });
}

// ── Der EINZIGE Uebergangsschritt ───────────────────────────────────────────
// step(etats, observation) → { etats', transition, atleds, impacts, ylamona, primitives, decision }
//
// Regeln (deterministisch, in Reihenfolge):
//   1. Grenz-Form erzwingen (boundaryObservation) — ein Ereignis ohne
//      Produzenten-Identitaet ist KEIN Ereignis (fail-closed).
//   2. Signal ableiten (signals.eventSignal) — null ist ehrliches Nichtwissen.
//   3. Achsen-Bewegungen messen (atled) — nur OBSERVED wirkt; DEFAULT bleibt
//      still (Startzustand ist keine Nachricht).
//   4. Wirkungen messen (impactsOf) — Messgroesse, keine Wahrheit.
//   5. Anomalien pruefen (ylamona) — unbelegte Bewegung ist Anomalie.
//   6. Primitive bilden (primitivesOf) — strukturiert, kein Text.
//   7. Leiter: OBSERVED (hier) → PERSISTED/DERIVED/NARRATIVELY_RELEVANT
//      durch den jeweiligen echten Schritt (Writer/Relevanz-Filter) — die
//      Maschine setzt NUR OBSERVED und leitet; die hoeheren Stufen verdient
//      sich der Signal-Schluessel durch echte Persistenz/Relevanz.
export function step(etats, observation, { threshold } = {}) {
  if (!etats || etats.rule_version !== RULE_VERSION) throw new Error('DOKI etats fehlen oder fremde Regelversion');
  const obs = boundaryObservation(observation); // Regel 1
  const signal = eventSignal(obs);              // Regel 2

  // Bewegungen: nur wenn das Signal eine Achse beruehrt. Nicht-fiktiv: die
  // Achs-Auswahl kommt aus dem Signal (reactivity), nicht aus Phantasie.
  const movements = {};
  if (signal) {
    const axis = axisFor(signal);
    if (axis) {
      const key = `self->${axis}`; // Selbstzustand des Kerns (Charakter-Zuordnung später, Ecke Ensemble-Anbindung)
      const cur = etats.relations[key] ?? { value: 0, provenance: 'DEFAULT' };
      const stepped = Math.min(1, (Number(cur.value) || 0) + magnitudeFor(signal));
      movements[axis] = {
        feature: axis,
        from: cur.value, to: stepped,
        atled: Math.round((stepped - Number(cur.value)) * 10000) / 10000,
        moved: true,
        provenance: 'OBSERVED', // echte Grenz-Bewegung
        effective: true,
      };
    }
  }

  const impacts = impactsOf(movements, {
    evidenceRefs: [obs.source_event_id],
    novelPattern: signal ? !(etats.seen[patternKey({ phase: signal.kind ?? null, verdict: signal.code ?? signal.state ?? null })] ?? 0) : false,
    contradictoryEvidence: signal?.care === 'ATTACK',
  });

  const anomalies = ylamona({ movements, evidenceRefs: [obs.source_event_id], signal }, { threshold });

  const pk = patternKey({
    phase: signal?.phase ?? (signal?.kind === 'loop' ? signal.state : null),
    verdict: signal?.code ?? null,
    wave: signal?.kind === 'finding' ? signal.severity : (signal?.kind === 'handoff' ? 'handoff' : null),
  });
  const primitives = signal ? primitivesOf({ signal, impacts, patternKey: pk, evidenceRefs: [obs.source_event_id] }) : [];

  // Regel 7 (Leiter): dieses Ereignis ist beobachtet (OBSERVED). PERSISTED und
  // NARRATIVELY_RELEVANT sind dem naechsten echten Schritt vorbehalten
  // (Writer bzw. Relevanz-Filter) — die Maschine luegt sich nichts hoch.
  const key = obs.source_event_id;
  const ladder = { ...etats.ladder, [key]: 'OBSERVED' };

  const next = {
    rule_version: RULE_VERSION,
    ladder,
    relations: applyMovements(etats.relations, movements),
    seen: { ...etats.seen, [pk]: (etats.seen[pk] ?? 0) + 1 },
    last_pattern: pk,
  };

  // Entscheidung: prompt-eligibel nur unter der harten Leiter + Kappe.
  const relevant = primitives.filter(() => false).length; // NARRATIVELY_RELEVANT kommt mit dem Relevanz-Filter (Etappe 3)
  const decision = Object.freeze({
    rule_version: ETATS_RULE_VERSION,
    event: obs.source_event_id,
    signal_kind: signal?.kind ?? null,
    prompt_relevant: relevant > 0, // solange Relevanz-Filter fehlt: ehrlich false
    relevance_cap: PROMPT_RELEVANCE_CAP,
  });

  const transition = Object.freeze({
    rule_version: ETATS_RULE_VERSION,
    from: etats.last_pattern, to: pk,
    ladder_states: Object.freeze([key, ladder[key]]),
  });

  return Object.freeze({
    etats: next,
    transition,
    atleds: Object.freeze(movements),
    impacts: Object.freeze(impacts),
    ylamona: Object.freeze(anomalies),
    primitives: Object.freeze(primitives),
    decision,
  });
}

// Mehrere Grenz-Ereignisse in Ordnung (seq, dann Ereignis-Identitaet) —
// dieselbe Reihenfolge-Regel wie bridge.sortObservations (kanonisch).
export function run(etats, observations, opts = {}) {
  let cur = etats;
  const steps = [];
  const sorted = [...(observations ?? [])].sort((a, b) =>
    ((a?.seq ?? Number.MAX_SAFE_INTEGER) - (b?.seq ?? Number.MAX_SAFE_INTEGER))
    || (String(a?.source_event_id ?? a?.event_id ?? '') < String(b?.source_event_id ?? b?.event_id ?? '') ? -1 : 1));
  for (const obs of sorted) {
    const r = step(cur, obs, opts);
    cur = r.etats;
    steps.push(r);
  }
  return Object.freeze({ etats: cur, steps: Object.freeze(steps) });
}

// Determinismus-Vertrag: gleiche Beobachtungen → gleicher etats-Digest.
export function digestOf(etats) {
  return digestJson(etats);
}

function applyMovements(relations, movements) {
  const next = { ...relations };
  for (const axis of Object.keys(movements)) {
    const key = `self->${axis}`;
    const m = movements[axis];
    next[key] = { value: m.to, provenance: 'OBSERVED' };
  }
  return next;
}

// Achse + Groeße aus dem Signal — deterministisch, nur echte Felder.
function axisFor(signal) {
  switch (signal.kind) {
    case 'finding': return signal.severity === 'critical' ? 'irritation' : 'curiosity';
    case 'verdict': return signal.code === 'WRITE' ? 'respect' : 'defensiveness';
    case 'loop': return signal.state === 'WRITE_AUTHORIZED' ? 'respect' : 'curiosity';
    case 'handoff': return 'affinity';
    default: return null;
  }
}
function magnitudeFor(signal) {
  if (signal.kind === 'finding') return signal.severity === 'critical' ? 0.3 : (signal.severity === 'warning' ? 0.2 : 0.1);
  if (signal.kind === 'verdict') return signal.code === 'WRITE' ? 0.25 : 0.1;
  if (signal.kind === 'loop') return 0.15;
  return 0.1;
}

// Versions-Anker (importiert, damit der Freeze-Test sie pruefen kann).
export const RULE_VERSIONS = Object.freeze({
  etats: ETATS_RULE_VERSION, signals: RULE_VERSION, atled: ATLED_RULE_VERSION,
  ylamona: YLAMONA_RULE_VERSION, blocks: BLOCKS_RULE_VERSION,
});
