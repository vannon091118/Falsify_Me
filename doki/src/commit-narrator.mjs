// 15th narrator skeleton. The 14 characters are the ensemble; this narrator
// turns an already-prepared history into a commit-message voice.

export const COMMIT_NARRATOR = Object.freeze({
  id: 'narrator',
  index: 15,
  name: 'Erzähler',
  traits: Object.freeze(['zynisch', 'sarkastisch', 'gelegentlich_gehässig']),
  mayImply: true,
  mayInventFacts: false,
  mayChangeTechnicalAuthority: false,
});

export function buildNarratorContext({ observed, ensemble, technical }) {
  return Object.freeze({
    narrator: COMMIT_NARRATOR,
    observed,
    ensemble,
    technical,
  });
}

export function assertNarratorBoundary(context) {
  if (context?.narrator?.mayInventFacts) throw new Error('15th narrator cannot invent facts');
  if (context?.narrator?.mayChangeTechnicalAuthority) throw new Error('15th narrator cannot change authority');
  return true;
}
