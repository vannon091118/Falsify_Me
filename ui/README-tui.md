# FalsifyMe 2.0 — Terminal-UI (ui/) — PHASE 1 (UI ONLY)

**Version v0.02 Beta** (`0.2.0-beta` im `package.json`; Produkt-Runtime bleibt
Read-only-Gateway, Business-Logik unverändert).

**Dokumentationsstand:** Die visuelle Phase-1-Implementierung ist abgeschlossen;
offene manuelle Checkpoints und die echte Phase-2-Worker-Integration bleiben in
`ui/PLAN.md` ausdrücklich als `IN_PROGRESS` bzw. als nächste Phase markiert.

Die neue **visuelle Worker-Ansicht** („Visible Worker Window"): Der Benutzer
schaut der Maschine bei der Arbeit zu. Das Fenster ist **reine Beobachtung** —
einen User-Input für Jobs gibt es nicht. Jobs kommen von ausserhalb
(Agents/Worker speisen Events ein) und werden als bis zu **3 Fenster-Slots
(FEN 1..3) im EINEN Terminal-Prozess (pid)** visualisiert. Kein Chat, keine
Agentensteuerung.

> UI-Scope: NUR `ui/` (neu) + `package.json` (deps `ink`, `react`).
> **KEINE Produktdatei** (`cli/*`, `artifacts/*`, `core/*`, `skills/*`, `ui/worker.mjs`)
> wurde veraendert. Die Integration in den echten Worker ist die NAECHSTE Phase.

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
Desktop:      FalsifyMe-TUI-Start.lnk / FalsifyMe-TUI-Test.lnk
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
im Bereich `1..3`. Für Phase 2 ist dieser stdin-JSONL-Feed eine Alternative
zur direkten In-Process-Verdrahtung über `createTui` und `createParser`:

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
| `T` / `t` | THINKING (Partikel-Animation) ↔ REASONING (strukturierter Status) |

## Ablauf

1. **Machine-Boot-Intro** (global, immer beim Startup, einmal pro Lauf): Wordmark baut sich auf
   (`░ → ░ █ ░ → ░ ███ █ ░`), dann nahtloser Handoff.
2. **WARTE AUF EINGABE** (kein Job aktiv / keine externen Agent-Events): fester, animierter Warte-Screen
   (Atemwelle) mit FEN 1..3 Status (BEREIT / COMPLETE / ERROR / TIMEOUT /
   GESTOPPT, farbig) — ehrlich: pulsierende Welle, aber keine Fake-Aktivität.
3. **Jobs von aussen** belegen freie Slots (max. 3, Fokus folgt dem neuesten
   Job): **1 Job** = volle Ansicht (Partikel-Animation oder REASONING-Checkliste,
   Progress-Bar determinate NUR aus echten Werten, Findings ●/!/▲ mit Puls,
   Verdict-Box ✓ WRITE / ! PLAN / ? RESEARCH / ✕ ERROR/TIMEOUT, Footer mit
   echten Fakten + Metriken). **2–3 Jobs** = Split-Ansicht: jedes Fenster wird
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
{ t: "files", n, slot? }
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
- [MANUELL OFFEN] Die tatsächliche 10-Sekunden-Betrachtung muss in einem sichtbaren User-Terminal erfolgen; ein automatischer Test darf diese visuelle Bestätigung nicht behaupten.

Wenn der manuelle Check eine Schwäche zeigt: Layout vereinfachen — nicht mehr
Elemente hinzufügen.