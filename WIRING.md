# FALSIFYME — WIRING INDEX (für LLM-Agents & Entwickler)

Schnellster Einstieg, um die Terminal-UI (Phase 1 implementiert) mit dem
Produktpfad (Worker/CLI) zu verdrahten — die nächste Phase. Offene manuelle
Checkpoints und aufgeschobene Integrationsaufgaben stehen verbindlich in
`ui/PLAN.md`.

> **Regel:** Index lesen → `ui/PLAN.md` (Fortschritt/Status) → relevante Modul-
> Dateien lesen → implementieren. NICHT raten, NICHT aus Erinnerung rekonstruieren.

---

## 1. SO IST DIE LANDKARTE (30 Sekunden)

```
ui/                        ← NEUE Terminal-UI (Phase 1 abgeschlossen)
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
cli/settings.mjs           ← settings show/set + models (siehe §6)
  tui/views/               ← React/Ink Views (NUR Darstellung, stateless)
worker.mjs                 ← PRODUKT: NICHT angefasst (Integration = Phase 2)
cli/run.mjs                ← PRODUKT: NICHT angefasst (Kindprozess des Workers)
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
Desktop: FalsifyMe-TUI-Start.lnk / FalsifyMe-TUI-Test.lnk  (sobald opt-in erteilt)
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
  onAbort: async () => { /* Phase 2: Job-/Agent-Prozess ECHT killen */ },
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
| `{t:"files", n, slot?}` | Whitelist-/Datei-Zaehler |
| `{t:"done", slot?}` | Job-Ende: WRITE→SUCCESS, sonst IDLE |

**Slot-Routing (3 Fenster-Slots im EINEN Terminal-pid):** Jedes Event darf
`slot` (oder den aelteren Alias `window`) 1..3 tragen → es wirkt auf genau
diesen Slot. Ohne Angabe wirkt es auf den Fokus-Slot (folgt dem neuesten Job).
Ein `job`-Event belegt einen freien Slot (belegten Wunsch-Slot → naechster
freier) und zieht den Fokus auf sich. Fokus wechseln: `{t:"focus", slot:n}`.
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

## 4. WIRING-PUNKTE FÜR PHASE 2 (nächste Phase, Produktpfad)

| Wo | Was | Vorsicht |
|---|---|---|
| `ui/worker.mjs` | Primär: `createTui({onAbort, options: {stdin: process.stdin}})` + direkter `createParser({onEvent: ui.applyEvent, onLine: ui.noteLine})`-Feed aus dem Worker-Stream. Alternative für getrennte Prozesse: stdin-JSONL-Feed an `tui-demo.mjs`/einen TUI-Runner | Worker-Fenster-Schleife (Claim-Loop) bleibt; TUI-Fenster übernimmt nur Anzeige |
| `cli/run.mjs` | optional `FM-EVT:`-Marker an den relevanten Stellen ausgeben (Job, Scope, Phase, Finding, Verdict, Zustände) — oder Events aus vorhandenen Prints ableiten | NUR Marker ADDIEREN, Ausgabe sonst unveraendert (Worker/CLI-Output bleibt kompatibel) |
| `onAbort` | Job-Kind (run.mjs) echt killen + auf `close` warten; danach `ui.applyEvent({t:"state",s:"ABORTED"})` | Keine UI-Fake-Beendigung; PID-Verifikation via `tui/abort.mjs` (`isDead`) |
| `tui/terminal.mjs` | enter/exit Alt-Screen beim Worker-Start/Ende | Ink übernimmt Mode 2026 + Cursor bereits selbst |
| `ui/start-dock.cmd` (etc.) | Fenster starten die TUI statt Textausgabe; bei separatem Prozess stdin-JSONL an den TUI-Runner pipen | Kein `-NoExit`-Quoting-Bruch (siehe bekannte wt.exe-Falle unten); START/TEST-Icons via `tui-make-icons.ps1` |

**Bekannte Falle Windows:** `wt.exe` aus einer Agent-/Headless-Session oeffnet KEIN sichtbares Fenster und Git-Bash zerlegt Argumente mit Leerzeichen + konvertiert `/k` zu Pfaden (Fehler 0x80070002 — "new-tab …" wird als Datei gesucht). Deshalb: **Fenster immer aus einer User-Konsole starten** — nie aus einer Agent-Shell:

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
`%USERPROFILE%\\.Falsify_Core` bzw. `~/.Falsify_Core`, getrennt von privaten
Laufzeitdaten unter `.Falsify_Private`. Der Installer prüft den globalen
`.agents`-Ordner und legt `skills/falsifyme` dort an; fehlt `.agents`, wird er
angelegt. Unter Windows wird nach der Installation ein Desktop-Icon erzeugt.
Option: `node install.mjs --no-desktop`.

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
`settings show` gibt keinen Key aus. `/models` ist provider-neutral und nutzt
den konfigurierten Endpunkt; Pricing wird nur aus Provider-Antwort oder
lokaler Konfiguration übernommen, niemals erfunden. Die bestehende
`core/config.mjs` liest die Werte bei jedem Runtime-Aufruf neu.

## 8. TEST-/VERIFIKATIONS-BEFEHLE (für Agents)

```bash
# Komplette UI-Suite (105 Tests):
node --test --test-force-exit --test-concurrency=1 "ui/tui/*.test.mjs" ui/tui.test.mjs ui/demo-agent.test.mjs

# Headless-Pipeline (alle Szenarien, parallele Slots):
node ui/tui-demo.mjs --plain --fast
# Stress + Abort-Kill-Check unter Last:
node ui/tui-demo.mjs --plain --stress --abort-after=1500 --scenarios=write
# Externer Feed (Agent -> TUI via stdin-JSONL):
node ui/tui-demo.mjs --plain < jobs.jsonl
```

## 9. OFFENE UND AUFGESCHOBENE TASKS

`ui/PLAN.md` ist die maßgebliche Aufgabenliste. Aktuell offen sind nur die
manuellen User-Checkpoints `UI-030`, `UI-034`, `UI-035` und `UI-038` sowie der
Abschluss-Task `UI-040`. Sie dürfen nicht als abgeschlossen behauptet werden,
solange der User die sichtbare Prüfung nicht bestätigt hat.

Die echte Phase-2-Integration in Worker/CLI ist bewusst aufgeschoben. Sie ist
kein Bestandteil der abgeschlossenen UI-Phase und darf nicht durch Doku oder
Demo-Befehle als bereits verdrahtet dargestellt werden.

## 10. REGELN (unverhandelbar)

- **NUR UI-Scope anfassen:** neue Dateien unter `ui/`; einzige bestehende
  Aenderung bisher: `package.json` deps (`ink`, `react`).
- Phase 1 = abgeschlossen; Integrationstasks gehören nach `ui/PLAN.md`
  als neue Tasks (`UI-0xx`, Status TODO, `DEPENDS_ON`, `VERIFY`, erst dann DONE).
- Keine Refactors/Reparaturen „nebenbei"; kein Chat-/Steuerungs-UX.
- Abschluss einer Phase ausschliesslich wie in PLAN.md geregelt (`UI BUILD COMPLETE` / `BLOCKED: <ID> <Grund>`).

## 11. BEI KONTEXTVERLUST (Agent-Recovery)

1. Diese Datei lesen (§1, §2, §3) · 2. `ui/PLAN.md` lesen (Status) ·
3. Ersten offenen Task mit erfüllten Dependencies übernehmen ·
4. `VERIFY`-Kommando ausführen · 5. `RESULT` + `STATUS` persistieren.