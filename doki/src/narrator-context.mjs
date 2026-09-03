import { digestJson } from './hash.mjs';

export const FIFTEENTH_NARRATOR = Object.freeze({
  id: 'NARRATOR_15',
  name: 'The Chronicler',
  role: '15th narrator',
  tone: Object.freeze(['cynical', 'sarcastic', 'caustic']),
  authority: 'NONE',
  ruleVersion: 'doki.narrator-context.v1',
});

const CARE_STAGES = Object.freeze(['CLAIM', 'ATTACK', 'RE_EVALUATE', 'EVIDENCE']);

function clone(value) {
  return structuredClone(value ?? null);
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(clone);
}

function stableRelevantCharacters(ensemble, relevance = []) {
  const known = new Set((ensemble?.characters ? Object.keys(ensemble.characters) : []));
  const requested = normalizeList(relevance)
    .map((item) => String(item?.name ?? item?.character ?? item))
    .filter((name) => known.has(name));
  return [...new Set(requested)].sort();
}

function buildCare(care = {}) {
  const stages = {};
  for (const stage of CARE_STAGES) {
    const value = care?.[stage] ?? care?.[stage.toLowerCase()] ?? null;
    stages[stage] = value == null ? null : clone(value);
  }
  return Object.freeze({
    protocol: 'C.A.R.E.',
    ruleVersion: 'doki.care.v1',
    stages: Object.freeze(stages),
    mandatory: true,
    authority: 'NONE',
  });
}

export function buildNarratorContext({
  observed = {},
  report = {},
  history = {},
  ensemble = {},
  care = {},
  relevance = [],
  evidence = [],
} = {}) {
  const context = {
    schema: 'doki.narrator_context/v1',
    ruleVersion: FIFTEENTH_NARRATOR.ruleVersion,
    narrator: clone(FIFTEENTH_NARRATOR),
    authority: 'NONE',
    source: {
      observed: clone(observed),
      report: clone(report),
      history: clone(history),
    },
    care: buildCare(care),
    ensemble: {
      relevantCharacters: stableRelevantCharacters(ensemble, relevance),
      characters: clone(ensemble?.characters ?? {}),
      relationships: clone(ensemble?.relationships ?? {}),
      threads: clone(ensemble?.threads ?? {}),
      perspectives: clone(ensemble?.perspectives ?? {}),
      conflicts: clone(ensemble?.conflicts ?? {}),
    },
    evidence: normalizeList(evidence),
    constraints: Object.freeze([
      'Narrative interpretation only.',
      'No technical authority.',
      'No invented evidence.',
      'No mutation of FalsifyMe verdicts or lifecycle state.',
      'C.A.R.E. stages must remain distinguishable.',
    ]),
  };

  return Object.freeze({
    ...context,
    contextDigest: digestJson(context),
  });
}

export function narratorContextDigest(context) {
  return digestJson(context);
}

export function careStages(context) {
  return CARE_STAGES.map((stage) => context?.care?.stages?.[stage] ?? null);
}
