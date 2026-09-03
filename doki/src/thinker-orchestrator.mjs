// Thinker orchestration skeleton.
// Exactly one prose call is reserved for a ready narrative context.
// Shared API key and idle model switching are supplied by existing config.

export const THINKER_PHASES = Object.freeze([
  'WAITING_FOR_SLOT',
  'PROMPT_READY',
  'THINKER_RUNNING',
  'OUTPUT_READY',
]);

export function buildPromptInput({ narratorContext, observed, ensemble, technical }) {
  return Object.freeze({ narratorContext, observed, ensemble, technical, outputTask: 'commit_message_prose' });
}

export async function narrateOnce({ prompt, callThinker, shouldRun = () => true }) {
  if (!shouldRun()) return { status: 'DEFERRED', reason: 'THINKER_SLOT_UNAVAILABLE' };
  if (typeof callThinker !== 'function') throw new TypeError('callThinker is required');
  const result = await callThinker(prompt);
  return Object.freeze({ status: 'OUTPUT_READY', calls: 1, text: String(result?.text ?? result ?? '') });
}
