# FALSIFYME — WIRING INDEX (für LLM-Agents & Entwickler)

Schnellster Einstieg in die Terminal-UI (Phase 1 implementiert, Phase 2
verdrahtet: `cli/run.mjs`-Marker + Worker-TUI). Offene manuelle Checkpoints
und neue Integrationsaufgaben stehen verbindlich in `ui/PLAN.md`.

> **Regel:** Index lesen → `ui/PLAN.md` (Fortschritt/Status) → relevante Modul-
> Dateien lesen → implementieren. NICHT raten, NICHT aus Erinnerung rekonstruieren.

---

## 0. KERNPRINZIP (unverhandelbar)

Die Kernfunktion ist die **FALSIFIKATION der USER-AGENT-Ausgangsbehauptungen** – eine kritische
Peer-Review durch einen unabhängigen Betrachter: USER AGENT und FalsifyMe pruefen
UNABHAENGIG voneinander dieselben Daten; FalsifyMe versucht, die Behauptungen des
USER AGENT zu WIDERLEGEN. Die Divergenz der beiden abschliessenden Urteile ist der
**GAP**, den der Loop schliesst. `RESEARCH` ist nur ein MODUL der
Datenbeschaffung fuer die Falsifikation, nie der Kern.

Invarianten (jede Aenderung wird dagegen geprueft):
- **Eine Job/Scope-Queue** (`artifacts/jobs.mjs` + `artifacts/scopes.mjs`) ist
  die EINZIGE Wahrheit; kein Codepfad schreibt Job-/Scope-Zustand ausserhalb
  dieser Module.
- **Verdict-Hoheit** liegt ausschliesslich beim Falsifikations-Agent (Modell).
  Deterministische Pre-Checks (feasibility) liefern nur Kontext-Hinweise und
  erteilen KEIN Verdict, schliessen KEINEN Job.
- **Wissen gehoert dem Nutzer**: lokal in `FALSIFY_HOME` (Default
  `~/.Falsify_Private`), kein Sammeln, keine Telemetrie; Modell-Nutzung via
  API ist Nutzerentscheidung. Der Scope-HEADER (User-Input 1:1) ist der
  Drift-Anker.
- Jede Komponente (TUI, Dock, Skills, Installer) existiert nur, um die
  Falsifikation effizienter/verlaesslicher zu machen; nichts umgeht den
  Falsifikations-Pfad. Neue Systeme sind begruendungspflichtig gegen §0.
- **Abnahme ist sichtbar („Niemals headless")**: Die Nutzer-Erfahrung und
  ihr Beweis sind das sichtbare Dock-Fenster; ein headless Lauf beweist nur
  headless (Tautologie). Headless Worker-/CLI-Pfade existieren nur fuer
  Agents/Automatisierung und ersetzen keine sichtbare Abnahme.
- **WRITE hat zwei Schluessel**: Probe-Set (§17, `requirement_ref` H_i,
  jede Probe vom Twin ausgefuehrt) UND kontextgetrennter Evil Twin — nur
  `BESTAETIGT` oeffnet das Gate; finale Job-Zustaende sind unveraenderlich
  (jobDone zweiter Abschluss = `false`, kein Rewrite).

---

## 1. SO IST DIE LANDKARTE (30 Sekunden)

```
ui/                        ← Terminal-UI (Phase 1+2, live verdrahtet)
  PLAN.md                  ← Persistente Task-Chain; offene Tasks bleiben sichtbar
  README-tui.md            ← Start, Tasten, Event-Contract, Design-Check
  WIRING.md                ← DIESER INDEX
  START-TUI.cmd            ← LIVE-START: Intro → WARTE AUF EINGABE; kein Auto-Job
  │                           erster Lauf = opt-in Desktop-Icons-Frage; -desktop erzeugt Icons
  TEST-TUI.cmd             ← TEST-START (Suite + Headless-Demo + Abort-Check)
  tui-make-icons.ps1       ← legt Desktop-Icons an (Start/Test, falsify.ico)
  tui.mjs                  ← createTui(): Kompositions-Wurzel (EINZIGE Eintritts-API)
  tui-demo.mjs             ← Demo-Harness: echte Kindprozesse → applyEvent/noteLine
  demo-agent.mjs           ← Fake-Agent (echter Stream, FM-EVT:-Marker)
  tui/                     ← Bausteine (1 Modul = 1 Verantwortung, siehe §5)
core/settings.mjs          ← Runtime-Provider/Model/Key + live /models-Abfrage
core/feasibility.mjs       ← Umsetzbarkeits-Puffer (Intent→Execution, §14)
core/identity.mjs         ← FalsifyME.md-Anchor: Root-/Digest-Prüfung, Records (read/explicit lifecycle write)
artifacts/projects.mjs    ← SQLite-Owner für PROJECT/CHECKOUT-Bindungen; Pre-Session-Identity-Gate
cli/anchor.mjs            ← expliziter Anchor-Lifecycle: init/check/rebind/clone/record
core/probes.mjs            ← Probe-Vertrag (P0-Cutover, §16): splitRequirement /
                             parseProbeSet / validateProbeSet / computeVerdict
core/twin.mjs              ← Unabhängige Gegenprüfung (Evil Twin, Regel 6, §15)
                             + Probe-Exekution (runProbeExecution)
core/verdict.mjs            ← Loop-Anker: parseScopeDivergence (Regel 7, §15, UI-107)
core/handoff.mjs           ← Versionierter v1-Handoff (§18): buildHandoff /
                             validateHandoff / renderCoderBrief (pure, fail-closed)
core/changes.mjs           ← Content-Snapshots/Digests (§18): snapshotRoot /
                             compareSnapshots / validateChangeReport (kein mtime)
core/protocols.mjs         ← 10X-Protokoll-Validatoren (§18): A1–A10 / F1–F10
                             (implementiert + getestet, NICHT im Release-Pfad)
artifacts/loops.mjs        ← REINE Loop-Zustandsmaschine (§18): loop_state /
                             legale Übergänge / loop_events (kein jobs.mjs-Import)
artifacts/loopflow.mjs     ← Übergangs-Dienst (§18): advanceLoop(event) — die
                             EINZIGE Runtime↔Loop-State-Kopplung (kein Zyklus)
artifacts/handoff.mjs      ← completeHandoff-Orchestrierung (§18): Child-Jobs
                             NUR via jobs.createJob / Idempotenz (Schema v9)
cli/handoff.mjs            ← falsify handoff brief|complete (§18)
cli/settings.mjs           ← settings show/set + models (siehe §6)
  tui/views/               ← React/Ink Views (NUR Darstellung, stateless)
worker.mjs                 ← PRODUKT: TUI-Host (createTui + Parser-Feed, Phase 2)
cli/run.mjs                ← PRODUKT: FM-EVT:-Marker (Kindprozess des Workers)
core/agent.mjs             ← additiver onTool-Callback (echte Tool-Aktivitaet)
ui/start-dock.cmd          ← sichtbarer Worker-Start (Fenster 1..3)
cli/onboard.mjs            ← Onboarding-Dialog (falsify onboard, siehe §13)
cli/jobs.mjs               ← status/jobs/ping/abort (Wait-Auswertung + CLI-Abbruch)
artifacts/stats.mjs        ← Progression-Statistik (read-only User-Anker aus der Queue)
cli/stats.mjs              ← falsify stats [--json] (Anzeige der Statistik)
cli/onboard/prompts.mjs    ← echter readline-Dialog: ask/askSecret(maskiert)/confirm
cli/onboard/steps.mjs      ← Onboarding-Ablauf (Settings abfragen, Dock-Start)
uninstall.mjs              ← vollständige Deinstallation (Gegenstück zu install.mjs)
```

### START / TEST (Run-Optionen)

```text
START-TUI.cmd              Beobachtungsfenster in eigenem Konsolenfenster:
                           Boot-Intro (immer beim Startup) -> WARTE AUF EINGABE
                           (animiert, fest). KEIN Auto-Job! Jobs kommen von aussen.
START-TUI.cmd --auto       ausdrücklich opt-in: Demo-Timeline mit 5 Jobs auf Slots 1..3
                           (bis zu 3 feste Slots parallel im einen Terminal-pid)
START-TUI.cmd -desktop     nur Desktop-Icons anlegen (opt-in, einmalig)
TEST-TUI.cmd               kompletter Verifikationslauf (105 Tests + Intro + Demo + Kill-Check)
Desktop: FalsifyMe.lnk (Dock) / FalsifyMe-TUI-Test.lnk (Verifikation)
```

**Jobs von ausserhalb (der eigentliche Betrieb):** Das Fenster ist REINE
Beobachtung — es gibt KEINEN User-Input fuer Jobs. Agents/Worker speisen
Events ueber eine stdin-Pipe ein (JSONL, siehe §2/§3):

```bash
# Beispiel: Agent-seitig Events in die TUI pipen
node ui/tui-demo.mjs < jobs.jsonl
# oder laufend:  (jede Zeile = ein FM-EVT-Event, slot 1..3)
node ui/tui-demo.mjs --auto        # ausdrücklich opt-in: Demo ohne externe Quelle
```

Opt-in-Mechanik: Beim ERSTEN `START-TUI.cmd`-Lauf fragt das Fenster nach
Desktop-Icons; die Entscheidung wird in `ui\.tui-desktop-optin` gespeichert
(nie wieder fragen). `-desktop` setzt das ohne Frage um.

## 2. EINZIGE INTEGRATIONS-API (createTui)

```js
// ui/tui.mjs
const ui = await createTui({
  onAbort: async () => { /* Worker: Job-Kind ECHT killen (createAbort, PID-Check) */ },
  onExit:  (code) => { /* Fenster schliesst */ },
  options: {
    seed: 7,
    stdin: process.stdin, // optional: nur echter TTY-Input; nicht für Jobs
  },
});
// Pipeline-Eingänge (pro Stream-Chunk/Zeile vom Kindprozess):
ui.applyEvent(evt);   // normierte Events, siehe §3 (slot/window: 1..3)
ui.noteLine(line);    // rohe Output-Zeile (Ringbuffer, flut-sicher, KEIN Event)
// Abschluss:
ui.finish(code);
// TTY-Modus: options.stdin ist ausschließlich der Input-Stream für Ink-Tasten
// (Q/STRG-C/T), niemals ein Job- oder Steuerkanal. Fehlt options.stdin, nutzt
// createTui process.stdin; bei nicht-raw-mode-fähigem stdin verwendet die TUI
// einen internen TTY-Stummel, damit Pipe-Events die Visualisierung nicht crashen.
// Jobs/Agent-Events kommen ausschließlich über ui.applyEvent() oder parser->applyEvent().
```

- **TTY vorhanden** → Alt-Screen-TUI (Scheduler 15 FPS aktiv / 1 Hz idle).
- **Kein TTY** → gleiche Pipeline, Plain-Branch (Statistik; ideal für Tests/Logs).
- `ui.plain === true` ⇒ Plain-Modus aktiv.

## 3. EVENT-CONTRACT (das ist das ganze Wiring-Wissen)

Marker-Zeilen im Kindprozess-Stream: `FM-EVT: <json>` — werden vom Parser
(`tui/parser.mjs`, ANSI-strip-sicher) zu Events. Alles andere = Roh-Zeilen.

| Event | Bedeutung |
|---|---|
| `{t:"boot"}` | STARTING (Intro) — global, einmal pro TUI-Lauf |
| `{t:"job", id, scope, slot?}` | Job/Scope-IDs (Kurzform 4); belegt Fenster-Slot |
| `{t:"state", s, slot?}` | LOADING·CLAIMING·THINKING·TOOL_ACTIVITY·FINDINGS·VERDICT·SUCCESS·ERROR·TIMEOUT·ABORTING·ABORTED·IDLE |
| `{t:"activity", tool, file, label, slot?}` | echte Tool-/Datei-Aktivitaet (taggt Partikel) |
| `{t:"finding", severity, slot?}` | discovered·warning·critical (Zaehler+Puls) |
| `{t:"phase", phase, progress?, slot?}` | PLAN·RESEARCH·WRITE·VERDICT; progress 0..1 NUR wenn echt |
| `{t:"phase_done", phase, slot?}` | Phase abgeschlossen (✓) |
| `{t:"verdict", v, slot?}` | WRITE·PLAN·RESEARCH·ERROR·TIMEOUT |
| `{t:"files", n, list?, slot?}` | Whitelist-/Datei-Zaehler + echte Dateiliste (max. 20; ohne `list` nur Zaehler) |
| `{t:"done", slot?}` | Job-Ende: WRITE→SUCCESS, sonst IDLE |

**Slot-Routing (3 Fenster-Slots im EINEN Terminal-pid):** Jedes Event darf
`slot` (oder den aelteren Alias `window`) 1..3 tragen → es wirkt auf genau
diesen Slot. Ohne Angabe wirkt es auf den Fokus-Slot (folgt dem neuesten Job).
Ein `job`-Event belegt einen freien Slot (belegten Wunsch-Slot → naechster
freier) und zieht den Fokus auf sich. Fokus wechseln: `{t:"focus", slot:n}`.
`{t:"selftest", status | step | result}` — echter Startup-Selftest (nur TTY-Worker): `step {name, ok, detail}` = Ergebnis EINER echten Pruefung (RUNTIME/DATABASE/CONFIG/API KEY/QUEUE/WORKER/READ-ONLY, ✓/✕ je realem Ausgang), `result pass|fail` = Endzustand (fail haelt den Boot im Fehlerzustand, vgl. ui/README-tui.md „Spec: Boot & Selftest"), `status` = kurzes Label (kompatibel). Kein Job-Event, nur im Boot-Intro sichtbar; keine hardcodierten Erfolgs-Steps; Ergebnis wird zusaetzlich nach `FALSIFY_HOME/logs/selftest.log` geschrieben.
Alle Slots endzustaendig (IDLE/SUCCESS/ERROR/TIMEOUT/ABORTED) ⇒ `globalIdle`
⇒ WARTE-AUF-EINGABE-Screen.

Kein Fake: fehlender `progress` ⇒ indeterminierter Sweep statt Prozent.

> **stdin-JSONL-Feed (Phase-2-Alternative):** Für getrennte Prozesse kann der
> Worker `FM-EVT: {json}`-Zeilen oder reines JSONL an einen TUI-Runner übergeben.
> Der Runner liest zeilenweise, nutzt `createParser` bei `FM-EVT:`-Markern bzw.
> JSON-Parsing beim JSONL-Feed und ruft danach `ui.applyEvent(evt)` auf. Damit
> bleibt der Worker unabhängig vom Ink-Prozess. Die bevorzugte In-Process-
> Verdrahtung ist weiterhin `createTui` + `createParser`; stdin-JSONL ist die
> dokumentierte Alternative, kein zusätzlicher Job- oder User-Input.

## 4. WIRING-PUNKTE PHASE 2 (umgesetzt — Stand siehe ui/PLAN.md BLOCK 6)

| Wo | Was | Stand |
|---|---|---|
| `ui/worker.mjs` | `createTui({onAbort, options: {stdin: process.stdin}})` + `createParser`-Feed aus dem run.mjs-Kind (TTY). Headless (kein TTY): Text-Ausgabe unverändert, kein Marker | DONE (Worker-Loop bleibt; TUI übernimmt nur Anzeige; FALSIFY_UI=1 nur im TTY-Spawn) |
| `cli/run.mjs` | `FM-EVT:`-Marker: job, state (LOADING/THINKING/TOOL_ACTIVITY/FINDINGS/ERROR/TIMEOUT), phase/phase_done (aus Scope-Phase; progress wird nie erfunden), activity (via onTool), finding (nur bei echtem Befund), files (echte Whitelist + Dateiliste), verdict, done | DONE — Marker gated auf `FALSIFY_UI=1`; Ausgabe sonst unverändert |
| `core/agent.mjs` | additiver `onTool`-Callback je echtem Tool-Aufruf (Tool + Datei-Arg) | DONE — ohne Callback keinerlei Verhaltensänderung |
| `onAbort` | Job-Kind (run.mjs) echt killen (`createAbort`, PID-Verifikation via `isDead`); danach `state: ABORTED`; ohne laufenden Job schliesst Q das Fenster (`ui.finish`) | DONE |
| `ui/start-dock.cmd` | sichtbarer Worker-Start: startet `dock-runner.ps1` (Fenster 1..3), Worker rendert die TUI | DONE — neue Datei (fehlte vorher im Repo trotz Verweisen) |

**Bekannte Falle Windows (GELOEST):** `wt.exe` aus einer Agent-/Headless-Session oeffnet KEIN sichtbares Fenster und Git-Bash zerlegt Argumente mit Leerzeichen + konvertiert `/k` zu Pfaden (Fehler 0x80070002 — "new-tab …" wird als Datei gesucht). Anmerkung: auch `cmd.exe /c start …` ist aus Git-Bash unzuverlaessig (MSYS-Mangling: blockiert oder oeffnet kein Fenster). **LOESUNG:** Fenster via PowerShell `Start-Process -WindowStyle Normal` oeffnen — keine Argumentwandlung, Fenster erscheint auf dem User-Desktop, auch aus Agent-Shells. `selbsttest.sh` startet sein sichtbares Testfenster exakt so (Bestanden, 2026-09-01). Empfehlung fuer den Betrieb:

```
Doppelklick:  ui\START-TUI.cmd  |  ui\TEST-TUI.cmd   (oder Desktop-Icons)
Terminal:     node ui/tui-demo.mjs                  (Intro -> WARTE AUF EINGABE)
              node ui/tui-demo.mjs --auto --fast     (sichtbare Demo, opt-in)
              node ui/tui-demo.mjs < jobs.jsonl       (externer JSONL-Feed)
oder:         start "FalsifyMe-TUI" cmd /k node ui\tui-demo.mjs %*
```

`wt new-tab …` funktioniert nur, wenn die aufrufende Konsole Zugriff auf den Desktop hat.

## 5. MODUL-LANDKARTE (alles pure/klein; ohne React-Imports ausser views/)

| Modul | Eine Verantwortung |
|---|---|
| `tui/parser.mjs` | Chunk→Zeilen→Events (`FM-EVT:`), ANSI-Strip |
| `core/tools.mjs` | read-only Tool-Set (list_dir/read_file/glob), Whitelist-Zwang |
| `core/project-context.mjs` | gemeinsame Zielroot-/Allowlist-/Self-Review-Kontext-Policy |
| `core/evidence.mjs` | Challenge-, Research-, Struktur- und allgemeine Evidenz-Gates |
| `core/twin-evidence.mjs` | Twin-Evidenz (Regel 6): objektive Tool-Evidence (host-aufgezeichneter erfolgreicher read_file) trägt die Freigabe; wörtliche Zitat-Verankerung als Qualitäts-Gate für Zitat-Aussagen |
| `core/prompt.mjs` | Prompt-Bau + Loader; System-Prompt-Text als DATEN in `core/prompt-text/*.md` (Root-Cause-Fix: keine Template-Literale für Text) |
| `core/selfreview.mjs` | Self-Review-Scope-Regel: eigenes Checkout erkennen + Kern-Whitelist ergänzen (pure, read-only) |
| `core/verdict.mjs` | Kompatibilitätsfassade für Verdict-/Befund-Parsing und bestehende Gate-Exporte |
| `artifacts/invariants.mjs` | Zustandsmodell-Invariante: checkQueueConsistency (read-only, Regel 3) |
| `core/twin.mjs` | Unabhängige Gegenprüfung (Evil Twin): runTwinCheck/parseTwinVerdict/extractClaims, Fail-closed (Regel 6) |
| `core/probes.mjs` | Probe-Vertrag (P0-Cutover, §16): splitRequirement (H1..Hn, Original-Spans), parseProbeSet, validateProbeSet (nur formal/strukturell), probeEvidenceOk, computeVerdict (deterministisches WRITE/PLAN-Gate) |
| `core/config.mjs` + `artifacts/jobs.mjs` | Audit-Grundlage für nicht-geheime Job-Laufzeit-Snapshots sowie Retry-Metadaten; Snapshot-Verbrauch und vollständige Retry-Orchestrierung sind noch offen (siehe HANDOFF.md) |
| `core/verdict.mjs` | Loop-Anker (Regel 7, UI-107): parseScopeDivergence — Divergenz-Deklaration des Thinkers blockt WRITE (PLAN), `scopes.last_divergence` (Schema v4) |
| `tui/events.mjs` | Event-Contract + einziger State-Writer (`apply`/`tick`), Slot-Routing 1..3, Fokus, Spiegel |
| `tui/state.mjs` | Zustände, erlaubte Übergänge, 3 Fenster-Slots, globalIdle, Labels/Farben |
| `tui/particles.mjs` | fallende Code-Partikel (Feld-Sim, deterministisch) |
| `tui/boot.mjs` | Intro-Timeline (build→condense→live; nur STARTING) |
| `tui/progress.mjs` | Phasen-Modell (determinate nur echt / Sweep) |
| `tui/findings.mjs` | Zähler ●/!/▲ + Puls-Fenster |
| `tui/verdict.mjs` | Verdict-Mapping (✓/!/?/✕ + TIMEOUT) |
| `tui/metrics.mjs` | Zähler, Sparkline, Frame-/RSS-Statistik |
| `tui/wcwidth.mjs` | Breiten + Truncation (CJK-sicher) |
| `tui/ring.mjs` | begrenzter Ringbuffer |
| `tui/scheduler.mjs` | Frame-Takt 15/1 Hz + Flush/Batch |
| `tui/keys.mjs` | Q/q/Strg-C→abort, T/t→toggle (pure Map) |
| `tui/abort.mjs` | Prozess-Kill + PID-Verifikation (idempotent) |
| `tui/resize.mjs` | Dimensions-Poller (Windows-sicher, Spam→1 Call) |
| `tui/terminal.mjs` | Alt-Screen ein/aus + Titel |
| `tui/views/IdleView.mjs` | WARTE-AUF-EINGABE-Screen (animiert, fest, FEN-Status) |
| `tui/views/SlotsView.mjs` | Split-Ansicht: 2..3 Slots als Mini-Fenster im einen pid |
| `tui/views/*` | React/Ink, stateless, rendern nur `snap` |

## 6. INSTALLATION UND FALSIFLOW-SKILLS

`node install.mjs` installiert die Programmdateien benutzerweit nach
`%USERPROFILE%\\.Falsify_Core` bzw. `~/.Falsify_Core`, getrennt von den
privaten Wissensdaten unter `FALSIFY_HOME` (Default `~/.Falsify_Private` =
SQLite, Keys, Logs). Der Installer prüft den globalen
`.agents`-Ordner und legt `skills/falsifyme` dort an; fehlt `.agents`, wird er
angelegt. Zusätzlich installiert er den FalsiFlow-Session-Skill
`falsifyme-falsiflow` unter `.agents/skills/falsifyme-falsiflow/SKILL.md`
und den Self-Install-Skill `falsifyme-selfinstall` unter
`.agents/skills/falsifyme-selfinstall/SKILL.md` (weist den Coding-Agenten
an, sich selbst einen ausführbaren FalsifyMe-Skill einzurichten).
Unter Windows werden zwei Desktop-Icons erzeugt: `FalsifyMe.lnk`
(startet den Worker-Dock, echte Jobs live sichtbar) und `FalsifyMe-TUI-Test.lnk`
(kompletter Verifikationslauf). Option: `node install.mjs --no-desktop`.

Die Skill-Skripte (`skills/agent-skill-falsify.sh/.mjs/.ps1`) lösen ihr
Install-Verzeichnis selbst auf: Repo-Checkout relativ, installierte Kopie
(`~/.agents/skills/falsifyme`) mit Fallback auf `~/.Falsify_Core` — keine
hartkodierten Benutzerpfade. Achtung: das Install-Verzeichnis heißt
`.Falsify_Core` (mit führendem Punkt); ein Pfad ohne Punkt existiert nicht
(`MODULE_NOT_FOUND`).

Der Skill beschreibt den FalsiFlow für die jeweilige Agent-Session: Scope-Start,
unveränderter User-Input als Header, read-only Prüfung, Verdict-Schleife und
Review im selben Scope. Er ersetzt keine Agentensteuerung und verändert keine
fremden Projekte automatisch. Die `.agents`-Installation ist eine Konvention;
der jeweilige Agent muss diesen Skillpfad tatsächlich unterstützen.

## 7. RUNTIME-SETTINGS (Provider/Model/API-Key ohne Codeänderung)

```bash
falsify settings show
falsify settings set provider="Provider-Name" apiBase="https://host/v1" model="model-id"
falsify settings set apiKeyName="PROVIDER_KEY" apiKey="secret"
falsify models
falsify models --api-base "https://host/v1" --api-key "$PROVIDER_KEY"
```

`core/settings.mjs` schreibt nicht ins Repo: Konfiguration liegt in
`FALSIFY_HOME/config.json`, der API-Key in `FALSIFY_HOME/.env` mit privaten
Dateirechten (POSIX 0600; Windows ACLs bleiben dem Benutzerkonto überlassen).
`FALSIFY_HOME`-Default ist `~/.Falsify_Private` (Programm = `.Falsify_Core`);
die Env-Variable `FALSIFY_HOME` bleibt als Override nutzbar.
`settings show` gibt keinen Key aus. `/models` ist provider-neutral und nutzt
den konfigurierten Endpunkt; Pricing wird nur aus Provider-Antwort oder
lokaler Konfiguration übernommen, niemals erfunden. Die bestehende
`core/config.mjs` liest die Werte bei jedem Runtime-Aufruf neu.

## 8. TEST-/VERIFIKATIONS-BEFEHLE (für Agents)

```bash
npm run test:phase2      # FM-EVT-Verdrahtung (Marker-Gate, Parser→UI-State,
                         # Worker-Loop headless)

# Komplette UI-Suite (105 Tests):
node --test --test-force-exit --test-concurrency=1 "ui/tui/*.test.mjs" ui/tui.test.mjs ui/demo-agent.test.mjs

# Headless-Pipeline (alle Szenarien, parallele Slots):
node ui/tui-demo.mjs --plain --fast
# Stress + Abort-Kill-Check unter Last:
node ui/tui-demo.mjs --plain --stress --abort-after=1500 --scenarios=write
# Externer Feed (Agent -> TUI via stdin-JSONL):
node ui/tui-demo.mjs --plain < jobs.jsonl

# Onboarding-Dialog (siehe §13):
node --test tests/onboard.test.mjs   # Dialog: detectInstallation/collectSettings/
                                     # updateRuntimeSettings/Key-Maskierung/Prompter

# Queue-Invarianten (Batch-Refactor 2026-09-01): wait --ping/--abort,
# Heartbeat-Staleness, GAP-Erfassung, WRITE-Challenge, Modus-Kopfzeile
# + die sechs Nutzer-Regeln (Self-Review-Scope, semantische Evidenz,
# Single-Writer, list_dir-Vertrag, strukturelle Kohärenz, Evil-Twin-
# Gegenprüfung):
node --test tests/queue.test.mjs tests/bootstrap.test.mjs tests/feasibility.test.mjs \
       tests/invariants.test.mjs tests/selfreview.test.mjs tests/twin.test.mjs

# Umsetzbarkeits-Puffer (siehe §14):
node --test tests/feasibility.test.mjs  # 7 Tests: leerer Plan / fehlende Whitelist-
                                        # Datei / Zugriffsrahmen-Warning /
                                        # ..-Traversal / Intent-Drift / Header-Passung

# Etage-2-Datenmodell (siehe §15):
node --test tests/datamodel.test.mjs    # Migration, Intake-Felder, atomare
                                        # Claim-Affinität, reapStaleJobs,
                                        # Härtung/open_conflicts/ASK, exitCodeOf

# Evil-Twin-Gegenprüfung (Regel 6, §15):
node --test tests/twin.test.mjs         # extractClaims, parseTwinVerdict (strenge
                                        # Lesart), Kontext-Trennung, Fail-closed,
                                        # evil-twin-Welle in findings.wave

# Prompt-Texte als Daten (Root-Cause-Fix):
node --test tests/prompt.test.mjs       # vier System-Prompts laden + Marker,
                                        # buildUserContent-Diff-Fences, fail-fast

# Progression-Statistik (User-Anker, read-only aus der Queue):
node --test tests/stats.test.mjs        # Gesamtzahlen (jobs/findings/scopes/
                                        # rate_limit), UNBEKANNT aus dem Status,
                                        # Ein-Satz-Anker, READ-ONLY-Beweis

# Dynamische Whitelist-Nachforderung (UI-094, scopes.research_additions):
node --test tests/research-additions.test.mjs  # extractResearchAdditions (Pfad-
                                        # Form + Security-Filter + Cap + Root),
                                        # Persistenz RESEARCH->set/WRITE->null,
                                        # Submit-Merge vor dem --files-Check
```

## 9. OFFENE UND AUFGESCHOBENE TASKS

`ui/PLAN.md` ist die maßgebliche Aufgabenliste. Dokumentiert offen bleiben
`UI-073` (API-Key-Abfrage beim Install/Bootstrap), `UI-119`/`UI-124`
(Brench-Event-Vertrag + Loop-E2E-Sichtbarkeit) sowie die Uninstall-/Doctor-
Härtung (HANDOFF.md). Der Job-Snapshot wird inzwischen konsumiert (Submit
friert ein, Job-Start lädt `configFromSnapshot`); die 10X-Protokoll-Gates
(`core/protocols.mjs`) sind implementiert + getestet,
aber bewusst NICHT im Release-Pfad (Prompt-Vorbedingung — siehe §18 und
`plan/feature-runtime-loop-production-1.md`). Bis UI-073 umgesetzt ist,
bleiben README „API-Key / .env manuell einrichten" und `falsify onboard`
der ehrliche Weg.

Die Projekt-/Checkout-Identität ist in `ui/PLAN.md` als UI-118 dokumentiert.
Sie ergänzt die bestehende Queue lediglich um eine fail-closed Bindung:
`FalsifyME.md` trägt nur Anchor-Metadaten und bestätigte Decision-Records,
SQLite bleibt Owner von Scopes, Findings, Jobs, Verdicts und Laufzeitstatus.
Die externe Brench-UI ist als UI-119 vorgemerkt und darf ausschließlich den
bestehenden Worker-/FM-EVT-Vertrag visualisieren.

Die Phase-2-Integration in Worker/CLI ist umgesetzt und via
`npm run test:phase2` verifiziert (BLOCK 6 in `ui/PLAN.md`); die sichtbare
Selbsttest-Abnahme (UI-053/UI-054) ist abgeschlossen: `npm run selftest`
BESTANDEN (Exit 0, 2026-09-01) — inkl. sichtbarem Fenster via
Start-Process-Loesung (siehe §4). Neue Behauptungen über
die Verdrahtung gehören in `ui/PLAN.md` Block 6 und dürfen nicht nur in
Antworten/Commits leben.

## 10. REGELN (unverhandelbar)

### Pflichtprotokoll nach jeder Arbeit

Jeder Plan, jede Änderung, jeder Bugfix, jedes Refactoring, jedes Feature sowie
jede Dokumentations- und Konfigurationsänderung erhält zwei ausdrücklich
getrennte Nachweise:

- `CHANGE_GATE_10X`: Der Coding-Agent beantwortet A1–A10 mit `JA` und liefert je
  Frage `Proof:` plus `Test:`. Die Fragen prüfen Scope, Architektur,
  Verdict-Hoheit, Falsifikations-Evidenz, Root-/Scope-Bindung, fail-closed
  `WRITE`, Evil-Twin-Isolation, Ausfallverhalten, ausführbaren Testbeleg und
  feindselige Agents.
- `FALSIFICATION_RECORD_10X`: Der unabhängige Reviewer beantwortet F1
  User-Agent-Ausgangsbehauptung, F2 User-Vertrag, F3 Scope-Abgleich, F4 falsifizierbare
  Annahme, F5 Angriff, F6 verifizierte Evidenz, F7 Gegenbeweise, F8 ungeprüften
  Bereich, F9 Rest-Risiko und F10 Release-Entscheidung.

`JA` ohne Beleg ist ungültig. Ein einziges `NEIN`, `UNBEKANNT` oder fehlender
Nachweis bedeutet exakt `BLOCKED – mindestens eine Invariante ist nicht
nachgewiesen.` Diese Nachweise sind Agenten-/Review-Dokumentation, keine neue
Queue und kein zweiter Verdict-Pfad; `WRITE` bleibt bei der bestehenden
Falsifikationspipeline.

- **KERNPRINZIP §0:** Falsifikation der USER-AGENT-Ausgangsbehauptungen; eine Job/Scope-Queue;
  Verdict-Hoheit nur beim Falsifikations-Agent; Wissen lokal für den Nutzer.
  Neue Systeme sind begründungspflichtig — kein zweiter Verteilweg, keine
  zweite Orchestrierungsebene, kein zweiter Status-/Verdict-Pfad.
- **SCOPE:** Phase 1 = nur `ui/` + `package.json` deps. Phase 2 (BLOCK 6,
  abgeschlossen) umfasst `cli/run.mjs` (nur Marker addieren), `ui/worker.mjs`
  (TUI-Host), `ui/start-dock.cmd` (neu) und `core/agent.mjs` (nur additiver
  `onTool`-Callback). Alles andere bleibt unangetastet.
- Phase 1/2 = abgeschlossen; neue Integrations-/Feature-Tasks gehören nach
  `ui/PLAN.md` als neue Tasks (`UI-0xx`, Status TODO, `DEPENDS_ON`, `VERIFY`,
  erst dann DONE).
- Keine Refactors/Reparaturen „nebenbei"; kein Chat-/Steuerungs-UX.
- Abschluss einer Phase ausschliesslich wie in PLAN.md geregelt (`UI BUILD COMPLETE` / `BLOCKED: <ID> <Grund>`).

## 11. BEI KONTEXTVERLUST (Agent-Recovery)

1. Diese Datei lesen (§1, §2, §3) · 2. `ui/PLAN.md` lesen (Status) ·
3. Ersten offenen Task mit erfüllten Dependencies übernehmen ·
4. `VERIFY`-Kommando ausführen · 5. `RESULT` + `STATUS` persistieren.
---

## 12. BOOTSTRAP (modular, revidiert)

Der Bootstrap (`falsify bootstrap` / `node cli/bootstrap.mjs`) ist modular
aufgebaut — Logik in `cli/bootstrap/`, Templates als statische Dateien in
`cli/bootstrap/templates/` (kein String-Escaping im Code, damit solche
Dateien nicht mehr durch Escape-Fehler kaputtgehen koennen).

### Module (1 Datei = 1 Verantwortung)

| Datei | Verantwortung |
|---|---|
| `cli/bootstrap.mjs` | duenner Einstiegspunkt (Flags: `--dry-run`, `--skip-dock`) |
| `cli/bootstrap/detect.mjs` | Agent-Detektion (pure, testbar: env/platform als Parameter) |
| `cli/bootstrap/install.mjs` | ruft das EXISTIERENDE `install.mjs` im **Paket-Root** auf (`packageRoot`); liest `install-location.json`; `installArgs(noDesktop)` — Default: volle Installation inkl. Desktop-Icons, `--no-desktop` nur explizit (Root-Cause-Fix 2026-09-01, UI-077). Bereits installiert (install-location.json vorhanden) → Kopie wird uebersprungen (kein zweiter Verteilweg) |
| `cli/bootstrap/instructions.mjs` | schreibt die persistente Instruction-Datei (Enforcement) |
| `cli/bootstrap/dock.mjs` | sichtbares Dock: Windows-only, Retry-Poll, kein Fake-Erfolg |
| `cli/bootstrap/main.mjs` | Kompositionswurzel (`runBootstrap`) |
| `cli/bootstrap/templates/*.md/.sh/.ps1` | Instruction-Templates mit `{{PLATZHALTERN}}` |

### Modus-Entscheid (UI-075, keine stille Gate-Aktivierung)

Vor dem Schreiben der Instruction-Datei wird Reichweite (`projekt`/`global`/
`aus`) und Betriebsmodus (`PFLICHT`/`optional`) festgelegt: interaktiv ueber
den Prompter (`cli/onboard/prompts.mjs`) oder per Flags `--mode=`/
`--reichweite=`. Default ohne Flag = `optional` + Warnung; PFLICHT entsteht
NIE still. Die Kopfzeile `FALSIFYME-MODUS: <reichweite> · <modus>` wird in
jeder Instruction-Datei dokumentiert (md-Kommentar bzw. #-Kommentar).

### Enforcement (Review-Fehler 2 behoben)

Der Bootstrap schreibt eine REALE, persistente Instruction-Datei je erkanntem
Agenten:

- Codebuff/Freebuff -> `AGENTS.md` im Projekt-Root
- Bash-Agent -> `~/.falsifyme-instructions.sh`
- PowerShell-Agent -> `~/.falsifyme-instructions.ps1`
- Generisch -> `FALSIFYME-WORKFLOW.md` im Projekt-Root

Die Datei enthaelt die REALEN Skill-Pfade (`~/.agents/skills/falsifyme/`,
`~/.agents/skills/falsifyme-falsiflow/SKILL.md` — Review-Fehler 3 behoben)
und das Verdict-Routing (Exit 0=WRITE, 1=PLAN/RESEARCH, 2/3=keine Freigabe).

### Plattform-Ehrlichkeit (Review-Fehler 4 behoben)

Das sichtbare Dock ist Windows-only (`ui/start-dock.cmd` + `dock-runner.ps1`).
Auf Linux/macOS meldet der Bootstrap ehrlich `unsupportedPlatform` und nennt
den headless Worker-Aufruf, statt einen nicht existierenden Fensterstart zu
behaupten. Die RUNNING-Bestaetigung erfolgt per Retry-Poll (30x1s, UI-064-
Muster), nicht per 2s-Einzelcheck.

### Deinstallation (uninstall.mjs, Gegenstück zu install.mjs)

`node uninstall.mjs` wickelt die Benutzerinstallation vollständig ab:
Worker stoppen (PIDs aus `ui/worker.mjs --check`), `~/.Falsify_Core` +
`~/.Falsify_Private` entfernen, `~/.agents/skills/falsifyme*` und
Instruction-Dateien + Profil-Marker entfernen, den markierten
Instruction-Block aus `AGENTS.md`/`FALSIFYME-WORKFLOW.md` des Zielprojekts
(`--project-root` oder aktuelle cwd) und npm-Global-Shims. Der kanonische
Runtime-Home ist `~/.Falsify_Private`; vorhandene alte `~/.Falsify`-Daten sind
Legacy-Drift und werden im aktuellen Uninstall-Audit noch nicht als vollständig
bereinigtes Ziel behauptet (siehe `HANDOFF.md`). Key-Inhalte werden vor der
Entfernung nach `~/.Falsify.env.uninstall-backup` gesichert; `--keep-env` behält
private Laufzeitdaten. Flags: `--dry-run`, `--keep-env`, `--project-root`.
Idempotent; `package.json`: `npm run uninstall:user`. Der Modus-Entscheid
(Reichweite/Betriebsmodus, nur `PFLICHT` = Gate) ist im Skill
`falsifyme-selfinstall` verankert.

### Verifikation

```bash
node --test tests/bootstrap.test.mjs   # detect/install/instructions/dock + Modus-Kopfzeile
node cli/bootstrap.mjs --dry-run --skip-dock   # echter Trockenlauf ohne Installation
node uninstall.mjs --dry-run           # Deinstallations-Trockenlauf
```

## 13. ONBOARDING (falsify onboard, modular)

`falsify onboard` ist der interaktive Ersteinrichtungs-Dialog: FALSIFYME
redet DIREKT mit dem Nutzer (kein stiller Setup-Lauf). Er fragt API-Endpunkt,
Modell, Key-Name und API-Key (maskiert) ab, schreibt die Runtime-Settings
(Keys nur in `FALSIFY_HOME/.env`, 0600), bietet live `/models` an und
startet danach das sichtbare Dock (Windows, TUI).

### Module (1 Datei = 1 Verantwortung)

| Datei | Verantwortung |
|---|---|
| `cli/onboard.mjs` | duenner Einstiegspunkt: Flags `--skip-dock`/`--help`, TTY-Guard (ohne Terminal: klare Fehlermeldung + Agent-Hinweis auf `falsify settings set …`, Exit 2) |
| `cli/onboard/prompts.mjs` | Dialog-Bausteine: `ask` (Default aus Antwort), `askSecret` (jeder Tastendruck = \*), `confirm`, `fakePrompter` für Tests (injizierbar, Default-Verhalten identisch) |
| `cli/onboard/steps.mjs` | `runOnboard` (Kompositionswurzel): `showStatus` → `collectSettings` → `updateRuntimeSettings` → optional `/models` → Dock-Start → `showSummary`; Prompter/Plattform injizierbar |

### Regeln / Verträge

- **Ehrlichkeit:** leerer Key / leere Antwort = „keine Änderung", kein Ratten; der
  Key erscheint NIE im Klartext (weder in Fragen noch in Ausgabe/JSON).

## 14. UMSETZBARKEITS-PUFFER (Intent → Execution, UI-078 revidiert)

FalsifyMe ist der Puffer zwischen dem gesendeten User-Input (= Scope-Header,
der Intent) und der Execution: Bevor irgendein Modell-Call läuft, prüft
`core/feasibility.mjs` deterministisch und read-only, ob die Einreichung
überhaupt umsetzbar ist. REVIDIERT (2026-09-01, Batch-Refactor): Der Check
ERTEILT KEIN Verdict und SCHLIESST KEINEN Job — seine blocks/findings gehen
als KONTEXT an den Thinker (cli/run.mjs sammelt feasibilityNotes in
buildUserContent; der Modell-Call läuft in jedem Fall). Verdict-Hoheit liegt
ausschließlich beim Thinker (Modellpfad). RESEARCH bleibt ein
Falsifikations-Modul der Datenbeschaffung, nie ein Urteil dieses Pre-Checks.

### Prüfungen (1 Datei = 1 Verantwortung, deterministisch)

| Prüfung | Verhalten |
|---|---|
| Plan leer | blockt-Hinweis (immer) |
| Whitelist-Datei existiert nicht unter root | blockt-Hinweis, ohne Verdict-Steuerwort („nicht gegenprüfbar" – E2E-Befund 3) |
| Whitelist `..`-Traversal / absoluter Pfad | blockt-Hinweis (Pfadsicherheit) |
| Plan nennt existierende Datei ausserhalb Whitelist | Warning „Zugriffsrahmen" (Agent darf sie nicht lesen) |
| Plan nennt neue/nicht existierende Datei | Warning „Annahmen prüfen" |
| Kein signifikanter Header-Begriff im Plan (Intent-Drift) | Warning „Plan gegen Auftrag schärfen" |

### Integration + Testfallen (empirisch, 2026-09-01)

- Aufruf: `cli/run.mjs` → `main()` direkt nach `enforceRateLimit`, vor
  `runAgent`. Beobachtbar: `uiEvt(finding, warning)` + Warnungen im Log;
  KEIN Verdict-Event, KEIN Scope-Finding, KEIN jobDone aus feasibility
  (nur cli/run.mjs und der Worker schließen Jobs – §0-Invariante).
- **Testfalle:** `--job-id`-Lauf von Hand liest ohne `--plan-file` stdin und
  wartet auf EOF — immer `< /dev/null` dranhängen (der Worker startet run.mjs
  mit geschlossenem stdin). Schnelle Folgeläufe hängen im bestehenden
  Rate-Limit (40/min) — kein Puffer-Fehler.
- **Agenten ohne Terminal:** `falsify onboard` verweigert ohne TTY ehrlich (Exit 2)
  und verweist auf `falsify settings set …` — kein stilles Hängen.
- **TUI/Dock:** das sichtbare Dock wird NUR auf Windows gestartet und per
  Retry-Poll bestätigt (bootstrap/dock.mjs); auf anderen Plattformen ehrliche
  Meldung. `--skip-dock` unterdrückt den Start.
- **Settings-Zentrale** bleibt `core/settings.mjs` (updateRuntimeSettings/
  getRuntimeSettings) — onboard dupliziert keine Logik.

## 15. ETAGE 2 – DATENMODELL (Vision, UI-090..096)

Scope-Entscheidung 2026-09-01: getrennte Wahrheiten (User-Wunsch vs.
Agent-Verständnis), Wellen-Dimension, Härtung, viertes Verdict ASK.
Schema-Version 3 (Migration in artifacts/db.mjs, ALTER-only):

- `jobs.agent_intent` / `jobs.affected` – Intake-Felder (CLI:
  `--agent-intent`/`--affected`); buildUserContent baut daraus die Sektion
  „Agent-Verständnis" – die Divergenz zum HEADER ist ein eigener Prüfpunkt.
- `jobs.wave` (Default 'scan') / `findings.wave` – Wellen-Verankerung
  (scan|plan|evil|replan); Rollen-Semantik folgt in UI-093 (Evil-Twin).
- `scopes.status` active|hardened|done; `open_conflicts` (PLAN/RESEARCH +1,
  WRITE = 0); `hardened_at`. Regel: gehärtet = letzter Verdict WRITE mit 0
  offenen Konflikten; erneuter PLAN ent-härtet (active, hardened_at null).
- Verdict `ASK` (Aufgaben-Mehrdeutigkeit): Phase + Konflikte bleiben,
  Status active, Exit 5, TUI-Label „TASK AMBIGUOUS". Exit-Codes zentral in
  `core/verdict.mjs exitCodeOf()`: 0 WRITE · 1 PLAN/RESEARCH · 5 ASK ·
  3 kein Verdict/Fehler.
- E2E-Befunde Iteration 5 (job …mx76dg): Worker-Start-Recovery
  (`jobs.reapStaleJobs`, RUNNING-Waisen → ERROR „Worker-Abbruch (Recovery)"),
  Scope-Affinität ATOMAR in der Claim-Transaktion (setWorkerScope im Claim-
  SELECT mit scope_id – ohne scope_id lief der Switch nie), `WORKER_STALE_MS`
  15 s (3× Heartbeat), feasibility-Wording ohne Verdict-Steuerworte. Befund 2
  (syntaktisches Challenge-Gate) → UI-093; Befund 7 (list_dir) → UI-100
  (Regel 4: Namen unsichtbar); Befund 8 (Rate-Limit-Tabelle) widerlegt
  (eigene Tabelle, kein Job-/Scope-Zustand).
- Self-Review-Regel (UI-097, „kein blinder Bereich"): `core/selfreview.mjs`
  erkennt ein eigenes Checkout unter `--root` über die Marker
  artifacts/db.mjs + core/tools.mjs + cli/run.mjs und ergänzt die
  Prüf-Kernkomponenten (SELF_REVIEW_CORE: Queue-Wahrheit, Prüf-Pipeline
  INKL. Evil-Twin-Gate core/twin.mjs und Prompt-Daten
  core/prompt-text/system-*.md, Worker, Vertrags-Doku) automatisch in die
  Whitelist (Union, nur existierende Dateien) – an beiden Stellen (submit +
  Job-Lauf). Fremdprojekte nie erweitert.
- Challenge-Evidenz semantisch (UI-098/UI-102, Regel 2): `hasChallengeEvidence`
  in core/verdict.mjs verlangt je Versuch (MEHRZEILIGES Bündel) eine
  WIDERLEGUNG mit verifizierter Evidenz: REFUTATION-Vokabular (Bestätigungen
  wie „ist korrekt"/„keine Fehler gefunden" zählen nicht, auch nicht mit
  Pfad), Whitelist-Datei, Symbol das real im Code vorkommt (Scan der
  whitelisted Dateien), Datei:Zeile deren Zeile existiert, existierender
  Pfad. Fantasie-Symbole/-Zeilen failen; Whitelist-Token „erbt" eine
  Fantasie-Zeile nicht. Selbst-Review deckt ALLE Einstiege ab (Direkt-Run,
  --job-id, --submit) und die Kernliste enthält selfreview+invariants
  (UI-101).
- Zustandsmodell-Invariante (UI-099/UI-106, Regel 3, ERZWUNGEN):
  `artifacts/invariants.mjs` `checkQueueConsistency` (read-only) prüft
  abgeleitete Zustände gegen ihre Quelldaten — zusätzlich zu hardened/
  Conflicts, GAP/Befund, Orphan-RUNNING, jobs- vs. findings-Verdict jetzt
  auch: hardened-OHNE-Finding, Phase vs. letztes Finding-Verdict, DONE-
  Status vs. jobs.verdict (inkl. UNBEKANNT-Rand, vorher Blindstellen),
  Findings ohne Scope. `enforceQueueConsistency` (wirft) läuft im
  BETRIEBSLOOP: submit (recovery-then-enforce), nach jedem Review-Commit
  (fail-closed Exit 3), nach jedem Worker-Claim (Job wird nicht
  verarbeitet). Die Review-Persistenz in cli/run.mjs ist EINE Transaktion
  (BEGIN IMMEDIATE … COMMIT) – kein Beobachter sieht Zwischenzustände.
  Direkt-Runs (`falsify run --job-id`, Fenster 0) registrieren sich selbst
  als Fenster-0-Worker mit Heartbeat (Orphan-Check + reapStaleJobs decken
  Fenster 0 mit — Asymmetrie-Fix). Der statische Writer-Scan deckt den
  GANZEN Baum, strippt Kommentare/Strings und erkennt auch
  Mitglied-Aufrufe (`jobs.jobDone(...)`) — Selbstzertifizierung im Test.
  `verdictToPhase` liefert für ASK/UNBEKANNT null: nur echte Verdicts
  bewegen die Scope-Phase.
- list_dir-Sichtbarkeit (UI-100, Regel 4): NUR Whitelist-Dateien + deren
  Ordnervorfahren sind sichtbar (minimaler Baum); die Namen nicht
  freigegebener Dateien/Ordner leaken nicht (read_file/glob waren schon
  hart; list_dir zeigte vorher alle Einträge des freigegebenen Ordners).
  Rand: OHNE `--files` (Direkt-Run) ist der ganze Root Zugriffsrahmen
  (kein Whitelist-Vertrag) — die CLI sagt es ehrlich statt still
  auszuweiten (`KEIN --files → ganzer Root ist Zugriffsrahmen`).
- Strukturelle Kohärenz (UI-103, Regel 5): `checkFeasibility` erkennt harte
  strukturelle Widersprüche deterministisch VOR dem Modell: Diff berührt
  Dateien außerhalb der Whitelist („ändert, was es nicht ändern darf") und
  Plan↔Diff-Divergenz (Plan nennt konkrete Whitelist-Dateien, der Diff
  betrifft keine davon). `enforceStructuralCoherence(blocks, verdict)` in
  core/verdict.mjs stuft ein WRITE mit solchen Blocker-Befunden auf PLAN
  runter – ein formales Gate macht eine kaputte Basis NIE grün.
- Loop-Anker (UI-107, Regel 7): beide Agents dividieren ihre Umsetzungsvorschläge — der Thinker liefert sein eigenes `## Umsetzungsverstaendnis (FalsifyMe)` direkt vor den Falsifikationsversuchen und deklariert SCOPE-KONFORM oder SCOPE-DIVERGENZ; deklarierte Divergenz ⇒ WRITE→PLAN (deterministisch) und `scopes.last_divergence` als Präzisierungs-Anker, der im nächsten Lauf sichtbar ist.
- Unabhängige Evidenz (UI-104, Regel 6 – der ARCHITEKTURKERN): FalsifyMe
  prüft nicht, ob ein Agent die Form erfüllt, sondern ob seine Behauptungen
  durch UNABHÄNGIGE Evidenz belastbar sind. `core/twin.mjs` (`runTwinCheck`)
  startet für JEDEN WRITE-Kandidaten (nach Regel-2/5-Gates) eine ZWEITE,
  kontextgetrennte Konversation (Evil Twin): nur header/plan/BEFUND/Claims,
  nie Erst-Reasoning; eigener Twin-System-Prompt (SYSTEM_EVILTWIN_DE/EN,
  core/prompt.mjs); Ausgang BESTAETIGT | WIDERSPRUCH | UNKLAR (parseTwinVerdict,
  strenge Lesart). Fail-closed: WIDERSPRUCH/UNKLAR/Fehler ⇒ PLAN, kein WRITE
  ohne unabhängige Bestätigung. Twin-Finding in findings.wave='evil-twin'
  (Letztes Finding trägt das final geltende Urteil – Invariante 4 hält);
  zweiter Rate-Limit-Verbrauch (enforceRateLimit); TUI-State VERIFYING
  (ui/tui/state.mjs).

Tests: `node --test tests/datamodel.test.mjs` (7 Tests: Migration,
Intake-Persistenz, atomare Claim-Affinität, reapStaleJobs, Härtungs-
Zustandsmaschine, ASK/exitCodeOf, buildUserContent-Intake) +
`node --test tests/selfreview.test.mjs` (4 Tests: Marker-Erkennung, Union/
Existenzfilter, Fremdprojekt, Live-Submit-Smoke) +
`node --test tests/invariants.test.mjs` (4 Tests: statischer Writer-Beweis,
konsistenter Zustand, verletzte Ableitungen, Phase-Stabilität UNBEKANNT).

---

## 16. PROJEKT-/CHECKOUT-IDENTITAET UND `FalsifyME.md` (UI-118, 2026-09-02)

`FalsifyME.md` ist ein physischer Identitaetsanker, keine zweite Queue und kein
Regel-/Verdict-Speicher. Seine einzige autoritaere Datenklasse sind die
stabilen, einmalig geminteten `PROJECT_ID`/`CHECKOUT_ID`, die kanonische
Root-Bindung und Digest-Pruefungen sowie explizit bestaetigte Decision-Records.
Scope-Header, Findings, Jobs, Verdicts, Worker, Retries und dynamischer Verlauf
bleiben ausschliesslich in SQLite (`FALSIFY_HOME/falsify.db`). `AGENTS.md`
bleibt der Workflow-Vertrag fuer den externen USER AGENT; der Anker ersetzt ihn
nicht und fuehrt keine neue Modellrolle oder Schreibinstanz ein.

### Daten- und Schreibgrenzen

- `core/identity.mjs` liest und validiert den Anker; `initAnchor` schreibt nur
  beim expliziten Lifecycle-Start, `appendDecisionRecord` nur nach expliziter
  Bestaetigung und unter einer exklusiven `.lock`-Datei.
- `artifacts/projects.mjs` ist der einzige Owner fuer `projects`/`checkouts`.
  `scopes.checkout_id` und `jobs.checkout_id` sind nur Fremdschluessel; sie
  bleiben in ihren bestehenden Owner-Modulen.
- `requireProjectIdentity` laeuft beim Submit, beim Direktlauf und erneut beim
  gebundenen Joblauf, bevor ein API-Key-/Modellpfad startet. Fehlender,
  kopierter, manipulierter, verschobener oder SQLite-widerspruechlicher Anker
  ist fail-closed.
- `falsify anchor init|check|rebind|clone|record` sind die einzigen expliziten
  Anchor-Lifecycle-Kommandos. `clone` erzeugt bei gleicher PROJECT_ID eine
  neue physische CHECKOUT_ID; ein impliziter Historien-Merge findet nicht statt.
- Decision-Records werden als `UNTRUSTED CONTEXT` in den Thinker-Prompt gegeben.
  Sie koennen weder HEADER, Falsifikationsaufgabe noch Verdict ueberschreiben.

### Verifikation

```bash
node --test tests/identity.test.mjs
node --test tests/foreign-project.test.mjs tests/probe-e2e.test.mjs tests/research-additions.test.mjs tests/selfreview.test.mjs
npm test
```

`tests/identity.test.mjs` beweist Root-/Digest-Tampering, kopierte Anker,
Newline-/Confirmation-Injection, getrennte Checkouts, Parser-Fehler und
Projektkonsistenz. Ein alter, direkt per Modul angelegter Scope/Job darf als
Legacy-`UNBOUND` gelesen werden; neue CLI-Sessions muessen gebunden sein.

---

## 17. P0-CUTOVER – PROBE-BASIERTE WRITE-ENTScheidung (Revision 5, 2026-09-02)

Prosa-Evidenz (`hasChallengeEvidence`, Regel 2 alt) suchte Evidenz im Fließtext –
Form-Slop („widerlegt“ + existierender Pfad ohne inhaltlichen Angriff) passierte
das Gate. Der Cutover ersetzt Prosa-Regex durch ein strukturiertes Protokoll:

| Schicht | Modul | Verantwortung (UNVERHANDLBAR getrennt) |
|---|---|---|
| Thinker | `core/prompt-text/system-*.md` + `core/prompt.mjs` + `cli/run.mjs` | erzeugt das Probe-Set (```json-Fence, `requirement_ref` = Original-H_i-IDs); WRITE-Wort bleibt wirkungslos |
| Validator | `core/probes.mjs validateProbeSet` | NUR formal/strukturell: Schema, requirement_ref ∈ H1..Hn (keine Paraphrase), Coverage (jede H_i ≥ 1 Probe, sonst PLAN), Target in Root+Whitelist, Anti-Vakuum-Minima (claim ≥ 16, check ≥ 24, Lob-Blacklist – Müllfilter, KEIN Qualitätsbeweis), keine Doppel-IDs, Enum |
| Twin | `core/twin.mjs runProbeExecution` | führt JEDE Probe aus (semantische Ausführbarkeit) → ProbeResult[] `{probe_id, status: BESTAETIGT\|WIDERSPRUCH\|UNKLAR, evidence}`; Parse-Fehler/Timeout → alle UNKLAR; fehlende probe_id → diese Probe UNKLAR |
| Gate | `core/probes.mjs computeVerdict` (aufgerufen aus `cli/run.mjs`) | entscheidet NUR aus Resultaten + Evidence (`probeEvidenceOk` = bestehende twinEvidenceOk/twinOwnFalsificationOk-Semantik pro Probe) + bestehenden harten Gates (structural, Divergenz-Anker, Dateien-unverändert) → WRITE/PLAN; Verdict in den bestehenden Review-Commit |

Header-Anker: `splitRequirement` zerlegt den HEADER (User-Input 1:1) deterministisch
an Satz-/Listen-/Zeilen-/Semikolon-Grenzen in H1..Hn (Original-Spans, Tail-Merge-Kappe
12, Mini-Merge, vager Ein-Satz-Header → H1). Keine LLM-Zerlegung, keine H1a/H1b-
Verfeinerung, keine Header-Mindestqualität – der Anker ist nicht intelligent, aber ehrlich.

Härten: `parseVerdict`-WRITE ist nur Kandidat – Release NUR über das voll bestätigte
Probe-Set; `parseProbeSet` fail-closed (kein/kaputter Fence → PLAN); fehlende probe_id
im ProbeResult → PLAN; Twin-Config (twinModel/reasoningEffort) wie bisher weitergegeben.
`core/verdict.mjs` bleibt Probe-frei (keine Müllhalde der Semantik);
`core/twin-evidence.mjs` unverändert. `core/evidence.mjs` (hasChallengeEvidence)
wird vom WRITE-Pfad nicht mehr benutzt, bleibt aber exportiert (andere Konsumenten).

Tests: `node --test tests/probes.test.mjs` (Splitter byte-identisch/IDs=Spans,
Kappe, vager Ein-Satz; Validator-Formen inkl. Coverage-Härte und Target-Härte;
Cutover-Matrix + P7-Attack-Fixtures in `computeVerdict`) + `tests/twin.test.mjs`
(Probe-Fixtures) + `tests/queue.test.mjs` (E2E-Fixtures WRITE/PLAN/vager Header).

## 18. PRODUKTIONS-LOOP (2026-09-03, Schema v9)

Die Loop-Kette `THINKER → EVIL TWIN → GATE → WRITE_AUTHORIZED → externer
Coder → CHANGE_CAPTURED → RE_REVIEW_QUEUED → THINKER` ist ausführbar und
e2e-getestet. Abschluss-Record: `plan/feature-runtime-loop-production-1.md`.

| Modul | Verantwortung (EIN Owner je Wahrheit) |
|---|---|
| `artifacts/loops.mjs` | REINE Loop-Zustandsmaschine: 12 `loop_state`-Werte, legale Übergänge (`applyTransition`/`transitionLoop`), `isTerminal` (SEC-004), append-only `loop_events` (Audit, nie Entscheidungsinstanz). Importiert KEIN jobs.mjs — keine Zustandslogik außerhalb. Schema-DDL gehört db.mjs (kein db↔loops-Zyklus) |
| `artifacts/loopflow.mjs` | ÜBERGANGS-DIENST: `advanceLoop(db, jobId, {event})` — EINZIGE Kopplung Runtime-Ereignis ↔ Loop-Zustand (claim/finalize/error), transaktions-agnostisch (Aufrufer besitzt die Transaktion); `markWriteAuthorized` — Handoff-Emission (handoff_id + WRITE_AUTHORIZED atomar, über die Transitionstabelle, kein Raw-Update). Kausale Zustands-Quellen (2026-09-03): `RE_REVIEW_RUNNING` ← `advanceLoop({event:"claim"})` im EINZIGEN Claim-Owner `claimJob` (`claimNextJob` + `--job-id` rufen beide nur ihn, atomar mit `status=RUNNING`); `DONE` ← `advanceLoop({event:"finalize"})` IN `jobDone` (finaler Job-Zustandsübergang → GENAU EINE Loop-Transition; nur nach persistiertem NICHT-WRITE-Verdict, status=DONE); `ERROR` ← `advanceLoop({event:"error"})` IN `jobDone` (Fehler-Finalisierung) |
| `artifacts/handoff.mjs` | `completeHandoff`-Orchestrierung: transaktionale Completion (Report-/Handoff-/Change-Korrelation, Parent-Übergänge, Idempotenz `(handoff_id, change_digest, scope_id)` IN der Transaktion, Loop-Limit → `LOOP_BLOCKED`), Child-Jobs NUR via `jobs.createJob` (RISK-003). SEC-004: ABORTED/NO_CHANGE/Loop-Limit prüfen zuerst `isTerminal` — kein Überschreiben terminaler Zustände |
| `core/handoff.mjs` | v1-Handoff-Vertrag: `buildHandoff` (nur nach Gate), `validateHandoff` (strikt, SEC-001-Secret-Scan), `renderCoderBrief` (pure Ableitung der Coder-Arbeitsanweisung, fail-closed) |
| `core/changes.mjs` | Gemessene Wahrheit über Repo-Zustände: `snapshotRoot` (Content+Git-HEAD, KEIN mtime), `compareSnapshots`, `validateChangeReport` (Report-Korrelation + Whitelist) |
| `core/protocols.mjs` | Strukturierte A1–A10/F1–F10-Validatoren — bewusst NICHT im Release-Pfad (Prompt-Vorbedingung: die System-Prompts erzeugen noch keine Records; Schaltung = TASK-017-Rest) |
| `cli/handoff.mjs` | `falsify handoff brief --job-id <id>` (Coder konsumiert) + `falsify handoff complete --file report.json --root <dir>` (Completion → automatisches Re-Review) |
| `cli/run.mjs` | Submit/Direkt-Run: `header_digest` + Basis-`change_digest` eingefroren; WRITE-Pfad: Handoff nur nach `computeVerdict`, Evidence-Prüfung pro Probe im Handoff reproduziert |

Korrelationspflicht des Childs: `parent_job_id`, `handoff_id`, `iteration_id`,
`change_digest`, `header_digest`, `review_iteration`, `loop_count` — alle
gesetzt in `completeHandoff`, bewiesen in `tests/full-loop-e2e.test.mjs`.
Fail-closed-Pfade (alle getestet in `tests/full-loop-negative.test.mjs`):
NO_CHANGE → `LOOP_BLOCKED`; Loop-Limit → `LOOP_BLOCKED`; ABORTED → terminal;
unautorisierte/fremde/ungültige Reports → Exit 3 ohne Child; Header-Drift →
Job-Abweisung ohne Modell-Call. Idempotenz: 100 identische Reports → 1 Child
(`tests/loop.test.mjs`). TUI spiegelt Zustände nur (`loop`-Event, UI-123,
CON-004: kein UI-eigener Zustand).
