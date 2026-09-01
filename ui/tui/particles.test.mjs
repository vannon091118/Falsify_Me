import { test } from "node:test";
import assert from "node:assert/strict";
import { createField, step, render, setLabels } from "./particles.mjs";

test("deterministisch: gleicher Seed -> gleiches Feld", () => {
  const a = createField({ cols: 60, rows: 12, seed: 42 });
  const b = createField({ cols: 60, rows: 12, seed: 42 });
  assert.deepEqual(a.drops, b.drops);
  const c = createField({ cols: 60, rows: 12, seed: 1 });
  assert.notDeepEqual(a.drops, c.drops);
});

test("Feld-Groesse: Dichte im erlaubten Bereich", () => {
  const f = createField({ cols: 120, rows: 30, seed: 5 });
  assert.ok(f.drops.length >= 6 && f.drops.length <= 28);
});

test("step: Tropfen fallen nach unten; wrap respawnt oberhalb", () => {
  const f = createField({ cols: 40, rows: 10, seed: 9 });
  const y0 = f.drops.map((d) => d.y);
  step(f, 16, { active: true });
  const y1 = f.drops.map((d) => d.y);
  for (let i = 0; i < f.drops.length; i++) {
    assert.ok(y1[i] > y0[i] - 1e-9, "bewegt sich nach unten");
  }
  // Simuliere viele Frames: alle Drops muessen im Wrap landen (unterhalb ge-respawnt)
  for (let i = 0; i < 4000; i++) step(f, 16, { active: true });
  for (const d of f.drops) assert.ok(d.y < f.rows + 1 && d.y >= -4);
});

test("step: active=false -> langsamer Drift (kein Fake-Denken)", () => {
  const f = createField({ cols: 40, rows: 10, seed: 3 });
  const y0 = f.drops.map((d) => d.y);
  step(f, 16_000, { active: false });
  const y1 = f.drops.map((d) => d.y);
  const moved = y1.reduce((acc, v, i) => acc + Math.abs(v - y0[i]), 0);
  assert.ok(moved < 40, `Drift muss klein bleiben, war ${moved}`);
});

test("render: liefert rows x cols Zellen; Inhalte nach Steps", () => {
  const f = createField({ cols: 30, rows: 8, seed: 11 });
  const cells = render(f);
  assert.equal(cells.length, 8);
  for (const row of cells) {
    assert.equal(row.length, 30);
    for (const c of row) {
      if (c !== null) {
        assert.equal(typeof c.ch, "string");
        assert.equal(typeof c.dim, "boolean");
      }
    }
  }
  let nonEmpty = 0;
  for (const row of cells) for (const c of row) if (c) nonEmpty++;
  assert.ok(nonEmpty > 0, "irgendwo muss ein Partikel sichtbar sein");
});

test("render: ueberlappende Labels mischen sich NICHT zu Wort-Mashups", () => {
  // Zwei Drops auf derselben Zeile mit ueberlappender Text-Spanne: der ERSTE
  // gewinnt, der zweite weicht aus -> keine zusammengewuerfelten Woerter wie
  // "subpromptMODEL(" (Dock-Screenshot-Befund 2026-09-01).
  const field = {
    cols: 30,
    rows: 2,
    drops: [
      { x: 1, y: 0, text: "subprompt", glyph: "░", labelled: false },
      { x: 7, y: 0, text: "MODEL(", glyph: "▓", labelled: false },
    ],
  };
  const row = render(field)[0].map((c) => (c ? c.ch : " ")).join("");
  assert.ok(row.includes("subprompt"), "erstes Label bleibt durchgehend lesbar");
  assert.ok(!row.includes("MODEL("), "spaeteres Label wird nicht ueber das erste gemischt");
  assert.ok(!/subpr\w*MODEL/.test(row), "kein Wort-Mashup (subpromptMODEL(...)-Klasse)");
});

test("setLabels: echte Aktivitaets-Labels landen nach Steps im Feld", () => {
  const f = createField({ cols: 50, rows: 10, seed: 7 });
  setLabels(f, ["read_file(app.js)", "glob('src')"]);
  let found = false;
  for (let i = 0; i < 3000 && !found; i++) {
    step(f, 16, { active: true });
    for (const row of render(f)) {
      for (const c of row) {
        if (c && (c.ch === "r" || c.ch === "g") && !c.dim) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  assert.ok(found, "label-getaggte Partikel (dim=false) muessen erscheinen");
});