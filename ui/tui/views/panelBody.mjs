// FalsifyMe TUI · views/panelBody.mjs
// Pure Entscheidungsfunktion (KEIN React, KEIN State): Was zeigt eine
// Slot-Panel im SlotsView als Body?
//
// E2E-Befund 2026-09-02 (Multi-Window-Sichtbarkeit): Der lesbare
// Reasoning-Verlauf lag im snapshot.output-Ring, wurde aber im SlotsView nie
// angezeigt — jede Panel zeigte nur Partikel. Damit die Gegen-/Erstpruefung
// WIRKLICH lesbar ist, zeigt ein Slot im Denk-Zustand (THINKING/TOOL_ACTIVITY/
// FINDINGS/VERIFYING) SEINE Output-Zeilen; nur wenn er noch keinen Output hat
// (Start/Idle), bleiben Partikel (Rueckgabe null). Stateless + testbar.
export const RESONING_STATES = new Set(["THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERIFYING"]);

export function slotBodyLines(panel, cols, maxRows) {
  const output = Array.isArray(panel?.output) ? panel.output : [];
  if (!RESONING_STATES.has(panel?.state) || output.length === 0) return null;
  const inner = Math.max(1, cols - 4); // Platz fuer Panel-Rahmen "│ … │"
  // Neueste Zeilen unten; jede auf die Panel-Breite begrenzt, Inhalt sonst intakt.
  return output.slice(-maxRows).map((l) => String(l).slice(0, inner));
}
