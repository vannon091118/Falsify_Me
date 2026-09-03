// DOKI observer skeleton.
// This module observes the actual FalsifyMe terminal/event stream and keeps
// a durable exactly-once cursor boundary. It has no technical authority.
//
// Identity contract (Blocker-Fix Rev. 2):
//   source_event_id = identity (producer-supplied, e.g. FM-EVT event id)
//   seq             = ordering only — NEVER part of the observation identity
//                     when a producer id exists (two sidecars ingesting the
//                     same event must dedupe to one observation)
//   cursor          = progress boundary, separate per pipeline:
//                     ingest_cursor  → LIVE stream (this module + store)
//                     observation_cursor → REPLAY pipeline (loop_events)
//
// For raw terminal text without a producer id, identity is the content hash
// of the text — stable across sidecars, independent of local seq counters.

import { createHash } from 'node:crypto';

export const OBSERVER_STATES = Object.freeze([
  'COLLECTING',
  'WAITING_FOR_THINKER_SLOT',
  'PROMPT_READY',
  'THINKER_RUNNING',
  'OUTPUT_READY',
]);

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function observationId(event) {
  if (event?.source_event_id || event?.event_id) {
    return `obs_${String(event.source_event_id ?? event.event_id)}`;
  }
  // Raw terminal material without producer identity: content hash.
  // session is session-partitioning metadata, not identity — the same text in
  // the same content stream is the same observation regardless of session key.
  const stable = JSON.stringify({
    type: event?.type ?? event?.event_type ?? null,
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
    const observation = { id, ...event, source_event_id: event?.source_event_id ?? event?.event_id ?? id };
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
