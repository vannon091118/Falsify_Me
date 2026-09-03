# Plan: Produktionsreifer Runtime-Loop (feature-runtime-loop-production-1)

Status: **Implementiert (Phasen 1–5), verifiziert 221/221** · Stand 2026-09-03
Basis: Merge `6f2446a` (Brench-UI), Baseline-Suite 198/198 → nach Loop-Paket 221/221 via `npm test`.

Diese Datei ist die konsolidierte Ausführungsspezifikation und der
Abschluss-Record des Loop-Pakets im Repo-Root. Sie basiert NUR auf
verifiziertem Laufzeitverhalten und getestetem Code. Jede „implementiert“-
Aussage hier hat einen namentlichen Test.

## Loop-Kette (eine Wahrheit, alle Pfeile ausführbar)

```text
USER AGENT (extern, einziger Writer)
   │ submit / Direkt-Run
   ▼
THINKER (core/agent.mjs runAgent)                    [EXISTS]
   │ Probe-Set (core/probes.mjs)
   ▼
EVIL TWIN (core/twin.mjs runProbeExecution)          [EXISTS]
   │ ProbeResult[] + Evidence
   ▼
VERDICT/LOOP GATE (core/probes.mjs computeVerdict)   [EXISTS, EINZIGE WRITE-Quelle]
   ├─ WRITE → buildHandoff (core/handoff.mjs) → jobs.loop_state=WRITE_AUTHORIZED
   │           → falsify handoff brief (Coder-Arbeitsanweisung, Ableitung)
   │           → externer Coder ändert Repo (AUSSERHALB FalsifyMe)
   │           → falsify handoff complete (cli/handoff.mjs)
   │           → validateChangeReport (core/changes.mjs)
   │           → completeHandoff (artifacts/handoff.mjs): CHANGE_CAPTURED →
   │             RE_REVIEW_QUEUED → createJob (Child, volle Korrelation)
   │           → claimNextJob / --job-id → RE_REVIEW_RUNNING (claimJob,
   │             EINZIGER Claim-Owner; advanceLoop claim, atomar mit status=
   │             RUNNING) → THINKER (zweiter Lauf) … LOOP
   │           → finaler NICHT-WRITE-Verdict → jobDone vollzieht DONE
   │             atomar (advanceLoop finalize IN jobDone, gleiche Transaktion)
   ├─ BLOCK  → PLAN/ASK/ERROR; NO_CHANGE/Loop-Limit/ABORTED → LOOP_BLOCKED/
   │           ABORTED (terminal, unumkehrlich)
   └─ RESEARCH → research_additions persistiert → nächster Submit merged
              die Nachforderung in die Whitelist → Thinker mit neuer Evidenz
```

## Verifizierte Implementierung (Phase → Beleg)

| Phase | Umsetzung | Beleg-Test |
|---|---|---|
| 0: Audit | Merge `6f2446a` fast-forward, Baseline 198/198, kein Konflikt mit lokalen Änderungen | `git log -1`, `npm test` |
| 1: Identität + Snapshot | Skill-Wrapper propagieren `rootDir` (bestand); `runtime_config`-Snapshot (bestand); `header_digest` + Basis-`change_digest` bei Submit UND Direkt-Run, Executionsseite verifiziert HEADER ohne Modell-Call | `tests/loop.test.mjs`, e2e |
| 2: Handoff | `core/handoff.mjs` (v1, strikt, SEC-001-Secret-Scan), Erzeugung nur nach Gate, `falsify handoff complete` + `falsify handoff brief` | `tests/loop.test.mjs`, `tests/full-loop-e2e.test.mjs` |
| 3: Change/Loop | `core/changes.mjs` (Content-Digests, kein mtime), Schema v9 (ALTER-only, DDL in db.mjs), `artifacts/loops.mjs` (reine Zustandsmaschine: 12 Zustände, Transaktions-Guard, append-only `loop_events`), `artifacts/loopflow.mjs` (`advanceLoop`-Übergangs-Dienst), `artifacts/handoff.mjs` (transaktionale Completion), Korrelation | `tests/loop.test.mjs`, `tests/full-loop-e2e.test.mjs` |
| 4: Idempotenz/Gates | `(handoff_id, change_digest, scope_id)` IN der Transaktion (Race-Fix), Loop-Limit → `LOOP_BLOCKED`, `core/protocols.mjs` (A1–A10/F1–F10-Validatoren, implementiert — **nicht geschaltet**) | `tests/loop.test.mjs`, `tests/full-loop-negative.test.mjs` |
| 5: E2E | Happy Path (Gate → Handoff → Coder-Brief → externer Write → automatisches Child → Idempotenz) + Negative Matrix | `tests/full-loop-e2e.test.mjs`, `tests/full-loop-negative.test.mjs` |
| 6: UI-Konsum | UI-123 (loop-Event, Spiegel-only) erledigt; UI-124 (E2E-Event-Beweis) offen | `ui/tui/events.test.mjs` |

## Ehrliche Grenzen (keine unerwiesenen Claims)

1. **Coder-Brief**: `renderCoderBrief` ist die Ableitung aus dem persistierten
   Handoff (pure, fail-closed bei ungültigem Handoff). Der externe Coder
   konsumiert CLI + Brief; FalsifyMe schreibt nie selbst (REQ-004).
2. **10X-Protokolle**: `core/protocols.mjs` validiert strukturierte
   A1–A10/F1–F10-Records getestet, ist aber **bewusst nicht** in den
   Release-Pfad geschaltet (TASK-017-Rest): die System-Prompts erzeugen noch
   keine strukturierten Records; naive Schaltung würde jeden WRITE unmöglich
   machen. Konvergenzschutz (identische Diffs/Verdicts) folgt mit der
   Schaltung — nicht als separater Pfad davor.
3. **RESEARCH-Re-entry** ist halbautomatisch (Whitelist-Merge beim nächsten
   Submit), nicht vollautomatisch wie der WRITE-Pfad.
4. **UI-124** (FM-EVT-loop-Nachweis im E2E) offen; UI-123 ist Anzeige-only
   erledigt.
5. **Doku**: Diese Datei + WIRING/HANDOFF/README/AGENTS.md wurden mit dem
   Implementierungsstand synchronisiert (TASK-023).

## SINGLE-TRUTH-Anker (geprüft)

- Queue/Verdict/Loop: SQLite EINE Quelle; `artifacts/loops.mjs` ist die
  reine Zustandsmaschine, `artifacts/loopflow.mjs` der Übergangs-Dienst,
  `artifacts/handoff.mjs` die Completion-Orchestrierung (statisch erzwungen:
  `tests/invariants.test.mjs` ALLOWED_CALLERS — `artifacts/handoff.mjs` ist
  der registrierte Orchestrierer); Child-Jobs nur via
  `artifacts/jobs.mjs:createJob`. Kein jobs↔loops-Importzyklus.
- Handoff-JSON ist Beschreibung, nie Autorität; nur nach `computeVerdict`
  erzeugt; Korrelation gegen `jobs.handoff_id`.
- Kein neuer Truth-Store durch das Loop-Paket (Beweis: RED-Fact-Finding §15,
  `REWIRE POSSIBLE`).

## Completion-Regel

`100% COMPLETE / PRODUCTION READY` bleibt **nicht** gesetzt: offen sind
UI-119/UI-124 (Brench-Event-Vertrag + E2E-Sichtbarkeit), die Schaltung der
10X-Protokoll-Gates (TASK-015/017-Rest, Prompt-Vorbedingung) und die
vollständige Doctor/Uninstall-Härtung (HANDOFF.md). Der Runtime-Kern der
Loop-Kette ist implementiert, getestet (221/221) und damit produktionsnah —
die Komplett-Behauptung wäre ohne Phase-6-Abschluss unerwiesen.
