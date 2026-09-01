// FalsifyMe TUI - fallende Code-Partikel (Aktivitaetsvisualisierung)
// Verantwortung: Simulation des Partikel-Feldes + Render-Zellen.
// VISUELLE PARTIKEL: generische Fragmente, optional getaggt mit ECHTEN
// Aktivitaets-Labels (Tool-/Dateinamen). Sie erzeugen keine falschen
// Agentenaussagen - ohne echte Labels fallen generische Fragmente.
// Pure Simulation: Float-Felder, deterministischer Seed, keine Allokationen
// grosser Objekte pro Frame.
import { clamp } from "./wcwidth.mjs";

const FRAGMENTS = [
  "const scope = …", "verdict.mjs", "validateScope()", "job.claim()",
  "findings.push()", "read_file()", "scope.id", "worker.loop()",
  "glob('**/*.js')", "agent.think()", "subprompt", "MODEL(",
  "READ ONLY", "review(run)", "tools.mjs", "plan.json",
  "claim NEXT", "delta → patch", "resolve()", "queue.wait()",
];

const GLYPHS = ["░", "█", "▓"];

// Deterministischer PRNG (mulberry32).
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const makeDrop = (rnd, cols, rows, labelPool) => {
  const hasLabel = labelPool.length > 0 && rnd() < 0.3;
  const entry = hasLabel ? labelPool[Math.floor(rnd() * labelPool.length)] : null;
  return {
    x: Math.floor(rnd() * Math.max(1, cols - 18)),
    y: rnd() * rows,
    speed: 0.014 + rnd() * 0.036, // Zeilen pro 16ms-Frame
    glyph: GLYPHS[Math.floor(rnd() * GLYPHS.length)],
    text: entry ? entry.label : FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)],
    labelled: !!entry,
  };
};

export const createField = ({ cols = 60, rows = 14, seed = 1, density = 0.011, labelPool = [] } = {}) => {
  const rnd = mulberry32(seed);
  const count = clamp(6, Math.floor(cols * rows * density), 28);
  const drops = [];
  for (let i = 0; i < count; i++) drops.push(makeDrop(rnd, cols, rows, labelPool));
  return { cols, rows, drops, rnd, labelPool, lastTick: 0 };
};

// dt in ms; active=false => langsamer Drift (kein Fake-"Denken" bei Idle).
export const step = (field, dt, { active = true } = {}) => {
  const d = Math.min(250, Math.max(0, dt));
  const factor = (d / 16) * (active ? 1 : 0.06);
  if (factor <= 0) return;
  for (const drop of field.drops) {
    drop.y += drop.speed * factor;
    if (drop.y > field.rows + 1) {
      Object.assign(drop, makeDrop(field.rnd, field.cols, field.rows, field.labelPool));
      drop.y = -1 - field.rnd() * 3;
    }
  }
};

// Fuegt echte Aktivitaets-Labels in den Pool (neueste zuerst, begrenzt).
export const setLabels = (field, labels) => {
  field.labelPool = labels.filter(Boolean).slice(0, 5).map((l) => ({ label: String(l) }));
};

// Render: Array[rows] von Array[cols]-Zellen; jede Zelle = { ch, dim } | null.
// Count-Drops (aber keine Drops sind 2 Buchstaben?) - ein Drop pro Zelle gewinnt
// (naechster Frame), Mehrfachbelegungen durch spate Drops ueberschrieben.
export const render = (field) => {
  const rows = field.rows;
  const cols = field.cols;
  const cells = new Array(rows);
  for (let r = 0; r < rows; r++) cells[r] = new Array(cols).fill(null);
  for (const drop of field.drops) {
    const row = Math.floor(drop.y);
    if (row < 0 || row >= rows) continue;
    if (row >= 0) {
      const glyphCol = Math.floor(drop.x);
      if (glyphCol >= 0 && glyphCol < cols) {
        cells[row][glyphCol] = { ch: drop.glyph, dim: !drop.labelled };
      }
      const start = glyphCol + 2;
      for (let i = 0; i < drop.text.length && start + i < cols; i++) {
        const ch = drop.text[i];
        cells[row][start + i] = { ch, dim: !drop.labelled };
      }
    }
  }
  return cells;
};