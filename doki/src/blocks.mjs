// DOKI reiner Kern — Primitive, Bausteine, Anker-Gate, Reaktionsvertrag
// (PLATZHALTER-ETUDE, nicht im Runtime-Pfad).
//
// Verantwortung: die Kompositionsschicht. Rohereignis → Tatsachen → Bewegung →
// Wirkungen → PRIMITIVE → BAUSTEINE. Primitive sind KEIN Text — strukturierte
// Bedeutungsbausteine mit Evidenz-Referenzen. Das Anker-Gate entscheidet, was
// ueberhaupt sagbar wird; der kreative Score (LLM-Rubrik) entscheidet nur,
// WELCHER verankerte Baustein unter Gleichen gewinnt — er kann einen
// unveraenderten/unverankerten Block NIE recall-faehig machen.
//
// Drei ehrliche Regeln (wie beim Evil Twin: BESTAETIGT traegt nur, wenn
// twinEvidenceOk echtes Lesen verifiziert — Prosa ersetzt nie einen Check):
//   1. Deterministischer Score = pure Runtime-Funktion aus verifizierbarer
//      Evidenz (anchor_ok + state_key-Match). EINZIGER Recall-Freigaber.
//      LLM-Einfluss: strukturell null (die Funktion nimmt keinen LLM-Output
//      entgegen; ihr Output schreibt diesen Score nie).
//   2. Ein Block sagt sich einmal je Muster (once-per-pattern).
//   3. Kreativ-Score: eigenes Record, markiert creative, gedeckelt
//      (CREATIVE_CAP), nie Teil des Anker-Gates.

import { digestJson } from './hash.mjs';

export const BLOCKS_RULE_VERSION = 'doki.blocks.v1';

// Primitive (strukturierte Bedeutung, KEIN Text) — wie verabredet.
export const PRIMITIVES = Object.freeze([
  'CLAIM', 'CONTRADICTION', 'REVERSAL', 'DISCOVERY', 'RECALL', 'TENSION',
  'TRUST_SHIFT', 'STATUS_SHIFT', 'ADMISSION', 'UNRESOLVED_CONFLICT',
]);

// Baustein-Slots (Komposition, spaeter Sprache).
export const BLOCK_SLOTS = Object.freeze([
  'setup', 'observation', 'reaction', 'contrast', 'callback', 'escalation', 'punchline', 'closing',
]);

// Kreativ-Deckel: wirkt nur TIEBREAK unter verankerten Gleichen.
export const CREATIVE_CAP = 0.3;

// ── Primitive aus Wirkungen + Signal (pure, strukturiert) ───────────────────
// input: { signal (aus signals.eventSignal), impacts (aus atled.impactsOf), patternKey, evidenceRefs }
export function primitivesOf({ signal = null, impacts = [], patternKey = null, evidenceRefs = [] } = {}) {
  const out = [];
  const push = (primitive, payload) => out.push(Object.freeze({
    rule_version: BLOCKS_RULE_VERSION,
    primitive, pattern_key: patternKey,
    evidence_refs: [...(payload?.evidence_refs ?? evidenceRefs)],
    ...(payload ?? {}),
  }));
  if (signal?.kind === 'finding') push('CONTRADICTION', { severity: signal.severity });
  if (signal?.kind === 'verdict') {
    if (signal.code === 'WRITE') push('STATUS_SHIFT', { code: signal.code });
    else push('TENSION', { code: signal.code });
  }
  if (signal?.kind === 'loop') {
    if (signal.state === 'WRITE_AUTHORIZED') push('CLAIM', { state: signal.state });
    if (signal.state === 'RE_REVIEW_RUNNING') push('RECALL', { state: signal.state });
    if (['LOOP_BLOCKED', 'ABORTED', 'ERROR'].includes(signal.state)) push('UNRESOLVED_CONFLICT', { state: signal.state });
  }
  for (const im of impacts) {
    if (im?.feature === 'trust') push('TRUST_SHIFT', { from: im?.atled, evidence_refs: im.evidence_refs });
    else if (im?.feature === 'irritation' || im?.feature === 'resentment') push('TENSION', { feature: im.feature, atled: im.atled, evidence_refs: im.evidence_refs });
    else if (im?.feature === 'respect' || im?.feature === 'competence_confidence') push('DISCOVERY', { feature: im.feature, atled: im.atled, evidence_refs: im.evidence_refs });
    else if (im?.feature === 'admission_made') push('ADMISSION', { atled: im.atled, evidence_refs: im.evidence_refs });
    else push('STATUS_SHIFT', { feature: im.feature, atled: im.atled, evidence_refs: im.evidence_refs });
  }
  return out;
}

// ── Deterministischer Score (EINZIGER Recall-Freigaber) ─────────────────────
// Pure Funktion: anchor_ok (echte Evidenz-Referenz) + state_key-Match.
// Nimmt KEINEN LLM-Output entgegen — kein Parameter, kein Feld, kein Pfad.
export function scoreBlock({ block, patternKey, evidenceRefs = [] } = {}) {
  if (!block) return { anchor_ok: false, state_key_match: false, deterministic: 0, recall: false };
  // anchor_ok: mind. eine Evidenz-Referenz, die als Grenz-Identitaet geformt ist
  const refs = (block.evidence_refs ?? []).filter((r) => typeof r === 'string' && r.length > 0);
  const anchor_ok = refs.length > 0;
  // state_key-Match: Baustein traegt das Lauf-Muster (phase/verdict/wave)
  const state_key_match = Boolean(patternKey) && block.pattern_key === patternKey;
  const deterministic = (anchor_ok ? 0.5 : 0) + (state_key_match ? 0.5 : 0);
  return Object.freeze({ anchor_ok, state_key_match, deterministic, recall: anchor_ok });
}

// ── Kreativ-Score (separates Record, markiert, gedeckelt) ───────────────────
// DARF vom LLM bewertet werden (Rubrik: Wortwitz, Bezugsqualitaet, Grammatik),
// darf subjektiv sein — wird aber GENANNT, gekapselt und gedeckelt. Er kommt
// hier als INJEKierter Wert rein (spaeter vom Runtime-Leser aus einem
// eigenen creative-Record gelesen), niemals aus scoreBlock().
export function creativeScore({ wit = 0, relevance = 0, grammar = 0 } = {}) {
  const clamp01 = (v) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : 0);
  const raw = (clamp01(wit) + clamp01(relevance) + clamp01(grammar)) / 3;
  return Object.freeze({ creative: true, rubric: { wit: clamp01(wit), relevance: clamp01(relevance), grammar: clamp01(grammar) }, value: Math.min(CREATIVE_CAP, raw) });
}

// ── Auswahl (Recall-Gate) ───────────────────────────────────────────────────
// Kandidaten: [{ block_id, slot, pattern_key, evidence_refs, creative? }]
// Rueckgabe:primary + 3–4 Kandidaten — NUR verankerte; kreativ nur als
// Tiebreak; ein unausgewaehlter/unverankter Block kann nicht gewinnen.
export function selectBlocks({ candidates = [], patternKey, said = {}, max = 4 } = {}) {
  const gate = [];
  for (const c of candidates) {
    const s = scoreBlock({ block: c, patternKey, evidenceRefs: c.evidence_refs });
    if (!s.recall) continue; // Anker-Gate: das ENDE. Kreativ rettet nichts.
    if (c.pattern_key && (said?.[c.pattern_key] ?? 0) > 0) continue; // einmal je Muster
    gate.push({ ...c, deterministic: s.deterministic, creativeValue: c.creative?.value ?? 0 });
  }
  gate.sort((a, b) =>
    (b.deterministic - a.deterministic)
    || (b.creativeValue - a.creativeValue)
    || (String(a.block_id) < String(b.block_id) ? -1 : 1));
  const picked = gate.slice(0, Math.max(1, max));
  if (!picked.length) return { primary: null, candidates: [], anomaly: 'NO_MATCH' };
  const [primary, ...rest] = picked;
  return Object.freeze({
    primary: Object.freeze({ block_id: primary.block_id, slot: primary.slot, pattern_key: primary.pattern_key, deterministic: primary.deterministic }),
    candidates: Object.freeze(rest.slice(0, Math.max(3, max - 1)).map((c) => Object.freeze({ block_id: c.block_id, slot: c.slot, deterministic: c.deterministic, creative: c.creativeValue }))),
  });
}

// ── Reaktionsvertrag (VOR jeder Prosa) ──────────────────────────────────────
// WHO reagiert? WORAN? WARUM? WELCHE Wirkung? WELCHE Evidenz? WELCHE Staerke?
// Nur aus nicht-fiktiven Daten: statischer Katalog (conflict_style, humor,
// defensiveness) + Wirkungs-Messung. Das LLM schreibt diesen Vertrag NIE —
// es konsumiert ihn. forbidden_modes leitet sich deterministisch her:
// aggressive Verbatim-Ausbrueche („rage“, „insult“) sind fuer analytische/
// direkte Konfliktstile verboten — die „ich piss in dein hu“-Falle.
export function reactionContract({ actor, target, trigger, impacts = [], catalog = null } = {}) {
  if (!actor || !trigger) throw new Error('Reaktionsvertrag braucht actor + trigger');
  const profile = catalog ?? { conflict_style: 'analytical', humor: 4, defensiveness: 5 };
  const topImpact = impacts[0] ?? null;
  const intensity = topImpact ? Math.min(1, Math.abs(Number(topImpact.impact) || 0)) : 0.1;
  const allowedByStyle = {
    analytical: ['dry', 'skeptical', 'precise'],
    direct: ['dry', 'blunt', 'precise'],
    humorous: ['wry', 'light', 'teasing'],
    aggressive: ['blunt', 'sharp'],
    evasive: ['mild', 'hedged', 'gentle'],
  }[profile.conflict_style] ?? ['dry'];
  const allowed = profile.humor >= 6 ? [...allowedByStyle, 'wry'] : allowedByStyle;
  return Object.freeze({
    rule_version: BLOCKS_RULE_VERSION,
    actor: String(actor),
    target: target ? String(target) : null,
    trigger: String(trigger),
    reaction: allowed[0],
    intensity: Math.round(intensity * 10000) / 10000,
    evidence_refs: [...(topImpact?.evidence_refs ?? [])],
    allowed_modes: Object.freeze([...allowed]),
    // Verboten IMMER: Ausbrueche ohne Evidenz und Beleidigung — der Vertrag
    // existiert, genau damit so etwas gar nicht erst Prosa wird.
    forbidden_modes: Object.freeze(['rage', 'insult', 'obscene']),
    authority: 'NONE',
  });
}

// Vertrags-Digest (pruefbar, spaeter im Prompt-Stripe referenzierbar).
export function contractDigest(contract) {
  return digestJson(contract);
}
