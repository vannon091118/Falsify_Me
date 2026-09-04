# FalsifyMe Handoff — Audit 2026-09-03 (ersetzt 2026-09-02)

## Status

Dieser Worktree enthält den verifizierten P0-Probe-Cutover **plus den
kompletten Produktions-Runtime-Loop** (Phasen 1–5 von
`plan/feature-runtime-loop-production-1.md`): die Kette
`THINKER → EVIL TWIN → GATE → WRITE_AUTHORIZED → externer Coder →
CHANGE_CAPTURED → RE_REVIEW_QUEUED → THINKER` ist ausführbar und e2e-getestet.
Der Konsolidierungs-Record lebt in jener Plan-Datei; die Modul-Zuständigkeiten
in `WIRING.md` §18.

**Noch nicht abgeschlossen (ehrliche Lücken):** UI-119/UI-124 (Brench-Event-
Vertrag + Loop-State-E2E-Sichtbarkeit), die Runtime-Erzwingung der
strukturierten 10X-Protokoll-Gates (`core/protocols.mjs` ist implementiert
und getestet, aber bewusst nicht in den Release-Pfad verdrahtet — die
System-Prompts erzeugen noch keine strukturierten Records), die vollständige
Doctor-/Uninstall-Härtung (Punkte 4–7 unten) und das finale Release-Audit
(TASK-023-Rest).

Das Repository ist absichtlich uncommittet gelassen. Alle aktuellen getrackten
Änderungen und aktuellen Produktdateien sollen für den nächsten Agenten oder
Menschen verfügbar bleiben; während dieses Audits wurden keine Dateien
gelöscht oder zurückgesetzt.

## Loop-Verifikation (neu 2026-09-03)

- Loop-Schicht azyklisch getrennt (2026-09-03, `Job-Lebenszyklus →
  Übergangs-Dienst → Loop-Zustand`): `artifacts/loops.mjs` ist die reine
  Loop-Zustandsmaschine (12 Zustände, illegale Übergänge und terminale
  Überschreibungen fail-closed, SEC-004); `artifacts/loopflow.mjs` ist der
  einzige `advanceLoop(event)`-Übergangs-Dienst; `artifacts/handoff.mjs` ist
  der `completeHandoff`-Orchestrierer (Child-Jobs nur via
  `jobs.createJob`; der Writer-Scan in `tests/invariants.test.mjs`
  registriert `artifacts/handoff.mjs`). Es gibt keinen Importzyklus mehr
  zwischen jobs.mjs und loops.mjs.
- `jobDone` finalisiert Status UND Loop-Zustand in EINER Transaktion
  (SAVEPOINT; atomar auch innerhalb des Review-Commits): ein Crash kann nie
  `status=ERROR` mit `loop_state=RE_REVIEW_RUNNING` hinterlassen, und ein
  fehlgeschlagener Loop-Übergang lässt die gesamte Zustandsänderung
  scheitern (kein halber Zustand, kein stilles Catch).
- `completeHandoff` validiert die Report-/Handoff-/Change-Korrelation
  innerhalb EINER `BEGIN IMMEDIATE`-Transaktion, erzeugt genau ein Child-Job
  mit voller Korrelation (`parent_job_id`, `handoff_id`, `iteration_id`,
  `change_digest`, `header_digest`) und ist für doppelte Zustellungen
  idempotent (verifiziert mit 100 identischen Reports).
- `header_digest` + Basis-`change_digest` werden bei Submit und Direkt-Run
  eingefroren; ein abgedrifteter Header weist den Job vor jedem Modell-Call
  ab.
- Der externe Writer-Pfad (`falsify handoff brief` → Change →
  `falsify handoff complete`) ist end-to-end in
  `tests/full-loop-e2e.test.mjs` bewiesen; die Negativ-Matrix (NO_CHANGE,
  Loop-Limit, unautorisierte Pfade, gefälschte Korrelation, Secrets,
  Terminal-Immutabilität) in `tests/full-loop-negative.test.mjs`.
- Der Coder-Brief (`renderCoderBrief`) ist eine reine Ableitung des
  persistierten Handoffs und fail-closed bei jedem ungültigen Handoff — er
  trägt keine Autorität.

## Was verifiziert wurde (Audit 2026-09-02, weiterhin gültig)

## Was verifiziert wurde

- `core/probes.mjs` liefert deterministische Anforderungs-Zerlegung,
  Probe-Set-Parsing, strukturelle Validierung, Proben-Evidenzprüfungen und
  das einzige probe-basierte `computeVerdict`-Gate.
- `core/twin.mjs` liefert die isolierte `runProbeExecution`; fehlerhafte,
  unvollständige, fehlende oder fehlgeschlagene Probe-Ergebnisse bleiben
  fail-closed.
- `cli/run.mjs` ruft den Probe-Validator und Twin-Executor für
  WRITE-Kandidaten auf, prüft strukturelle und Divergenz-Gates und vergleicht
  mtime/Größe der Whitelist-Dateien vor und nach der Twin-Ausführung.
- Prompt-Daten werden aus `core/prompt-text/*.md` geladen; die Thinker- und
  Probe-Executor-Verträge liegen auf Deutsch und Englisch vor.
- Der verbindliche `CHANGE_GATE_10X`- und `FALSIFICATION_RECORD_10X`-Vertrag
  ist in AGENTS.md, README, WIRING, Skills und Bootstrap-Templates
  propagiert.
- `FALSIFY_HOME` nutzt den dokumentierten Default `~/.Falsify_Private`,
  getrennt von der Programminstallation in `~/.Falsify_Core`.
- Das bestehende Ollama-/OpenAI-kompatible Konfigurationsverhalten bleibt im
  Baum erhalten. Loopback-Erkennung existiert in `core/config.mjs`; dieses
  Audit behauptet nicht, dass jeder Worker-/API-Key-Pfad sie korrekt
  konsumiert.
- Die bereits im Worktree vorhandenen Banner-Datei- und
  Paket-/Lizenz-/Dokumentationsänderungen wurden erhalten. Das angefragte
  Split-Identity-Banner-Konzept ist nur Design-Richtung, sofern nicht separat
  in der SVG verifiziert.

## Verifikations-Evidenz

Erfolgreich vom Repository-Root aus ausgeführt:

```text
npm test
228 Tests bestanden, 0 fehlgeschlagen   (2026-09-03; +3: Terminal-Matrix SEC-004, jobDone-Crash-Boundary, Immutable-Guard; Baseline 198 vor dem Loop, 191 beim Audit am 09-02)

node --check cli/run.mjs
node --check artifacts/db.mjs
node --check artifacts/jobs.mjs
node --check artifacts/loops.mjs
node --check artifacts/loopflow.mjs
node --check artifacts/handoff.mjs
node --check core/config.mjs
node --check core/handoff.mjs
node --check core/changes.mjs
node --check core/protocols.mjs
node --check core/probes.mjs
node --check core/twin.mjs
node --check core/prompt.mjs
node --check cli/handoff.mjs

bash -n falsify.sh
bash -n cli/falsify.sh
bash -n selbsttest.sh

git diff --check
```

Die Suite umfasst Probe-Cutover-E2E-Fälle, fail-closed-Missing-Probe-Fälle,
Twin-Evidenztests, Queue-Invarianten, Bootstrap-Tests, Settings-/Key-Tests,
Security-Tests, Stream-Tests und die bestehende UI-/Test-Integrationsabdeckung.

## Umgesetzte Dokumentationsänderungen

- Das wiederverwendbare 10X-Abschluss- und unabhängige Prüfprotokoll wurde
  zum kanonischen Agent-Vertrag und zur ausführbaren Workflow-Dokumentation
  hinzugefügt.
- Der P0-Probe-Cutover-Vertrag und Testbefehl-Referenzen wurden zu README,
  WIRING, Prompts und `ui/PLAN.md` hinzugefügt.
- Die WIRING-Aussage zu offenen Arbeiten wurde korrigiert, sodass sie nicht
  mehr sagt, nur die API-Key-Onboarding-Aufgabe sei offen.
- Dieses Handoff wurde hinzugefügt, damit verifiziertes Verhalten und
  unvollständige Arbeit bei Kontextverlust oder paralleler Entwicklung nicht
  verwechselt werden.

## Ausstehende Implementierungs-Verträge

Die folgenden Punkte sind weiterhin offen. Ihre Präsenz in
Konfiguration/Schema darf nicht als Beweis gelesen werden, dass das Verhalten
vollständig ist.

1. **Unveränderliche Per-Job-Runtime-Snapshots und explizite Overrides**
   `core/config.mjs` hat `snapshotConfig()` und `configFromSnapshot()`;
   `artifacts/jobs.mjs` speichert `runtime_config`. `cli/run.mjs` löst die
   Ausführung in wichtigen Pfaden weiterhin aus dem prozessglobalen `CFG`
   auf, snapshotet nicht alle expliziten Per-Run-Overrides in eingereichte
   Jobs, und der Worker stellt den gespeicherten Snapshot vor dem Start eines
   Jobs nicht wieder her. Regressionstests ergänzen für
   Submit → Settings-Änderung → Worker-Ausführung, inklusive
   Ollama-kompatibles keyless Loopback-Verhalten und getrennte
   Twin-Modell-/API-/Key-Settings.

2. **Strukturierter Attack-Round-/NO_EVIDENCE-Vertrag**
   Der P0-Probe-Vertrag ist implementiert und fail-closed, aber der
   breitere Attack-Round-/NO_EVIDENCE-Workflow-Punkt ist kein separat
   abgeschlossener Runtime-Vertrag. Jede Implementierung muss Kontext/
   Evidenz-only bleiben oder downgraden/vetoen; sie darf nie einen zweiten
   WRITE-Pfad erzeugen.

3. **Verdict-Parsing und begrenzter transienter Retry**
   `parseVerdict()` ist robust gegenüber mehreren Platzierungsvarianten und
   Queue-Retry-Helfer existieren. Worker-Crash-/Provider-Retry-Orchestrierung
   ist noch nicht vollständig verdrahtet, und Retry-Metadaten dürfen nie
   einen terminalen `DONE`- oder `ERROR`-Job wieder öffnen. Tests ergänzen
   für transienten Retry, Backoff-Berechtigung, Versuchs-Erschöpfung,
   Abort-Klassifikation und unveränderliche terminale Zeilen.

4. **CLI-Help und Bootstrap-Zielausrichtung**
   Bootstrap-Flag-Parsing und expliziter Modus/Reichweite sind vorhanden,
   aber jedes CLI-Subkommando braucht noch ein nebenwirkungsfreies
   `--help`-Audit. Insbesondere verifizieren, dass `falsify scope new
   --help` keinen Scope erzeugen kann und dass Agent- und
   Instruction-Ziele an beiden Bootstrap-Einstiegen explizit sind.

5. **Kanonische Secret-Pfade und Diagnostik**
   Das Fundament für kanonisches Home und Private-Env-Schreiben existiert,
   inklusive `0600`-Versuchen auf POSIX. Doctor braucht noch ein
   vollständiges Audit für Dateimodus, Duplikat-/Legacy-Homes,
   Local-Provider-Key-Ausnahmen und ehrliche Diagnostik, wenn `.env` nur
   als leere Vorlage existiert.

6. **Uninstall-Sicherheit**
   Der Uninstall-Flow behandelt mehrere bekannte Pfade, Worker, Backups und
   Dry-Run-Verhalten. Aktive Sessions, gesperrte Verzeichnisse, Legacy-Homes
   und der Schutz fremder Nutzerdateien brauchen noch Adversarial-Tests und
   begrenzte Lösch-Retries. Löschungen nicht über explizit eigene Pfade
   hinaus verbreitern.

7. **Opt-in-Allowlist-Web-Recherche**
   `core/config.mjs` enthält Web-Search-Settings, aber es gibt keinen
   verifizierten end-to-end Allowlist-Web-Tool mit isoliertem Twin-Kontext,
   Throttling, Quellen-Referenzen und Quellen-Persistenz. Default deaktiviert
   lassen und bei fehlenden Credentials, nicht erlaubten Domains,
   Netzwerkfehlern und fehlerhaften Quellen-Ergebnissen fail-closed bleiben.

8. **Finaler Abschluss und Staging**
   Dokumentations-Propagation und Verifikation laufen. Der finale
   Staging-Schritt muss alle aktuell angefragten, Dokumentations- und
   vorab existierenden Produktänderungen einschließen, während ignoriertes
   Session-Scratch draußen bleibt. In diesem Handoff wurde kein Commit
   erzeugt.

## Nächste Ausführungsreihenfolge

1. Fokussierte Tests für die aktuellen Snapshot-/Retry-Helfer ergänzen,
   bevor deren Konsumenten geändert werden.
2. EIN unveränderliches Config-Objekt durch Submit, Direkt-Run, Worker-Spawn,
   Thinker und Twin-Pfade verdrahten; Legacy-Zeilen mit explizitem Fallback
   erhalten.
3. CLI-Help-, Secrets-/Doctor-, Uninstall- und Opt-in-Web-Grenzen mit
   fail-closed-Tests abschließen.
4. README/WIRING/`ui/PLAN.md` nur mit durch Tests bewiesenem Verhalten
   aktualisieren.
5. Die volle Suite und statische Checks erneut ausführen.
6. `git diff` und `git log` prüfen, alle beabsichtigten aktuellen Änderungen
   stagen und den Commit unerzeugt lassen, sofern nicht explizit angefragt.

## Audit-Record

```text
F1: User-Agent-Ausgangsbehauptung: Die gewünschte Kette lautet USER AGENT → THINKER → EVIL TWIN → USER AGENT → REPOSITORY CHANGE → THINKER.
F2: User contract: Prüfen, ob diese Kette bereits vollständig im ausführbaren System vorhanden ist.
F3: Scope match oder konkrete Divergenz: THINKER und EVIL TWIN existieren; der Handoff zurück zum USER AGENT, der Repository-Write und der automatische Re-entry fehlen im Runtime-Code.
F4: Falsifizierbare Annahme: Die dokumentierte Loop-Kette könnte vollständig implementiert sein, obwohl der Runtime-Code nur bis zum finalen Verdict führt.
F5: Unternommener Angriff: Suche nach tatsächlichem Repository-Write, direktem Twin→USER-AGENT-Handoff, automatischer Resubmission und automatischem Re-entry in THINKER.
F6: Tatsächlich gelesene und verifizierte Evidenz: cli/run.mjs, core/agent.mjs, core/twin.mjs, core/probes.mjs, core/tools.mjs, ui/worker.mjs und die relevanten Tests.
F7: Gesuchte Gegenbeweise und Ergebnis: Es wurde nach Produktionspfaden für Write, Git-Änderungserkennung, automatische Resubmission und erneuten THINKER-Start gesucht. Kein solcher vollständiger automatischer Pfad wurde gefunden.
F8: Ungeprüfter oder nur vermuteter Bereich: Das tatsächliche Verhalten eines externen USER AGENT nach Erhalt des Verdicts liegt außerhalb des Runtime-Prozesses.
F9: Stärkstes verbleibendes Risiko: Der USER AGENT erhält kein dediziertes strukturiertes Twin-Ergebnis, sondern primär das finale Verdict, den Status und den Exit-Code.
F10: WRITE-Entscheidung oder konkretes Hindernis: BLOCKED – die Review-Hälfte ist implementiert und getestet, die vollständige USER-AGENT → REPOSITORY CHANGE → THINKER Loop jedoch nicht.
```