// FalsifyMe – Regressionstest F-1 (Live-E2E 2026-09-02): Duplikat-Schatten-Falle
// beim API-Key-Laden aus der .env. readKeyFromEnvFile muss die LETZTE befuellte
// Zeile gewinnen lassen; leere Vorlagen-/Duplikat-Zeilen zaehlen nie als Wert.
// Isoliert: FALSIFY_HOME + FALSIFY_ENV zeigen auf eigenes Temp-Verzeichnis.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadApiKey, keyEnvFile } from "../core/keys.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falsify-keys-"));
const HOME = path.join(tmp, "home");
const ENV = path.join(tmp, "home", ".env");
fs.mkdirSync(HOME, { recursive: true });

const saved = {};
for (const n of ["FALSIFY_HOME", "FALSIFY_ENV", "FALSIFY_API_KEY_ENV", "NVIDIA_API_KEY", "OPENAI_API_KEY", "FALSIFY_API_KEY"]) {
  saved[n] = process.env[n];
  delete process.env[n];
}
process.env.FALSIFY_HOME = HOME;
process.env.FALSIFY_ENV = ENV;

after(() => {
  for (const [n, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const writeEnv = (txt) => fs.writeFileSync(ENV, txt, "utf8");

test("F-1: befuellte Duplikat-Zeile nach leerer Vorlagen-Zeile gewinnt (Schatten-Falle)", () => {
  writeEnv(`NVIDIA_API_KEY=
OPENAI_API_KEY=
NVIDIA_API_KEY="nvapi-fresh"
`);
  assert.equal(keyEnvFile(), ENV);
  assert.equal(loadApiKey(), "nvapi-fresh");
});

test("F-1: leere Vorlagen-Zeilen zaehlen nie als Wert - Key bleibt ungesetzt", () => {
  writeEnv(`NVIDIA_API_KEY=
OPENAI_API_KEY=
FALSIFY_API_KEY=
`);
  assert.equal(loadApiKey(), null);
});

test("F-1: zuletzt geschriebener befuellter Wert gewinnt bei mehreren Duplikaten", () => {
  writeEnv(`NVIDIA_API_KEY="alpha"
NVIDIA_API_KEY="beta"
NVIDIA_API_KEY="gamma"
`);
  assert.equal(loadApiKey(), "gamma");
});

test("F-1: Bestand - einfache Zeile mit Quotes und ohne Quotes wird gelesen", () => {
  writeEnv(`NVIDIA_API_KEY=plain-value
`);
  assert.equal(loadApiKey(), "plain-value");
  writeEnv(`NVIDIA_API_KEY="quoted-value"
`);
  assert.equal(loadApiKey(), "quoted-value");
});

test("F-1: angehaengte leere Duplikat-Zeile schattet den frueheren befuellten Wert nicht", () => {
  // Angehaengte leere Duplikat-Zeile (manuelles Editieren) darf den echten
  // frueheren Wert NICHT schatten - umgekehrter Schatten-Fall.
  writeEnv(`NVIDIA_API_KEY="real-key"
NVIDIA_API_KEY=
`);
  assert.equal(loadApiKey(), "real-key");
});

test("F-1: Namen-Reihenfolge bleibt - erster gesetzter Name gewinnt, kein Fallback-Mix", () => {
  writeEnv(`NVIDIA_API_KEY=
OPENAI_API_KEY="groq-key"
FALSIFY_API_KEY="other"
`);
  assert.equal(loadApiKey(), "groq-key");
});