# FalsifyMe 2.0 — Terminal-UI (ui/) — PHASE 1 + 2 (live verdrahtet)

**Version v0.05 Beta** (`0.5.0-beta` im `package.json`; Produkt-Runtime bleibt
Read-only-Gateway, Business-Logik unverändert).

**Dokumentationsstand:** Phase 1 (visuelle Implementierung) abgeschlossen,
Phase 2 (Worker/CLI-Verdrahtung via FM-EVT) umgesetzt — siehe `ui/PLAN.md`
BLOCK 6. Visuelle User-Checkpoints (UI-030/034/035/038) und die sichtbare
Selbsttest-Abnahme (UI-053/054) sind abgenommen und dokumentiert
(2026-09-01); ehrlich offen bleiben nur die ausdruecklich als User-Check
markierten Punkte im PLAN.

Die neue **visuelle Worker-Ansicht** („Visible Worker Window"): Der Benutzer
schaut der Maschine bei der Arbeit zu. Das Fenster ist **reine Beobachtung** —
einen User-Input für Jobs gibt es nicht. Jobs kommen von ausserhalb
(Agents/Worker speisen Events ein) und werden als bis zu **3 Fenster-Slots
(FEN 1..3) im EINEN Terminal-Prozess (pid)** visualisiert. Kein Chat, keine
Agentensteuerung.

> **Phase-1-Scope** war NUR `ui/` + `package.json` (deps `ink`, `react`).
> **Phase 2 (umgesetzt)** hat additiv verdrahtet: `ui/worker.mjs` (TUI-Host),
> `cli/run.mjs` (nur FM-EVT:-Marker, gated auf FALSIFY_UI=1 — Ausgabe sonst
> unverändert), `core/agent.mjs` (nur additiver onTool-Callback),
> `ui/start-dock.cmd` (neu). Kein Refactor von Produktlogik.

## §1 Start und Betriebsmodi

### Normaler Start: WARTE AUF EINGABE

`ui\START-TUI.cmd` startet **keinen Job und keine Demo**. Beim Start läuft
immer zuerst das Boot-Intro. Danach zeigt das feste Terminal-Fenster eindeutig:

```text
WARTE AUF EINGABE
```

Die Anzeige besitzt keinen eigenen Job-Input. Sie wartet ausschließlich auf
externe Events von Agents oder Worker-Prozessen. Es werden keine beliebigen
neuen Fenster geöffnet; alles bleibt im selben Terminal-Prozess/PID.

```text
Doppelklick:  ui\START-TUI.cmd   Intro -> WARTE AUF EINGABE
              ui\TEST-TUI.cmd    Testsequenz inklusive Intro
Desktop:      FalsifyMe.lnk (Dock) / FalsifyMe-TUI-Test.lnk (Verifikation)
```

### Opt-in-Demo: `--auto`

Nur mit dem expliziten Flag `--auto` startet die Demo-Timeline. Das ist kein
normaler Produktions- oder Wartezustand:

```text
START-TUI.cmd --auto              5 Demo-Jobs auf den festen Slots 1..3
node ui/tui-demo.mjs            Intro -> WARTE AUF EINGABE (Standard)
node ui/tui-demo.mjs --auto       gleiche Demo im Terminal (opt-in)
node ui/tui-demo.mjs --auto --fast --stress
```

### Externer Agent-/Worker-Feeder

Im echten Beobachtungsbetrieb kommen Jobs ausschließlich von außen. Die TUI
liest JSONL-Events; jede Zeile ist ein Event, optional mit `slot` oder `window`
im Bereich `1..3`. Der stdin-JSONL-Feed ist eine dokumentierte Alternative zur
direkten In-Process-Verdrahtung über `createTui` + `createParser` (die der
Worker im Dock nutzt):

```bash
node ui/tui-demo.mjs < jobs.jsonl
# {"t":"job","id":"job-1234","scope":"scope-31a7","slot":1}
# {"t":"state","s":"THINKING","slot":1}
# {"t":"verdict","v":"WRITE","slot":1}
# {"t":"done","slot":1}
```

> **Agent-Einstieg:** `WIRING.md` (Projektroot) = zentraler Index fuer LLM-Agents
> (Integration-API, Event-Contract inkl. Slot-Routing, stdin-Feed, Wiring-Punkte
> Phase 2, Modul-Landkarte).

### §2 `createTui({ options })` und `stdin`

`options.stdin` ist optional und ausschließlich der Tastatur-Stream für Ink
(`Q`/`STRG-C`/`T`). Er ist **kein** Job-Eingang und enthält keine
Agentensteuerung. Fehlt er, verwendet `createTui()` den Prozess-stdin. Jobs
werden ausschließlich über `ui.applyEvent()` bzw. den Parser-Feed eingespeist.
Bei Pipe-/Headless-Streams ohne Raw-Mode nutzt die TUI intern einen sicheren
TTY-Stummel, damit die Anzeige weiterlaufen kann.

```js
const ui = await createTui({
  onAbort,
  onExit,
  options: { seed: 7, stdin: process.stdin },
});
```

Headless-/Verifikationsläufe (kein TTY nötig):

```bash
node ui/tui-demo.mjs --plain --fast                      # alle Szenarien
node ui/tui-demo.mjs --plain --stress --abort-after=1500 --scenarios=write
node ui/tui-demo.mjs --plain < jobs.jsonl                # Feed-Test
```

Tests:

```bash
node --test --test-force-exit --test-concurrency=1 "ui/tui/*.test.mjs" ui/tui.test.mjs ui/demo-agent.test.mjs
```

## Tasten (einzige Interaktion)

| Taste | Wirkung |
|---|---|
| `Q` / `q` / `STRG-C` | laufen Jobs → **ABORT ALLE Slots** (echtes Kill + PID-Verifikation → WARTE-Screen mit FEN-Status GESTOPPT); sonst (WARTE/fertig) → Fenster schliessen |
| `T` / `t` | THINKING (Partikel-Animation) ↔ REASONING (strukturierter Status); aktiver Modus ist im Footer als hervorgehobene **Toggle-Bar** sichtbar (`THINKING|REASONING`, aktives Segment cyan+fett). Wirkt nur waehrend eines laufenden Jobs |

## Ablauf

1. **Machine-Boot-Intro** (global, immer beim Startup, einmal pro Lauf): Wordmark baut sich auf
   (`░ → ░ █ ░ → ░ ███ █ ░`), dann nahtloser Handoff.
2. **WARTE AUF EINGABE** (kein Job aktiv / keine externen Agent-Events): fester, animierter Warte-Screen
   (Atemwelle) mit FEN 1..3 Status (BEREIT / COMPLETE / ERROR / TIMEOUT /
   GESTOPPT, farbig) — ehrlich: pulsierende Welle, aber keine Fake-Aktivität.
3. **Jobs von aussen** belegen freie Slots (max. 3, Fokus folgt dem neuesten
   Job): **1 Job** = volle Ansicht (Partikel-Animation oder REASONING-Checkliste,
   Progress-Bar determinate NUR aus echten Werten, Findings ●/!/▲ mit Puls,
   Verdict-Box ✓ WRITE / ! PLAN / ? RESEARCH / ✕ ERROR/TIMEOUT),
   REASONING-Ansicht mit **SCAN-N-Zeile** der echten gescannten Dateien
   (aus `files`-Event, max. 20), Footer mit echten Fakten + Metriken
   inkl. sichtbarer THINKING/REASONING-Toggle-Bar). **2–3 Jobs** = Split-Ansicht: jedes Fenster wird
   ein Mini-Fenster (eingerahmt: FEN-Kopf, Phasen, Findings, Verdict,
   Mini-Partikelfeld) — alles im einen Terminal-pid.
4. **Abort** beendet alle laufenden Kindprozesse echt (SIGTERM→SIGKILL,
   Windows TerminateProcess) und verifiziert per PID-Check — keine
   Fake-Beendigung.

## Architektur (Pipeline + strikte Modularitaet)

```
PROCESS (cli/run.mjs o. demo-agent.mjs o. externer Agent-Pipe)
  → STREAM  (tui/parser.mjs: Chunk→Zeilen, ANSI-Strip, `FM-EVT:`-Marker)
  → EVENTS  (tui/events.mjs: einziger State-Writer apply/tick; Slot-Routing 1..3)
  → STATE   (tui/state.mjs: 3 Slots + Fokus + Spiegel + globalIdle)
  → RENDER  (Scheduler 15 FPS aktiv / 6 FPS Warte / 1 Hz statisch → Views → Ink)
```

- **React/Ink** (Views in `tui/views/`) sind AUSSCHLIESSLICH Darstellung —
  stateless, rendern nur den Snapshot.
- Parser, State, Partikel, Progress, Findings, Verdict, Boot, Metrics, Keys,
  Abort, Resize, Scheduler = je eigene kleine Module (1 Modul = 1 Verantwortung).
- Ringbuffer statt Endlos-Speicher (Lehre aus Claude-Code-Bug #10881);
  Output-Flut komprimiert sich zu Zaehlern + Sparkline.
- Resize: eigenes Dimensions-Polling (Windows-sicher), Spam koalesziert.
- Pro Slot ein eigenes Partikelfeld: parallele Fenster animieren unabhaengig.
- `FM-EVT: {json}` — nur diese Marker-Zeilen werden als Events interpretiert;
  alle anderen Zeilen landen (begrenzt) im Output-Ring des Slots.

## Event-Contract (fuer die spaetere Integration)

### §3 Slot-Routing (maximal drei feste Slots)

Jedes Job-, Status-, Aktivitäts-, Finding-, Phasen-, Verdict-, Output- und
Datei-Event kann ein `slot`- oder `window`-Feld mit dem Wert `1`, `2` oder `3`
tragen. Das Event wird dann ausschließlich dem entsprechenden festen Slot
zugeordnet. Fehlt `slot`/`window`, wirkt das Event auf den aktuellen
Fokus-Slot. Es werden niemals beliebige neue Fenster geöffnet: Es existieren
maximal drei feste Slots innerhalb desselben Terminal-Fensters und desselben
Prozesses (PID).


```js
{ t: "boot" }                                    // STARTING (Intro, global)
{ t: "job", id, scope, slot? }                   // belegt Fenster-Slot 1..3
{ t: "state", s, slot? }                         // LOADING|CLAIMING|THINKING|
                                                 // TOOL_ACTIVITY|FINDINGS|VERDICT|
                                                 // SUCCESS|ERROR|TIMEOUT|ABORTING|
                                                 // ABORTED|IDLE
{ t: "activity", tool, file, label, slot? }      // echte Tool-/Datei-Aktivitaet
{ t: "finding", severity, slot? }                // discovered|warning|critical
{ t: "phase", phase, progress?, slot? }          // PLAN|RESEARCH|WRITE|VERDICT
{ t: "phase_done", phase, slot? }
{ t: "verdict", v, slot? }                       // WRITE|PLAN|RESEARCH|ERROR|TIMEOUT
{ t: "output", line, slot? }                     // nur begrenzt genutzt
{ t: "files", n, list?, slot? }             // n = Anzahl, list = echte Scan-Dateien
                                            //   (max. 20 im State, ohne list nur Zaehler)
{ t: "done", slot? }                             // Jobende (WRITE→SUCCESS, sonst IDLE)
{ t: "focus", slot }                             // Fokus-Slot wechseln (1..3)
```

Slot-Regeln: `slot` (oder `window`) 1..3 lenkt das Event auf genau diesen
Slot; ohne Angabe wirkt es auf den Fokus-Slot. Ein neuer `job` belegt einen
freien Slot und zieht den Fokus auf sich. Alle Slots endzustaendig ⇒
WARTE-AUF-EINGABE-Screen.

Nur echte Events → Zustand; nichts wird erfunden. `Q`-Abort ruft den von der
Kompositions-Wurzel bereitgestellten `onAbort`-Callback (dort killt die
Integration die echten Agentenprozesse).

## 5. Modul-Landkarte

Die Darstellung und Slot-Verwaltung sind explizit getrennt:

| Modul | Verantwortung |
|---|---|
| `tui/state.mjs` | Zustände, feste Slots 1..3, Fokus-Slot, `globalIdle`, Slot-Daten |
| `tui/events.mjs` | Event-Contract, `slot`/`window`-Routing, einziger State-Writer |
| `tui/views/IdleView.mjs` | Fester animierter `WARTE AUF EINGABE`-Screen bei `globalIdle` |
| `tui/views/SlotsView.mjs` | Darstellung von 2–3 aktiven Slots als feste Mini-Fenster im selben Terminal |
| `tui/views/App.mjs` | Deterministisches Routing: IdleView, SlotsView oder Einzelansicht |
| `tui.mjs` | Ein Terminal-Renderer, ein Prozess/PID, Snapshot-Erzeugung und Scheduler |

Siehe `PLAN.md` (persistente Task-Chain, Single Source of Truth). Stand:
Implementierung + headless Verifikation abgeschlossen (105/105 Tests; Block 4b
Beobachtungsmodell: WARTE-Screen, 3 Slots, Feeder, Split-Ansicht).

## Design-Check (10-Sekunden-Test, UI-038)

Live-Fenster 10 s anschauen, **ohne Text zu lesen**:

- [TECHNISCH PASS] Ohne Jobs wird `globalIdle` gerendert: `WARTE AUF EINGABE` + Atemwelle + FEN-Status.
- [TECHNISCH PASS] Aktive Jobs nutzen Partikel und den farbigen Status-Punkt; stale Aktivität wird nicht künstlich animiert.
- [TECHNISCH PASS] 2–3 aktive Jobs werden als feste Slots im selben Terminal-PID gesplittet.
- [TECHNISCH PASS] Findings werden als Zähler (`●`/`!`/`▲`) mit zeitbegrenztem Puls dargestellt.
- [TECHNISCH PASS] Verdicts werden in einer eindeutigen Box mit Symbol/Farbe/Puls dargestellt.
- [TECHNISCH PASS] Footer zeigt `Q`/`STRG-C` als Abort-/Schließen-Hinweis.
- [TECHNISCH PASS] COMPLETE/ERROR/TIMEOUT/GESTOPPT sind als Endzustände getrennt sichtbar.
- [STATUS 2026-09-01] User-Feedback umgesetzt (UI-061): Welle mit Farbverlauf, prominente Rahmen-Box um WARTE AUF EINGABE, Block „LETZTE AKTIVITÄT“ aus echten Slot-Abschlüssen; T wirkt nur bei aktivem Job (Hinweis in der Idle-Ansicht). Die 10-Sekunden-Endabnahme bleibt eine User-Sichtprüfung. Resize-Grenze (UI-035/062): In klassischen cmd-Konsolen feuert das resize-Event nicht zuverlässig (node#13197) — Windows Terminal / PowerShell-Konsole nutzen; `process.stdout.getWindowSize()` liefert dort die Puffer- statt Fenstergröße und darf nicht übernommen werden (verursachte dauerhaftes „TERMINAL ZU KLEIN“).

Wenn der manuelle Check eine Schwäche zeigt: Layout vereinfachen — nicht mehr
Elemente hinzufügen.

## Spec: Boot & Selftest (vorher „Spec §5/§6" — jetzt im Repo)

Dieser Abschnitt ersetzt die frueheren externen Spec-Verweise („Spec §5/§6",
„Spec §6.6") und ist der verbindliche Vertrag fuer Boot-Intro und
Startup-Selftest:

- **Boot-Wort (Spec §5):** Das Intro baut visuell `F A L S I F Y _ M E`
  (mit Unterstrich, gespaced) auf — `boot.mjs` `WORD = "FALSIFY_ME"`.
- **Selftest (Spec §6):** Der Worker emit-t beim Startup echte Pruefungen als
  `{t:"selftest", step:{name,ok,detail}}` in dieser Reihenfolge: RUNTIME →
  DATABASE → CONFIG → API KEY → QUEUE → WORKER → READ-ONLY. Jeder Schritt ist
  das Ergebnis EINER echten Pruefung (kein Fake, kein Timer); `API KEY` darf
  ehrlich ✕ melden (erwartetes Verhalten, blockiert nicht). Zusaetzlich wird
  das Ergebnis nach `FALSIFY_HOME/logs/selftest.log` geschrieben.
- **Endzustand (Spec §6.6):** `{t:"selftest", result:"fail"}` haelt das
  Boot-Intro im Fehlerzustand (kein stummer Fall auf Idle), solange ein
  Pflicht-Schritt (DB/CONFIG/QUEUE/WORKER/READ-ONLY) fehlgeschlagen ist.
- **Kein Mock:** Das Produkt zeigt keinen Demo-/Fake-Screen; die TUI zeigt
  echte Jobs, `tui-demo.mjs` bleibt reines Test-/Demo-Harness.