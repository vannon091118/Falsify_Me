import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDokiDb } from '../src/db.mjs';
import { createPersistentStore } from '../src/observer-store.mjs';
import { observationId } from '../src/observer.mjs';
import { createBridge, fmEvtSourceId } from '../src/bridge.mjs';

// Windows: SQLite-Handles MUessen geschlossen sein, bevor rmSync das
// Temp-Verzeichnis anfassen darf (sonst EPERM). Schliesst den Store IMMER
// nach dem Test, auch wenn der Test selbst nur doki.stop() gerufen hat.
async function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'doki-bridge-'));
  const path = join(dir, 'doki.sqlite');
  const store = createPersistentStore({ path });
  try { await fn(store, dir); }
  finally {
    try { store.close(); } catch { /* egal */ }
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

const FM_EVT = (t) => ({ t, status: 'THINKING', ts: 1 });

test('identity: producer id wins; same FM-EVT from two sidecars dedupes to one observation', () => {
  const a = { source_event_id: 'FM-EVT:abc123', t: 'state', status: 'THINKING' };
  const b = { ...a, seq: 999 }; // other sidecar counts differently
  assert.equal(observationId(a), observationId(b), 'seq must not influence identity');
  assert.equal(fmEvtSourceId(a), fmEvtSourceId(a), 'content id is stable');
  assert.notEqual(fmEvtSourceId(a), fmEvtSourceId({ ...a, status: 'TOOL' }), 'different content differs');
});

test('raw terminal text without producer id: identity from content, not local seq', () => {
  const e = { type: 'monologue', text: 'scan complete' };
  const withSeq = { ...e, seq: 17 };
  assert.equal(observationId(e), observationId(withSeq));
});

test('cursor separation: ingest_cursor (live) advances while observation_cursor (replay) stays untouched', () => {
  withStore((store) => {
    const doki = createBridge({
      store,
      provider: { apiBase: 'http://localhost:9', apiKey: 'k', model: 'm' },
      slotState: () => 'BUSY',
    });
    doki.ingest(FM_EVT('state'));
    doki.ingest(FM_EVT('finding'));
    const live = store.db.prepare('SELECT cursor_id FROM ingest_cursor WHERE id=1').get();
    const replay = store.db.prepare('SELECT cursor_id FROM observation_cursor WHERE id=1').get();
    assert.ok(live?.cursor_id, 'live cursor advanced');
    assert.equal(replay?.cursor_id ?? null, null, 'replay cursor untouched by live ingest');
    doki.stop();
  });
});

test('state machine: busy → WAITING, further events buffer, slot free + pump → exactly 1 call → COLLECTING', async () => {
  await withStore(async (store) => {
    let busy = true;
    let calls = 0;
    const doki = createBridge({
      store,
      provider: { apiBase: 'http://localhost:9', apiKey: 'k', model: 'm' },
      slotState: () => (busy ? 'BUSY' : 'FREE'),
      callModel: async () => { calls++; return { text: `narrative ${calls}`, model: 'm' }; },
    });
    // Vier INHALTLICH verschiedene Events (ts unterscheidet sie — gleiche
    // Inhalte wuerden zu Recht als Duplikate dedupliziert).
    const events = ['job', 'state', 'finding', 'verdict'];
    events.forEach((t, i) => {
      const r = doki.ingest({ ...FM_EVT(t), ts: i + 1 });
      assert.equal(r.accepted, true, `event ${t} must be accepted`);
    });
    assert.equal(doki.observer.state, 'WAITING_FOR_THINKER_SLOT', 'busy → WAITING');
    assert.equal(store.readBridgeState().state, 'WAITING_FOR_THINKER_SLOT', 'persisted');

    // Slot frei, aber kein pump() → DOKI bleibt WAITING (event-driven only).
    busy = false;
    assert.equal(doki.observer.state, 'WAITING_FOR_THINKER_SLOT');

    // pump() nach Slot-Freiwerden: DER eine Call, voller Kontext.
    const out = await doki.pump();
    assert.equal(out.pumped, true, JSON.stringify(out));
    assert.equal(calls, 1, 'exactly one Thinker call');
    assert.equal(out.observations, events.length, 'full durable context since boundary');
    assert.equal(doki.observer.state, 'COLLECTING', 'back to collecting');

    // Restart-sicher: dieselbe Runde erneut pumpen → KEIN zweiter Call
    // (narrative boundary ist gerückt).
    const again = await doki.pump();
    assert.equal(again.pumped, false);
    assert.equal(calls, 1);
    doki.stop();
  });
});

test('duplicate ingest never creates a second narrative input', async () => {
  await withStore(async (store) => {
    let calls = 0;
    const doki = createBridge({
      store,
      provider: { apiBase: 'http://localhost:9', apiKey: 'k', model: 'm' },
      slotState: () => 'FREE',
      callModel: async () => { calls++; return { text: 'x', model: 'm' }; },
    });
    doki.ingest(FM_EVT('state'));
    const dup = doki.ingest(FM_EVT('state'));
    assert.equal(dup.duplicate, true);
    const out = await doki.pump();
    assert.equal(out.pumped, true);
    assert.equal(out.observations, 1);
    doki.stop();
  });
});

test('atomic claim: second bridge loses the race, only one call happens', async () => {
  await withStore(async (store) => {
    let calls = 0;
    const mk = () => createBridge({
      store,
      provider: { apiBase: 'http://localhost:9', apiKey: 'k', model: 'm' },
      slotState: () => 'FREE',
      callModel: async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return { text: 'x', model: 'm' }; },
    });
    const a = mk();
    const b = mk();
    a.ingest(FM_EVT('state'));
    const pa = a.pump(); // in flight, holds the claim
    await new Promise((r) => setTimeout(r, 5));
    const pb = await b.pump();
    assert.equal(pb.pumped, false);
    assert.equal(pb.reason, 'CLAIM_LOST');
    await pa;
    assert.equal(calls, 1, 'mutual exclusion inside one doki.db');
    b.stop();
  });
});

test('crash recovery: PROMPT_READY persisted + restart → COLLECTING, boundary unadvanced, context rebuilt', async () => {
  let calls = 0;
  const dir = mkdtempSync(join(tmpdir(), 'doki-crash-'));
  const p = join(dir, 'doki.sqlite');
  const stores = [];
  const mk = () => {
    const s = createPersistentStore({ path: p });
    stores.push(s);
    return createBridge({
      store: s,
      provider: { apiBase: 'http://localhost:9', apiKey: 'k', model: 'm' },
      slotState: () => 'FREE',
      // Nur der ERSTE Call crasht (simulierter Absturz mid-call); nach dem
      // Restart ist das Modell wieder gesund — sonst beweist der Test nur,
      // dass ein kaputtes Modell kaputt bleibt.
      callModel: async () => {
        calls++;
        if (calls === 1) throw new Error('simulated crash mid-call');
        return { text: 'recovered', model: 'm' };
      },
    });
  };
  try {
    const first = mk();
    first.ingest(FM_EVT('job'));
    const r1 = await first.pump();
    assert.equal(r1.pumped, false);
    assert.equal(r1.reason, 'ERROR');
    first.stop();

    // Restart: state recovered to COLLECTING, boundary NOT advanced → retry works.
    const second = mk();
    assert.equal(second.observer.state, 'COLLECTING');
    assert.equal(second.store.readBridgeState().state, 'COLLECTING');
    const r2 = await second.pump();
    assert.equal(r2.pumped, true, 'context rebuilt from durable observations');
    second.stop();
  } finally {
    for (const s of stores) { try { s.close(); } catch { /* egal */ } }
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test('stale claim takeover: abandoned owner (heartbeat too old) is replaced atomically', () => {
  withStore((store) => {
    const t = (msAgo) => new Date(Date.now() - msAgo).toISOString();
    store.db.prepare(`INSERT INTO thinker_claims(id, owner, claimed_at, heartbeat_at) VALUES(1, 'ghost', ?, ?)`)
      .run(t(600_000), t(600_000));
    const claim = store.tryClaimThinkerSlot('fresh', { staleMs: 120_000 });
    assert.equal(claim.claimed, true, 'stale claim taken over');
    assert.equal(claim.previousOwner, 'ghost');
    assert.equal(store.thinkerSlotOwner(), 'fresh');
  });
});

test('live claim blocks while heartbeat is fresh', () => {
  withStore((store) => {
    const first = store.tryClaimThinkerSlot('a');
    assert.equal(first.claimed, true);
    const second = store.tryClaimThinkerSlot('b');
    assert.equal(second.claimed, false);
    assert.equal(store.releaseThinkerSlot(), true);
    const third = store.tryClaimThinkerSlot('b');
    assert.equal(third.claimed, true, 'released slot is claimable');
  });
});

test('fail-open: model error does not consume observations; retry after cooldown with working model succeeds', async () => {
  await withStore(async (store) => {
    let fail = true;
    let calls = 0;
    const doki = createBridge({
      store,
      provider: { apiBase: 'http://localhost:9', apiKey: 'k', model: 'm' },
      slotState: () => 'FREE',
      errorCooldownMs: 120,
      callModel: async () => {
        calls++;
        if (fail) throw new Error('HTTP 500');
        return { text: 'ok', model: 'm' };
      },
    });
    doki.ingest(FM_EVT('state'));
    const r1 = await doki.pump();
    assert.equal(r1.reason, 'ERROR');
    assert.equal(calls, 1);
    const r2 = await doki.pump(); // sofortiger Retry-Versuch → Cooldown greift
    assert.equal(r2.reason, 'ERROR_COOLDOWN');
    assert.equal(calls, 1, 'no retry call while cooldown is active');
    await new Promise((resolve) => setTimeout(resolve, 150)); // Cooldown abgelaufen
    fail = false;
    const r3 = await doki.pump();
    assert.equal(r3.pumped, true);
    assert.equal(r3.observations, 1, 'observations never consumed by failed rounds');
    doki.stop();
  });
});

test('provider outage: error cooldown bounds retry frequency across many idle ticks', async () => {
  await withStore(async (store) => {
    let calls = 0;
    const doki = createBridge({
      store,
      provider: { apiBase: 'http://localhost:9', apiKey: 'k', model: 'm' },
      slotState: () => 'FREE',
      errorCooldownMs: 250,
      callModel: async () => { calls++; throw new Error('HTTP 503'); },
    });
    doki.ingest(FM_EVT('job'));
    const r1 = await doki.pump();
    assert.equal(r1.reason, 'ERROR');
    const reasons = new Set([r1.reason]);
    // ~10 schnelle Idle-Ticks (~250 ms nominal, Timer-Jitter inklusive):
    // OHNE Cooldown waeren das 10 Calls auf den kranken Provider.
    for (let i = 0; i < 10; i++) {
      const r = await doki.pump();
      reasons.add(r.reason);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(calls <= 3, `cooldown must bound retry frequency, got ${calls} calls in 10 idle ticks`);
    assert.ok(reasons.has('ERROR_COOLDOWN'), 'idle ticks during outage return ERROR_COOLDOWN');
    doki.stop();
  });
});

test('no env reads: bridge works with only the injected provider object', async () => {
  await withStore(async (store) => {
    const seen = [];
    const doki = createBridge({
      store,
      provider: { apiBase: 'http://injected:1', apiKey: 'injected-key', model: 'injected-model' },
      slotState: () => 'FREE',
      callModel: async (body) => { seen.push(body); return { text: 'x', model: 'm' }; },
    });
    doki.ingest(FM_EVT('state'));
    await doki.pump();
    assert.equal(seen.length, 1);
    doki.stop();
  });
});

test('idle-time model switch: currentModel() is re-resolved EVERY pump cycle and the new model is carried', async () => {
  await withStore(async (store) => {
    const seenModels = [];
    let configured = 'model-v1';
    const doki = createBridge({
      store,
      provider: { apiBase: 'http://localhost:9', apiKey: 'k', model: 'model-v1' },
      slotState: () => 'FREE',
      callModel: async (body, model) => { seenModels.push(model); return { text: 'x', model }; },
      // Worker-Injektion: liest FALSIFYMEs aktuelle Modellwahrheit (hier simuliert)
      currentModel: () => configured,
    });
    doki.ingest(FM_EVT('state'));
    const r1 = await doki.pump();
    assert.equal(r1.pumped, true);
    // Thinker idelt: Konfiguration wird umgeschaltet (FalsifyMe-Rotation).
    configured = 'model-v2';
    doki.ingest(FM_EVT('state2'));
    const r2 = await doki.pump();
    assert.equal(r2.pumped, true);
    assert.deepEqual(seenModels, ['model-v1', 'model-v2'], 'each pump re-resolves the CURRENT model');
    doki.stop();
  });
});

test('currentModel errors keep the frozen provider model (fail-open)', async () => {
  await withStore(async (store) => {
    const seenModels = [];
    const doki = createBridge({
      store,
      provider: { apiBase: 'http://localhost:9', apiKey: 'k', model: 'frozen' },
      slotState: () => 'FREE',
      callModel: async (body, model) => { seenModels.push(model); return { text: 'x', model }; },
      currentModel: () => { throw new Error('config broken'); },
    });
    doki.ingest(FM_EVT('state'));
    const r = await doki.pump();
    assert.equal(r.pumped, true);
    assert.deepEqual(seenModels, ['frozen']);
    doki.stop();
  });
});

test('no DOKI_API_* reads in production bridge path', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/bridge.mjs', import.meta.url), 'utf8');
  assert.ok(!/DOKI_API_BASE|DOKI_API_KEY|DOKI_GREEN_MODEL|DOKI_THINKER_MODEL/.test(src), 'bridge must not read DOKI_* env');
  assert.ok(!/process\.env/.test(src), 'bridge must not read process.env at all');
  assert.ok(!/falsify-reader|core\//.test(src), 'bridge must not import FalsifyMe modules');
});
