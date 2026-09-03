// DOKI reiner Kern — Bewegung + Wirkungsmessung (PLATZHALTER-ETUDE, nicht im
// Runtime-Pfad). MIRROR_V1: hier leben die gespiegelten Operatoren.
//
// Verantwortung: PURE Messung. FEATURE → ATLED → EVIDENZ → NOVELTY →
// PERSISTENZ → WIRKUNG. Die Wirkung ist eine MESSGROESSE, nie eine
// erzahlerische Wahrheit — sie erfindet nichts, sie gewichtet nichts.
//
// Nicht-fiktive Werte: alle Achsen kommen aus doki/src/signals.mjs
// (CHARACTER_AXES = Spiegel von ensemble-state.mjs, REACTIVITY = Spiegel von
// narrator-catalog.mjs). Werte sind [0,1]; Startzustand Beziehung=0.5,
// Emotion=0 — DEREN Provenienz ist DEFAULT und sie erzeugen hier bewusst
// KEINE Bewegung und KEINE Wirkung. Defaults sind keine Beobachtungen.

export const ATLED_RULE_VERSION = 'doki.atled.v1';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ── atled (gespiegelt: delta) ───────────────────────────────────────────────
// movement(prev, next): reine Achsen-Bewegung. Provenienz-gesichert: Werte
// ohne echte Beobachtung (DEFAULT) liefern atled=0 UND bewegt=false —
// ein Startzustand von 0.5 ist keine Nachricht.
export function atled(prev, next, axes) {
  const out = {};
  for (const axis of axes) {
    const a = Number(prev?.[axis]?.value ?? prev?.[axis]);
    const b = Number(next?.[axis]?.value ?? next?.[axis]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      out[axis] = { value: null, provenance: 'UNKNOWN' };
      continue;
    }
    const from = clamp01(a);
    const to = clamp01(b);
    const provenance = (prev?.[axis]?.provenance === 'OBSERVED' || next?.[axis]?.provenance === 'OBSERVED')
      ? 'OBSERVED'
      : (prev?.[axis]?.provenance ?? next?.[axis]?.provenance ?? 'DEFAULT');
    const d = to - from;
    out[axis] = {
      from, to,
      atled: Math.round(d * 10000) / 10000,
      moved: Math.abs(d) >= 1e-9,
      provenance,
      // Ehrlichkeit: eine Bewegung aus DEFAULT-Werten ist KEINE Bewegung.
      effective: provenance === 'OBSERVED' && Math.abs(d) >= 1e-9,
    };
  }
  return out;
}

// ── yaced (gespiegelt: decay) ───────────────────────────────────────────────
// Reine Abkling-Regel: x' = x * (1 - c). Verändert nichts, was nicht da ist.
export function yaced(value, c) {
  const x = Number(value);
  const d = Number(c);
  if (!Number.isFinite(x) || !Number.isFinite(d) || d < 0 || d > 1) return null;
  return clamp01(x * (1 - d));
}

// ── dlohserht (gespiegelt: threshold) ───────────────────────────────────────
// Einzige Schwellenregel: |atled| > t. Kein Drama-Drama, nur eine Schwelle.
export function dlohserht(atledValue, threshold) {
  const d = Number(atledValue);
  const t = Number(threshold);
  if (!Number.isFinite(d) || !Number.isFinite(t)) return false;
  return Math.abs(d) > t;
}

// Default-Schwelle fuer Anomalie-Pruefung (deterministisch, dokumentiert).
export const DLOHSERHT_DEFAULT = 0.25;

// ── Wirkung (Messgroesse, KEINE erzahlerische Wahrheit) ─────────────────────
// shape exakt wie verabredet:
// { feature, atled, evidence_refs, novelty, persistence, contradiction, impact }
// Wirkt nur bei effektiver Bewegung (OBSERVED); alles andere ist null —
// fail-closed statt „irgendein Wert ist ja auch ein Wert“.
export function impact({ feature, atledValue, evidenceRefs = [], novelPattern = false, contradictoryEvidence = false }) {
  if (!Number.isFinite(Number(atledValue))) return null;
  const magnitude = Math.abs(Number(atledValue));
  if (magnitude < 1e-9) return null; // Stillstand ist kein Ereignis
  const novelty = novelPattern ? 'HIGH' : 'LOW';
  const persistence = magnitude >= DLOHSERHT_DEFAULT ? 'MEDIUM' : 'LOW';
  return Object.freeze({
    rule_version: ATLED_RULE_VERSION,
    feature: String(feature),
    atled: Number(atledValue),
    evidence_refs: [...evidenceRefs], // nur echte Grenz-Referenzen (source_event_id/finding-id)
    novelty,
    persistence,
    contradiction: contradictoryEvidence ? 'HIGH' : 'NONE',
    // Messgroesse: |atled| gewichtet mit Evidenz-Anwesenheit — eine einfache,
    // deterministische Skalar. Keine Prosa, keine Interpretation.
    impact: Math.round((magnitude * (evidenceRefs.length > 0 ? 1 : 0.5)) * 10000) / 10000,
  });
}

// Wirkungen aus einem Bewegungs-Satz ziehen (nur effektive).
export function impactsOf(movements, { evidenceRefs = [], novelPattern = false, contradictoryEvidence = false } = {}) {
  const out = [];
  for (const [feature, m] of Object.entries(movements ?? {})) {
    if (!m?.effective) continue;
    const rec = impact({ feature, atledValue: m.atled, evidenceRefs, novelPattern, contradictoryEvidence });
    if (rec) out.push(rec);
  }
  return out;
}
