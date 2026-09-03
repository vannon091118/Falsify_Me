// Persistent narrative ensemble state adapted from SnipWar DOKI.
// Static personality lives in narrator-catalog.mjs. Everything below is runtime
// state and is therefore rebuildable from observed history.

import { narratorByName, NARRATORS } from './narrator-catalog.mjs';

export const CHARACTERS = Object.freeze(NARRATORS.map((n) => n.name));
export const CHARACTER_AXES = Object.freeze([
  'trust', 'respect', 'irritation', 'affinity',
  'competence_confidence', 'resentment', 'curiosity', 'defensiveness',
]);
export const RELATIONSHIP_COUNT = CHARACTERS.length * (CHARACTERS.length - 1);

export function emptyCharacterState(name) {
  const personality = narratorByName(name);
  return {
    name,
    personality: personality.name,
    role: personality.role,
    recallCount: 0,
    knownEvents: [],
    knownBeliefs: [],
    threadRefs: [],
    knowledge: {},
    memories: [],
    emotional: Object.fromEntries(CHARACTER_AXES.map((axis) => [axis, 0])),
  };
}

export function relationshipKey(from, to) {
  if (from === to) throw new Error('DOKI relationship cannot be a self-edge');
  if (!CHARACTERS.includes(from) || !CHARACTERS.includes(to)) throw new Error('DOKI relationship references unknown character');
  return `${from}->${to}`;
}

function emptyRelationship() {
  return Object.fromEntries(CHARACTER_AXES.map((axis) => [axis, 0.5]));
}

export class EnsembleState {
  constructor({ store } = {}) {
    this.store = store;
    this.characters = new Map(CHARACTERS.map((name) => [name, emptyCharacterState(name)]));
    this.relationships = new Map();
    for (const from of CHARACTERS) {
      for (const to of CHARACTERS) {
        if (from !== to) this.relationships.set(relationshipKey(from, to), emptyRelationship());
      }
    }
    this.threads = new Map();
    this.perspectives = new Map();
    this.conflicts = new Map();
  }

  profile(name) {
    return narratorByName(name);
  }

  recordRecall(characterName, observationId) {
    const state = this.characters.get(characterName);
    if (!state) throw new Error(`Unknown DOKI character: ${characterName}`);
    if (!state.knownEvents.includes(observationId)) {
      state.knownEvents.push(observationId);
      state.recallCount += 1;
    }
    return state;
  }

  setKnowledge(characterName, key, value) {
    const state = this.characters.get(characterName);
    if (!state) throw new Error(`Unknown DOKI character: ${characterName}`);
    state.knowledge[String(key)] = structuredClone(value);
    return state.knowledge[String(key)];
  }

  remember(characterName, memory) {
    const state = this.characters.get(characterName);
    if (!state) throw new Error(`Unknown DOKI character: ${characterName}`);
    const id = String(memory?.memoryId ?? memory?.id ?? '');
    if (!id) throw new Error('DOKI memory requires stable memoryId');
    if (!state.memories.some((item) => item.memoryId === id)) state.memories.push(structuredClone(memory));
    return state.memories;
  }

  applyEmotion(characterName, delta) {
    const state = this.characters.get(characterName);
    if (!state) throw new Error(`Unknown DOKI character: ${characterName}`);
    for (const axis of CHARACTER_AXES) {
      if (Number.isFinite(delta?.[axis])) state.emotional[axis] = Math.min(1, Math.max(0, state.emotional[axis] + delta[axis]));
    }
    return state.emotional;
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
