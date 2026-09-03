// DOKI F: the Thinker writes prose only.
// Slot availability comes from the existing FalsifyMe runtime contract.
// There is exactly one narrative API call; failure produces a factual fallback.
export const THINKER_PHASES = Object.freeze(['WAITING_FOR_SLOT','PROMPT_READY','THINKER_RUNNING','OUTPUT_READY','FACTUAL_FALLBACK']);
export function buildPromptInput({ narratorContext, observed, ensemble, technical }) {
  if (!narratorContext || narratorContext.authority !== 'NONE') throw new Error('DOKI narrator context is required and must have authority NONE');
  return Object.freeze({ narratorContext, observed, ensemble, technical, outputTask: 'commit_message_prose' });
}
export async function narrateOnce({ prompt, callThinker, shouldRun = () => true }) {
  if (!shouldRun()) return Object.freeze({ status: 'DEFERRED', reason: 'THINKER_SLOT_UNAVAILABLE', calls: 0 });
  if (typeof callThinker !== 'function') throw new TypeError('callThinker is required');
  const result = await callThinker(prompt);
  return Object.freeze({ status: 'OUTPUT_READY', calls: 1, text: String(result?.text ?? result ?? ''), model: result?.model ?? null });
}
