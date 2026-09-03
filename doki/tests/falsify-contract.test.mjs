// ─────────────────────────────────────────────────────────────────────────────
// DOKI · doki/tests/falsify-contract.test.mjs – FM-EVT-Vokabular-Vertrag
// -----------------------------------------------------------------------------
// DOKI ist gegen FalsifyMes FM-EVT-Stream gebaut. Dieser Test friert den
// Vokabular-Vertrag ein (Abgleich UI-137, 2026-09-03):
//
//   (1) Vokabular-Bruecke: Der Live-Stream spricht `t` (t:'job' / t:'finding'
//       / t:'loop' / t:'handoff' / t:'scope_auto'), der Observer beobachtet
//       `event_type`. Die Bridge (ingest) mappt t → event_type, damit
//       C.A.R.E. (CLAIM='job', ATTACK='finding') und die Loop-/Handoff-/
//       Scope-Auto-Events in den durable Observations nach Typ sichtbar sind.
//       Ohne die Bruecke: event_type=NULL (empirisch belegt vor dem Fix).
//   (2) UI-137 externer-Writer-Loop: Der handoff-report-Pfad ist BEWUSST
//       off-stream (read-only CLI des externen Writers, kein FM-EVT). Was der
//       Worker sieht, sind zwei Job-Stroeme: der WRITE-Parent (inkl. 'handoff'
//       + 'loop' WRITE_AUTHORIZED) und spaeter das Re-Review-Child (Claim →
//       RE_REVIEW_…). Zwischen beiden liegt die stille Luecke — DOKI darf dort
//       keine Observation und keinen Thinker-Call erzeugen.
//
// Kein FalsifyMe-Import (Isolations-Vertrag): nur echte DOKI-Module + die
// dokumentierte FM-EVT-Gestalt (Envelope wie ui/worker.mjs: { …evt, job,
// session }).
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentStore } from '../src/observer-store.mjs';
import { createBridge } from '../src/bridge.mjs';

// Windows: SQLite-Handles MÜSSEN vor rmSync geschlossen sein (sonst EPERM).
async function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'doki-contract-'));
  const store = createPersistentStore({ path: join(dir, 'doki.sqlite') });
  try { await fn(store, dir); }
  finally {
    try { store.close(); } catch { /* egal */ }
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

// Worker-Envelope wie ui/worker.mjs Zeile 483: FM-EVT + job + session.
// job/session gehoeren NICHT zur Content-Identitaet — die stampft die Bridge
// aus dem ROH-Event (fmEvtSourceId), Envelope-Felder nur als Metadaten.
const fmevt = (t, extra = {}) => ({ t, ts: 1, ...extra });

test('Vokabular: FM-EVT t wird als event_type beobachtet (job/finding/loop/handoff/scope_auto)', () => {
  withStore((store) => {
    const doki = createBridge({
      store,
      provider: { apiBase: 'http://localhost:9', apiKey: 'k', model: 'm' },
      slotState: () => 'BUSY',
    });
    const events = [
      fmevt('job', { id: 'job-a', scope: 'scope-a' }),
      fmevt('finding', { n: 1 }),
      fmevt('loop', { s: 'WRITE_AUTHORIZED' }),
      fmevt('handoff', { id: 'handoff-ui137', ticket: 'Ticket 1:1', probes: 3 }),
      fmevt('scope_auto', { outcome: 'continue', scope_id: 'scope-a', ticket: 'Ticket 1:1' }),
      fmevt('loop', { s: 'LOOP_BLOCKED' }),
    ];
    for (const e of events) {
      const r = doki.ingest({ ...e, job: 'job-a', session: 'scope-a' });
      assert.equal(r.accepted, true, `Event ${e.t} muss akzeptiert werden`);
    }
    const rows = store.list();
    // Vokabular-Bruecke: jedes Live-Event traegt seinen Typ (nicht null).
    for (const [t, n] of [['job', 1], ['finding', 1], ['loop', 2], ['handoff', 1], ['scope_auto', 1]]) {
      const typed = rows.filter((o) => o.event_type === t);
      assert.equal(typed.length, n, `observation(s) mit event_type=${t}`);
    }
    // Loop-Zustaende + Prüfauftrag sind im Event-JSON sichtbar (UI-123/128).
    const handoff = rows.find((o) => o.event_type === 'handoff');
    assert.equal(handoff.event.id, 'handoff-ui137');
    assert.equal(handoff.event.ticket, 'Ticket 1:1');
    assert.deepEqual(rows.filter((o) => o.event_type === 'loop').map((o) => o.event.s).sort(),
      ['LOOP_BLOCKED', 'WRITE_AUTHORIZED']);
    assert.equal(rows.find((o) => o.event_type === 'scope_auto').event.outcome, 'continue');
    // Duplikat-Lieferung desselben Inhalts bleibt exactly-once.
    const dup = doki.ingest({ ...fmevt('handoff', { id: 'handoff-ui137', ticket: 'Ticket 1:1', probes: 3 }), job: 'job-a', session: 'scope-a' });
    assert.equal(dup.duplicate, true, 'identischer Inhalt dedupliziert');
    assert.equal(store.list().length, events.length, 'keine zweite Observation');
    doki.stop();
  });
});

test('UI-137 externer-Writer-Loop: WRITE-Strom → stille Luecke (report/complete) → Re-Review-Strom, genau 1 Call je Runde', async () => {
  await withStore(async (store) => {
    let calls = 0;
    const seen = [];
    const doki = createBridge({
      store,
      provider: { apiBase: 'http://localhost:9', apiKey: 'k', model: 'm' },
      slotState: () => 'FREE',
      callModel: async (body) => { calls++; seen.push(body); return { text: `narrative ${calls}`, model: 'm' }; },
    });

    // Phase A — WRITE-Parent-Job im Worker (FalsifyMe liess WRITE zu):
    // 'handoff' (Prüfauftrag, UI-128) + 'loop' WRITE_AUTHORIZED (UI-123).
    const phaseA = [
      fmevt('job', { id: 'job-write', scope: 'scope-a' }),
      fmevt('state', { s: 'THINKING' }),
      fmevt('finding', { n: 1 }),
      fmevt('verdict', { v: 'WRITE' }),
      fmevt('handoff', { id: 'handoff-ui137-x', ticket: 'Ticket 1:1', probes: 2 }),
      fmevt('loop', { s: 'WRITE_AUTHORIZED' }),
    ];
    for (const e of phaseA) {
      const r = doki.ingest({ ...e, job: 'job-write', session: 'scope-a' });
      assert.equal(r.accepted, true, `Phase A ${e.t}`);
    }
    const r1 = await doki.pump();
    assert.equal(r1.pumped, true, JSON.stringify(r1));
    assert.equal(calls, 1, 'genau EIN Narrator-Call nach dem WRITE-Strom');
    assert.equal(r1.observations, phaseA.length);

    // Stille Luecke — der externe Writer laeuft `falsify handoff report` +
    // `falsify handoff complete` (agentenseitig, bewusst OHNE FM-EVT). DOKI
    // sieht keine neuen Observations → kein zweiter Call, keine Grenzverschiebung.
    const gap = await doki.pump();
    assert.equal(gap.pumped, false);
    assert.equal(gap.reason, 'NO_NEW_OBSERVATIONS');
    assert.equal(calls, 1, 'Off-Stream-Report/Complete erzeugt keinen Thinker-Call');

    // Phase B — Re-Review-Child-Job (nach der Completion automatisch gequeued,
    // vom Worker geclaimt): der zweite Job-Strom erreicht DOKI wie Phase A.
    const phaseB = [
      fmevt('job', { id: 'job-rereview', scope: 'scope-a' }),
      fmevt('state', { s: 'THINKING' }),
      fmevt('loop', { s: 'RE_REVIEW_RUNNING' }),
      fmevt('verdict', { v: 'PLAN' }),
      fmevt('done', {}),
    ];
    for (const e of phaseB) {
      const r = doki.ingest({ ...e, job: 'job-rereview', session: 'scope-a' });
      assert.equal(r.accepted, true, `Phase B ${e.t}`);
    }
    const r2 = await doki.pump();
    assert.equal(r2.pumped, true, JSON.stringify(r2));
    assert.equal(calls, 2, 'genau EIN zweiter Call nach dem Re-Review-Strom');
    assert.equal(r2.observations, phaseB.length);

    // Durable Nachweis: der Loop-Verlauf des externen Writers ist nach Typ
    // und Reihenfolge sichtbar (WRITE_AUTHORIZED … RE_REVIEW_RUNNING) — die
    // Off-Stream-Luecke (report/complete) hinterlaesst KEINE Observation.
    const loops = store.list().filter((o) => o.event_type === 'loop').map((o) => o.event.s);
    assert.deepEqual(loops, ['WRITE_AUTHORIZED', 'RE_REVIEW_RUNNING'],
      'Loop-Transitionen des UI-137-Workflows im Event-Vokabular sichtbar');
    assert.equal(store.list().filter((o) => o.event_type === 'handoff').length, 1);
    // Keine Observation zwischen den Job-Stroemen: die stille Luecke (report/
    // complete) hinterlaesst nichts — nur die echten FM-EVT der zwei Jobs.
    assert.equal(store.list().length, phaseA.length + phaseB.length,
      'nur echte FM-EVT der zwei Job-Stroeme sind durable (stille Luecke bleibt leer)');
    doki.stop();
  });
});