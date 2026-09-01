# FALSIFYME — WIRING INDEX (für LLM-Agents & Entwickler)

Schnellster Einstieg in die Terminal-UI (Phase 1 implementiert, Phase 2
verdrahtet: `cli/run.mjs`-Marker + Worker-TUI). Offene manuelle Checkpoints
und neue Integrationsaufgaben stehen verbindlich in `ui/PLAN.md`.

> **Regel:** Index lesen → `ui/PLAN.md` (Fortschritt/Status) → relevante Modul-
> Dateien lesen → implementieren. NICHT raten, NICHT aus Erinnerung rekonstruieren.

---

## 0. KERNPRINZIP (unverhandelbar)

Die Kernfunktion ist die **FALSIFIKATION der Coder-Annahmen** – eine kritische
Peer-Review durch einen unabhängigen Betrachter: Coder und FalsifyMe pruefen
UNABHAENGIG voneinander dieselben Daten; FalsifyMe versucht, die Annahmen des
Coders zu WIDERLEGEN. Die Divergenz der beiden abschliessenden Urteile ist der
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
cli/settings.mjs           ← settings show/set + models (siehe §6)
  tui/views/               ← React/Ink Views (NUR Darstellung, stateless)
worker.mjs                 ← PRODUKT: TUI-Host (createTui + Parser-Feed, Phase 2)
cli/run.mjs                ← PRODUKT: FM-EVT:-Marker (Kindprozess des Workers)
core/agent.mjs             ← additiver onTool-Callback (echte Tool-Aktivitaet)
ui/start-dock.cmd          ← sichtbarer Worker-Start (Fenster 1..3)
cli/onboard.mjs            ← Onboarding-Dialog (falsify onboard, siehe §13)
cli/jobs.mjs               ← status/jobs/ping/abort (Wait-Auswertung + CLI-Abbruch)
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
| `core/prompt.mjs` | System-/User-Prompt-Bau, HEADER-/Artefakt-Einspielung (pure) |
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
# Heartbeat-Staleness, GAP-Erfassung, WRITE-Challenge, Modus-Kopfzeile:
node --test tests/queue.test.mjs tests/bootstrap.test.mjs tests/feasibility.test.mjs

# Umsetzbarkeits-Puffer (siehe §14):
node --test tests/feasibility.test.mjs  # 7 Tests: leerer Plan / fehlende Whitelist-
                                        # Datei (RESEARCH) / Zugriffsrahmen-Warning /
                                        # ..-Traversal / Intent-Drift / Header-Passung
```

## 9. OFFENE UND AUFGESCHOBENE TASKS

`ui/PLAN.md` ist die maßgebliche Aufgabenliste. Aktuell offen ist nur
`UI-073` (API-Key-Abfrage beim Install/Bootstrap; bis dahin: README
„API-Key / .env manuell einrichten" + `falsify onboard`). Alle anderen
Tasks sind DONE (Stand 2026-09-01, Batch-Refactor).

Die Phase-2-Integration in Worker/CLI ist umgesetzt und via
`npm run test:phase2` verifiziert (BLOCK 6 in `ui/PLAN.md`); die sichtbare
Selbsttest-Abnahme (UI-053/UI-054) ist abgeschlossen: `npm run selftest`
BESTANDEN (Exit 0, 2026-09-01) — inkl. sichtbarem Fenster via
Start-Process-Loesung (siehe §4). Neue Behauptungen über
die Verdrahtung gehören in `ui/PLAN.md` Block 6 und dürfen nicht nur in
Antworten/Commits leben.

## 10. REGELN (unverhandelbar)

- **KERNPRINZIP §0:** Falsifikation der Coder-Annahmen; eine Job/Scope-Queue;
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
(`--project-root` oder aktuelle cwd), `~/.Falsify` (FALSIFY_HOME: Key-Inhalt
vorher nach `~/.Falsify.env.uninstall-backup` gesichert; `--keep-env` behält
alles) und npm-Global-Shims. Flags: `--dry-run`, `--keep-env`, `--project-root`.
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

## 14. UMSETZBARKEITS-PUFFER (Intent → Execution, UI-078)

FalsifyMe ist der Puffer zwischen dem gesendeten User-Input (= Scope-Header,
der Intent) und der Execution: Bevor irgendein Modell-Call läuft, prüft
`core/feasibility.mjs` deterministisch und read-only, ob die Einreichung
überhaupt umsetzbar ist. Bei `feasible=false` endet der Job SOFORT mit
`VERDICT: PLAN` (Plan adressiert den Intent nicht) oder `RESEARCH` (Dateien/
Whitelist fehlen) und Exit 1 — ohne API-Kosten, ohne ins Projekt zu schreiben.
Bei `feasible=true` bleibt der Lauf unverändert (additiv, kein System-Eingriff).

### Prüfungen (1 Datei = 1 Verantwortung, deterministisch)

| Prüfung | Verhalten |
|---|---|
| Plan leer | blockt (immer) |
| Whitelist-Datei existiert nicht unter root | blockt → RESEARCH (FalsifyMe braucht echte Dateien) |
| Whitelist `..`-Traversal / absoluter Pfad | blockt (Pfadsicherheit) |
| Plan nennt existierende Datei ausserhalb Whitelist | Warning „Zugriffsrahmen" (Agent darf sie nicht lesen) |
| Plan nennt neue/nicht existierende Datei | Warning „Annahmen prüfen" |
| Kein signifikanter Header-Begriff im Plan (Intent-Drift) | Warning „Plan gegen Auftrag schärfen" |

### Integration + Testfallen (empirisch, 2026-09-01)

- Aufruf: `cli/run.mjs` → `main()` direkt nach `enforceRateLimit`, vor `runAgent`.
  UI-Events (FINDINGS/verdict/done), Scope-Finding + `jobDone` werden wie bei
  einem normalen Verdict gesetzt — das Dock zeigt den Abbruch ehrlich an.
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
