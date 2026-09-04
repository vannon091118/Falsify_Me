// Persistent narrative ensemble state adapted from SnipWar DOKI.
// Static personality lives in narrator-catalog.mjs. Everything below is runtime
// state and is therefore rebuildable from observed history.

import { narratorByName, NARRATORS } from './narrator-catalog.mjs';
import { etats } from './etats.mjs';

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

export function createEmptyEnsemble() {
  const characters = {};
  for (const name of CHARACTERS) {
    characters[name] = emptyCharacterState(name);
  }
  const relationships = {};
  for (const from of CHARACTERS) {
    for (const to of CHARACTERS) {
      if (from !== to) {
        relationships[relationshipKey(from, to)] = emptyRelationship();
      }
    }
  }
  return {
    characters,
    relationships,
    threads: {},
    perspectives: {},
    conflicts: {},
  };
}

export function projectEnsemble(etatsState = {}, _options = {}) {
  const base = createEmptyEnsemble();
  const stateEnsemble = etatsState?.ensemble ?? etatsState ?? {};
  return Object.freeze({
    characters: Object.freeze({ ...base.characters, ...(stateEnsemble.characters ?? {}) }),
    relationships: Object.freeze({ ...base.relationships, ...(stateEnsemble.relationships ?? {}) }),
    threads: Object.freeze({ ...base.threads, ...(stateEnsemble.threads ?? {}) }),
    perspectives: Object.freeze({ ...base.perspectives, ...(stateEnsemble.perspectives ?? {}) }),
    conflicts: Object.freeze({ ...base.conflicts, ...(stateEnsemble.conflicts ?? {}) }),
  });
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

// ─── Akkumulierter etats-State → Ensemble ────────────────────────────────────
//
// `accumulateEtats` führt etats() schrittweise über eine geordnete Event-Liste
// und baut dabei das `characters`-Dictionary im State auf:
//   - knownEvents: alle Event-IDs, die der Character "gesehen" hat
//   - recallCount: Anzahl der gesehenen Events
//
// Regeln für die Zuordnung von Events zu Characters (Etappe 1, deterministisch):
//   event_type='job'      → primary: 'Thinker' (Aufgabe beobachtet)
//   event_type='finding'  → primary: Charakter abhängig vom wave-Feld
//     wave='evil'/'evil-twin' → 'Buffy' (Angriff) + 'Thinker' (Verteidigung)
//     sonst               → 'Thinker'
//   event_type='handoff'  → 'Thinker' + 'Buffy'
//   sonst                 → 'Thinker' (Default)
//
// Numerische Emotional/Relationship-Deltas kommen in Etappe 3 (Step C).
// Diese Funktion ist REIN: keine IO, kein DB, keine LLM-Calls, keine Mutation
// des Inputs. Replay mit denselben Events erzeugt identisches Ergebnis.

function eventCharacters(event) {
  const t = event?.event_type ?? event?.t ?? event?.type ?? null;
  const wave = event?.wave ?? null;
  if (t === 'finding' && (wave === 'evil' || wave === 'evil-twin')) {
    return ['Buffy', 'Thinker'];
  }
  if (t === 'handoff') return ['Thinker', 'Buffy'];
  return ['Thinker'];
}

function mergeCharacterEvent(characters, event) {
  const eventId = String(event?.id ?? event?.event_id ?? '');
  if (!eventId) return characters;
  const involved = eventCharacters(event);
  const updated = { ...characters };
  for (const name of involved) {
    if (!CHARACTERS.includes(name)) continue;
    const prev = updated[name] ?? emptyCharacterState(name);
    if (prev.knownEvents.includes(eventId)) continue;
    updated[name] = {
      ...prev,
      knownEvents: [...prev.knownEvents, eventId],
      recallCount: prev.recallCount + 1,
    };
  }
  return updated;
}

export function accumulateEtats(events = [], rules = {}) {
  // Startzustand: leere characters-Map (alle 14 Characters mit Leer-State)
  const base = createEmptyEnsemble();
  let state = { stage: 'OBSERVED', characters: base.characters };

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    // etats-Schritt für Leiter + Signal — purer Übergang
    let step;
    try {
      step = etats(state, event, rules);
    } catch {
      // Unbekanntes Event-Signal → überspringen (fail-open, kein Abbruch)
      continue;
    }
    // Characters aus diesem Event akkumulieren
    const updatedCharacters = mergeCharacterEvent(state.characters ?? base.characters, event);
    // State weiterführen: etats-State + aktualisiertes characters-Dictionary
    state = { ...step.state, characters: updatedCharacters };
  }
  return state;
}

export const accumulateContract = Object.freeze({
  imports_io: false,
  imports_falsifyme: false,
  imports_doki_runtime: false,
  imports_llm: false,
  mutates_input: false,
  persists: false,
  deterministic: true,
});
