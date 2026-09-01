// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/util.mjs – gemeinsame CLI-Helfer
// -----------------------------------------------------------------------------
// Von allen Kommando-Modulen genutzt (Fehlerausgang + Textkürzung).
// ─────────────────────────────────────────────────────────────────────────────
export function fail(msg) {
  console.error(`FEHLER: ${msg}`);
  process.exit(2);
}

export function truncate(s, n = 90) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}
