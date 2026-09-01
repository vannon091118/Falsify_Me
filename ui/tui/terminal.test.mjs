import { test } from "node:test";
import assert from "node:assert/strict";
import { enter, exit, setTitle, ALT_ON, ALT_OFF } from "./terminal.mjs";

const fakeOut = () => {
  const chunks = [];
  return {
    chunks,
    write(s) {
      chunks.push(s);
    },
    all() {
      return chunks.join("");
    },
  };
};

test("enter aktiviert Alt-Screen + Titel", () => {
  const out = fakeOut();
  enter(out, "FALSIFYME 1");
  assert.ok(out.all().includes(ALT_ON), "Alt-Screen ON");
  assert.ok(out.all().includes("\x1b]0;FALSIFYME 1\x07"), "Titel");
});

test("exit stellt Alt-Screen + Reset wieder her", () => {
  const out = fakeOut();
  exit(out);
  assert.ok(out.all().includes(ALT_OFF), "Alt-Screen OFF");
  assert.ok(out.all().includes("\x1b[0m"), "Reset");
});

test("setTitle ohne Alt-Screen-Einfluss", () => {
  const out = fakeOut();
  setTitle("X", out);
  assert.equal(out.all(), "\x1b]0;X\x07");
});