# AGENTS.md — Session-Learnings (FalsifyMe)

Ergänzt README/WIRING/PLAN um nicht-offensichtliche, empirisch bestätigte
Fakten. Bei Kontextverlust: erst WIRING.md §1 → ui/PLAN.md lesen.

## Prozess-/Fehlertrennung (architektonische Abgrenzung)

- OOM im Dock (TUI) trifft NUR die Bedien-/Darstellungsschicht — die
  Falsifikationslogik (Thinker → Evidence → Verdict → Evil Twin → Gate)
  läuft strukturell GETRENNT: run.mjs ist ein EIGENER Kindprozess
  (worker.mjs:389), importiert nie die TUI, persistiert sein Verdict SELBST
  (jobDone in run.mjs, eine Transaktion) und core/verdict.mjs + core/twin.mjs
  sind pure (importieren nur fs/path/agent). Ein Dock-Crash kann kein WRITE
  durchs Gate rücken und keine Evidence fälschen.
- Stirbt der Worker mitten im Job, bleibt der Job nie hängen: Orphan-Recovery
  (reapStaleJobs beim nächsten Worker-Start) schließt RUNNING-Waisen als
  „ERROR Worker-Abbruch (Recovery)" — fail-closed, kein Fake-Verdict.
  uiEvt ist `ui?.applyEvent` (optional chaining): ohne UI arbeitet die
  Pipeline weiter (headless-Identität).
- Finale Job-Zustände sind IMMUTABEL (Security-Review 2026-09-01, Pkt 4/7):
  jobDone lehnt einen zweiten Abschluss ab (Rückgabe false, empirical
  vorher: WRITE → ERROR per Crash-Guard-2. Aufruf). Ein nachgelagerter
  Fehlerpfad kann ein persistiertes WRITE nie tilgen — Umkehr-Risiko
  „alter WRITE-Zustand wird überschrieben" ist geschlossen. Doppelfinale
  im produktionscode sind damit no-op statt Konflikt.


## Repo-Römer

(This block is the temporary scan ledger for this session. Each file below answers the two session questions. When the scan is complete, the block is removed.)

- `FALSIFY_HOME` = `~/.Falsify_Private` (`falsifyHome()` in
  `artifacts/db.mjs`, Default; per Env-Variable überschreibbar). Dort liegen
  SQLite, API-Keys (`.env`) und Logs — **bewusst getrennt** vom Programm in
  `~/.Falsify_Core` und explizit NUR für den Nutzer/das lokale FalsifyMe
  (kein Sammeln, keine Telemetrie; Modelle via API sind Nutzerentscheidung).
  Historisch (vor dem Batch-Commit 2026-09-01) war der Default fälschlich
  `~/.Falsify`; `uninstall.mjs` räumt Altdaten ab (Key-Backup nach
  `~/.Falsify.env.uninstall-backup`).
- Clickable-Items im Repo-Root: `FalsifyMe-Setup.cmd` (Installation per
  Doppelklick, ruft `node install.mjs`, sichtbares Fenster) und
  `FalsifyMe-Deinstall.cmd` (Bestätigungs-Dialog, ruft `node uninstall.mjs`,
  durchreicht `--dry-run`/`--keep-env`/`--project-root`).
- **Deinstallation = „als wäre FalsifyMe nie da gewesen"** (uninstall.mjs,
  UI-131): zusätzlich zu Core/Private/Skills/Instructions/Icons/Shims werden
  auch die PATH-Marker-Zeilen von `falsify install` (Marker `Falsify-CLI`,
  NICHT nur `FalsifyMe-Agent-Integration`) aus `.bashrc`/`.bash_profile`/
  `.profile`/PowerShell-Profil entfernt, sowie mit `--project-root` der
  markierte `.gitignore`-Block (`# >>> FalsifyMe (lokal …)`) und der
  Identitäts-Anker `FalsifyME.md` des Zielprojekts. Test-/CI-Escape-Hatch:
  `FALSIFY_UNINSTALL_HOME=<tmp>` verlegt ALLE Pfade isoliert (nie echte
  Profile/Desktop/npm-Shims). `ensureAnchorGitIgnored` mutiert beim
  Selbstprüfen des FalsifyMe-Repos die eigene `.gitignore` nie.
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
  ERZWUNGEN (Enforcement im Betriebsloop, nicht nur doctor):
  `enforceQueueConsistency` läuft nach jedem Review-Commit (cli/run.mjs,
  fail-closed Exit 3), nach jedem Submit (recovery-then-enforce) und nach
  jedem Worker-Claim (Job wird NICHT verarbeitet). Review-Commits sind EINE
  Transaktion (BEGIN IMMEDIATE … COMMIT) — kein Beobachter sieht je einen
  Zwischenzustand. `checkQueueConsistency` (= doctor-Variante, read-only)
  prüft abgeleitete Zustände: hardened/Konflikte, hardened-ohne-Finding,
  GAP/Befund, Phase vs. letztes Finding-Verdict, DONE-Status vs. jobs.verdict
  (inkl. UNBEKANNT), Orphan-RUNNING (Fenster 0 = Direkt-Run mit eigener
  Liveness), jobs- vs. findings-Verdict. `tests/invariants.test.mjs` scannt
  den GANZEN Repo-Baum statisch (Kommentar-/String-bereinigt,
  qualifier-aware — auch `jobs.jobDone(...)` wird gefunden; Selbstzertifiz.),
  und `reapStaleJobs` räumt seit dem Rig auch Fenster-0-Waisen (gecrashte
  `falsify run --job-id`) auf — Direkt-Runs registrieren sich selbst als
  Fenster-0-Worker mit Heartbeat (sonst galt jeder legitime Direkt-Lauf als
  Orphan).
- `falsify wait` hat **keinen festen Timeout** (Laufzeiten sind
  anbieterabhängig): `--ping` pollt den Job und übergibt die Auswertung an den
  USER AGENT (der externe Agent entscheidet selbst über Abbruch via `--abort`/`falsify
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
  scannt sie **unabhängig NACH dem USER AGENT** (der Agent muss erst seine
  Whitelist fertigstellen und einen ersten Entwurf umsetzen — nur dann gibt
  es etwas zu falsifizieren) — die Divergenz der beiden Urteile
  ist der GAP, den der Loop schließt. `addFinding`/`jobDone` werden von
  feasibility nie aufgerufen (nur `cli/run.mjs` schließt Jobs).
- `scopes.last_gap` ist NUR der FalsifyMe-Befund bei PLAN/RESEARCH (null bei
  WRITE) — keine gespeicherte Divergenz zweier Urteile: das USER-AGENT-Urteil wird
  nirgends erfasst, „Divergenz USER-AGENT-Urteil vs. Falsifikation" ist Label.
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
- Loop-Anker (Regel 7, UI-107, Schema v4): `scopes.last_divergence` hält die
  deklarierte Divergenz zwischen USER-AGENT-`agent_intent` und dem UNABHÄNGIGEN
  `## Umsetzungsverstaendnis (FalsifyMe)`-Abschnitt des Thinkers (Pflicht
  DIREKT VOR `## Falsifikationsversuche`, sonst schneidet das `##` den
  Challenge-Abschnitt ab!). `SCOPE-DIVERGENZ: <Grund>` (≥20 Zeichen) ⇒ WRITE
  wird deterministisch zu PLAN (Warnung in run.mjs); `SCOPE-KONFORM` leert
  den Anker; fehlende Sektion = keine Aussage (kein Write an last_divergence).
  `buildUserContent` gibt den Anker als „Offener Divergenz-Anker“ an den
  nächsten Lauf — der Submit muss `--agent-intent` tragen, sonst kann der
  Thinker nicht dividieren.
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
  (core/tools.mjs; Regressionstest in tests/security.test.mjs). Ohne
  `--files` (Direkt-Run ohne Submit) gibt es keinen Whitelist-Vertrag: der
  GANZE Root ist Zugriffsrahmen (Tools erlauben alles unter Root); die CLI
  sagt das ehrlich („KEIN --files → ganzer Root ist Zugriffsrahmen") —
  kein stiller Sondermodus.
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
  BESTAETIGT ist erst belastbar, wenn der Twin NACHWEISBAR selbst gelesen
  hat — twinEvidenceOk (core/verdict.mjs): mind. 1 Tool-Runde ODER
  verifizierte Datei:Zeile-/Pfad-Referenz; 0 Runden ohne Referenz ⇒
  UNKLAR/keine Freigabe (Rig 2026-09-01, Prompt-Ebene reichte nicht);
  WIDERSPRUCH/UNKLAR/Fehler ⇒ PLAN mit ehrlicher Warnung. Doppel-
  Plausibilisierung blockt separat (UI-112, Audit-Befund 10):
  twinOwnFalsificationOk verlangt für BESTAETIGT Tool-Runden UND eine
  eigene verifizierbare Datei:Zeile im Twin-Befund — nur die Nachlese der
  Erstprüfer-Zitate ist keine zweite Falsifikation. Twin-Finding
  bekommt wave='evil-twin' und trägt als LETZTES Finding das final geltende
  Urteil (Invariante 4 unverändert gültig). Zweiter enforceRateLimit-Call
  (noWait=false); TUI-State VERIFYING.
- Self-Review-Regel (UI-097/UI-101, nachgeschärft 2026-09-01): `core/selfreview.mjs`
  ergänzt bei erkannter Selbstprüfung (Marker artifacts/db.mjs + core/tools.mjs +
  cli/run.mjs unter --root) die Kern-WHITELIST automatisch
  (SELF_REVIEW_CORE inkl. selfreview.mjs + invariants.mjs + twin.mjs +
  core/prompt-text/system-*.md — der Prüfmechanismus inkl. Evil-Twin-Gate und
  Prompt-Daten darf NIE unsichtbar bleiben; nur existierende Dateien,
  Union, Meldung „Selbstprüfung erkannt") — an ALLEN Einstiegen
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
- CLI-Generalisierung (2026-09-01): `falsify run` ist der einheitliche
  Einstieg — `run --submit` = Job einreichen, `run --falsiflow` = kompletter
  Flow (einreichen + blockieren bis Verdict); `falsify submit` ist der
  FLOW-ALIAS und delegiert aus dem run-Branch via `exec bash "$0" submit "$@"`
  (nur als ERSTES Flag, shift vor Delegation).
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
- OOM-B10-Gelände (UI-113): TUI-State-Ringe (80/200) sind NICHT die Leak-
  Quelle — Plain- und TTY-Soak beides heap-flach (−2 bis −3 MB/min). Die
  Quelle war der Parser-Teilzeilenpuffer (Streams ohne \n wachsen ungebunden,
  7,8 MB Input → 133 MB Heap). Lektion: bei Heap-Wachstumsverdacht erst
  Wegwerf-Soak mit heapUsed-Sampling (`node --expose-gc`, Trend MB/min)
  statt Code-Lesen — der TTY-Zweig von createTui wird headless via
  `process.stdout.isTTY = true` + columns/rows erzwingbar.
- OCR für Screenshots (2026-09-01, Screenshot-Verifikation): `python ocr.py
  <png>…` im Repo-Root (pytesseract+PIL; Tesseract unter `C:\Program Files\
  Tesseract-OCR` mit NUR eng-Paket — UI-Text/ASCII/Zahlen liest es zuverlässig,
  Umlaute teils verhunzt). Immer mit `PYTHONUTF8=1` starten (Mojibake-Falle wie
  generate_review.py); 2x-Upscale+autocontrast steckt im Skript. WinRT-OCR
  (Windows.Media.Ocr, de-DE verfügbar) scheitert im PowerShell-5.1-Interop
  (AsTask-AggregateException) — der Tesseract-Pfad ist der verlässliche.

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
- **Ticket-Protokoll (UI-127/129, 2026-09-03):** Der Agent schreibt den Job
  als Ticket (User-Input 1:1) und liefert es bei JEDER Iteration — FalsifyMe
  bestimmt die Scope-Zuordnung automatisch (`resolveScopeForCheckout` in
  artifacts/scopes.mjs: 0 aktive = neu, genau 1 = Fortsetzung, mehrere =
  fail-closed Exit 2). Agent-Pfad: `falsify start "<Ticket>"` · `falsify
  submit --header "<Ticket 1:1>" …` · `falsify resume [--header …]` ·
  `falsify history [--scope <id>]`. `--scope <id>` ist Operator-/Diagnose-
  Flag, KEIN Agent-Vertrag (Agent-Skills lehnen es ab); unscoped Submit ohne
  Ticket warnt ehrlich (CI-/Direkt-Run).
- Kernprinzip: FalsifyMe = kritische Peer-Review durch einen unabhängigen
  Betrachter („Thinker-with-files", eigene Konversation, Kontext getrennt,
  Anti-Self-Check-Bias): Alles wird unabhängig geprüft, bevor der USER AGENT
  schreibt; ohne Challenge-Nachweis gibt es kein `VERDICT: WRITE`.
- **Niemals headless — User-Experience ist das sichtbare Fenster:** Die
  Abnahme einer Nutzer-Erfahrung ist der sichtbare Lauf (Dock-Fenster,
  Selbsttest); ein headless Lauf beweist nur headless (Tautologie) und zählt
  nicht als UX-Beweis. Headless Worker-/CLI-Pfade existieren nur für Agents
  und Automatisierung (README „Terminal-UI & Worker-Dock", WIRING §0).
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

## Pflichtprotokoll nach jeder Arbeit (CHANGE_GATE_10X + FALSIFICATION_RECORD_10X)

Diese zwei Blöcke sind ein verbindlicher Agenten- und Review-Vertrag für jeden
Plan, jede Iteration, jeden Bugfix, jedes Refactoring, jedes Feature, jede
Dokumentations- und jede Konfigurationsänderung. Sie sind KEIN neuer
Runtime-Verdictpfad, KEINE Queue und KEIN Datenbankschema. Die bestehende
Falsifikationspipeline bleibt die einzige Quelle für `WRITE`.

### CHANGE_GATE_10X – Abschlussprüfung des Agents

Nach jeder Arbeit beantwortet der Agent alle zehn Fragen mit `JA`. Jede Antwort
braucht konkreten Beleg und eine reproduzierbare Prüfung im folgenden Format:

```text
A1: JA
Proof: <konkreter Beleg aus Diff, Code, Verhalten oder Test>
Test: <exakter Befehl oder reproduzierbare Verifikation>
```

Die zehn Fragen:

1. **Scope:** Liegt Änderung vollständig im beauftragten Scope, ohne ungeplante
   Dateien, Verhalten, Architektur oder Zuständigkeiten?
2. **Architektur:** Ist dieselbe Architektur erhalten – eine Queue, eine
   Falsifikationspipeline, ein persistierter Verdict-Pfad und kein Bypass?
3. **Verdict-Hoheit:** Liefert neue Logik höchstens Kontext oder ein Downgrade/
   Veto; bleibt release-tragendes `WRITE` ausschließlich im bestehenden
   Falsifikationsprozess?
4. **Evidenz:** Werden echte Widerlegungen weiterhin von „gefunden", „sieht
   korrekt aus", Lob, „kein Problem" und unbelegter Sicherheit getrennt?
5. **Datenbindung:** Sind jede Datei-, Zeilen-, Symbol-, Zitat- oder
   Probe-Referenz gegen Root und erlaubten Zugriffsscope verifizierbar?
6. **Fail-closed:** Führt jede fehlende, kaputte, widersprüchliche,
   unverifizierbare oder unvollständige Voraussetzung weiterhin zu keiner
   `WRITE`-Freigabe?
7. **Twin-Isolation:** Erhält der Evil Twin ausschließlich den definierten
   Gegenprüfungs-Kontext, niemals Erst-Reasoning, versteckte Zustände oder
   fremde Scope-Historie?
8. **Fehlersicherheit:** Werden leere, kaputte oder fehlende Modellantworten,
   API-Fehler, Timeouts, Provider-Ausfälle und Prozessabbrüche niemals zu
   `BESTAETIGT` oder `WRITE`?
9. **Ausführbarer Beleg:** Gibt es einen echten reproduzierbaren Test oder
   End-to-End-Lauf für genau das geänderte Verhalten?
10. **Feindseliger Agent:** Bleibt das System sicher bei einem literalistischen,
    überheblichen, sycophantischen, manipulierten, inkompetenten oder kaputten
    Agenten?

`A1` bis `A10` müssen `JA` sein. Ein einziges `NEIN`, `UNBEKANNT` oder fehlender
Beleg bedeutet zwingend:

```text
BLOCKED – mindestens eine Invariante ist nicht nachgewiesen.
```

### FALSIFICATION_RECORD_10X – unabhängiges Prüfprotokoll

Der Record ist kein zweites Abschluss-Gate und kein Modell-Override. Er hält
fest, was der unabhängige Reviewer tatsächlich geprüft hat. Jede Antwort muss
auf konkrete zugängliche Evidenz zeigen:

```text
F1: <User-Agent-Ausgangsbehauptung – konkrete Behauptung und betroffenes Verhalten>
F2: <User contract – ursprüngliche Anforderung oder unveränderter Scope-Header>
F3: <Scope match – exakte Übereinstimmung oder konkrete Divergenz>
F4: <Falsifiable assumption – eine Annahme, die falsch sein könnte>
F5: <Attack – konkrete Widerlegungsmaßnahme>
F6: <Evidence – Datei:Zeile, Symbol, Probe oder anderes verifiziertes Artefakt>
F7: <Counterevidence – gesuchte Gegenbeweise und Ergebnis>
F8: <Unexamined area – ungeprüfter oder nur vermuteter Bereich>
F9: <Residual risk – stärkste verbleibende Unsicherheit>
F10: <Release decision – WRITE nur bei vorhandener Evidenz, sonst Hindernis>
```

`F1` bis `F10` müssen bei jedem Plan, jeder Änderung und jeder Iteration
beantwortet werden. `F6` darf keine Fantasie-Referenz enthalten; nicht
zugängliche oder nicht verifizierte Daten sind als Unsicherheit zu benennen.
`WRITE` darf nur nach bestandenem bestehenden Probe-/Twin-/Gate-Vertrag
behauptet werden. Ohne ausreichenden Nachweis lautet der Abschluss nicht
„wahrscheinlich“, sondern exakt `BLOCKED – mindestens eine Invariante ist nicht
nachgewiesen.`

## P0-Cutover — Probe-basierte WRITE-Entscheidung (Revision 5)

- WRITE wird NICHT mehr durch Prosa-Evidenz freigegeben. `hasChallengeEvidence`
  (core/evidence.mjs, Regel 2 alt) suchte Evidenz im Fließtext – Form-Slop
  („widerlegt“ + existierender Pfad ohne inhaltlichen Angriff) passierte das
  Gate. Der Cutover ersetzt Prosa-Regex durch ein strukturiertes Protokoll mit
  DREI getrennten Schichten (keine Vermischung, core/verdict.mjs bleibt
  Probe-frei): Thinker erzeugt das Probe-Set (```json-Fence, requirement_ref =
  Original-H_i-IDs) → Validator (`validateProbeSet`, NUR formal/strukturell
  inkl. Coverage-Härte jede H_i ≥ 1 Probe + Anti-Vakuum-Minima als Müllfilter)
  → Twin führt JEDE Probe aus (`runProbeExecution`, semantische
  Ausführbarkeit → ProbeResult[]) → Gate (`computeVerdict`, entscheidet NUR aus
  Resultaten + Evidence `probeEvidenceOk` = bestehende twinEvidenceOk/
  twinOwnFalsificationOk-Semantik pro Probe + bestehende harte Gates
  structural/Divergenz-Anker/Dateien-unverändert) → WRITE/PLAN.
- `parseVerdict`-WRITE ist nur KANDIDAT, keine Freigabe. Genau EIN WRITE-Pfad:
  ein Thinker-WRITE ohne gültiges/coverage-vollständiges Probe-Set wird
  fail-closed PLAN (keine „nicht prüfbar“-Ausnahme, kein Override).
  Kaputte/coverage-unvollständige Probe-Sets erreichen den Twin NIE.
- Header-Anker (COVERAGE-Referenz): `splitRequirement` zerlegt den HEADER
  (User-Input 1:1, scope.header) deterministisch an Satz-/Listen-/Zeilen-/
  Semikolon-Grenzen in H1..Hn (Original-Spans, Tail-Merge-Kappe 12, Mini-
  Merge, vager Ein-Satz-Header → H1). Keine LLM-Zerlegung, keine H1a/H1b-
  Verfeinerung, keine Header-Mindestqualität. Coverage-Härte ist eine
  FORMAT-Anforderung, KEIN Qualitätsbeweis.
- Twin-Kontext-Trennung bleibt (Pkt 7): `runProbeExecution` bekommt NUR
  HEADER + H_i-Originaltexte + Iteration/Diff + Probe-Set, NIE das Erst-
  Reasoning. Fail-closed: Parse-Fehler/Timeout → alle Proben UNKLAR;
  fehlende probe_id → diese Probe UNKLAR; globale Zusatzaussagen ohne
  Autorität. `twinEvidenceOk`/`twinOwnFalsificationOk`/`anchoredFileLine`
  bleiben, pro Probe angewendet (BESTAETIGT braucht eigenes Lesen UND
  verifizierte eigene Datei:Zeile-Referenz).
- Dateien-unverändert-Gate (P0, letzte harte Hürde): `whitelistSnapshot`
  erfasst mtime+Größe der Whitelist VOR der Twin-Exekution, danach verglichen
  – eine während der Prüfung veränderte Basis trägt keine Freigabe.

## Produktions-Loop (Schema v9, 2026-09-03)

- Die Loop-Kette `THINKER → EVIL TWIN → GATE → WRITE_AUTHORIZED →
  externer Coder → CHANGE_CAPTURED → RE_REVIEW_QUEUED → THINKER` ist
  ausführbar und e2e-getestet (Abschluss-Record:
  `plan/feature-runtime-loop-production-1.md`; Modul-Karte: WIRING §18).
- Drei getrennte Module statt eines Zyklus (Richtung: Job-Lebenszyklus →
  Übergangs-Dienst → Loop-Zustand):
  · `artifacts/loops.mjs` — REINE Loop-Zustandsmaschine (12 Zustände,
    legale Übergänge `applyTransition`/`transitionLoop`, `loop_events`-
    Log, `isTerminal`). Importiert KEIN jobs.mjs; Terminale sind
    unumkehrbar (SEC-004).
  · `artifacts/loopflow.mjs` — ÜBERGANGS-DIENST: die EINZIGE Kopplung
    zwischen Runtime-Ereignis und Loop-Zustand (`advanceLoop(event)`:
    load → Terminal-Guard → Übergang ableiten → persistieren).
  · `artifacts/handoff.mjs` — `completeHandoff`-Orchestrierung: Child-Jobs
    entstehen NUR hier via `jobs.createJob` (der Writer-Scan in
    `tests/invariants.test.mjs` hat `artifacts/handoff.mjs` als
    registrierten Orchestrierer, RISK-003: keine zweite Queue).
- **Kausale Zustands-Herkunft (2026-09-03, Divergenz-Fix + Atomaritäts-
  Fix):** `loop_state` ist ein EIGENER persistierter Protokollzustand (kein
  Ableitung aus `jobs.status`); Job-State und Loop-State sind bewusst
  getrennt und kausal gekoppelt. Welches RUNTIME-Ereignis welchen Zustand
  setzt:
  - `RE_REVIEW_QUEUED`: `completeHandoff` erzeugt das Child (EINE
    Transaktion mit Parent-Übergängen).
  - `WRITE_AUTHORIZED`: `markWriteAuthorized` in artifacts/loopflow.mjs bei
    der Handoff-Emission (QUEUED beim Erstlauf ODER RE_REVIEW_RUNNING beim
    Re-Review) — handoff_id + Transition in EINER Transaktion, läuft über
    die Transitionstabelle (kein Raw-Update; QUEUED → WRITE_AUTHORIZED ist
    der legalisierte First-Run-Handoff-Pfad).
  - `RE_REVIEW_RUNNING`: der EINZIGE Claim-Übergangs-Owner ist `claimJob`
    in artifacts/jobs.mjs — `claimNextJob` (worker) UND der `--job-id`-Pfad
    (worker-Kind/Direkt-Run) rufen BEIDE nur diese eine Funktion; die
    Claim-Transition existiert genau einmal. `advanceLoop({event:"claim"})`
    läuft in derselben BEGIN-IMMEDIATE-Transaktion wie `status=RUNNING`;
    ein Crash dazwischen kann nie status=RUNNING bei
    loop_state=RE_REVIEW_QUEUED hinterlassen. Erstlauf-Jobs ohne Re-Review
    werden NICHT auf RE_REVIEW_RUNNING gehoben (kein Phantom-State; Retry
    bleibt idempotent).
  - `DONE`: IN `jobDone` selbst (kein separater CLI-Schritt mehr) — der
    finale Job-Zustandsübergang erzeugt GENAU EINE Loop-Transition.
    `advanceLoop({event:"finalize"})` setzt DONE NUR wenn der letzte
    Loop-Schritt einen finalen NICHT-WRITE-Verdict persistiert hat und der
    Job status=DONE trägt. WRITE lässt den Loop offen (Handoff →
    `WRITE_AUTHORIZED`); ein laufender Job (status=RUNNING) kann nie DONE
    werden (kein vorzeitiges DONE, auch nicht bei Parent mit ausstehendem
    Child).
  - `ERROR`: IN `jobDone` bei Fehler-Finalisierung (Worker-Crash, Abort,
    Review-Fehler, Retry-Exhaustion) — jeder Nicht-Terminal-Zustand hat
    ERROR als legales Ziel; Terminale bleiben unangetastet (SEC-004).
- **jobDone ist EINE Transaktion (SAVEPOINT):** Status UND Loop-Zustand
  werden zusammen persistiert (verify non-terminal → status →
  `advanceLoop` → RELEASE). Scheitert die Loop-Transition, scheitert die
  GESAMTE Zustandsänderung (kein halber Zustand); ein Crash zwischen zwei
  Writes kann nie status=ERROR bei loop_state=RE_REVIEW_RUNNING
  hinterlassen. SAVEPOINT statt BEGIN, weil jobDone sowohl innerhalb des
  Review-Commits (cli/run.mjs) als auch standalone läuft (Abort, Recovery,
  Retry-Exhaustion) — bewiesen in tests/loop.test.mjs (Crash-Boundary).
- **SEC-004 ist jetzt überall erzwungen:** LOOP_BLOCKED, ABORTED und
  NO_CHANGE-Pfade in `completeHandoff` prüfen zuerst `isTerminal` — ein
  terminaler Zustand (DONE/ABORTED/ERROR/LOOP_BLOCKED) wird durch keinerlei
  Re-Completion überschrieben (Terminal-Matrix-Test). LOOP_BLOCKED ist von
  jedem offenen Zustand legal erreichbar (WRITE_AUTHORIZED nach der
  Handoff-Emission, RE_REVIEW_QUEUED bei Re-Delivery) — die
  Transitionstabelle ist die Wahrheit, es gibt kein rohes
  `loop_state='LOOP_BLOCKED'`-UPDATE mehr.
- `completeHandoff` ist EINE Transaktion: Report-/Handoff-/Change-
  Korrelation, Übergänge und GENAU EIN Child mit voller Korrelation
  (`parent_job_id`, `handoff_id`, `iteration_id`, `change_digest`,
  `header_digest`). Idempotenz `(handoff_id, change_digest, scope_id)` wird
  INNERHALB der Transaktion geprüft (Race-Fix: der Vorab-Check allein liesse
  zwei gleichzeitige Completions je ein Child erzeugen).
- `header_digest` + Basis-`change_digest` werden bei Submit UND Direkt-Run
  eingefroren; HEADER-Drift weist den Job vor jedem Modell-Call ab.
- `core/handoff.mjs`: v1-Handoff NUR nach `computeVerdict` (Modellprosa
  autorisiert nie); `validateHandoff` lehnt Secrets (SEC-001) und
  WIDERSPRUCH/UNKLAR-Proben ab. `renderCoderBrief` ist reine Ableitung —
  der Coder konsumiert (REQ-004), FalsifyMe schreibt nie.
- `falsify handoff report` (cli/handoff.mjs, UI-137): der einzige Weg, den
  v1-Write-Report korrekt zu erzeugen — der Agent kann die Digests
  (before/after/diff, changed_files) nicht von Hand kennen. FalsifyMe misst
  den Repo-Zustand selbst (dieselben `snapshotRoot`/`compareSnapshots` wie
  `complete`, Whitelist-gebunden) und füllt alle maschinenmessbaren Felder
  vor; der Agent bezeugt nur Absicht (`writer_id`, `write_status` bei
  NO_CHANGE/ABORTED). Read-only: kein DB-Write, kein Loop-Übergang, kein
  FM-EVT; `validateChangeReport`/`complete` bleiben der einzige,
  unveränderte Gate — ein generierter Report erteilt keine Freigabe.
- E2E-Befund (2026-09-03): der Handoff baute `probeResults` aus den Raw-
  Twin-Results OHNE `evidenceOk` — ein Gate-freigegebener WRITE erzeugte
  ein vom eigenen Validator abgelehntes Handoff. Lektion: Evidence-Prüfung
  (`probeEvidenceOk`) muss am Übergabepunkt reproduziert werden, nicht nur
  im Gate; der E2E-Test rendert jetzt den Coder-Brief gegen das echte
  Pipeline-Handoff.
- Fail-closed-Matrix (alle getestet): NO_CHANGE → `LOOP_BLOCKED`, Loop-Limit
  → `LOOP_BLOCKED`, ABORTED → terminal, fremde/unautorisierte Reports →
  Exit 3 ohne Child, 100 identische Reports → 1 Child.
- Die 10X-Protokoll-Gates sind bewusst NICHT im Release-Pfad: die
  System-Prompts erzeugen noch keine strukturierten A1–A10/F1–F10-Records;
  naive Schaltung würde jeden WRITE unmöglich machen. Schaltung =
  TASK-017-Rest mit Prompt-Vorbedingung (Konvergenzschutz folgt mit der
  Schaltung — nicht als separater Pfad davor).
- TUI spiegelt `loop_state` nur (FM-EVT `loop`, UI-123; CON-004: UI besitzt
  keine Zustandswahrheit). `falsify handoff brief|complete` sind in
  cli/falsify.sh + help.mjs nachgezogen.

## Test-/Verifikationspfade

- **Test-Konsolidierung (2026-09-03):** EIN Einstieg — `bash scripts/run-tests.sh
  <tier>` (bzw. `npm run test:fast` / `test:core`; `full` = `npm test`).
  Tiers: **fast** = Unit-Verträge < 3 s/Datei (~8 s gesamt, jeder Commit) ·
  **core** = fast + Prozess-/DB-Suiten (~2.5 min, vor jedem Push; enthält
  uninstall/ticketflow/invariants/security/identity/full-loop) · **full** =
  alle 33 Dateien (Release; node parallelisiert, ~2 min Wandzeit). Die alte
  hardcoded 19-Dateien-„Kernsuite" war stale (14 Dateien fehlten ihr) —
  Pfadlisten PFLEGEN WEGEN: nur noch scripts/run-tests.sh. Tests pro Datei
  getaktet (Datenbasis im Commit 2026-09-03): loop 69 s + invariants 63 s
  (langsamste, bewusst nur in full; ticketflow/queue/phase2/stats/
  probe-e2e/scope-trace/datamodel 14–27 s je in core). Vollbaseline:
  254/254 grün (2026-09-03). Einzel-Datei-`node --test` bleibt für Diagnose
  ok — der dokumentierte VERTRAG ist der Tier-Runner.
- Prompt-Texte sind DATEN, kein Code: Die System-Prompts leben in
  `core/prompt-text/*.md` (Loader in `core/prompt.mjs`, `promptText()`).
  Template-Literale zerbrechen bei Backticks/`${}` im Text (5 SyntaxError-
  Testfails am 2026-09-01) — Markdown-Dateien können prompt.mjs nicht brechen.
  Prompt-Edits sind reine Datei-Änderungen; NIE `${}`-Interpolation in die
  Prompt-Dateien einbauen (Loader lädt rohen Text). `install.mjs copyTree`
  kopiert den Ordner automatisch (kein Dateifilter); Konsumenten:
  `cli/run.mjs` (SYSTEM_DE/EN) + `core/twin.mjs` (SYSTEM_EVILTWIN_*).
- Deterministischer Abort-/Kill-E2E ohne echten Key: Dummy-Key in isolierter
  `FALSIFY_HOME/.env` + lokaler HTTP-Server (SSE ohne `[DONE]`, hält run.mjs
  offen) → CLI-Abort killt den hängenden Job beweisbar (`ERROR Abgebrochen
  (CLI)`). Worker-PID zum Killen aus `--check` nehmen, nicht aus `$!`.
- Onboarding-Tests brauchen isoliertes `FALSIFY_HOME` (mkdtemp) — Werte nie
  in config.json/JSON asserten: Keys leben nur in `.env`; `********`-Maskierung
  ist CLI-Ausgabe (`cli/settings.mjs`), nicht Core-API.
- `ui/PLAN.md` muss bei Doku/Status-Behauptungen (README/WIRING) synchron
  mitgepflegt werden, sonst widerspricht sich das Projekt („Doku ist Vertrag").
