# P0-Cutover: Probe-basierte WRITE-Entscheidung (FINAL, Revision 5 + harte Regeln)

> Stand: 2026-09-02 — Status **GO**. Keine weitere Planungsrunde.
> Quelle: Nutzer-Notiz (E2E-User-Test-Session). Hier konsolidiert als
> verbindlicher Plan; Implementierung beginnt mit Commit 1 (unten begrenzt).

## Architektur & Cutover-Logik (Kern)

- **Problem:** `hasChallengeEvidence` (core/evidence.mjs:90) sucht Evidence in
  Fließtext → Form-Slop passiert das Gate. P0 ersetzt die Prosa-Regex durch
  **strukturierte Proben** mit `requirement_ref` aus Original-H_i-IDs:
  deterministischer Validator → Twin führt jede Probe aus (`ProbeResult[]`)
  → Gate = `for each probe: BESTAETIGT ∧ Evidence-Ok` (+ bestehende harte
  Gates) → bestehender Review-Commit.
- **Schichten (unverhandelbar):** Validator prüft nur formal/strukturell
  (Schema, IDs, Coverage, Target in Root+Whitelist, Anti-Vakuum-Minima,
  keine Doppel-IDs, Enum). **Twin entscheidet semantische Ausführbarkeit**
  → `ProbeResult (BESTAETIGT|WIDERSPRUCH|UNKLAR)`. **Gate** entscheidet nur
  aus Resultaten + Evidence + bestehenden harten Gates → WRITE/PLAN/ERROR.
  Vager Header / nicht ausführbare Assertion: formal ok → Twin UNKLAR →
  Gate PLAN. Der Validator beweist keine linguistische Qualität.
- **Anti-Vakuum:** claim/check-Minima + Lob-Blacklist sind **Müllfilter,
  kein Qualitätsbeweis** — lange Nonsense-Proben bleiben formal möglich;
  Twin + Evidence-Gate fangen inhaltlich ab.
- **Zusatz (kein eigener Task):** Twin nutzt die bestehende Twin-Config
  (CFG.twinModel / reasoningEffort-Weitergabe wie heute). Eine getrennte
  Primary/Twin-`reasoningEffort`-Refaktorierung ist **nicht P0** und
  blockiert den Cutover nicht.
- **core/verdict.mjs bekommt keine Probe-Logik** (keine Müllhalde der
  Semantik).

## Header-Anker & Granularität (verifiziert)

- HEADER = Nutzer-Input 1:1 (artifacts/scopes.mjs:20-21; cli/scope.mjs
  scope new; core/prompt.mjs bindet ihn als `# Anforderung (User-Input 1:1 –
  HEADER)`). `requirementSource = scope ? scope.header : planText`.
- Split **deterministisch** auf Satzenden + Aufzählungs-/Zeilen-Grenzen,
  IDs `H1..Hn` mit Original-Spans, Tail-Merge-Kappe 12.
- Vager Ein-Satz-Header → H1; Coverage mit ≥1 Probe erfüllbar.
- **Keine** LLM-Header-Zerlegung, keine H1a/H1b-Verfeinerung, keine
  Header-Mindestqualität, keine Klassen-Pflicht — alles nicht Teil dieses
  Plans. Schwacher Header = Scope-/Betriebs-Thema (bessere HEADER → bessere
  Proben); starkes Gate = Runtime-Problem, das P0 löst.

## Sequenz (6 Schritte, Cutover = EIN Schnitt-Paar)

| # | Schritt | Dateien | DONE-Kriterium |
|---|---|---|---|
| 1 | **Probe-Vertrag + Splitter** (rein additiv) | `core/probes.mjs` (neu: Schema-Konstanten, PROBE_CLASSES-Enum, `splitRequirement(source)` — Satz-/Listen-/Zeilen-Grenzen, Original-Spans, Kappe 12, Fallback H1); `tests/probes.test.mjs` (Splitter byte-identisch, IDs=Spans, Satz/Liste/Semikolon/vager Ein-Satz/Kappe); `core/selfreview.mjs` (+probes.mjs); WIRING.md (Modultabelle) | reine Funktionen; kein bestehender Import; Tests grün |
| 2 | **Probe-Validierung inkl. Coverage** (rein additiv) | `core/probes.mjs`: `validateProbeSet(probes, {requirementSource, root, whitelist})` → `{ok, reasons[]}`; Tests | formal/strukturell nur: Schema gültig · `requirement_ref ∈ {H1..Hn}` (keine Paraphrase) · Coverage: jede H_i ≥1×, sonst PLAN · target existiert & in Whitelist unter Root · syntaktisch eindeutig · Anti-Vakuum-Minima (claim ≥16, check ≥24, Lob-/Zustimmungs-Vokabular → invalid) · keine Doppel-IDs · keine unbekannten class-Werte |
| 3 | **Thinker erzeugt Probe-Set** | `system-de/en.md` (Probe-Set-Block; H_i-IDs aus Original-Liste; target real; check konkret; `VERDICT: WRITE` verboten; ASK bei zu vagen Headern erlaubt); `core/prompt.mjs` buildUserContent (HEADER + H_i-Liste als Objekt; Plan als Objekt); `cli/run.mjs` (nur JSON-Block-Extraktion, KEINE Verdict-Änderung vor Schritt 5); `tests/prompt.test.mjs` | Extraktion gültig/kaputt/fehlend getestet; Verhalten bis Cutover unverändert |
| 4 | **Twin führt Proben aus** | `core/twin.mjs` `runProbeExecution` (nutzt runAgent/makeTools, Config wie heute); eviltwin-Prompts als Daten ersetzt; `core/twin-evidence.mjs` unverändert; `tests/twin.test.mjs` (Probe-Fixtures; bestehende Evidence-/Anker-Fälle bleiben Schutznetz) | Output `{probe_id, status, evidence}` je Probe; Parse-Fehler/Timeout → alle UNKLAR; fehlende probe_id → diese Probe UNKLAR; globale Zusatzaussagen ohne Autorität |
| 5 | **Deterministic Gate + alter WRITE-Pfad weg** | `core/probes.mjs` `computeVerdict(...)`; `cli/run.mjs` (Schnitt 1 an enforceWriteChallenge ~513: Prosa-Evidenz → validateProbeSet; Schnitt 2 an runTwinCheck ~569–625: Freitext-extractClaims → runProbeExecution); `core/twin.mjs`; `tests/queue.test.mjs`/`twin.test.mjs`/`exit-code-authority.test.mjs` | Gate-Kette: Probe Set gültig (Coverage H1..Hn, Müllfilter)? → nein: PLAN · Twin ausgeführt (vollständiges ProbeResult[])? → nein: PLAN/ERROR · Jede Pflicht-Probe BESTAETIGT? → nein: PLAN · Jede Bestätigung mit gültiger Evidence? → nein: PLAN · harte Gates grün (structural, Divergenz-Anker, Dateien unverändert)? → nein: PLAN → **WRITE (Exit 0)** in den bestehenden Review-Commit. `parseVerdict`-WRITE wird ignoriert (Release nur über Probe-Set); twinEvidenceOk/twinOwnFalsificationOk/anchoredFileLine bleiben, pro Probe angewendet. P7 vor Entfernen: jede alte Angriffsklasse (Fantasie-Datei:Zeile, Fantasie-Symbol, „keine Fehler gefunden"+Pfad, echte-aber-irrelevante Zeile) → im neuen Pfad nachweislich PLAN (Fixtures im selben Commit) |
| 6 | **Verifikation & STOPP** | `tests/queue.test.mjs`/`probes.test.mjs`: 3 Fixture-E2E im bestehenden isolierten Muster (mkdtemp-Home, Fixture-Runner, kein Live-Key) | E2E-WRITE (alle Proben BESTAETIGT, echte verankerte Zitate + Tool-Evidence → Exit 0, hardened, open_conflicts=0, Wellen/Invariante 4 korrekt) · E2E-PLAN (WIDERSPRUCH/fehlende Coverage → Exit 1, Phase/GAP korrekt) · E2E-vager-Header (formal gültige H1-Probe, vom Twin nicht ausführbar → UNKLAR → PLAN) · komplette bestehende Kernsuite + UI-Suite grün |

## Harte Regeln & Grenzen (unverhandelbar)

- **COMMIT-1-GRENZE:** Berührt Commit 1 `cli/run.mjs`, `artifacts/*`,
  `core/verdict.mjs`, `core/twin.mjs`, Queue/DB, Evidence-Löschungen →
  **BLOCKED, kein Improvisieren.**
- **STOPP-GRENZE:** Beendet, sobald Schritt 6 grün. **Nicht** starten als
  Folge-Tasks: A/B gegen alten Pfad · Coverage-Klassen-Pflicht ·
  Probe-Exekution je Iteration · Lokalisierungs-Assists ·
  PROBE-SET-Globalstatus · Umbau von PLAN/RESEARCH/ASK ·
  Header-Mindestqualitäts-Gate · getrennte reasoningEffort-Refaktorierung ·
  neue DB-Spalten · Snapshot-Persistenz · neue Test-Batterien. Wer so etwas
  will, formuliert einen NEUEN verdichteten Plan.
- **BLOCKED-Stop:** Muss eine bestehende Invariante, Queue-/Scope-Semantik,
  Recovery-Logik, Immutable-Final-State-Regel oder
  Whitelist-Sicherheitsregel verändert werden → kein Improvisieren:
  `BLOCKED: <Invariante> <Warum das Probe-System sie berührt> <kleinste
  notwendige Änderung> <betroffene Tests>`.
- **Invarianten:** keine Queue-/Scope-/Recovery-Invariante at risk;
  Schutznetz = checkQueueConsistency, Invariante 4, jobDone-Immutability
  laufen unverändert mit. Self-Review-Pflege in Schritt 1.
- **Betroffene Dateien (gesamt):** Neu: `core/probes.mjs`,
  `tests/probes.test.mjs`. Geändert: `core/twin.mjs`, `cli/run.mjs`
  (Extraktion Schritt 3; Schnitt 1+2 Schritt 5), `core/prompt.mjs`,
  `core/prompt-text/system-de.md`/`system-en.md` + eviltwin-Prompts.