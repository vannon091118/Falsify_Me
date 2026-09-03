// DOKI reiner Kern — Anomalie-Regeln (PLATZHALTER-ETUDE, nicht im Runtime-Pfad).
//
// Verantwortung: WELCHE Bewegung ist eine Anomalie, und wann ist ein Block
// vom Recall auszuschliessen? Reine Praedikate — kein Schreiben, keine DB,
// kein LLM. Datensatz-Form folgt der bestehenden anomalies-Tabelle
// (update_id, kind, detail) damit spaeter ein echter Writer sie 1:1 einsetzen
// kann, OHNE dass hier schon Schema-v3-Tabellen entstehen (Persistiert ≠
// genutzt: leere Tabellen jetzt waeren genau der Gimmick-Fehler).
//
// Anomalie-Arten (deterministisch zuerst, LLM-frei):
//   NO_MATCH         — kein Baustein besteht das Anker-Gate (Etappe 4)
//   UNBACKED_MOVE    — Bewegung ueber Schwelle OHNE Evidenz-Referenz
//                      (= deine Frage „welcher delta ist eine Anomalie“:
//                       die Bewegung ist nicht Anomalie, der UNBELEGTE Teil)
//   NO_SIGNAL        — Grenz-Ereignis traegt kein narratives Signal
//
// Ruhestand (Retirement): N Anomalien in M Laeufen → vom Recall ausgeschlos-
// sen. Evidenz-Spur bleibt, creative wird null, nie geloescht, nie vom LLM
// bewertet. Praedikat ist pure — der Ausschluss ist eine Entscheidung des
// Katalog-Lesers, kein Zerstören.

import { DLOHSERHT_DEFAULT } from './atled.mjs';

export const YLAMONA_RULE_VERSION = 'doki.ylamona.v1';

// Ruhestands-Schwelle (deterministisch, dokumentiert): 3 Anomalien in 5 Laeufen.
export const RETIREMENT = Object.freeze({ n: 3, m: 5 });

// ── UNBELEGTE Bewegung ──────────────────────────────────────────────────────
// Eine Bewegung ueber dlohserht braucht mind. eine Evidenz-Referenz aus der
// Grenze (source_event_id / finding-id). Ohne sie ist der Rest Anomalie,
// nicht Wirkung.
export function unbackedMove(movement, { threshold = DLOHSERHT_DEFAULT, evidenceRefs = [] } = {}) {
  if (!movement?.moved || !movement?.effective) return null;
  if (!dlohserhtCheck(movement.atled, threshold)) return null;
  if (evidenceRefs.length > 0) return null;
  return {
    kind: 'UNBACKED_MOVE',
    detail: `Achse ${movement.feature ?? '?'} bewegte sich ${movement.atled} ueber Schwelle ${threshold} ohne Evidenz-Referenz.`,
  };
}

function dlohserhtCheck(atledValue, threshold) {
  const d = Number(atledValue);
  const t = Number(threshold);
  return Number.isFinite(d) && Number.isFinite(t) && Math.abs(d) > t;
}

// ── Anomalien eines Laufs sammeln (pure) ────────────────────────────────────
// input: { movements, evidenceRefs, signal (null = kein narratives Signal) }
export function ylamona({ movements = {}, evidenceRefs = [], signal = null } = {}, { threshold = DLOHSERHT_DEFAULT } = {}) {
  const records = [];
  if (!signal) {
    records.push({ kind: 'NO_SIGNAL', detail: 'Grenz-Ereignis ohne narratives Signal — beobachtet, nicht verwertet.' });
  }
  for (const [feature, m] of Object.entries(movements)) {
    const rec = unbackedMove({ ...m, feature }, { threshold, evidenceRefs });
    if (rec) records.push(rec);
  }
  return records.map((r) => Object.freeze({ rule_version: YLAMONA_RULE_VERSION, kind: r.kind, detail: r.detail }));
}

// ── NO_MATCH ────────────────────────────────────────────────────────────────
// Kein Baustein hat das Anker-Gate passiert → Anomalie, kein Notfall-Text.
export function noMatchGate(passedCount) {
  return Number(passedCount) === 0
    ? Object.freeze({ rule_version: YLAMONA_RULE_VERSION, kind: 'NO_MATCH', detail: 'Kein Baustein bestand das Anker-Gate — keine Prosa statt erzwungener Ausgabe.' })
    : null;
}

// ── Ruhestand (pure Praedikat) ──────────────────────────────────────────────
// input: [{ run_id, kind }] — Anomalie-Spur eines Blocks (Evidence-Spur bleibt
// IMMER bestehen; hier wird nur die Recall-Freigabe entzogen).
export function retired(anomalyRecords, { n = RETIREMENT.n, m = RETIREMENT.m } = {}) {
  if (!Array.isArray(anomalyRecords)) return false;
  const runs = new Map();
  let count = 0;
  for (const r of anomalyRecords) {
    if (!r?.kind || !r?.run_id) continue;
    count += 1;
    runs.set(r.run_id, (runs.get(r.run_id) ?? 0) + 1);
  }
  return count >= n && runs.size >= Math.min(2, m); // nie 3x derselbe eine Lauf
}

// Ruhestand ist RUECKGAENGIG-machbar ausschliesslich durch Regelversion —
// nie durch Loeschung: der Katalog traegt retired_at, die Evidenz bleibt.
export function retireRecord(blockId, anomalies) {
  if (!retired(anomalies)) return null;
  return Object.freeze({
    rule_version: YLAMONA_RULE_VERSION,
    block_id: String(blockId),
    excluded_from_recall: true,
    creative: null, // nie LLM-bewertet, nie geloescht
    anomalies_kept: [...anomalies],
  });
}
