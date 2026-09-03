// DOKI observer skeleton.
// This module observes the actual FalsifyMe terminal/event stream and keeps
// a durable exactly-once cursor boundary. It has no technical authority.

import { createHash } from 'node:crypto';

export const OBSERVER_STATES = Object.freeze([
  'COLLECTING',
  'WAITING_FOR_THINKER_SLOT',
  'PROMPT_READY',
  'THINKER_RUNNING',
  'OUTPUT_READY',
]);

export function observationId(event) {
  const stable = JSON.stringify({
    session: event?.session ?? null,
    job: event?.job ?? null,
    seq: event?.seq ?? null,
    source: event?.source ?? null,
    type: event?.type ?? null,
    text: event?.text ?? null,
  });
  return `obs_${createHash('sha256').update(stable).digest('hex').slice(0, 24)}`;
}

export class DokiObserver {
  constructor({ store }) {
    this.store = store;
    this.state = 'COLLECTING';
    this.cursor = store?.readCursor?.() ?? null;
    this.buffer = [];
  }

  ingest(event) {
    const id = observationId(event);
    if (this.store?.hasObservation?.(id)) return { accepted: false, id, duplicate: true };
    const observation = { id, ...event };
    this.store?.appendObservation?.(observation);
    this.cursor = id;
    this.buffer.push(observation);
    this.state = 'COLLECTING';
    return { accepted: true, id, duplicate: false };
  }

  waitForThinkerSlot() {
    this.state = 'WAITING_FOR_THINKER_SLOT';
  }

  markPromptReady(prompt) {
    this.state = 'PROMPT_READY';
    return { prompt };
  }

  markThinkerRunning() {
    this.state = 'THINKER_RUNNING';
  }

  markOutputReady(message) {
    this.state = 'OUTPUT_READY';
    return { message };
  }

  resumeCollection() {
    this.state = 'COLLECTING';
  }

  snapshot() {
    return Object.freeze({ state: this.state, cursor: this.cursor, buffered: this.buffer.length });
  }
}
