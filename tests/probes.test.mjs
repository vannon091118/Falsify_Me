// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe · tests/probes.test.mjs – Probe-Vertrag (P0-Cutover, Revision 5)
// -----------------------------------------------------------------------------
// Deckt ab: splitRequirement (Satz-/Listen-/Zeilen-/Semikolon-Grenzen, Original-
// Spans, Mini-Merge, Tail-Merge-Kappe 12, vager Ein-Satz-Header → H1),
// parseProbeSet (fail-closed ohne Fence/kaputtes JSON), validateProbeSet (NUR
// formal/strukturell: Schema, Paraphrase-Abweisung, Coverage-Härte, Target in
// Root+Whitelist, Anti-Vakuum-Minima, Doppel-IDs, Enum), probeEvidenceOk
// (bestehende Regel-6-Semantik pro Probe) und computeVerdict (deterministisches
// Gate: Cutover-Matrix + P7-Attack-Fixtures).
// Alles reine Funktionen + Wegwerf-Roots; kein Netz, kein echter Key.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function mod(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href);
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "falsify-probes-"));
}

// ── splitRequirement ─────────────────────────────────────────────────────────

test("splitRequirement: Satzenden trennen, Original-Spans bleiben 1:1 (byte-identisch)", async () => {
  const { splitRequirement } = await mod("core/probes.mjs");
  const src = "Erstelle eine Funktion. Sie soll inkrementieren! Was ist mit Null?";
  const rs = splitRequirement(src);
  assert.deepEqual(rs.map((r) => r.id), ["H1", "H2", "H3"]);
  assert.equal(rs.map((r) => r.text).join(" "), src, "Join mit Leerzeichen rekonstruiert den Original-Text");
});

test("splitRequirement: Aufzählungs-/Zeilen-Grenzen trennen; Listenmarker '1.' trennt NICHT", async () => {
  const { splitRequirement } = await mod("core/probes.mjs");
  const rs = splitRequirement("1. Erste Anforderung\n2. Zweite Anforderung\n- Dritte Anforderung");
  assert.deepEqual(rs.map((r) => r.id), ["H1", "H2", "H3"]);
  assert.match(rs[0].text, /Erste Anforderung/);
  assert.match(rs[1].text, /Zweite Anforderung/);
  assert.match(rs[2].text, /Dritte Anforderung/);
});

test("splitRequirement: Semikolon trennt, Abkürzungen ('z. B.') nicht", async () => {
  const { splitRequirement } = await mod("core/probes.mjs");
  const rs = splitRequirement("Lade Daten; validiere sie z. B. per Schema. Speichere das Ergebnis.");
  assert.deepEqual(rs.map((r) => r.id), ["H1", "H2", "H3"], "Semikolon trennt, 'z. B.' nicht");
  assert.match(rs[0].text, /Lade Daten/);
  assert.match(rs[1].text, /z\. B\. per Schema/);
  assert.match(rs[2].text, /Speichere/);
});

test("splitRequirement: vager Ein-Satz-Header → genau H1 (Coverage mit ≥1 Probe erfüllbar)", async () => {
  const { splitRequirement } = await mod("core/probes.mjs");
  const rs = splitRequirement("Mach die App besser");
  assert.deepEqual(rs, [{ id: "H1", text: "Mach die App besser" }]);
  assert.equal(splitRequirement("").length, 0);
});

test("splitRequirement: Mini-Fragmente mergen, Kappe 12 (Tail-Merge)", async () => {
  const { splitRequirement, TAIL_MERGE_CAP } = await mod("core/probes.mjs");
  // Killer-Reste: "." und "1." werden an die nächste Einheit gemerged.
  const rs = splitRequirement("Ein Satz. Ein weiterer Satz");
  assert.equal(rs.length, 2);
  // Kappe: 15 Einheiten → 12 (Rest an der letzten).
  const many = Array.from({ length: 15 }, (_, i) => `Anforderung Nummer ${i + 1} pruefen.`).join("\n");
  const capped = splitRequirement(many);
  assert.equal(capped.length, TAIL_MERGE_CAP);
  assert.match(capped[capped.length - 1].text, /Anforderung Nummer 12/);
  assert.match(capped[capped.length - 1].text, /Anforderung Nummer 15/, "Rest wurde an die letzte Einheit gemerged");
  assert.ok(capped.slice(0, 11).every((r) => !/\n/.test(r.text)));
});

test("renderRequirementList: Spans als <H1>…</H1> (Original-Text, keine Paraphrase)", async () => {
  const { splitRequirement, renderRequirementList } = await mod("core/probes.mjs");
  const list = renderRequirementList(splitRequirement("A ist zu tun. B ist zu tun"));
  assert.equal(list, "<H1>A ist zu tun.</H1>\n<H2>B ist zu tun</H2>");
});

// ── parseProbeSet ────────────────────────────────────────────────────────────

const GOOD_PROBE = {
  id: "P1",
  requirement_ref: "H1",
  class: "claim-check",
  target: "core/tools.mjs",
  claim: "claimNextJob reserviert den Scope atomar in der Claim-Transaktion.",
  check: "Lies artifacts/jobs.mjs und prüfe, dass setWorkerScope innerhalb derselben BEGIN IMMEDIATE-Transaktion wie der Claim-UPDATE läuft.",
};

test("parseProbeSet: gültiger json-Fence wird geparst (letzer Fence mit probes gewinnt)", async () => {
  const { parseProbeSet } = await mod("core/probes.mjs");
  const content = `Kritik im Fließtext.

\`\`\`json
{"probes": [${JSON.stringify(GOOD_PROBE)}]}
\`\`\`

Mehr Text. Abschließend noch ein zweiter Fence:

\`\`\`json
{"probes": [${JSON.stringify({ ...GOOD_PROBE, id: "P2" })}]}
\`\`\``;
  const parsed = parseProbeSet(content);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.probes.length, 1, "LETZTER Fence gewinnt (deterministische Quelle)");
  assert.equal(parsed.probes[0].id, "P2");
});

test("parseProbeSet: fail-closed ohne Fence / mit kaputtem JSON / ohne probes-Array", async () => {
  const { parseProbeSet } = await mod("core/probes.mjs");
  assert.equal(parseProbeSet("nur Prosa, kein Fence").ok, false);
  assert.equal(parseProbeSet("```json\n{kaputt\n```").ok, false);
  assert.equal(parseProbeSet('```json\n{"andere": 1}\n```').ok, false);
  assert.equal(parseProbeSet('```json\n{"probes": {"kein": "array"}}\n```').ok, false);
  assert.equal(parseProbeSet("").ok, false);
  assert.equal(parseProbeSet(null).ok, false);
});

// ── validateProbeSet ─────────────────────────────────────────────────────────

function probeSetEnv() {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, "core"), { recursive: true });
  fs.writeFileSync(path.join(root, "core", "tools.mjs"), "export const x = 1;\n");
  fs.writeFileSync(path.join(root, "core", "other.mjs"), "export const o = 1;\n");
  return { root, whitelist: ["core/tools.mjs"] };
}

test("validateProbeSet: gültiges Set ok (Coverage H1+H2, Target in Root+Whitelist)", async () => {
  const { validateProbeSet } = await mod("core/probes.mjs");
  const { root, whitelist } = probeSetEnv();
  try {
    const validation = validateProbeSet(
      [GOOD_PROBE, { ...GOOD_PROBE, id: "P2", requirement_ref: "H2" }],
      { requirementSource: "Erste Anforderung an das Modul. Zweite Anforderung an das Modul.", root, whitelist },
    );
    assert.equal(validation.ok, true, validation.reasons.join(" | "));
    assert.deepEqual(validation.reasons, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("validateProbeSet: Paraphrase als requirement_ref failt (nur Original-H_i-IDs)", async () => {
  const { validateProbeSet } = await mod("core/probes.mjs");
  const { root, whitelist } = probeSetEnv();
  try {
    const validation = validateProbeSet(
      [{ ...GOOD_PROBE, requirement_ref: "Anforderung 1 (Paraphrase)" }],
      { requirementSource: "Erste Anforderung an das Modul.", root, whitelist },
    );
    assert.equal(validation.ok, false);
    assert.match(validation.reasons.join("\n"), /requirement_ref "Anforderung 1 \(Paraphrase\)" ist keine Original-Anforderungs-ID/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("validateProbeSet: Coverage-Härte – fehlende H_i → ok:false (PLAN, keine Ausnahme)", async () => {
  const { validateProbeSet } = await mod("core/probes.mjs");
  const { root, whitelist } = probeSetEnv();
  try {
    const validation = validateProbeSet([GOOD_PROBE], {
      requirementSource: "Erste Anforderung an das Modul. Zweite Anforderung an das Modul.",
      root, whitelist,
    });
    assert.equal(validation.ok, false);
    assert.match(validation.reasons.join("\n"), /Coverage: H2 hat keine Probe/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("validateProbeSet: Anti-Vakuum – vakanter/kurzer check, Lob-claim, Doppel-ID, unbekannte Klasse", async () => {
  const { validateProbeSet, CLAIM_MIN, CHECK_MIN } = await mod("core/probes.mjs");
  const { root, whitelist } = probeSetEnv();
  try {
    const src = "Erste Anforderung an das Modul. Zweite Anforderung an das Modul.";
    const base = { target: "core/tools.mjs" };
    const validation = validateProbeSet(
      [
        // Lob-Claim (Bestätigungs-Vokabular) → invalid:
        { ...base, id: "P1", requirement_ref: "H1", class: "claim-check", claim: "Alles ist korrekt umgesetzt", check: "Prüfe die Claim-Transaktion in artifacts/jobs.mjs komplett durch." },
        // Kurzer check → invalid:
        { ...base, id: "P2", requirement_ref: "H1", class: "claim-check", claim: "Der Claim reserviert den Scope atomar.", check: "kurz" },
        // Doppelte ID → invalid:
        { ...base, id: "P3", requirement_ref: "H1", class: "claim-check", claim: "Der Claim reserviert den Scope atomar.", check: "Lies artifacts/jobs.mjs und verifiziere die Transaktionsgrenze vollständig." },
        { ...base, id: "P3", requirement_ref: "H2", class: "regression", claim: "Der zweite Anker prüft die zweite Anforderung.", check: "Lies artifacts/jobs.mjs und verifiziere die Transaktionsgrenze vollständig." },
        // Unbekannte Klasse → invalid:
        { ...base, id: "P4", requirement_ref: "H2", class: "vibes", claim: "Der zweite Anker prüft die zweite Anforderung.", check: "Lies artifacts/jobs.mjs und verifiziere die Transaktionsgrenze vollständig." },
        // Kurzer claim → invalid:
        { ...base, id: "P5", requirement_ref: "H2", class: "claim-check", claim: "zu kurz", check: "Lies artifacts/jobs.mjs und verifiziere die Transaktionsgrenze vollständig." },
      ],
      { requirementSource: src, root, whitelist },
    );
    assert.equal(validation.ok, false);
    const joined = validation.reasons.join("\n");
    assert.match(joined, /Lob-Formulierung/);
    assert.match(joined, /check zu kurz/);
    assert.match(joined, /doppelte id "P3"/);
    assert.match(joined, /unbekannte class "vibes"/);
    assert.match(joined, /claim zu kurz/);
    assert.ok(CLAIM_MIN > 0 && CHECK_MIN > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("validateProbeSet: kaputtes Target (absolut, .., existiert nicht, außerhalb Whitelist)", async () => {
  const { validateProbeSet } = await mod("core/probes.mjs");
  const { root, whitelist } = probeSetEnv();
  try {
    const src = "Erste Anforderung an das Modul. Zweite Anforderung an das Modul.";
    const base = { id: "P1", requirement_ref: "H1", class: "claim-check", claim: "Der Claim reserviert den Scope atomar.", check: "Lies artifacts/jobs.mjs und verifiziere die Transaktionsgrenze vollständig." };
    const validation = validateProbeSet(
      [
        { ...base, id: "P1", target: "C:/Windows/system32/config.sys" },
        { ...base, id: "P2", target: "../outside/secrets.env" },
        { ...base, id: "P3", target: "core/gibtsnicht.mjs" },
        { ...base, id: "P4", target: "core/other.mjs" },
      ],
      { requirementSource: src, root, whitelist },
    );
    assert.equal(validation.ok, false);
    const joined = validation.reasons.join("\n");
    assert.match(joined, /absoluter Pfad/);
    assert.match(joined, /verlässt das Zielprojekt/);
    assert.match(joined, /existiert nicht unter dem Root: core\/gibtsnicht\.mjs/);
    assert.match(joined, /nicht in der Zugriffs-Whitelist: core\/other\.mjs/, "existierende Datei außerhalb der Whitelist blockt");
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

// ── probeEvidenceOk (bestehende Regel-6-Semantik, pro Probe) ─────────────────

test("probeEvidenceOk: BESTAETIGT braucht eigenes Lesen UND verifizierte Referenz; WIDERSPRUCH/UNKLAR frei", async () => {
  const { probeEvidenceOk } = await mod("core/probes.mjs");
  const root = tmpRoot();
  try {
    fs.mkdirSync(path.join(root, "core"), { recursive: true });
    fs.writeFileSync(path.join(root, "core", "tools.mjs"), "export const x = 1;\nexport const y = 2;\n");
    const opts = { root, whitelist: ["core/tools.mjs"] };
    const run = { error: null, toolRounds: 2, toolEvidence: [{ tool: "read_file", path: "core/tools.mjs", allowed: true, success: true }] };
    // 1) BESTAETIGT + eigener read_file + wörtlich zitierte eigene Zeile → ok.
    assert.equal(probeEvidenceOk(
      { probe_id: "P1", status: "BESTAETIGT", evidence: 'Gegenprobe: `core/tools.mjs:2` → "export const y = 2;" trägt die Behauptung.' },
      run, opts,
    ), true);
    // 2) BESTAETIGT ohne Tool-Evidenz → fail-closed.
    assert.equal(probeEvidenceOk(
      { probe_id: "P1", status: "BESTAETIGT", evidence: "Behauptung hält nach eigener Prüfung." },
      { ...run, toolRounds: 0, toolEvidence: [] }, opts,
    ), false);
    // 3) BESTAETIGT mit halluziniertem Zitat → fail-closed.
    assert.equal(probeEvidenceOk(
      { probe_id: "P1", status: "BESTAETIGT", evidence: 'Gegenprobe: `core/tools.mjs:2` → "export const zzz = 9;"' },
      run, opts,
    ), false);
    // 4) Twin-Fehler → fail-closed.
    assert.equal(probeEvidenceOk(
      { probe_id: "P1", status: "BESTAETIGT", evidence: "irgendwas" },
      { ...run, error: "API down" }, opts,
    ), false);
    // 5) WIDERSPRUCH/UNKLAR sind nicht pruefpflichtig.
    assert.equal(probeEvidenceOk({ probe_id: "P1", status: "WIDERSPRUCH", evidence: "" }, { error: null, toolRounds: 0, toolEvidence: [] }, opts), true);
    assert.equal(probeEvidenceOk({ probe_id: "P1", status: "UNKLAR", evidence: "" }, { error: null, toolRounds: 0, toolEvidence: [] }, opts), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

// ── computeVerdict (Cutover-Matrix + P7-Attack-Fixtures) ─────────────────────

const VALID_VALIDATION = { ok: true, reasons: [], probes: [GOOD_PROBE] };
const BEST_RESULT = { probe_id: "P1", status: "BESTAETIGT", evidence: "e", evidenceOk: true };
const NO_EVIDENCE_RUN = { error: null, toolRounds: 0, toolEvidence: [] };

test("computeVerdict: Cutover-Matrix – alle BESTAETIGT+Evidence+Gates grün → WRITE", async () => {
  const { computeVerdict } = await mod("core/probes.mjs");
  const out = computeVerdict({ validation: VALID_VALIDATION, results: [BEST_RESULT] });
  assert.equal(out.verdict, "WRITE");
  assert.deepEqual(out.reasons, []);
});

test("computeVerdict: kaputtes/fehlendes Probe-Set → PLAN (Thinker-WRITE ohne Probe-Set)", async () => {
  const { computeVerdict } = await mod("core/probes.mjs");
  assert.equal(computeVerdict({ parseError: "kein Fence", validation: null, results: null }).verdict, "PLAN");
  assert.equal(computeVerdict({ validation: { ok: false, reasons: ["Coverage: H1 hat keine Probe (x)"], probes: [] }, results: [BEST_RESULT] }).verdict, "PLAN");
  assert.match(computeVerdict({ validation: { ok: false, reasons: ["Coverage: H1 hat keine Probe (x)"], probes: [] }, results: [BEST_RESULT] }).reasons.join("\n"), /Coverage: H1/);
});

test("computeVerdict: Twin nicht ausgeführt / fehlende probe_id → PLAN (→ UNKLAR-Lesart)", async () => {
  const { computeVerdict } = await mod("core/probes.mjs");
  const noRun = computeVerdict({ validation: VALID_VALIDATION, results: null });
  assert.equal(noRun.verdict, "PLAN");
  assert.match(noRun.reasons.join("\n"), /kein ProbeResult/);
  const partial = computeVerdict({ validation: VALID_VALIDATION, results: [] });
  assert.equal(partial.verdict, "PLAN");
  const missingProbe = computeVerdict({ validation: VALID_VALIDATION, results: [{ probe_id: "P9", status: "BESTAETIGT", evidenceOk: true }] });
  assert.equal(missingProbe.verdict, "PLAN");
  assert.match(missingProbe.reasons.join("\n"), /Probe P1: fehlt im ProbeResult/);
});

test("computeVerdict: UNKLAR/WIDERSPRUCH/Evidence-fail je Probe → PLAN (P7: alte Angriffsklassen)", async () => {
  const { computeVerdict } = await mod("core/probes.mjs");
  // P7-Fixtures: jede alte Angriffsklasse landet im neuen Pfad auf PLAN.
  const attacks = [
    { ...BEST_RESULT, status: "UNKLAR" },
    { ...BEST_RESULT, status: "WIDERSPRUCH", evidence: "echte Gegenstelle" },
    { ...BEST_RESULT, evidenceOk: false }, // „BESTAETIGT" ohne eigenes Lesen/Referenz
    { probe_id: "?", status: "UNBEKANNT" },
  ];
  for (const r of attacks) {
    const out = computeVerdict({ validation: VALID_VALIDATION, results: [r] });
    assert.equal(out.verdict, "PLAN", JSON.stringify(r));
    assert.ok(out.reasons.length >= 1);
  }
});

test("computeVerdict: harte Gates – structural, Divergenz, Dateiänderung → PLAN", async () => {
  const { computeVerdict } = await mod("core/probes.mjs");
  assert.equal(computeVerdict({ validation: VALID_VALIDATION, results: [BEST_RESULT], structuralBlocks: ["Diff berührt core/nope.mjs (außerhalb der Whitelist)"] }).verdict, "PLAN");
  assert.equal(computeVerdict({ validation: VALID_VALIDATION, results: [BEST_RESULT], divergence: "USER AGENT zielt auf andere Datei als der Header." }).verdict, "PLAN");
  assert.equal(computeVerdict({ validation: VALID_VALIDATION, results: [BEST_RESULT], filesUnchanged: false }).verdict, "PLAN");
  // Kombiniert: alle Gates grün trotz WRITE-Verdict des Thinkers.
  const all = computeVerdict({
    validation: VALID_VALIDATION,
    results: [BEST_RESULT],
    structuralBlocks: [],
    divergence: null,
    filesUnchanged: true,
  });
  assert.equal(all.verdict, "WRITE");
});
