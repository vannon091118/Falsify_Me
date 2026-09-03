// Central DOKI pure transition core. No DB, FalsifyMe, UI, User or LLM access.
// The machine consumes a state, an already-observed event and deterministic rules.

import { atled } from './atled.mjs';
import { ylamona } from './ylamona.mjs';
import { patternKey, eventSignal } from './signals.mjs';

export const MIRROR_VERSION = 'MIRROR_V1';
export const LADDER = Object.freeze([
  'OBSERVED',
  'PERSISTED',
  'DERIVED',
  'NARRATIVELY_RELEVANT',
]);

const ladderIndex = (value) => LADDER.indexOf(value);

function advance(previous, requested) {
  const currentIndex = ladderIndex(previous);
  const requestedIndex = ladderIndex(requested);
  if (currentIndex < 0) return 'OBSERVED';
  if (requestedIndex < 0) return LADDER[currentIndex];
  return requestedIndex >= currentIndex ? requested : LADDER[currentIndex];
}

export function etats(previous = {}, event = {}, rules = {}) {
  const signal = eventSignal(event);
  if (!signal) throw new TypeError('etats requires a known observed event');

  const requestedLadder = typeof rules.ladder === 'function'
    ? rules.ladder({ state: previous, signal })
    : event.ladder;
  const stage = advance(previous.stage ?? 'OBSERVED', requestedLadder ?? 'OBSERVED');

  const next = {
    ...previous,
    stage,
    event_id: signal.eventId,
    sequence: signal.seq,
  };

  const deltas = typeof rules.movements === 'function'
    ? rules.movements(previous, next, signal)
    : atled(previous.axes ?? {}, next.axes ?? {}, Object.keys(next.axes ?? {}));

  const anomaly = typeof rules.anomaly === 'function'
    ? rules.anomaly({ previous, next, signal, deltas })
    : null;

  const stateKey = patternKey({
    phase: event.phase,
    verdict: event.v,
    wave: event.wave,
  });

  return Object.freeze({
    transition: Object.freeze({ from: previous.stage ?? 'OBSERVED', to: stage }),
    state: Object.freeze(next),
    derived: Object.freeze({ state_key: stateKey, signal }),
    atled: deltas,
    ylamona: anomaly,
    decisions: Object.freeze({
      prompt_eligible: stage === 'NARRATIVELY_RELEVANT',
    }),
  });
}

export const pureContract = Object.freeze({
  imports_io: false,
  imports_falsifyme: false,
  imports_doki_runtime: false,
  imports_llm: false,
  mutates_input: false,
  persists: false,
});
