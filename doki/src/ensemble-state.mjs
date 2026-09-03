// Persistent narrative-memory skeleton adapted from the SnipWar DOKI model.
// This layer contains derived narrative state only. Raw observations remain
// the source material; no value here is technical FalsifyMe truth.

export const CHARACTERS = Object.freeze([
  'Buffy', 'Basher', 'Thinker', 'Vannon', 'Squizzle', 'Devin', 'Argos',
  'Ghost', 'Spark', 'Glitch', 'Null', 'Echo', 'Flux', 'Sage',
]);

export const CHARACTER_AXES = Object.freeze([
  'trust', 'respect', 'irritation', 'affinity',
  'competence_confidence', 'resentment', 'curiosity', 'defensiveness',
]);

export const RELATIONSHIP_COUNT = CHARACTERS.length * (CHARACTERS.length - 1);

export function emptyCharacterState(name) {
  return {
    name,
    recallCount: 0,
    emotional: Object.fromEntries(CHARACTER_AXES.map((axis) => [axis, 0] )),
    knownEvents: [],
    knownBeliefs: [],
    threadRefs: [],
  };
}

export function relationshipKey(from, to) {
  if (from === to) throw new Error('DOKI relationship cannot be a self-edge');
  return `${from}->${to}`;
}

export class EnsembleState {
  constructor({ store } = {}) {
    this.store = store;
    this.characters = new Map(CHARACTERS.map((name) => [name, emptyCharacterState(name)]));
    this.relationships = new Map();
    for (const from of CHARACTERS) {
      for (const to of CHARACTERS) {
        if (from !== to) this.relationships.set(relationshipKey(from, to), Object.fromEntries(CHARACTER_AXES.map((axis) => [axis, 0.5])));
      }
    }
    this.threads = new Map();
    this.perspectives = new Map();
    this.conflicts = new Map();
  }

  recordObservation(observation) {
    for (const state of this.characters.values()) state.recallCount += 1;
    return observation;
  }

  applyRelationshipDelta(from, to, delta) {
    const key = relationshipKey(from, to);
    const current = this.relationships.get(key);
    if (!current) throw new Error(`unknown relationship: ${key}`);
    for (const axis of CHARACTER_AXES) {
      if (Number.isFinite(delta?.[axis])) current[axis] = Math.min(1, Math.max(0, current[axis] + delta[axis]));
    }
    return current;
  }

  snapshot() {
    return Object.freeze({
      characters: structuredClone(Object.fromEntries(this.characters)),
      relationships: structuredClone(Object.fromEntries(this.relationships)),
      threads: structuredClone(Object.fromEntries(this.threads)),
      perspectives: structuredClone(Object.fromEntries(this.perspectives)),
      conflicts: structuredClone(Object.fromEntries(this.conflicts)),
    });
  }
}
