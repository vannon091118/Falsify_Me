---
goal: FalsifyMe Produktionsreife – externer USER-AGENT-Write und automatischer Re-Review-Loop
version: 1.0
date_created: 2026-09-03
last_updated: 2026-09-03
owner: FalsifyMe maintainers
status: 'In progress'
tags: [production, runtime, loop, security, e2e, architecture]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

Dies ist der kanonische Ausführungsplan für die noch fehlende Produktionshärtung. Die vorhandene Review-Pipeline führt bereits USER AGENT → THINKER → EVIL TWIN → technische Gates → SQLite-Persistenz aus. Dieser Plan ergänzt ausschließlich die nachgewiesenen Lücken: unveränderlichen Job-Snapshot, versionierten Handoff, externe Writer-Rückmeldung, Change Detection, Korrelation, persistente Loop-Zustände, automatische Re-Reviews, Idempotenz, Konvergenzschutz, runtime-validierte 10X-Protokolle, Recovery und E2E-Beweise.

Der externe USER AGENT bleibt der einzige Repository-Writer. FalsifyMe validiert, persistiert und re-queued, schreibt aber keine Implementierung. Es gibt keinen Coder, kein drittes Modell, keine zweite Queue und keine zweite Verdict-Hoheit. Die Brench-UI wird erst nach stabilisiertem Runtime-Vertrag als reine Anzeige integriert.

## 1. Requirements & Constraints

- **REQ-001**: Jeder model-startende Einstieg (`submit`, direct run, `--job-id`, worker, retry/resume und Skill-Wrapper) muss Projektidentität, Root-, Checkout-, Scope- und Header-Bindung vor dem Modellaufruf validieren.
- **REQ-002**: Jobs verwenden ausschließlich den bei Submit gespeicherten nicht-geheimen Runtime-Snapshot; spätere Settings/Umgebungsänderungen dürfen den Lauf nicht verändern.
- **REQ-003**: Der externe Handoff ist versioniert und maschinenlesbar; Freitext-Parsing ist nicht erforderlich.
- **REQ-004**: FalsifyMe konsumiert und validiert externe Write-Reports, führt den Repository-Write aber niemals selbst aus.
- **REQ-005**: SQLite bleibt die einzige ausführbare Queue und der bestehende technische Verdict-Pfad die einzige Release-Hoheit.
- **REQ-006**: Ein Re-Review entsteht nur nach validiertem Handoff, validiertem Write-Report, korrekter Identität/Header-Bindung und nachgewiesener Änderung.
- **REQ-007**: `WRITE` wird nur bei bestandenem technischem Gate, gültigem `FALSIFICATION_RECORD_10X` und gültigem `CHANGE_GATE_10X` freigegeben.
- **REQ-008**: Fehlende, ungültige, widersprüchliche, veraltete, fremde oder doppelte Daten failen closed.
- **SEC-001**: Snapshots, Handoffs, Reports und Logs dürfen keine Secrets oder internes THINKER-Reasoning enthalten.
- **SEC-002**: Pfade, Zeilen, Symbole, Proben und Digests werden gegen gebundenen Root und Whitelist geprüft.
- **SEC-003**: Writer-Identität ist Provenienz und überschreibt keine Sicherheitsprüfung.
- **SEC-004**: Retry, Crash, Restart, Abort, Replay und stale Worker dürfen keinen terminalen WRITE/ERROR/ABORTED/LOOP_BLOCKED-Zustand öffnen oder überschreiben.
- **CON-001**: Kein Coder-Modell, kein zusätzlicher Modellpfad, keine zweite Queue, kein FalsifyMe-Repository-Writer.
- **CON-002**: Bestehende Identity-, Queue-, Scope-, Probe-, Twin-, Recovery- und Immutable-State-Invarianten bleiben maßgeblich.
- **CON-003**: Schemaänderungen erfolgen ALTER-only; Legacy-Daten werden nicht still in neue Modellläufe promoted.
- **CON-004**: Die gemergte Brench-UI konsumiert Runtime-State und erzeugt keine Queue-, Verdict-, Transition- oder Persistenzwahrheit.
- **GUD-001**: Bestehende Module, Node-Standardbibliothek, SQLite-Transaktionen und isolierte Test-Homes zuerst verwenden.
- **GUD-002**: Neue Runtime-Autoritätsmodule in Self-Review, WIRING und Tests aufnehmen.
- **PAT-001**: `BEGIN IMMEDIATE`, `createJob`, `claimNextJob`, `jobDone`, `checkQueueConsistency` und Fail-Closed-Gates weiterverwenden.
- **PAT-002**: THINKER-Reasoning bleibt vom EVIL-TWIN-Kontext getrennt.

## 2. Implementation Steps

### Implementation Phase 0 — Root-Audit und Merge-Checkpoint

- **GOAL-001**: Einen verifizierten Post-Merge-Baseline-Zustand herstellen.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-001 | Vor jedem Runtime-Block vom Projektroot `git status --short --branch`, `git diff --check`, `git diff --stat` und den Testbefehl aus `package.json` ausführen; jede bestehende Änderung zuordnen; nichts Fremdes resetten/überschreiben/stagen/commiten; den Brench-Merge später als separaten UI-Checkpoint erneut auditieren und Testanzahl/Fehler in `progress.md` festhalten. | | |
| TASK-002 | `FalsifyME.md`, `AGENTS.md`, `HANDOFF.md`, `README.md`, `WIRING.md`, `ui/PLAN.md`, Skill-Wrapper und Bootstrap-Templates auditieren; diesen Plan als einzige Runtime-Spezifikation referenzieren. | | |

### Implementation Phase 1 — Identity, Header und Snapshot

- **GOAL-002**: Projekt- und Konfigurationsdrift vor jedem Modelllauf verhindern.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-003 | Root in allen Skill-Scope-Erstellungen mit `scope new ... --root <rootDir>` weitergeben und Identity-Gate in Scope, Submit, Direct-Run, Job-ID, Worker, Retry und Resume erzwingen. | | |
| TASK-004 | Bei Submit `snapshotConfig(effectiveConfig)` persistieren, bei Ausführung `jobRuntimeConfig()` laden und dasselbe immutable Config-Objekt an THINKER und TWIN geben; nur Key-Namen, nie Key-Werte speichern. | | |
| TASK-005 | `header_digest` aus dem exakten Scope-HEADER persistieren und vor THINKER, Handoff-Completion und Re-Review prüfen. | | |

### Implementation Phase 2 — Versionierter Handoff und externe Write-Schnittstelle

- **GOAL-003**: Eine sichere maschinenlesbare Übergabe an den externen USER AGENT herstellen.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-006 | `core/handoff.mjs` mit v1-Schema und strikter Validierung von Handoff-, Job-, Scope-, Checkout-, Iterations-, Verdict-, Probe-, Evidence-, Snapshot- und Allowlist-Feldern erstellen; Secrets/Reasoning ablehnen. | | |
| TASK-007 | Handoff nur nach technischem Gate erzeugen, kanonisch persistieren und über `cli/log.mjs`, `cli/answer.mjs` und Skills als JSON ausgeben; Modellprosa darf keinen Handoff autorisieren. | | |
| TASK-008 | `cli/handoff.mjs` und `falsify handoff complete --file <report.json>` hinzufügen. Der Report enthält Handoff-/Job-/Scope-/Checkout-ID, Writer-ID, Before-/After-Digest, changed_files, diff_digest und write_status; FalsifyMe schreibt keine Implementierung. | | |

### Implementation Phase 3 — Change Detection, Korrelation und Loop-State

- **GOAL-004**: Externe Änderungen atomar, nachvollziehbar und restart-fähig in den Review-Loop überführen.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-009 | `core/changes.mjs` als read-only Detector für Git HEAD, Working Tree, erlaubte Pfade, Content-Digests und canonical change_digest erstellen; mtime allein ist unzulässig. | | |
| TASK-010 | ALTER-only Korrelation/Loop-Felder für parent_job_id, handoff_id, iteration_id, change_digest, header_digest, retry/iteration/loop counters und append-only Audit-History ergänzen; keine zweite Queue. | | |
| TASK-011 | `artifacts/loops.mjs` mit atomaren, validierten Übergängen für WRITE_AUTHORIZED, WAITING_FOR_AGENT, WRITE_IN_PROGRESS, CHANGE_CAPTURED, RE_REVIEW_QUEUED, RE_REVIEW_RUNNING, DONE, LOOP_BLOCKED, ABORTED und ERROR erstellen. | | |
| TASK-012 | Handoff-Completion transaktional validieren, Änderung persistieren, Loop-State ändern und genau einmal `createJob()` für das Re-Review ausführen; No-change/fremd/stale/invalid darf nicht re-queue’n. | | |
| TASK-013 | Parent-, Scope-, Checkout-, Handoff-, Change-, Header- und Finding-Korrelation in `checkQueueConsistency()` und Invariant-Tests erzwingen. | | |

### Implementation Phase 4 — Idempotenz, Konvergenz und ein finales Gate

- **GOAL-005**: Replay, Endlosschleifen und unbelegte 10X-Behauptungen sicher blockieren.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-014 | Idempotenz für `(handoff_id, change_digest, scope_id)` und stabile Event-IDs erzwingen; 100 identische Reports dürfen nur eine semantische Transition und ein Child-Job erzeugen. | | |
| TASK-015 | technical_retry_count, review_iteration und loop_count trennen; max_loop_count, gleiche Diff-Wiederholung, Verdict-ohne-Change, No-change und ABORTED/LOOP_BLOCKED terminal behandeln. | | |
| TASK-016 | `core/protocols.mjs` für strikt strukturierte `F1`–`F10` und `A1`–`A10` mit verifizierten Evidence-Referenzen, unbekannten Bereichen und begründetem Ergebnis bauen; fehlende/falsche/inkonsistente Nachweise failen closed. | | |
| TASK-017 | Technische Probe/Twin-Gates, F-Record und A-Record in einem einzigen bestehenden Verdict-Pfad verbinden: ALL PASS → WRITE, ANY FAIL → non-release; keine parallele Protocol-Verdict-Hoheit. | | |

### Implementation Phase 5 — Retry/Recovery und vollständiger Runtime-Beweis

- **GOAL-006**: Erfolg, Fehler, Replay, Abort und Restart durch E2E beweisen.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-018 | Retry/Recovery in Jobs, Run und Worker vervollständigen: Snapshot bei Retry verwenden, Fehler klassifizieren, Backoff begrenzen, stale Worker recovern, terminale Rows immutable halten und doppeltes WRITE verhindern. | | |
| TASK-019 | `tests/full-loop-e2e.test.mjs`: isoliertes Projekt/Home und deterministischer Provider; Scope → Submit → THINKER → TWIN → Gate → Handoff → echter Fake-USER-AGENT-File-Write → Report → automatische Child-Queue → zweiter THINKER/TWIN → persistierte Historie, ohne manuelles Re-Submit. | | |
| TASK-020 | `tests/full-loop-negative.test.mjs`: Twin-Widerspruch/Timeout, fehlendes F6/A7, Evidence-Fehler, No-change, identischer Diff, duplicate Handoff, Worker-Crash, Abort, falsches Projekt, Anchor/Header-Tampering, Config-Drift und unauthorized file. | | |

### Implementation Phase 6 — Brench UI und finaler Audit

- **GOAL-007**: Die gemergte UI als read-only Consumer anschließen und die Freigabe beweisen.

| Task | Description | Completed | Date |
|---|---|---|---|
| TASK-021 | Nach stabilen Runtime-States Brench Dashboard/Dock an Loop-Events und Zustände anbinden; UI darf keine Jobs/Verdicts/Transitions erzeugen. | | |
| TASK-022 | Echte Dock-E2E für `job whitelist → event → slot state → refresh → rendered snapshot/header`; sichtbare Dateianzahl und Loop-Labels prüfen, nicht nur interne State-Objekte. | | |
| TASK-023 | Erst nach Tests `HANDOFF.md`, `README.md`, `AGENTS.md`, `WIRING.md`, Skills/Templates und `ui/PLAN.md` auf belegtes Verhalten synchronisieren; keine parallele Runtime-Spezifikation erzeugen. | | |
| TASK-024 | Final vom Root alle Tests, neue Suites, Syntax-/JSON-/Shell-Prüfungen, `git diff --check`, Identity-/Clean-root-Checks und finalen 10X-Record ausführen. `100% COMPLETE / PRODUCTION READY` erst bei vollständigem Pass. | | |

## 3. Alternatives

- **ALT-001**: Drittes Coder-Modell — abgelehnt; der externe USER AGENT schreibt.
- **ALT-002**: FalsifyMe führt Patches aus — abgelehnt; verletzt Read-only-Writer-Grenze.
- **ALT-003**: `DONE WRITE`/Exit-Code/Prosa als Handoff — abgelehnt; keine sichere Korrelation.
- **ALT-004**: Zweite Queue — abgelehnt; SQLite bleibt einzige Queue.
- **ALT-005**: Nur mtime — abgelehnt; keine Content-/Pfad-/Autorisierungsbeweise.
- **ALT-006**: UI als Truth-Owner — abgelehnt; erzeugt zweite Wahrheit.

## 4. Dependencies

- **DEP-001**: Die Runtime-Implementierung erfolgt auf dem aktuellen `main`. Der Brench-UI-Merge erfolgt parallel bzw. vor TASK-021; gemeinsame Dateien werden beim Merge auditiert und nicht überschrieben.
- **DEP-002**: Node.js >=22.5.0, node:sqlite, Ink, React und bestehender Test-Runner bleiben verfügbar.
- **DEP-003**: Bestehende Identity-, Queue-, Probe-, Twin-, Worker-, Recovery- und Invariant-Owner bleiben maßgeblich.
- **DEP-004**: Der externe USER AGENT kann nach seinem Write den Handoff-Completion-Report einreichen.
- **DEP-005**: Temporäre Homes und deterministische Provider-Fixtures sind verfügbar.
- **DEP-006**: Legacy-Fixtures bleiben lesbar, werden aber nicht still zu neuen Modellläufen promoted.

## 5. Files

- **FILE-001**: `plan/produktionsreife-runtime-loop-v1.md` — kanonischer Plan.
- **FILE-002**: Skill-Wrapper — Root-Propagation und Handoff-Verbrauch.
- **FILE-003**: `cli/scope.mjs`, `cli/run.mjs`, `cli/main.mjs`, `cli/log.mjs`, `cli/answer.mjs`, `cli/help.mjs` — Runtime- und CLI-Grenzen.
- **FILE-004**: `ui/worker.mjs`, `artifacts/jobs.mjs`, `artifacts/db.mjs` — Snapshot, Queue, Recovery und Korrelation.
- **FILE-005**: `core/config.mjs`, `core/handoff.mjs`, `core/changes.mjs`, `core/protocols.mjs` — Verträge.
- **FILE-006**: `artifacts/loops.mjs`, `artifacts/invariants.mjs` — State und Konsistenz.
- **FILE-007**: `core/probes.mjs`, `core/twin.mjs`, `core/verdict.mjs`, `core/selfreview.mjs` — Gates.
- **FILE-008**: Neue und bestehende Identity/Snapshot/Handoff/Change/Loop/Protocol/Recovery/E2E-Tests.
- **FILE-009**: Gemergte Brench-UI/Dock-Dateien und UI-Tests.
- **FILE-010**: Synchronisierte Doku- und Skill-Dateien.

## 6. Testing

- **TEST-001**: Root-Baseline, Testanzahl, Syntax und diff-check.
- **TEST-002**: Identity-Matrix inklusive Skill-Root und unbound legacy block.
- **TEST-003**: Snapshot-Isolation über Submit, Worker, Direct, Job-ID und Retry.
- **TEST-004**: Header-Digest-Manipulation ohne Modellaufruf/Release.
- **TEST-005**: Handoff v1: valid, missing fields, invalid probe/evidence, secret/reasoning leakage, correlation mismatch.
- **TEST-006**: Write-Report: valid, stale, foreign, unauthorized, no-change und invalid metadata.
- **TEST-007**: Change Detector: real change, no-change, Git noise, foreign/unverifiable.
- **TEST-008**: Loop-State/Korrelation: legal/illegal, atomic, restart, complete trace.
- **TEST-009**: 100-fach Idempotenz, Konvergenz, max-loop und Abort.
- **TEST-010**: F1–F10/A1–A10 vollständig, fehlend, fake, widersprüchlich, unbelegt.
- **TEST-011**: Unified Gate: technische/protocol Kombinationen und kein Prosa-Override.
- **TEST-012**: Retry/Recovery, terminal immutability, kein doppeltes WRITE.
- **TEST-013**: Full-loop Happy Path mit echtem File-Write und automatisch zweitem Review.
- **TEST-014**: Vollständige negative E2E-Matrix.
- **TEST-015**: Brench-Dock-E2E mit sichtbarer Whitelist und Loop-State.
- **TEST-016**: Final regression, static checks, JSON/shell checks, clean root und Doku-Konsistenz.

## 7. Risks & Assumptions

- **RISK-001**: Brench überschneidet Worker/Event-Dateien; bei unklarer Ownership stoppen.
- **RISK-002**: Handoff kann Secrets/Reasoning leaken; strikt allowlisten und testen.
- **RISK-003**: Loop-Metadaten könnten als zweite Queue missbraucht werden; nur `createJob()` erzeugt Jobs.
- **RISK-004**: Externer Report kann fremde Pfade behaupten; Root/Whitelist/Digests prüfen.
- **RISK-005**: Protocol-Validator darf keine zweite Verdict-Hoheit werden.
- **RISK-006**: Replay/Restart kann doppelte Jobs erzeugen; unique keys und Transaktionen.
- **RISK-007**: Secrets sind nicht snapshot-fähig; nur Referenzen persistieren.
- **RISK-008**: USER AGENT kann Report nicht liefern; in WAITING_FOR_AGENT bleiben und nicht re-reviewen.
- **ASSUMPTION-001**: USER AGENT kann Completion-Report nach dem Write ausführen.
- **ASSUMPTION-002**: Git oder ein deterministischer Content-Digest-Fallback ist verfügbar.
- **ASSUMPTION-003**: Unbound-Legacy-Fixtures sind keine gültigen neuen Sessions.
- **ASSUMPTION-004**: HEADER ist nach Submit unveränderlich.
- **ASSUMPTION-005**: Production Readiness wird nur durch ausführbaren Code und Tests belegt.

## 8. Related Specifications / Further Reading

- `HANDOFF.md` — aktueller Runtime-Audit, Statusreferenz.
- `AGENTS.md` — Agent-, Identity-, Queue-, Probe/Twin- und Protocol-Regeln.
- `WIRING.md` — Ownership und Datenfluss; verweist auf diesen Plan.
- `README.md` und Skills — externer USER-AGENT-Vertrag.
- `ui/PLAN.md` — UI-spezifische Präsentation.

## 100-%-Freigabekriterien

Der Status darf erst auf `Completed` und `100% COMPLETE / PRODUCTION READY` wechseln, wenn nachweisbar ist:

1. Jeder Model-Entry ist Identity-, Root-, Checkout-, Scope- und Header-gebunden.
2. Submit-to-worker nutzt den unveränderlichen Job-Snapshot.
3. Ein v1-Handoff ohne Secrets/Reasoning wird erzeugt und konsumiert.
4. Externer Write-Report wird validiert, ohne dass FalsifyMe die Implementierung schreibt.
5. Real/no-change/foreign/unauthorized/stale/unverifiable Changes werden unterschieden.
6. Parent/Iteration/Handoff/Change/Scope/Checkout/Header sind persistiert und invariant-geprüft.
7. Loop-Transitions sind atomar, restartable, idempotent, bounded und terminal-safe.
8. Technische Gates plus F1–F10 plus A1–A10 ergeben eine einzige Release-Entscheidung.
9. Retry/Recovery/Abort duplizieren oder öffnen kein terminales WRITE.
10. Full-loop-E2E ändert eine echte Datei und startet automatisch das zweite Review.
11. Negative E2E-Matrix besteht.
12. Gemergte Brench-UI zeigt echten Runtime-State ohne eigene Truth.
13. Full regression, targeted tests, static checks, Doku-Konsistenz und clean-root bestehen.

Bis dahin bleibt der gültige Status:

```text
BLOCKED – die Review-Pipeline ist vorhanden, aber der vollständige externe Write- und automatische Re-Review-Loop ist nicht bewiesen.
```
