# AGENTS.md — Session-Learnings (FalsifyMe)

Ergänzt README/WIRING/PLAN um nicht-offensichtliche, empirisch bestätigte
Fakten. Bei Kontextverlust: erst WIRING.md §1 → ui/PLAN.md lesen.

## Runtime & Installation (Docs-weichen-von-Code-Fallen)

- `FALSIFY_HOME` = `~/.Falsify_Private` (`falsifyHome()` in
  `artifacts/db.mjs`, Default; per Env-Variable überschreibbar). Dort liegen
  SQLite, API-Keys (`.env`) und Logs — **bewusst getrennt** vom Programm in
  `~/.Falsify_Core` und explizit NUR für den Nutzer/das lokale FalsifyMe
  (kein Sammeln, keine Telemetrie; Modelle via API sind Nutzerentscheidung).
  Historisch (vor dem Batch-Commit 2026-09-01) war der Default fälschlich
  `~/.Falsify`; `uninstall.mjs` räumt Altdaten ab (Key-Backup nach
  `~/.Falsify.env.uninstall-backup`).
- `ensureFalsifyHome()` schreibt eine `.env`-**Vorlage mit leeren Werten**
  (`NVIDIA_API_KEY=`, `OPENAI_API_KEY=`, `FALSIFY_API_KEY=`). Datei-existiert
  heißt NICHT Key-konfiguriert: `falsify doctor` meldet dann `Kein API-Key`.
  Auf diesem PC waren die Keys historisch nie gesetzt (Backup enthielt nur
  leere Werte). Key fehlt → jeder echte Job Exit 3, kein Fake-Verdict.
- `.env` enthält NUR Keys: `FALSIFY_API_BASE`/`FALSIFY_MODEL` stehen dort als
  Kommentar-Vorlage und werden nie gelesen — Ziel/Modell kommen aus
  Prozess-Env oder `FALSIFY_HOME/config.json` (schreibt `falsify settings set`).
- Der Worktree `C:\Users\Vannon\Desktop\Falsify_ME` ist die (einzige)
  Wahrheit; alle anderen PC-Referenzen (.Falsify*, ~/.agents/skills/falsifyme*,
  Desktop-Icons, ~/.falsifyme-instructions.ps1) wurden entfernt und nur aus
  diesem Checkout neu aufgebaut. `which falsify` zeigt hier auf das
  Repo-eigene `./falsify`-Skript (kein globaler npm-Shim installiert).

## Queue & Status (eine Job/Scope-Queue als einzige Wahrheit)

- Alle Schreibzugriffe auf Job/Scope-Zustand laufen ausschließlich über
  `artifacts/jobs.mjs` + `artifacts/scopes.mjs` (`createJob`/`jobDone`/
  `claimNextJob`/`addFinding`/`updateScopeAfterReview`/`registerWorker`); nur
  `core/ratelimit.mjs` schreibt direkt, aber in eine eigene Tabelle. Es gibt
  **keine zweite Queue** und keinen zweiten Verdict-Pfad. Regel 3 wird
  ERZWUNGEN: `artifacts/invariants.mjs checkQueueConsistency` (read-only,
  in `falsify doctor` integriert) prüft abgeleitete Zustände (hardened/
  Konflikte, GAP/Befund, Orphan-RUNNING, jobs- vs. findings-Verdict), und
  `tests/invariants.test.mjs` scannt das Repo statisch: ALLE Zustands-Writer
  (`createJob`/`jobToRunning`/`jobDone`/`setJobAbort`/`clearJobAbort`/
  `claimNextJob`/`reapStaleJobs`/`registerWorker`/`unregisterWorker`/
  `heartbeatWorker`/`setWorkerScope`/`createScope`/`updateScopeAfterReview`/
  `markScopeDone`/`addFinding`) dürfen nur aus ihren Heimatmodulen +
  `cli/run.mjs` + `ui/worker.mjs` + `cli/jobs.mjs` (abort) + `cli/scope.mjs`
  (new) aufgerufen werden.
- `falsify wait` hat **keinen festen Timeout** (Laufzeiten sind
  anbieterabhängig): `--ping` pollt den Job und übergibt die Auswertung an den
  Coder (der Agent entscheidet selbst über Abbruch via `--abort`/`falsify
  abort`). `--abort` setzt ein Flag; der Worker pollt es und killt den
  Kindprozess echt (kein Fake-Verdict, Abort-Race-Guard in `ui/worker.mjs`).
- Status-API (`worker.mjs --check`/`--state`) liest NUR die Queue: ein
  registrierter Worker zählt, wenn seine PID lebt UND sein Heartbeat frisch
  ist (`WORKER_STALE_MS` in `artifacts/jobs.mjs`; kontinuierliches
  setInterval-Heartbeat im Worker). Der frühere PowerShell-CIM-Abgleich
  (Querschnitts-Check gegen die Prozesstabelle) ist entfernt — hart gekillte
  Fenster altern über den Heartbeat aus.
- `core/feasibility.mjs` hat **keine Verdict-Hoheit**: Es ist der
  deterministische read-only Umsetzbarkeits-Check VOR dem Modell-Call
  (Whitelist unter Root, kein Pfad-Ausbruch, Plan adressiert Intent). Seine
  `blocks`/`findings` gehen als KONTEXT an den Thinker (`run.mjs`: Warnungen +
  Validierungs-Hinweise im User-Content) — **kein Verdict, kein Job-Ende**;
  RESEARCH bedeutet: FalsifyMe fordert Research-Daten an und der Thinker
  scannt sie **unabhängig vor dem Coder** — die Divergenz der beiden Urteile
  ist der GAP, den der Loop schließt. `addFinding`/`jobDone` werden von
  feasibility nie aufgerufen (nur `cli/run.mjs` schließt Jobs).
- `scopes.last_gap` ist NUR der FalsifyMe-Befund bei PLAN/RESEARCH (null bei
  WRITE) — keine gespeicherte Divergenz zweier Urteile: das Coder-Urteil wird
  nirgends erfasst, „Divergenz Coder-Urteil vs. Falsifikation" ist Label.
- WRITE-Challenge-Gate (UI-098/UI-102, Regel 2 seit 2026-09-01): WRITE
  braucht den Abschnitt `## Falsifikationsversuche` MIT mind. einem
  substanziellen Versuch (>10 Zeichen), der eine WIDERLEGUNG mit VERIFIZIERTER
  Evidenz trägt (`evidenceOf` in core/verdict.mjs): Widerlegungs-Vokabular
  (Bestätigungen wie „ist korrekt"/„keine Fehler gefunden" zählen NIE),
  Whitelist-Datei, real im Code vorkommendes Symbol (Backtick, Scan der
  whitelisted Dateien), Datei:Zeile deren Zeile existiert, existierender
  Pfad — Fantasie-Symbole/-Zeilen/-Pfade failen. Evidenz darf in der
  Folgezeile stehen (Bündel). `BEFUND: …` allein ist KEIN Nachweis
  (WRITE -> UNKNOWN).
- Abort-Interleaving ist strukturell unmöglich: während `createAbort` läuft,
  parkt die Worker-Main-Loop am `await close` — der `aborting`-Guard im
  Loop ist faktisch tot; Doppel-Aborts fängt der `started`-Guard ab.
- node:sqlite bindet `undefined` nicht: `getJob(db, undefined)` meldet
  irreführend „Provided value cannot be bound to SQLite parameter 1."
  (Exit 3) — ids VOR jedem DB-Zugriff guarden (`fail`, Exit 2).
- Etage 2 (UI-090..096): `jobs.agent_intent/affected/wave` +
  `scopes.open_conflicts/hardened_at` + `findings.wave` (Schema-Version 3,
  ALTER-only-Migration); `--agent-intent`/`--affected` beim Submit; die
  Sektion „Agent-Verständnis" im User-Content macht die Divergenz zum HEADER
  zu einem eigenen Prüfpunkt des Thinkers.
- Verdict `ASK` = Aufgaben-Mehrdeutigkeit (nicht Umsetzung): Phase und
  `open_conflicts` bleiben, Status active, Exit 5 — Exit-Codes zentral in
  `core/verdict.mjs exitCodeOf()` (0 WRITE · 1 PLAN/RESEARCH · 5 ASK · 3 sonst).
- Härtung: `scopes.status` active|hardened|done; hardened nur nach WRITE mit
  0 offenen Konflikten (`updateScopeAfterReview`), erneuter PLAN ent-härtet.
  „hardened/done" sind für `listScopes` abgeschlossen (nur active läuft).
- `claimNextJob` setzt die Scope-Affinität ATOMAR in der Claim-Transaktion
  (setWorkerScope INNERHALB BEGIN IMMEDIATE) — das Claim-SELECT MUSS
  `scope_id` mitnehmen, sonst bleibt der Switch still tot (2026-09-01).
- Worker-Start ruft `reapStaleJobs` auf (RUNNING-Waisen toter Worker →
  `ERROR Worker-Abbruch (Recovery)`) — ohne Recovery lügt die Queue ewig
  (claimt nur QUEUED). `WORKER_STALE_MS` = 15 s (3× Heartbeat; `isWorkerAlive`
  nutzt bewusst 1 h für Duplikat-Schutz — zwei Staleness-Semantiken,
  dokumentiert).
- feasibility-Block-Texte dürfen KEINE Verdict-Steuerworte (PLAN/RESEARCH/
  WRITE) enthalten (E2E-Befund 3) — die Hinweise sind Kontext, kein Urteil.
- list_dir-Vertrag (Regel 4): zeigt NUR Whitelist-Dateien + Ordnervorfahren
  freigegebener Dateien — Namen nicht freigegebener Daten sind unsichtbar
  (core/tools.mjs; Regressionstest in tests/security.test.mjs).
- Strukturelle Kohärenz (Regel 5, UI-103): feasibility-Blocker sind NICHT
  nur Kontext — ein WRITE wird deterministisch auf PLAN runtergestuft,
  wenn der Diff Dateien außerhalb der Whitelist berührt oder Plan und
  Diff divergieren (enforceStructuralCoherence in core/verdict.mjs, Einbau
  cli/run.mjs nach parseVerdict). Ein formales Gate macht eine kaputte
  Basis nie grün. Diff-Parser: /^[+-]{3} [ab]\/(.+)$/ + /^diff --git a\/(.+?) b\/(.+)$/.
- Evil-Twin-Gegenprüfung (Regel 6, UI-104): JEDER WRITE-Kandidat (nach den
  Regel-2/5-Gates) kostet einen ZWEITEN Modell-Call — core/twin.mjs
  runTwinCheck, kontextgetrennte Konversation (nur header/plan/BEFUND/
  Claims via extractClaims, nie Erst-Reasoning), Twin-System-Prompt
  SYSTEM_EVILTWIN_DE/EN. Fail-closed: BESTAETIGT ist die EINZIGE WRITE-
  tragende Antwort (parseTwinVerdict, strenge Lesart, Default UNKLAR);
  WIDERSPRUCH/UNKLAR/Fehler ⇒ PLAN mit ehrlicher Warnung. Twin-Finding
  bekommt wave='evil-twin' und trägt als LETZTES Finding das final geltende
  Urteil (Invariante 4 unverändert gültig). Zweiter enforceRateLimit-Call
  (noWait=false); TUI-State VERIFYING.
- Self-Review-Regel (UI-097/UI-101): `core/selfreview.mjs` ergänzt bei
  erkannter Selbstprüfung (Marker artifacts/db.mjs + core/tools.mjs +
  cli/run.mjs unter --root) die Kern-WHITELIST automatisch
  (SELF_REVIEW_CORE inkl. selfreview.mjs + invariants.mjs, nur existierende
  Dateien, Union, Meldung „Selbstprüfung erkannt") — an ALLEN Einstiegen
  (submit, Job-Lauf auf Job-Root, Direkt-Run); Fremdprojekte nie.
  Install-Tools (uninstall, bootstrap/*) sind bewusst nicht im Kern
  (kein Prüfmechanismus).

## Bootstrap & Onboarding (verhaltensrelevante Details)

- `falsify bootstrap` = volle Installation inkl. Desktop-Icons (Default,
  UI-077-Fix 2026-09-01). `--no-desktop`/`--skip-dock`/`--dry-run` sind
  explizite Flags, durchgereicht bis `runInstall({ noDesktop })`
  (`cli/bootstrap/install.mjs installArgs()`); ohne Flag keine stillen
  Sonderfälle. Läuft bereits eine Installation, überspringt der Bootstrap
  sie ehrlich (kein Doppel-Setup).
- **Modus-Entscheid ist Pflicht VOR dem Instruction-Schreiben** (UI-075
  umgesetzt im Batch-Commit): interaktiv über den Prompter
  (`cli/onboard/prompts.mjs`) ODER per Flags `--mode=PFLICHT|optional`
  `--reichweite=projekt|global|aus`. Default ohne Flag: `optional` + Marker +
  Warnung — **niemals PFLICHT still**. Die Instruction-Datei (AGENTS.md /
  FALSIFYME-WORKFLOW.md / powershell.ps1-Template) trägt eine Modus-Kopfzeile;
  nur `PFLICHT` macht FalsifyMe zum letzten Git-Check-Gate.
- In dieser Umgebung (Git Bash unter Freebuff) erkennt `detectAgent()` den
  Agenten als **PowerShell** (PSModulePath) und schreibt
  `~/.falsifyme-instructions.ps1` — nicht AGENTS.md.
- `falsify onboard` verweigert ohne echtes TTY (Exit 2, Hinweis auf
  `settings set`). Aus Agent-Shells ist das ERWARTETES Verhalten, kein Bug;
  `--help` funktioniert ohne TTY. Onboarding dupliziert keine Settings-Logik:
  spricht `core/settings.mjs` + `cli/bootstrap/dock.mjs` an, Prompter ist
  injizierbar (`fakePrompter` in `cli/onboard/prompts.mjs` für Tests).
- `cli/falsify.sh` hat `onboard`, `uninstall` und `abort` als Befehle;
  `help.mjs` und der CLI-Kopf in falsify.sh müssen bei neuen Befehlen
  mitziehen.
- ZWEI Bootstrap-Einstiege müssen synchron bleiben: `cli/bootstrap.mjs`
  main() und `cli/main.mjs bootstrap` teilen `applyModeDecision`; der
  main.mjs-Einstieg hat den Modus-Entscheid historisch still übersprungen
  (2026-09-01 gefixt).
- `bootstrap --dry-run` OHNE `--skip-dock` startet trotzdem das echte
  Dock-Fenster (startDock kennt kein dryRun); `--skip-dock`-Ausgabe meldet
  fälschlich „gestartet und bestaetigt" (dock.ok vor dock.skipped geprüft).

## Windows/Git-Bash-Quirks

- `rm -rf ~/.Falsify_Private` schlägt mit „Device or resource busy" fehl,
  solange ein Worker (`node ~/.Falsify_Core/ui/worker.mjs`) läuft. Reihenfolge:
  Worker-PIDs aus `node <core>/ui/worker.mjs --check` (`RUNNING <pid> (Fenster
  <n>)`) lesen, dann `taskkill //PID <pid> //F` (**doppelte Slashes** in Git
  Bash), dann löschen. `uninstall.mjs` macht das automatisch.
- Sichtbares Fenster aus Agent-Shells: nur PowerShell
  `Start-Process -WindowStyle Normal` (wt.exe/cmd /c start unzuverlässig),
  vgl. WIRING §4 — empirisch bestätigt durch selftest + bootstrap.
- Einstiegserkennung in CLI-Skripten NUR via
  `process.argv[1] === fileURLToPath(import.meta.url)`: der frühere
  String-Vergleich (`file://` + Pfad, ein Slash zu kurz) feuerte auf Windows
  nie — `node cli/bootstrap.mjs` war still ein No-Op (Exit 0, keine Ausgabe).
- `$!` eines Git-Bash-Hintergrundprozesses ist NICHT die Win32-PID von node:
  `taskkill //PID $!` verfehlt — PID aus `worker.mjs --check` (`RUNNING <pid>`)
  parsen (macht uninstall.mjs).
- MSYS-Prozesssubstitution ist für natives node unsichtbar: `--plan-file
  <(echo …)` → `ENOENT 'C:\proc\…'` — echte Temp-Datei verwenden.
- Der Dock-Start zeigt einen echten „Falsify lädt"-Boot (F A L S I F Y _ M E)
  mit Selftest-Fortschritt; die echten Selftest-Schritte landen zusätzlich in
  `FALSIFY_HOME/logs/selftest.log` (kein Mock, kein Demo-Screen).

## Skill-Creator-Werkzeuge (eigene Fallen)

- `generate_review.py` erzeugt unter Windows Mojibake (Umlaute), wenn nicht
  mit `PYTHONUTF8=1` gestartet. Aggregations-Skript heißt
  `scripts/aggregate_benchmark.py` (mit .py!), nicht `aggregate_benchmark`.
- Reihenfolge: erst `aggregate_benchmark.py` → `benchmark.json`, DANN erst
  Viewer mit `--benchmark <pfad> --static <pfad>` generieren; sonst bleibt
  der Benchmark-Tab leer. Ohne Subagents (Freebuff) sind Baselines/
  quantitative Deltas nicht möglich — Assertions-Grading + User-Review tragen
  die Bewertung (Claude.ai-Modus des skill-creators).
- Nutzer-Präferenz: Skill-Creator-Artefakte (Evals/Workspace) werden
  MITcommittet („Evals/Workspace mitcommitten bleibt korrekt") — sie sind
  Repo-Bestandteil, kein wegwerfbares Scratch.
- Der Self-Install-Skill liegt im Repo (`skills/falsifyme-selfinstall.md` +
  `skills/falsifyme-selfinstall-evals/`, Workspace als
  `falsifyme-selfinstall-workspace/iteration-N/`); `install.mjs` kopiert ihn
  nach `~/.agents/skills/falsifyme-selfinstall/SKILL.md`. Nach
  Skill-Änderungen: `cp skills/falsifyme-selfinstall.md
  ~/.agents/skills/falsifyme-selfinstall/SKILL.md` (install.mjs kopiert beim
  Re-Install, aber manueller cp ist schneller).

## User-Workflow-Vorgaben (nicht verhandelbar)

- FalsifyMe ist ein installierbares Agent-Gate: Auf „INSTALLIER BITTE
  https://github.com/vannon091118/Falsify_Me" → installieren, DANN
  **zwingende** Entscheidung mit dem Nutzer über Reichweite
  (projekt/global/aus) und Betriebsmodus (PFLICHT/optional). Nur `PFLICHT`
  macht FalsifyMe zum letzten Git-Check-Gate; optional → kein Enforcement;
  **keine stille Gate-Aktivierung** (Modus-Kopfzeile in der Instruction-
  Datei; UI-075 im Batch-Commit 2026-09-01 umgesetzt).
- Kernprinzip: FalsifyMe = kritische Peer-Review durch einen unabhängigen
  Betrachter („Thinker-with-files", eigene Konversation, Kontext getrennt,
  Anti-Self-Check-Bias): Alles wird unabhängig geprüft, bevor der Coder
  schreibt; ohne Challenge-Nachweis gibt es kein `VERDICT: WRITE`.
- Deinstallation muss vollständig rückabwickeln (uninstall.mjs: Worker,
  Core, Private, Skills, Instructions, Profil-Marker, AGENTS.md-Block,
  FALSIFY_HOME mit Key-Backup nach `~/.Falsify.env.uninstall-backup`,
  npm-Shims; `--dry-run`/`--keep-env`/`--project-root`).
- FalsifyMe soll direkt mit dem Nutzer sprechen (Dialog-Output, `falsify
  onboard`); die API-Key-Abfrage ist als PLAN-Task UI-073 notiert (TODO) —
  bis dahin: manuelle .env-Einrichtung (README, Abschnitt „API-Key / .env
  manuell einrichten").
- Strikte Modularität: neue Module bekommen je 1 Verantwortung und MÜSSEN im
  WIRING-Index nachgezogen werden (neue §-Abschnitte, Landkarte §1,
  Testbefehle §8); neue Tasks nach `ui/PLAN.md` (ID/TASK/STATUS/DEPENDS_ON/
  VERIFY/RESULT, Status DONE erst nach ehrlicher Verifikation vgl. WIRING §10).

## Test-/Verifikationspfade

- Kernsuite: `node --test tests/onboard.test.mjs tests/bootstrap.test.mjs
  tests/security.test.mjs tests/phase2.test.mjs tests/queue.test.mjs
  tests/feasibility.test.mjs tests/datamodel.test.mjs tests/invariants.test.mjs
  tests/selfreview.test.mjs` (Stand 2026-09-01; deckt die fünf Regeln ab:
  Queue eine Wahrheit, list_dir-Namen-Vertrag, WRITE-Challenge-Evidenz,
  Self-Review-Scope, strukturelle Kohärenz). `tests/settings.test.mjs` läuft
  separat.
- Deterministischer Abort-/Kill-E2E ohne echten Key: Dummy-Key in isolierter
  `FALSIFY_HOME/.env` + lokaler HTTP-Server (SSE ohne `[DONE]`, hält run.mjs
  offen) → CLI-Abort killt den hängenden Job beweisbar (`ERROR Abgebrochen
  (CLI)`). Worker-PID zum Killen aus `--check` nehmen, nicht aus `$!`.
- Onboarding-Tests brauchen isoliertes `FALSIFY_HOME` (mkdtemp) — Werte nie
  in config.json/JSON asserten: Keys leben nur in `.env`; `********`-Maskierung
  ist CLI-Ausgabe (`cli/settings.mjs`), nicht Core-API.
- `ui/PLAN.md` muss bei Doku/Status-Behauptungen (README/WIRING) synchron
  mitgepflegt werden, sonst widerspricht sich das Projekt („Doku ist Vertrag").
