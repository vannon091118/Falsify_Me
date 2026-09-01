import { test } from "node:test";
import assert from "node:assert/strict";
import { stage, BLOCK_ROWS, WORD } from "./boot.mjs";
import { createUiState } from "./state.mjs";

const booted = (at) => {
  const s = createUiState();
  s.state = "STARTING";
  s.bootAt = at;
  return s;
};

test("stage: build waechst (chars/block)", () => {
  const s = booted(0);
  const a = stage(s, 100);
  assert.equal(a.mode, "build");
  assert.ok(a.chars >= 1 && a.chars <= WORD.length);
  assert.ok(a.block >= 0 && a.block <= 3);
  const b = stage(s, 800);
  assert.ok(b.chars >= a.chars);
});

test("stage: condense nach BUILD_MS", () => {
  const s = booted(0);
  const st = stage(s, 1000);
  assert.equal(st.mode, "condense");
  assert.ok(st.t > 0 && st.t <= 1);
  assert.equal(st.chars, WORD.length);
});

test("stage: nicht-STARTING -> sofort live (Handoff an Live-UI)", () => {
  const s = createUiState(); // IDLE
  const st = stage(s, 12345);
  assert.equal(st.mode, "live");
});

test("BLOCK_ROWS: 4 Wachstumsstufen, wachsend", () => {
  assert.equal(BLOCK_ROWS.length, 4);
  for (let i = 1; i < BLOCK_ROWS.length; i++) {
    assert.ok(BLOCK_ROWS[i].length > BLOCK_ROWS[i - 1].length);
  }
});