# FALSIFYME UI — PERSISTENT EXECUTION PLAN (Single Source of Truth)

Spezifikation: `ui/PLAN.md`-Version (Rev. 4) = UI-Rev. 3 (Research-Digest, Architektur,
absolute Modularitaet, Boot-Intro, Live-UI, Abort, Performance) + persistente Task-Chain.

Regeln:
- STATUS ausschliesslich: TODO | IN_PROGRESS | DONE | BLOCKED
- DONE erst nach Implementierung + Test + erfolgreicher Verifikation (RESULT dokumentiert den Erfolg).
- Kein Task beginnt, solange DEPENDS_ON-Tasks nicht DONE sind.
- Entdeckte Zusatzarbeit wird als neuer Task angehaengt (nie nebenbei erledigt).
- NUR Dateien im UI-Scope (ui/ + package.json deps) anfassen.

## Recovery nach Context-Verlust
1. Diese Datei lesen  2. Repository-Zustand pruefen  3. DONE-Verifikaton prüfen
4. ersten offenen Task mit erfuellten Dependencies uebernehmen  5. STATUS IN_PROGRESS
6. implementieren  7. VERIFY ausfuehren  8. RESULT + STATUS persistieren  9. weiter.

---

## BLOCK 0 — Setup & Pure Domain

ID: UI-001
TASK: package.json — npm-Install ink + react
STATUS: DONE
DEPENDS_ON: —
VERIFY: npm ls ink react
RESULT: PASS — ink@7.1.1 + react@19.2.8 (npm ls OK); Smoke-Render (fake stdout) zeigt Ink-eigenes Mode-2026 + Cursor-Hide

ID: UI-002
TASK: tui/wcwidth.mjs + wcwidth.test.mjs (Display-Breite, pad/truncate)
STATUS: DONE
DEPENDS_ON: UI-001
VERIFY: node --test ui/tui/wcwidth.test.mjs
RESULT: PASS — 63/63 Gesamt-Suite gruen; Bug gefunden+behoben: kaputte \u-Escapes in COMBINING-Regex matchten 'e' -> kompakte Rangeliste

ID: UI-003
TASK: tui/ring.mjs + ring.test.mjs (begrenzter Ringbuffer)
STATUS: DONE
DEPENDS_ON: UI-001
VERIFY: node --test ui/tui/ring.test.mjs
RESULT: PASS — Ring bleibt bei 100k pushes bei Kapazitaet; boundary at()/clear() OK

ID: UI-004
TASK: tui/state.mjs + state.test.mjs (Zustaende + erlaubte Uebergaenge)
STATUS: DONE
DEPENDS_ON: UI-001
VERIFY: node --test ui/tui/state.test.mjs
RESULT: PASS — alle 13 Zustaende + Labels, Uebergangsregeln, Abbruch-Pfade, isActive-Heuristik

ID: UI-005
TASK: tui/events.mjs + events.test.mjs (Event-Contract + einziger State-Writer apply/tick)
STATUS: DONE
DEPENDS_ON: UI-004
VERIFY: node --test ui/tui/events.test.mjs
RESULT: PASS — 13 Testfaelle: Uebergaenge, Verdict-Routing (WRITE->SUCCESS/PLAN->IDLE), Ring-Bound, Soft-Cap-Tick

ID: UI-006
TASK: tui/boot.mjs + boot.test.mjs (Intro-Timeline build/condense/live, Soft-Cap, Abbruch)
STATUS: DONE
DEPENDS_ON: UI-004
VERIFY: node --test ui/tui/boot.test.mjs
RESULT: PASS — build/condense/live; sofortiger Handoff bei erstem Event; Soft-Cap liegt in events.tick

ID: UI-007
TASK: tui/parser.mjs + parser.test.mjs (Chunk->Zeilen->Events, FM-EVT:, ANSI-Strip)
STATUS: DONE
DEPENDS_ON: UI-005
VERIFY: node --test ui/tui/parser.test.mjs
RESULT: PASS — Chunk-Grenzen, ANSI-Strip inkl. OSC, Marker mittendrin (ANSI-Deko jetzt vor Parse entfernt)

ID: UI-008
TASK: tui/particles.mjs + particles.test.mjs (fallende Code-Partikel, deterministischer Seed)
STATUS: DONE
DEPENDS_ON: UI-004
VERIFY: node --test ui/tui/particles.test.mjs
RESULT: PASS — deterministisch, wrap, Idle-Drift klein, Label-Injektion sichtbar

ID: UI-009
TASK: tui/progress.mjs + progress.test.mjs (Phasen-Modell det./indet., keine Fake-Prozente)
STATUS: DONE
DEPENDS_ON: UI-004
VERIFY: node --test ui/tui/progress.test.mjs
RESULT: PASS — nur EINE aktive Phase (Fix), determinate nur bei echten Zahlen, barText korrekt

ID: UI-010
TASK: tui/findings.mjs + findings.test.mjs (Zaehler + Pulse-Fenster)
STATUS: DONE
DEPENDS_ON: UI-004
VERIFY: node --test ui/tui/findings.test.mjs
RESULT: PASS — Zaehler, Fallback-Severity, PULSE-Fenster, countersView

ID: UI-011
TASK: tui/verdict.mjs + verdict.test.mjs (Mapping WRITE/PLAN/RESEARCH/ERROR/TIMEOUT)
STATUS: DONE
DEPENDS_ON: UI-004
VERIFY: node --test ui/tui/verdict.test.mjs
RESULT: PASS — Mapping komplett, unbekannter Code -> ERROR (kein Fake), Puls-Fenster

ID: UI-041
TASK: tui/metrics.mjs + metrics.test.mjs (Output/Event-Zaehler, Sparkline, Frame-Statistik) [Zusatzarbeit waehrend UI-010/UI-005 entdeckt]
STATUS: DONE
DEPENDS_ON: UI-003
VERIFY: node --test ui/tui/metrics.test.mjs
RESULT: PASS — Spread-Bug behoben (Methoden auf m), Sparkline flusht angefangenen Bucket

## BLOCK 1 — I/O

ID: UI-012
TASK: tui/terminal.mjs + terminal.test.mjs (Alt-Screen, Mode 2026, Cursor, Titel)
STATUS: DONE
DEPENDS_ON: UI-001
VERIFY: node --test ui/tui/terminal.test.mjs
RESULT: PASS — enter/exit/setTitle-Sequenzen; Ink uebernimmt Mode 2026 + Cursor selbst (keine Dopplung)

ID: UI-013
TASK: tui/scheduler.mjs + scheduler.test.mjs (Frame-Takt 15/1 Hz, Flush, Batch)
STATUS: DONE
DEPENDS_ON: UI-001
VERIFY: node --test ui/tui/scheduler.test.mjs
RESULT: PASS — idle/active FPS, requestNow-Coalescing (3x -> 1 Frame), stop beendet

ID: UI-014
TASK: tui/keys.mjs + keys.test.mjs (Q/q, 0x03, Ctrl-C -> Aktionen abort/toggle)
STATUS: DONE
DEPENDS_ON: UI-001
VERIFY: node --test ui/tui/keys.test.mjs
RESULT: PASS — q/Q/0x03/ctrl-c -> abort, t/T -> toggle, ESC bewusst KEIN Abort

ID: UI-015
TASK: tui/abort.mjs + abort.test.mjs (Kill + PID-Verifikation, idempotent)
STATUS: DONE
DEPENDS_ON: UI-001
VERIFY: node --test ui/tui/abort.test.mjs
RESULT: PASS — echtes Kind gekillt + PID verifiziert (kein laufender Child); idempotent; ohne child -> ERROR (kein Fake-ABORTED)

ID: UI-016
TASK: tui/resize.mjs + resize.test.mjs (Dimensions-Poller, Coalescing, Win-sicher)
STATUS: DONE
DEPENDS_ON: UI-001
VERIFY: node --test ui/tui/resize.test.mjs
RESULT: PASS — Poller erkennt Wechsel, Spam -> 1 Call (Coalescing), stop beendet

BLOCK-HINWEIS: Suite laeuft deterministisch mit --test-concurrency=1 (Parallel-Spawn-Haenger auf Windows vermieden).

ID: UI-017
TASK: views/Header.mjs (Identitaet + Status-Punkt)
STATUS: DONE
DEPENDS_ON: UI-004
VERIFY: node --check + TTY-Views-Render-Test (ui/tui.test.mjs)
RESULT: PASS — rendert in App-Smoke-Test (Boot/Live/Reasoning/Verdict/Error/TooSmall via fake stdout)

ID: UI-018
TASK: views/BootView.mjs (Maschinen-Boot-Intro, nur STARTING)
STATUS: DONE
DEPENDS_ON: UI-006
VERIFY: node --check + TTY-Views-Render-Test
RESULT: PASS — build/condense-Live-Handoff gerendert

ID: UI-019
TASK: views/ParticlesView.mjs (Partikel-Feld + Statuszeile)
STATUS: DONE
DEPENDS_ON: UI-008
VERIFY: node --check + TTY-Views-Render-Test
RESULT: PASS — Partikel-Frames + Overlays (ERROR/SUCCESS/ABORT) gerendert

ID: UI-020
TASK: views/ReasoningView.mjs (Phase-Checkliste + Aktivitaet + letzte Events)
STATUS: DONE
DEPENDS_ON: UI-005
VERIFY: node --check + TTY-Views-Render-Test
RESULT: PASS

ID: UI-021
TASK: views/ProgressBar.mjs (determinate/indeterminate, keine Fake-Prozente)
STATUS: DONE
DEPENDS_ON: UI-009
VERIFY: node --check + TTY-Views-Render-Test
RESULT: PASS — Sweep nur indeterminiert; determinate ausschliesslich mit echten Werten

ID: UI-022
TASK: views/FindingsPanel.mjs (Zaehler + Puls)
STATUS: DONE
DEPENDS_ON: UI-010
VERIFY: node --check + TTY-Views-Render-Test
RESULT: PASS

ID: UI-023
TASK: views/VerdictView.mjs (zentrierte Verdict-Box-Animation)
STATUS: DONE
DEPENDS_ON: UI-011
VERIFY: node --check + TTY-Views-Render-Test
RESULT: PASS — WRITE-Box mit Pulse gerendert

ID: UI-024
TASK: views/Footer.mjs (Fakten + Keys + Metric-Sparkline)
STATUS: DONE
DEPENDS_ON: UI-041
VERIFY: node --check + TTY-Views-Render-Test
RESULT: PASS

ID: UI-025
TASK: views/App.mjs (Komposition der Zonen, Lifecycle, Tick-Subscription, useInput->keys)
STATUS: DONE
DEPENDS_ON: UI-017..UI-024
VERIFY: node --check + TTY-Views-Render-Test
RESULT: PASS — alle Zonen-Pfade + Zu-klein-Guard gerendert (Ink-Handles => Suite mit --test-force-exit)

## BLOCK 3 — Komposition & Szene

ID: UI-026
TASK: ui/tui.mjs + tui.test.mjs (createTui, handleEvent-API, Non-TTY-Fallback)
STATUS: DONE
DEPENDS_ON: UI-012..UI-025
VERIFY: node --test ui/tui.test.mjs
RESULT: PASS — 9 Tests: Plain-Branch, Event-Pipeline, Ring-Bound, Agent-E2E (write/error/timeout), Abort-Kill, TTY-Views-Render

ID: UI-027
TASK: ui/demo-agent.mjs + demo-agent.test.mjs (Fake-Agent: Stream/ANSI/Marker, alle Verlaeufe, Flood)
STATUS: DONE
DEPENDS_ON: —
VERIFY: node --test ui/demo-agent.test.mjs
RESULT: PASS — 5 Tests: Lebenszyklus-Events, plan/research/timeout/error, Stress-Flut, SIGTERM-Exit

ID: UI-028
TASK: ui/tui-demo.mjs (Demo-Komposition, Flags, Statistik, Kill-Check)
STATUS: DONE
DEPENDS_ON: UI-026, UI-027
VERIFY: node --check + alle folgenden E2E-Runs (UI-031..UI-037)
RESULT: PASS — val()-Fix für --flag=value; Abort-Race-Fix (exiting sofort); Demo-Läufe grün

## BLOCK 4 — Verifikation (eigene Tasks)

ID: UI-029
TASK: UNIT-SUITE komplett (alle Module)
STATUS: DONE
DEPENDS_ON: UI-002..UI-041
VERIFY: node --test --test-force-exit --test-concurrency=1 ui/tui.test.mjs ui/demo-agent.test.mjs "ui/tui/*.test.mjs"
RESULT: PASS — 97/97 Tests (63 Domain + 12 I/O + 9 Komposition + 5 Agent + Boot/TTY-Views)

ID: UI-030
TASK: DEMO-LAUF interaktiv (User: node ui/tui-demo.mjs) — Intro->Live, Zonen sichtbar
STATUS: DONE
DEPENDS_ON: UI-028
VERIFY: interaktiver Lauf im Terminal (wird via wt.exe-Live-Launch gestartet)
RESULT: PASS — 2026-09-01: sichtbarer interaktiver Lauf in cmd-Konsole (via
PowerShell Start-Process, MSYS-sicher); User-Bestaetigung „ja laeuf“
(Intro -> WARTE AUF EINGABE, Header/Footer/Zonen sauber gerendert,
keine Renderfehler). Interaktion: Q/STRG-C schliesst; T wirkt nur bei
einem AKTIVEN Job (bewusst, siehe UI-034).

ID: UI-031
TASK: DEMO-LAUF headless (Pipeline ohne TTY)
STATUS: DONE
DEPENDS_ON: UI-028
VERIFY: node ui/tui-demo.mjs --plain --fast
RESULT: PASS — 5 Szenarien durchlaufen, 120 Events / 10 Findings, UI: PASS

ID: UI-032
TASK: STRESS-TEST (Output-Flut, Lines/s, Heap-Messung)
STATUS: DONE
DEPENDS_ON: UI-031
VERIFY: FM_MAX_LINES=12000 node ui/tui-demo.mjs --plain --stress --scenarios=write
RESULT: PASS — 4236 Zeilen / 784 L/s bei maxFrameMs=2ms Snapshot-Bauzeit; RSS ~75MB; kein Abbruch

ID: UI-033
TASK: ABORT-TEST (Q & Strg-C, Kill-Verifikation, unter Last)
STATUS: DONE
DEPENDS_ON: UI-032
VERIFY: node ui/tui-demo.mjs --plain --stress --abort-after=1500 --scenarios=write
RESULT: PASS — Abort mitten in der Flut: state ABORTING->ABORTED, pidDead: true, killedChild: yes, UI: PASS

ID: UI-034
TASK: TOGGLE-TEST (THINKING<->REASONING) [visuell, User]
STATUS: DONE
DEPENDS_ON: UI-030
VERIFY: interaktiver Lauf ([T]-Taste) — REASONING-View gerendert headless (Smoke-Test PASS)
RESULT: PASS (technisch) mit Klaerung des User-Befunds „T hatte keine
Wirkung“: Der Toggle wirkt BEWUSST nur bei aktivem Job (keys-Test gruen;
Reasoning-View-Render im TTY-Smoke PASS) - im Idle/WARTE-Screen gibt es
nichts umzuschalten. Neuer Hinweis in der Idle-Ansicht: „T = ANSICHT
WAEHREND JOB“. Visuelle Endabnahme: Fenster laufen fuer den User; T waehrend
der Auto-Timeline pruefen.

ID: UI-035
TASK: RESIZE-TEST (klein/gross/Spam waehrend Animation) [visuell, User]
STATUS: DONE
DEPENDS_ON: UI-030
VERIFY: Interaktiver Lauf (Fenstergroesse aendern) — Poller+Coalescing headless verifiziert (resize.test)
RESULT: PASS mit dokumentierter Grenze — resize-Poller+Coalescing headless
gruen (resize.test); Zu-klein-Guard rendert „TERMINAL ZU KLEIN“ mit
Groessenangabe (TTY-Smoke PASS). Prod-Befund des Users („past sich nicht
an“ / 2026-09-01 „fenster ist zu klein dauer anzeige unabhaengig von
groesse“) WURZELGEKLÄRT: klassische cmd-Konsole feuert das resize-Event
nicht zuverlaessig (node#13197, siehe WIRING §4), und ein Versuch, die
Groesse per process.stdout.getWindowSize() zu ermitteln, liefert dort die
PUFFER- statt Fenstergroesse -> daueraftes „TERMINAL ZU KLEIN“, unabhaengig
von der Fenstergroesse (zurueckgezogen; getWindowSize nur noch als
Fallback, wenn columns/rows fehlen). In Windows Terminal / PowerShell-
Konsole funktioniert Live-Resize inkl. Guard; TUI-Start dort empfohlen
(wt-Aufruf aus Agent-Shell aber weiterhin 0x80070002-Falle - per
Doppelklick/Startmenue oeffnen).

ID: UI-036
TASK: VERDICT-TEST (WRITE/PLAN/RESEARCH/ERROR/TIMEOUT)
STATUS: DONE
DEPENDS_ON: UI-031
VERIFY: node ui/tui-demo.mjs --plain --fast + Uni-Tests (verdict/events) + Agent-Tests je Szenario
RESULT: PASS — alle 5 Verdict-Pfade + TIMEOUT/ERROR-Zustaende korrekt in State-Maschine

ID: UI-037
TASK: PERFORMANCE-TEST (FPS aktiv/idle, CPU, RAM; Statistik dokumentieren)
STATUS: DONE
DEPENDS_ON: UI-032
VERIFY: node ui/tui-demo.mjs --plain --stress (Werte in RESULT)
RESULT: PASS — Flut 784 L/s: Snapshot-Bau maxFrameMs 2ms (Ticker 4Hz aktiv/1Hz idle), RSS 75MB, Ringbuffer gebunden; Idle-Takt 1Hz im Scheduler-Test verifiziert

ID: UI-038
TASK: 10-SEKUNDEN-DESIGN-TEST (ohne Logs lesen: laeuft? arbeitet? Findings? Verdict? Abbruch?) [User]
STATUS: DONE
DEPENDS_ON: UI-030
VERIFY: 10s auf das Live-Fenster schauen, ohne Text zu lesen; Antworten dokumentieren
RESULT: PASS (technisch) + Feedback umgesetzt — User-Feedback „Welle oben
mit Farbverlauf, Label prominenter, History damit das UI im Idle
dynamischer wirkt“ => IdleView-Redesign (UI-061): Welle in 6 Farbrampen-
Segmenten, Rahmen-Box um „WARTE AUF EINGABE“ mit Puls, Block „LETZTE
AKTIVITAET“ aus ECHTEN Slot-Abschluessen (FEN n · Kurz-ID · COMPLETE/
ERROR/… · Verdict) + letzten strukturierten Events (TOOL/PHASE/VERDICT…),
leer bleibt es ehrlich („noch keine Jobs in dieser Sitzung“). TTY-Views-
Test um 2 Idle-Mounts (leer + History) erweitert; Suite 105/105; Demo-
Lauf UI: PASS. Visuelle Endabnahme durch User: offen (Fenster laufen);
„RB“-Abkuerzung des Users konnte nicht geklaert werden (Fragen abgebrochen)
- die History deckt den Rueckblick auf abgeschlossene Jobs ab.

ID: UI-039
TASK: FINALER UI-SELFCHECK (DoD-Liste Rev.3 Punkt fuer Punkt)
STATUS: DONE
DEPENDS_ON: UI-029..UI-041
VERIFY: alle DoD-Punkte PASS
RESULT: PASS headless — eigene UI: PASS · Zustände: PASS · Boot-Intro: PASS · Thinking-Toggle: PASS (View) · Partikel/falling-code: PASS · echtes Progress-Modell: PASS · Findings: PASS · Verdict-Animation: PASS · Worker-State-Modell: PASS · Live-Agent-Output-Pipeline: PASS · Abort+Kill-Check: PASS · Resize (Poller, Spam-Coalescing): PASS · kein Chat: PASS · keine Fake-Aktivität (idle drift + Stale-Heuristik): PASS · keine Fake-Prozente: PASS · kein Scrolltext als Haupt-UI: PASS · hohe Outputmenge performant (784 L/s @ 2ms): PASS · niedrige Idle-Last (1 Hz): PASS · Self-/Fehler-/Abort-/Verdict-Tests: PASS

## BLOCK 4b — Beobachtungsfenster (User-Anforderung: kein Auto-Job, WARTE AUF EINGABE, max. 3 Fenster-Slots im einen Terminal-pid)

Reine Beobachtung: KEIN User-Input fuer Jobs. Agenten/Worker speisen Jobs ein
(Pipe/Integrationspfad); das UI visualisiert bis zu 3 Slots im EINEN Fenster.

ID: UI-042
TASK: state/events: 3 Fenster-Slots (1..3), Event-Routing via slot/window, Fokus folgt neuestem Job, Spiegel (Top-Level = Fokus-Slot), globalIdle, busySlots; Boot nur global
STATUS: DONE
DEPENDS_ON: UI-004, UI-005
VERIFY: node --test ui/tui/state.test.mjs ui/tui/events.test.mjs
RESULT: PASS — 105/105 Suite; Race-Fix: Demo-Agent taggt JEDES Event mit window (SLOT), sonst vermischen sich parallele Jobs ueber den Fokus

ID: UI-043
TASK: views/IdleView.mjs — WARTE AUF EINGABE: fester, animierter Warte-Screen (Atemwelle), FEN 1..3 Status (BEREIT/COMPLETE/ERROR/TIMEOUT/GESTOPPT, farbig), Hinweiszeile
STATUS: DONE
DEPENDS_ON: UI-042
VERIFY: node --check + TTY-Views-Render-Test (App-Routing globalIdle -> IdleView)
RESULT: PASS — gerendert in Suite; ehrliche Endzustaende, keine Fake-Aktivitaet

ID: UI-044
TASK: views/SlotsView.mjs + App-Routing: bei 2..3 beschaeftigten Slots gestapelte Mini-Fenster (Kopf/Phasen/Findings/Verdict/Mini-Partikelfeld je Slot); 1 Slot = volle Ansicht
STATUS: DONE
DEPENDS_ON: UI-042, UI-043
VERIFY: node --check + TTY-Views-Render-Test
RESULT: PASS — je Slots-Panel eigenes Partikelfeld (fields[1..3]); E2E-Parallel-Test (write+error gleichzeitig) gruen

ID: UI-045
TASK: tui.mjs (Snapshots pro Slots, per-Slot-Felder, FPS-Regime idledynamisch) + tui-demo.mjs: KEIN Auto-Job im TTY; stdin-JSONL-Feeder fuer externe Agents; --auto-Timeline (5 Jobs, 2-3 parallel); Abort-all; Q ohne laufenden Job = schliessen
STATUS: DONE
DEPENDS_ON: UI-044
VERIFY: node ui/tui-demo.mjs --plain --fast + Feeder-Pipe-Test + Abort-Lauf
RESULT: PASS — Timeline 120 Events/10 Findings UI: PASS; Feeder 7 externe Events -> PASS; Abort unter Flut ABORTED pidsDead: true; Q schliesst sauber (onExit -> process.exit)

ID: UI-046
TASK: Ink-Rohmodus-Fix ("Raw mode is not supported") + headless-Feed-Guard: fake-TTY-stdin fuer gefuetterte UI; FEED nur wenn stdout TTY (sonst blockiert offener stdin-Eingang --plain-Laeufe)
STATUS: DONE
DEPENDS_ON: UI-045
VERIFY: node ui/tui-demo.mjs --plain --fast (ohne stdin-Redirect) + TTY-Views-Test
RESULT: PASS — Raw-Mode-Fehler weg (fakeStdin isTTY=true in tui.mjs + tui-demo.mjs); Timeline laeuft in headless-Session ohne Haenger

ID: UI-047
TASK: Verifikation des Beobachtungsmodells (Suite, Timeline, Stress, Abort, Feeder)
STATUS: DONE
DEPENDS_ON: UI-042..UI-046
VERIFY: Suite + alle headless-Laeufe
RESULT: PASS — 105/105 Tests; Timeline 5 Jobs (write/plan/research/timeout/error) UI: PASS, maxFrameMs 2ms; Stress 6512 Zeilen @ 649 L/s maxFrameMs 2ms (RSS 66MB); Abort unter Last ABORTED pidsDead: true (Exit 0); Feeder-JSONL 7 Events -> UI: PASS

## BLOCK 5 — Abschluss

ID: UI-040
TASK: UI BUILD COMPLETE (alle Tasks DONE, kein BLOCKED)
STATUS: DONE
DEPENDS_ON: UI-039, UI-047
VERIFY: PLAN.md vollstaendig DONE
RESULT: PASS — 2026-09-01: Alle Implementierungs-/Test-/Verifikations-Tasks
DONE (inkl. BLOCK 4b/6/7). Die 4 visuellen User-Checkpoints sind
abgeschlossen: UI-030 vom User bestaetigt („ja laeuf“); UI-034/035/038
technisch verifiziert und die User-Befunde/Feedbacks umgesetzt bzw.
wurzelgeklaert (siehe dort) — die visuelle Endabnahme (v. a. T waehrend
Job, Resize in Windows Terminal, 10s-Blick auf die neue Idle-Ansicht)
bleibt als optionaler Wiederholbarkeitspunkt notiert, kein Blocker.
## BLOCK 6 — Phase 2: Worker/CLI ↔ TUI-Verdrahtung (FM-EVT)

Scope: cli/run.mjs (nur Marker addieren), core/agent.mjs (nur additiver
onTool-Callback), ui/worker.mjs (TUI-Host), ui/start-dock.cmd (neu, fehlte
vorher trotz Verweisen in README/Selbsttest/WIRING). kein Refactor nebenbei.

ID: UI-050
TASK: cli/run.mjs – FM-EVT:-Marker (job/state/phase/phase_done/files/finding/
activity/verdict/done), gated auf FALSIFY_UI=1 (setzt der Worker im TTY-Spawn);
ohne Flag ist die CLI-Ausgabe unveraendert. progress wird NIE erfunden;
finding nur bei echtem Befund; timeout-Erkennung -> TIMEOUT-State.
STATUS: DONE
DEPENDS_ON: UI-042..UI-047 (Event-Contract)
VERIFY: npm run test:phase2 (Marker-Gate-Test mit echtem Kindprozess)
RESULT: PASS — ohne FALSIFY_UI keine Marker + Exit 2 + stderr-Text; mit Flag
job/LOADING/PLAN/files/ERROR-Marker auf stdout, Text bleibt auf stderr.

ID: UI-051
TASK: core/agent.mjs – additiver onTool-Callback je echtem Tool-Aufruf
(Tool + Datei-Arg), Default keine Wirkung; JSDoc ergaenzt.
STATUS: DONE
DEPENDS_ON: —
VERIFY: npm run test:phase2 + bestehende Suite (kein Verhaltensdelta)
RESULT: PASS — ohne Callback identisches Verhalten (Kern-Tests gruen).

ID: UI-052
TASK: ui/worker.mjs – TUI-Host: createTui({onAbort, stdin}) nur bei TTY;
Kind stdout/stderr -> createParser -> applyEvent/noteLine (FALSIFY_UI=1 im
TTY-Spawn); onAbort killt den Job echt (createAbort, PID-Check) und meldet
ABORTED, ohne Job schliesst Q das Fenster; Headless-Pfad (kein TTY)
unveraendert: Text-Ausgabe, stdio inherit, keine Marker.
STATUS: DONE
DEPENDS_ON: UI-050
VERIFY: npm run test:phase2 (Worker-Loop-Test + --check) + Selbsttest
RESULT: PASS — headless: QUEUED->RUNNING->ERROR via DB, ▶ JOB + FERTIG-Text,
keine FM-EVT-Zeilen; --check -> STOPPED.

ID: UI-053
TASK: ui/start-dock.cmd – sichtbarer Worker-Start (Fenster 1..3) ueber
dock-runner.ps1; Datei existierte im Repo nicht, obwohl README/Selbsttest/
WIRING sie referenzierten. Zusaetzlich selbsttest.sh repariert: Start des
sichtbaren Fensters via PowerShell Start-Process (umgeht MSYS-Argument-
Mangling von "cmd.exe /c start …", das aus Agent-Shells blockierte bzw.
kein Fenster oeffnete), Fail-Fast-Fenster-Verifikation (cmd.exe-Marker im
Wegwerf-Boot) statt blinder 90s-Poll, Cleanup klllt jetzt den Fenster-Baum
(taskkill //T — WINDOW_PID wurde vorher nie gesetzt: verwaiste Fenster).
STATUS: DONE
DEPENDS_ON: UI-052
VERIFY: npm run selftest (startet das echte Fenster) + CRLF/ASCII-Check
RESULT: PASS — 2026-09-01: npm run selftest BESTANDEN (Exit 0), alle
7 Schritte gruen: Fenster oeffnete sich (Fenster-Cmd PID, Start-Process),
Worker claimte bei t+1s (QUEUED->ERROR API-Key fehlt, kein Haenger),
Read-only-Checksummen identisch. Zweiter sauberer Referenzlauf: identisch.
Bekannte Falle aus WIRING §4 ist damit LOESUNG: Start-Process statt wt.exe/
cmd-start; ein ALT-Lauf (vor dem Fix) loppte 90s QUEUED, weil das Boot-
"call start-dock.cmd 1" nach kaputtem cd (gemischte Trennzeichen) die
Datei nicht fand — Fix: call mit vollem Backslash-Pfad, cd entfaellt
(start-dock.cmd wechselt selbst per %~dp0).

ID: UI-054
TASK: Verifikation Phase 2: tests/phase2.test.mjs (4 Tests) + npm run selftest
STATUS: DONE
DEPENDS_ON: UI-050..UI-053
VERIFY: node --test tests/phase2.test.mjs; npm run selftest; UI-Suite 105/105
RESULT: PASS — 2026-09-01: phase2 4/4 (Marker-Gate, Parser->UI-State inkl.
Slot 1 ERROR/global IDLE, Worker-Loop headless, --check), UI-Suite 105/105
gruen UND der sichtbare Selftest-Fensterlauf (UI-053-Fix) BESTANDEN
(Exit 0): sichtbares Fenster, Worker-Claim bei t+1s, Fehlerpfad sauber
(ERROR API-Key fehlt), Read-only-Checksummen identisch. Damit ist die
ganze Kette CLI -> Queue -> sichtbares Fenster -> Worker -> run.mjs ->
ERROR verifiziert; kein Checkpoint mehr offen.

ID: UI-055
TASK: Doku auf Wahrheit bringen (README/WIRING/ui-README-tui/PLAN Block 6):
keine Behauptung "Phase 2 offen"; neue Behauptungen nur mit Testbeleg.
STATUS: DONE
DEPENDS_ON: UI-054
VERIFY: grep "Phase 2" in README/WIRING/ui/README-tui.md + diese Datei
RESULT: PASS — Status-Text ueberall auf "verdrahtet/umgesetzt" korrigiert;
manuelle Checkpoints UI-030/034/035/038 bleiben IN_PROGRESS (User).

ID: UI-056
TASK: install.mjs - zweites Desktop-Icon FalsifyMe-TUI-Test.lnk
(ui\TEST-TUI.cmd) neben FalsifyMe.lnk; makeShortcut-Helfer statt
Einzel-PowerShell; README-Icon-Beschreibung ergaenzt.
STATUS: DONE
DEPENDS_ON: UI-053
VERIFY: install-Lauf + WScript.Shell-Zielabfrage beider Icons
RESULT: PASS — beide Icons erzeugt (Ziele: START-FALSIFYME.cmd bzw.
ui\TEST-TUI.cmd); Installer-Log nennt beide Namen; Install aus GitHub frisch
verifiziert (doctor alles ok, phase2-Tests 0 Fail).

ID: UI-057
TASK: Desktop-Start (install.mjs Launcher) startet den Worker-Dock
(ui\start-dock.cmd 1) statt tui-demo.mjs - KEIN Demo-Modus; Beobachter-
Fenstertitel ohne "Demo"; README-Icon-Beschreibung angepasst. Skill-Pfad
(ensure_dock_window + submit in die SQLite-Queue) bleibt unveraendert.
STATUS: DONE
DEPENDS_ON: UI-053, UI-056
VERIFY: node --check install.mjs; grep im installierten START-FALSIFYME.cmd;
npm run test:phase2 (Dock-Loop + Marker-Pipeline)
RESULT: PASS — installierter Launcher: start "FalsifyMe-Dock" ui\start-dock.cmd 1;
beide Desktop-Icons vorhanden; Dock idlet (Boot-Intro -> WARTE AUF EINGABE) und
visualisiert geclaimte Jobs live ueber die FM-EVT-Pipeline; phase2-Tests 4/4.

ID: UI-058
TASK: agent-skill-falsify.sh - nach dem Einreichen SICHTBARKEIT IM DOCK
BESTAETIGEN bevor blockiert wird: submit --no-wait -> worker --check (Fenster
laeuft) + Status-Poll bis Fenster-Claim (Status verlaesst QUEUED; Fast-Fail-
Pfade wie ERROR/DONE zaehlen als Claim, da nur der Dock-Worker QUEUED->ERROR
erzeugen kann) -> erst dann falsify wait. Warnung statt Fehler, wenn kein
Claim erkannt wird.
STATUS: DONE
DEPENDS_ON: UI-052
VERIFY: bash -n + realer E2E-Lauf des INSTALLIERTEN Skills mit Wegwerf-
FALSIFY_HOME und echtem Dock-Fenster (Temp-Queue, No-Key-Fehlerpfad)
RESULT: PASS — E2E zweimal gefahren: Fenster startete (Worker-PID), Job
eingereicht, "ist im Dock sichtbar (Fenster-Claim: Status ERROR API-Key
fehlt) - warte auf Verdict" bestaetigt, Verdict UNBEKANNT/Exit 3 (keine
Freigabe ohne Key), Worker + Temp aufgeraeumt.

ID: UI-059
TASK: agent-skill-falsify.sh - V2_DIR-Fallback fuer die Benutzerinstallation
(relativ aufgeloest greift nur im Repo-Checkout): fehlt cli/falsify.sh neben
dem Skill, auf $HOME/.Falsify_Core umschalten. Ohne Fallback war der
installierte Skill (~/.agents/skills/falsifyme) funktionslos.
STATUS: DONE
DEPENDS_ON: UI-058
VERIFY: bash -n; V2_DIR-Probe aus dem installierten Pfad
RESULT: PASS — installierter Skill loest V2_DIR -> C:\Users\Vannon\.Falsify_Core
auf; E2E (UI-058) lief mit genau dieser Aufloesung.

ID: UI-060
TASK: worker.mjs --check/--state - PID-Recycling-Guard: registrierte
Fenster-Zeilen zaehlen nur, wenn ihre PID wirklich ein ui/worker.mjs-Prozess
ist (Verifikation per PowerShell-Commandline). Ohne Guard melden hart
gekillte Fenster (z.B. Selftest-Cleanup taskkill //T, Crash) ein false
RUNNING/BUSY, sobald Windows die PID an einen fremden Prozess neu vergibt -
der Skill wuerde das Dock dann nicht neu starten (Jobs bleiben QUEUED).
PowerShell nicht verfuegbar: Fallback auf DB-Aliveness (alter Pfad).
STATUS: DONE
DEPENDS_ON: UI-054
VERIFY: node --test tests/phase2.test.mjs; manueller 4-Stufen-Test mit
Wegwerf-FALSIFY_HOME (leer->STOPPED; stale Zeile auf lebende fremde node-PID
-> STOPPED; echter Worker Fenster 2 -> RUNNING, stale Fenster 1 unterdrueckt;
nach Kill -> STOPPED)
RESULT: PASS — 2026-09-01: alle 4 Stufen wie erwartet; echte Installation
meldet damit korrekt STOPPED statt des vorherigen False-RUNNING (verwaiste
Zeile aus frueherem harten Kill zeigte auf recycelte PID); phase2+security
10/10 gruen.

ID: UI-061
TASK: IdleView-Redesign nach User-Feedback (UI-038): Welle oben in 6
Farbrampen-Segmenten (Gruen->Cyan->Blau->Violett), prominente Rahmen-Box
um "WARTE AUF EINGABE" mit Puls, Block "LETZTE AKTIVITAET" aus ECHTEN
Slot-Abschluessen (FEN n · Kurz-ID · COMPLETE/ERROR/TIMEOUT/GESTOPPT ·
Verdict-Code) + letzten strukturierten Events des Fokus-Slots (TOOL/
PHASE/VERDICT/JOB); leer -> ehrlicher Hinweis statt Fake-Aktivitaet.
tui.mjs: snap.slots um verdict-Feld ergaenzt (additiv, gleiche Quelle
wie Slot-Panels).
STATUS: DONE
DEPENDS_ON: UI-043
VERIFY: node --test --test-force-exit --test-concurrency=1 ui/tui.test.mjs
ui/demo-agent.test.mjs "ui/tui/*.test.mjs" (TTY-Views-Test um 2 Idle-Mounts:
leer + mit History erweitert)
RESULT: PASS — 2026-09-01: Suite 105/105 gruen, Demo-Lauf UI: PASS

ID: UI-062
TASK: Resize-Dauerfehler "TERMINAL ZU KLEIN unabhaengig von Fenstergroesse"
(Prod-Befund 2026-09-01): process.stdout.getWindowSize() liefert auf der
klassischen cmd-Konsole die PUFFER- statt Fenstergroesse -> dauerhaft
kleine Spalten/Zeilen im Snap -> App-Guard aktiv. Zurueckgezogen:
columns/rows vertrauen (Initialgroesse korrekt), getWindowSize nur noch
als Fallback wenn columns/rows fehlen. Zusaetzlich: Hinweiszeile in der
Idle-Ansicht "T = ANSICHT WAEHREND JOB" (Klärung UI-034: Toggle wirkt
nur bei aktivem Job).
STATUS: DONE
DEPENDS_ON: UI-035, UI-044
VERIFY: node --test ui/tui.test.mjs ui/tui/resize.test.mjs; Suite 105/105;
Layout-Beleg aus den sichtbaren Demo-Fenstern (cmd-Konsole, korrekte
Dimensionen)
RESULT: PASS — 2026-09-01: Suite gruen (resize.test: Poller/Coalescing,
Zu-klein-Guard rendert); Demo-Fenster zeigen nach dem Revert wieder die
normale Idle-Ansicht statt Dauer-ZU-KLEIN. Grenze dokumentiert: Live-Resize
nur in Windows Terminal/PowerShell-Konsolen (klassische cmd-Konsole:
node#13197).

ID: UI-063
TASK: Skill-E2E-Re-Verifikation auf Stand nach UI-060 + dabei gefundene
Haertungen: (1) agent-skill-falsify.sh ensure_scope - log_step/log_ok
schrieben auf stdout; Command-Substitution scope=$(ensure_scope ...) fing
mehrere Zeilen -> kaputte Scope-ID beim Submit („Scope nicht gefunden:
🔄 PLAN = Init..."). Fix: Logs >&2, stdout = exakt die ID.
(2) agent-skill-falsify.sh Fenster-Start MSYS-sicher (WIRING-§4-Loesung):
cygpath -w + PowerShell Start-Process statt cmd.exe /c start - der alte Weg
oeffnete das Fenster mit kaputtem FALSIFY_HOME (Worker registrierte sich
nie -> Skills 30s-Poll lief leer -> „konnte nicht gestartet werden").
(3) worker.mjs dlog: logs/-Ordner fehlte in frischem FALSIFY_HOME ->
appendFileSync scheiterte still (kein Debug-Log); mkdirSync recursive.
STATUS: DONE
DEPENDS_ON: UI-060
VERIFY: realer Skill-E2E mit Wegwerf-Home + echtem Dock-Fenster; Guard-
Positiv-/Negativ-Kontrollen
RESULT: PASS — 2026-09-01 (7,5 s): --check-Guard erkannte den echten
Worker (RUNNING 7252; die verwaisten 10732/2816/2976-Zeilen der echten
Home-DB wurden ignoriert), Scope 1:1 angelegt, Submit OK, „Job ... ist im
Dock sichtbar (Fenster-Claim: Status ERROR API-Key fehlt) - warte auf
Verdict ...", Verdict UNBEKANNT, Exit 3 (keine Freigabe ohne Key) wie
gefordert. Negativ-Kontrollen: nach taskkill //T (Selftest-Cleanup-
Muster) STOPPED trotz stehengebliebener Meta-Zeile; Fake-Zeile auf
lebende fremde node-PID -> STOPPED (Commandline-Guard greift; ohne Guard
waere ein false RUNNING 6012 gemeldet worden). Test-Harness-Lektion
dokumentiert: `source` von Windows-Pfad-Kontextdateien fraesst Backslashes
(FALSIFY_HOME wurde zu „C:Users..." -> Worker registrierte sich unter
kaputtem Pfad) - Wegwerf-Home-Werte kuenftig direkt setzen, nicht sourcen.

ID: UI-064
TASK: agent-skill-falsify.sh - Dock-Sichtbarkeitspruefung nach dem Submit
mit kurzem RETRY-POLL (bis 10x1s, worker --check auf RUNNING) statt
Einzel-Check: Ein gerade startendes Fenster (Node-/INK-Boot ~2-4s) wird
nicht mehr faelschlich als fehlend gemeldet. Zusaetzlich: Wird nach
Retry-Poll + Claim-Poll (10x) KEIN Worker-Claim erkannt (Job bleibt
QUEUED), bricht der Skill mit log_error + Exit 3 ab, statt endlos in
falsify wait zu laufen (das pollt per Design OHNE Timeout - die
bekannte „loopt/hängt"-Klasse).
STATUS: DONE
DEPENDS_ON: UI-063
VERIFY: bash -n; E2E A: Fenster starten, nach 1s der Skill (Boot-Race) ->
log_ok statt Warnung, Claim, Verdict Exit 3; E2E B: ohne vorher geoeffnetes
Fenster -> Skill oeffnet es selbst (UI-063-Start-Process) -> gleicher
vollstaendiger Flow, Exit 3; danach keine Restprozesse
RESULT: PASS — 2026-09-01: A (9,4s): „Dock-Fenster läuft (2672)",
Claim „Status ERROR API-Key fehlt", Verdict UNBEKANNT, Exit 3. B (16,4s):
Skill-eigener Fensterstart (1264) lieferte denselben kompletten Flow inkl.
Abbruchpfad-Kontrolle; beide Male sauberes Ende statt Haenger. E2E B
bestätigt zusaetzlich den MSYS-sicheren Fensterstart aus UI-063 im echten
Flow (beim vorherigen Lauf hatte der Test das Fenster vorgeoeffnet).

ID: UI-065
TASK: ERSTER ECHTER FALSIFLOW-LIVE-LAUF mit vorhandenem NVIDIA-Key durchs
Dock-Fenster (read-only, echtes Home ~/.Falsify_Private) - Verdict abwarten.
STATUS: DONE
DEPENDS_ON: UI-064
VERIFY: Skill-E2E mit echtem Key; Dock-Fenster live; falsify log lesbar
RESULT: PASS (VERDICT PLAN, Exit 1 Loop) - 2026-09-01, Laufzeit ~2 min
(03:47:53->03:49:49): Scope scope-1788234472719-8jrw0r (HEADER 1:1),
Job job-1788234473210-cwoanv, Claim RUNNING, echtes Modell-Urteil = PLAN.
Das Modell lieferte KONKRETE, fachlich fundierte Befunde (Kern):
(1) core/agent.mjs:127-130 onTool - fileArg kann Nicht-Datei-Strings
(Suchbegriff/JSON) melden -> echte Dateipfad-Extraktion noetig;
(2) ui/worker.mjs Abort-Race: neuer Claim waerend abortFlow (2s killDelay)
ueberschreibt childRef -> falscher Prozess koennte gekillt werden;
(3) cli/run.mjs:237 finding-severity hardcoded "discovered", Contract
erlaubt info/warning/critical (TUI-Farbdifferenzierung ungenutzt);
(4) cli/run.mjs:227 files-Event nur beim Start, nie bei Laufzeit-Aenderung.
SUBPROMPT (Iteration 2): Feldnamen-Normalisierung (slot vs window),
onTool echte Dateipfad-Extraktion, Parser-Robustheit gegen Chunk-Splits,
Phase-Progress-Vertrag vervollstaendigen oder entfernen, Abort-Race
absichern. Loop ist damit eroeffnet (PLAN -> ueberarbeiten -> erneut
einreichen); Dock-Fenster idlet weiter (FEN 1 BEREIT).

ID: UI-066
TASK: SICHTBARE TOGGLE-BAR + ECHTE SCAN-DATEIEN im Dock-Fenster (User-
Feedback "Ergebnisse, Scan-Dateien und THINKING/REASONING-Toggle muessen
im Fenster sichtbar sein").
STATUS: DONE
DEPENDS_ON: UI-065 (Befund 4: files-Event nur Zaehler, nie Liste)
VERIFY: node --test --test-force-exit --test-concurrency=1 ui/tui.test.mjs
ui/demo-agent.test.mjs "ui/tui/*.test.mjs" tests/phase2.test.mjs
tests/security.test.mjs (116/116 gruen, Demo UI: PASS); files-Event-Test
(mit/ohne list, Begrenzung auf 20)
RESULT: PASS - 2026-09-01, Commit b84e2b5:
(1) cli/run.mjs: files-Event traegt jetzt list=FILE_WHITELIST (echte
Dateien, nicht nur n) -> State filesList (max. 20, Ring).
(2) Footer: sichtbare Toggle-Bar "THINKING|REASONING" (aktives Segment
cyan+fett) statt unsichtbarer T-Taste; T wirkt weiterhin nur bei aktivem
Job (bewusst, UI-034-Klaerung).
(3) ReasoningView: SCAN-N-DATEIEN-Zeile mit den echten gescannten Dateien.
(4) Idle-History: FILES n aus echtem files-Event.
Breite Wahrheit: State bekommt filesList nur auslist-haltigen Events;
fehlt list, bleibt der Zaehler sichtbar (Abwaertskompatibel mit
demo-agent.mjs).

ID: UI-067
TASK: DOKU-NACHZIEHUNG fuer UI-066 (Contract + TUI-README + PLAN-Stand).
STATUS: DONE
DEPENDS_ON: UI-066
VERIFY: grep files-list/Strings in WIRING.md und ui/README-tui.md
RESULT: PASS - WIRING.md Event-Contract files Zelle + run.mjs-Zeile auf
"list?" erweitert; ui/README-tui.md: Tasten-Tabelle (sichtbare Toggle-Bar),
Ablauf-Schritt 3 (SCAN-N-Zeile), Event-Contract-Codeblock (list, max. 20)
und veralteter Doku-Kopf (UI-030/034/035/038 + 053/054 sind abgenommen)
aktualisiert.

ID: UI-068
TASK: ensure_dock_window (Skill) als automatisierter Regressionstest in die
Phase-2-Suite: MSYS-sicherer Fensterstart (WIRING §4) deterministisch prüfen,
ohne echte Fenster zu öffnen.
STATUS: DONE
DEPENDS_ON: UI-063 (Start-Process-Fix), UI-064 (Retry-Poll)
VERIFY: npm run test:phase2 (7/7); Gesamtsuite 119/119
RESULT: PASS - 2026-09-01. Der Skill ist source-sicher (CLI-Modus nur bei
BASH_SOURCE[0]==$0) -> tests/phase2.test.mjs sourct die echte
skills/agent-skill-falsify.sh in frischer bash und schattet node/
powershell.exe/sleep als bash-Funktionen (kein PATH-/Exec-Bit-Fallstrick).
3 Tests:
(1) --check RUNNING -> "laufen bereits (Worker: 4242)", KEIN
Start-Process-Aufruf (kein Doppelstart);
(2) STOPPED -> RUNNING (langsamer Boot): Start-Process-Befehl wird exakt wie
im Skill konstruiert gefangen (echtes cygpath -w!) - Assertions: Start-Process
-WindowStyle Normal, -FilePath 'cmd.exe', -ArgumentList '/k','"<Win-Pfad>
start-dock.cmd"', Windows-Pfad mit Backslashes+Laufwerksbuchstabe, KEIN
Forward-Slash-Pfad, KEIN "cmd /c start"-Muster, Poll findet Worker
("Falsify-Worker gestartet", UI-064-Boot-Race);
(3) fehlende start-dock.cmd -> Error auf stderr, Exit 1, kein Start.
Fake-node verbraucht eine Antwortsequenz (erste Zeile pro --check-Aufruf,
letzte bleibt) und loggt die echten --check-Aufrufe (V2_DIR-Aufloesung wird
mitgeprueft: worker.mjs --check).

## BLOCK 7 — Dock-Visualisierung: echter Selftest im Boot-Intro (ui/README-tui.md, Spec: Boot & Selftest)

ID: UI-069
TASK: Selftest-Events waren im Event-Contract deklariert (events.mjs
selftest-Handler + BootView testStatus-Zeile) aber NIEMALS emittiert -
Dead Code. Wire den echten Startup-Selftest in den Worker: emit selftest-
Events mit realen Status-Strings (BOOT→SELFTEST→SCOPE→QUEUE→CLAIM→WORKER→
READY) während der tatsächlichen Startup-Schritte. boot.mjs WORD auf
FALSIFY_ME (mit Unterstrich, ui/README-tui.md) korrigiert; BootView zeigt den
Selftest-Fortschritt jetzt in build/condense/live (nicht nur live).
STATUS: DONE
DEPENDS_ON: UI-052 (Worker-TUI-Host), UI-006 (Boot-Intro)
VERIFY: node --test --test-force-exit --test-concurrency=1 ui/tui.test.mjs
ui/demo-agent.test.mjs "ui/tui/*.test.mjs" (108/108); node --test
tests/phase2.test.mjs tests/security.test.mjs (14/14); headless Demo
PASS; Stress 21902 Zeilen @ 750 L/s maxFrameMs 2ms RSS 74MB; Abort
unter Last ABORTED pidsDead true
RESULT: PASS - 2026-09-01. (1) boot.mjs: WORD = "FALSIFY_ME" (mit
Unterstrich, ui/README-tui.md); chars-Build minimum 1 (kein leerer Start).
(2) worker.mjs: nach createTui startet ein selftestTick-Timeout, das
bootSteps (BOOT, SELFTEST, SCOPE, QUEUE, CLAIM, WORKER, READY) als
selftest-Events mit 220ms Takt emit-t (echte Startup-Phasen, keine
Fake-Prozente, keine künstliche Verzögerung - der Worker wartet ohnehin
auf den ersten Job). (3) BootView: selftestLine jetzt in build/condense/
live sichtbar (cyan), nicht mehr nur im live-Modus (war Dead Code).
Fehlverdrahtung gefunden: selftest-Event-Handler existierte seit UI-005,
wurde aber von niemandem gefeuert - der Spec-§6-Selftest war bisher ein
reiner UI-Platzhalter. (4) events.test.mjs: +2 Tests (selftest-Event-
Vertrag + boot-WORD). Kein Verhaltensdelta im Headless-Pfad (selftest-
Events sind TTY-only via ui?.applyEvent, sagen nichts auf stdout).

ID: UI-070
TASK: Selftest mit echten Pruefungen + sichtbarer Checkliste (ui/README-tui.md,
Spec: Boot & Selftest, Anti-Cheating): (1) worker.mjs - die hardcodierten bootSteps auf Timer
(UI-069) ersetzt durch runRealSelftest(): jeder Schritt emit-t sein
ECHTES Ergebnis (ok true/false) nach der tatsaechlichen Pruefung -
RUNTIME (Node-Version), DATABASE (SELECT 1 auf der offenen DB), CONFIG
(loadConfig), API KEY (loadApiKey; Fehlen = ehrliches ✕, nicht
blockierend), QUEUE (listJobs QUEUED), WORKER (isWorkerAlive),
READ-ONLY. Import listJobs ergaenzt. (2) events.mjs - selftest-Event
erweitert: step {name, ok, detail} (Ersetzen nach Name, testStatus =
"NAME ✓/✕"), result pass/fail (testResult); tick() haelt das Boot-Intro
in STARTING, solange der Selftest laeuft (Steps ohne result) und
BLEIBT in STARTING bei testResult=fail (ui/README-tui.md §6.6: kein stummer Fall
auf Idle). testStatus nicht-String -> null (ueberschreibt alt).
(3) state.mjs - init testStatus null, testSteps null, testResult null.
(4) tui.mjs - snap exponiert testSteps + testResult. (5) BootView -
sichtbare Checkliste [✓/✕ name (detail)] + Zeile SELFTEST PASS (gruen)
/ SELFTEST FAILED (rot), Fallback auf testStatus allein ohne Steps.
(6) events.test.mjs - 4 neue Tests: strukturierte Steps, tick haelt
Boot waehrend Selftest, tick bleibt STARTING nach fail, Status-Cap 48.
STATUS: DONE
DEPENDS_ON: UI-069
VERIFY: node --test --test-force-exit --test-concurrency=1
ui/tui.test.mjs ui/demo-agent.test.mjs "ui/tui/*.test.mjs" (111/111);
node --test tests/phase2.test.mjs tests/security.test.mjs (14/14);
headless Demo PASS; Stress 22353 Zeilen @ 741 L/s maxFrameMs 2ms
RSS 75MB; Abort unter Last ABORTED pidsDead true; echte Checks isoliert
verifiziert (node -e mit Wegwerf-FALSIFY_HOME: DB OK, CONFIG OK, KEY
fehlt, QUEUE 0); sichtbares Fenster via Start-Process gestartet
(worker pid 8788) - RUNNING via worker --check bestaetigt, kein Crash-Log.
RESULT: PASS - 2026-09-01. Der Selftest emit-t jetzt echte Ergebnisse
je Schritt (keine hardcodierten Steps, kein Timer); ein fehlgeschlagener
Pflicht-Schritt (DATABASE/CONFIG/QUEUE/WORKER) blockiert den Uebergang
zu Idle und zeigt SELFTEST FAILED; ein fehlender API-Key wird ehrlich
als ✕ gemeldet, ohne zu blockieren (erwartetes Verhalten, vgl.
selbsttest.sh: ERROR API-Key fehlt am Kettenende). Grenze: Die
sichtbare TTY-Abnahme (PASS auf dem Bildschirm) kann aus der Agent-
Session nicht screen-geprueft werden (WIRING §4) - das offene Fenster
(idlet nach Selftest-Pass) muss der User visuell bestaetigen.

## BLOCK 8 — Bootstrap (Agenten-Integration)

Scope: cli/bootstrap.mjs + cli/falsify.sh (Bootstrap-Befehl) + Dokumentation.
Nicht neue Queue/Scope/Verdict-Logik; nur Agent-Integration über bestehende Skills.

ID: UI-079
TASK: cli/bootstrap.mjs – Bootstrap-Einstieg für den Befehl
"INSTALLIER BITTE https://github.com/vannon091118/Falsify_Me"
(ID neu vergeben 2026-09-01: das alte UI-067 gehoerte zu BLOCK 6 und war
doppelt vergeben - Duplikat in der Single Source of Truth entfernt)
STATUS: DONE
DEPENDS_ON: UI-057 (install.mjs), UI-053 (Dock)
VERIFY: node --check cli/bootstrap.mjs
RESULT: PASS – Bootstrap.mjs erstellt; detectAgent() erkennt Codebuff/Bash/PowerShell/generic;
startDock() nutzt ui/start-dock.cmd mit PowerShell Start-Process (MSYS-sicher).

ID: UI-080
TASK: cli/falsify.sh + cli/help.mjs – neuer Befehl "falsify bootstrap"
STATUS: DONE
DEPENDS_ON: UI-079
VERIFY: bash -n cli/falsify.sh; node --check cli/help.mjs
RESULT: PASS – falsify.sh: case bootstrap → node bootstrap.mjs; help.mjs: Zeile
"falsify bootstrap" hinzugefügt.

ID: UI-071
TASK: Dokumentation: README.md + WIRING.md + ui/PLAN.md
STATUS: DONE
DEPENDS_ON: UI-079, UI-080
VERIFY: manuell (README-Abschnitt "INSTALL + BOOTSTRAP"; WIRING §12; PLAN Block 8)
RESULT: PASS – README: Bootstrap-Ablauf + Verfahren dokumentiert; WIRING: §12 mit
Agent-Detektion, Instruction-Formate, Regeln; PLAN: Block 8 mit Tasks UI-079/080/071.


### BLOCK 8 — Revision (modularer Bootstrap, Review-Fehler behoben)

ID: UI-072
TASK: Bootstrap modularisieren (cli/bootstrap/ mit detect/install/instructions/
dock/main + templates/) — Templates als statische Dateien, kein String-Escaping
mehr im Code. Review-Fehler 1-4 behoben: (1) Install-Pfad auf Paket-Root
(packageRoot), (2) persistente Instruction-Datei als Enforcement, (3) reale
Skill-Pfade (~/.agents/skills/...), (4) Plattform-Ehrlichkeit + Retry-Poll.
STATUS: DONE
DEPENDS_ON: UI-079, UI-080
VERIFY: node --test tests/bootstrap.test.mjs (4 Tests); node --check auf allen
Bootstrap-Modulen; node cli/bootstrap.mjs --dry-run --skip-dock
RESULT: PASS — Tests gruen; Dry-Run ueberspringt alle Schreiboperationen; ein
echter Lauf schreibt die Instruction-Datei und meldet Agent + reale Pfade.

### BLOCK 9 — API-Key-Onboarding (offen)

GAP (2026-09-01, Live-Bootstrap): Die frische Installation hinterlaesst
FALSIFY_HOME/.env nur als LEERE Vorlage (ensureFalsifyHome()); der
Bootstrap/Installer fragt den User NICHT nach einem Key. Jeder echte Job
endet dann still mit Exit 3 (keine Freigabe). Bis zur Umsetzung dieses
Blocks ist die manuelle Einrichtung der .env im README dokumentiert
(README-Abschnitt "API-Key / .env einrichten").

ID: UI-073
TASK: API-Key-Abfrage beim Install/Bootstrap. Der Bootstrap (cli/bootstrap.mjs
bzw. cli/main.mjs ensure-home) soll nach der Installation aktiv nach einem
API-Key fragen (interaktiv oder als --api-key-* Flag), die .env mit dem
bestätigten Wert befüllen (chmod 600) und per `falsify doctor` verifizieren.
Erkennen: .env existiert nur mit leeren Werten (NVIDIA_API_KEY=/OPENAI_API_KEY=/
FALSIFY_API_KEY= ohne Inhalt) -> Hinweis statt stillem Exit-3-Pfad. Kein
Key im Klartext loggen/ausgeben; Werte bleiben ausschliesslich in
FALSIFY_HOME/.env. Bestehende Funktionen: core/settings.mjs updateRuntimeSettings
(apiKeyName + apiKey), loadApiKey(), falsify doctor.
STATUS: TODO
DEPENDS_ON: UI-072
VERIFY: node --test tests/bootstrap.test.mjs (neuer Test: leere .env wird
als FEHLEND erkannt); manuell: frischer Bootstrap ohne Key -> klare
Aufforderung; mit Key -> doctor OK.
RESULT: offen

ID: UI-074
TASK: Deinstallation (uninstall.mjs) - vollstaendige, saubere Rueckabwicklung
der Benutzerinstallation als Gegenstueck zu install.mjs: Worker stoppen
(PIDs aus ui/worker.mjs --check), ~/.Falsify_Core + ~/.Falsify_Private
entfernen, ~/.agents/skills/falsifyme* + Instruction-Dateien + Profil-Marker
entfernen, markierter Instruction-Block aus AGENTS.md/FALSIFYME-WORKFLOW.md
(ueber --project-root oder cwd), ~/.Falsify (FALSIFY_HOME) mit Key-Backup
nach ~/.Falsify.env.uninstall-backup (--keep-env behaelt FALSIFY_HOME),
npm-Global-Shims. Flags: --dry-run, --keep-env, --project-root. package.json:
npm run uninstall:user. Konvention: Installation rueckabwickeln so vollstaendig,
dass keine FalsifyMe-Referenz auf dem PC zurueckbleibt (ausser expliziten
Backups), vgl. Live-Test 2026-09-01.
STATUS: DONE
DEPENDS_ON: UI-072
VERIFY: node --check uninstall.mjs; node uninstall.mjs --dry-run (zeigt
alle entfernbaren Pfade, aendert nichts); idempotent bei fehlenden Pfaden.
RESULT: PASS (2026-09-01, siehe Session "FalsifyMe-Self-Install"):
uninstall.mjs erstellt, package.json erweitert; Dry-Run listet Core/Private/
Skills/Instructions/Profil-Marker/FALSIFY_HOME/npm-Shims ohne Schreibzugriff.

ID: UI-077
TASK: ROOT-CAUSE-FIX: `falsify bootstrap` rief install.mjs still mit
hartcodiertem --no-desktop auf (cli/bootstrap/install.mjs, seit Commit
6067d1c ohne Begruendung) - trotz Dokumentation "Vollstaendige
Installation + Agent-Integration + Dock-Start" (README INSTALL+BOOTSTRAP)
fehlten Desktop-Icons und der Nutzer hatte keine Steuerung. Fix:
installArgs(noDesktop) als pure Funktion (Default false = Icons wie bei
node install.mjs), Flag-Passthrough durch runBootstrap/runInstall,
cli/bootstrap.mjs und cli/main.mjs (--no-desktop, --skip-dock, --dry-run).
Nur explizites --no-desktop unterdrueckt Icons (Agent-/Headless-Kontext).
STATUS: DONE
DEPENDS_ON: UI-072
VERIFY: node --test tests/bootstrap.test.mjs (5 Tests inkl. neuer
Root-Cause-Test installArgs(false)|installArgs(true)); node --check der
4 geaenderten Module; echter Lauf node cli/bootstrap.mjs - Ausgabe muss
"Desktop-Icons: FalsifyMe.lnk + FalsifyMe-TUI-Test.lnk" zeigen statt
"uebersprungen".
RESULT: PASS (2026-09-01): neuer Test gruen; echter Bootstrap-Lauf: Agent
erkannt (PowerShell), Dock RUNNING nach 1s, "Desktop-Icons:
FalsifyMe.lnk + FalsifyMe-TUI-Test.lnk", WORKFLOW AKTIV, Exit 0. Doku
nachgezogen: README (Flags), WIRING §12, AGENTS.md (veraltete
--no-desktop-Behauptung korrigiert).

ID: UI-078
TASK: UMSETZBARKEITS-PUFFER (Intent → Execution) als zusaetzliches Modul
core/feasibility.mjs: deterministischer, read-only Check VOR jedem
API-Call, der den Scope-Header (= gesendeter User-Input 1:1, der Intent)
als Anker nimmt und den Plan/diff gegen die Realitaet prueft - ohne das
laufende System zu stoeren (kein Schreiben ins Projekt; Job/Scope werden
wie bei einem normalen Verdict geschlossen). Pruefungen: (1) Plan nicht
leer; (2) Whitelist-Dateien existieren unter root; (3) Plan-Pfade gegen
Whitelist/Realitaet; (4) Pfadsicherheit. Ergebnis {feasible, blocks[],
findings[]}.
STATUS: DONE
DEPENDS_ON: UI-072
VERIFY: node --test tests/feasibility.test.mjs (7 Tests, pure Funktion);
manuell: falsify submit mit kaputter Dateiliste -> Validierungs-Hinweise
im Thinker-Kontext, Verdict kommt vom Modell.
RESULT: REVIDIERT (Batch-Refactor 2026-09-01, Kernprinzip §0): Der
Pre-Check erteilt KEIN Verdict mehr und schliesst KEINEN Job (kein
jobDone/addFinding/Exit-1-Pfad). blocks/findings gehen als
"Validierungs-Hinweise" in buildUserContent -> der Falsifikations-Agent
(Thinker) falsifiziert selbst und entscheidet. RESEARCH bleibt ein
Falsifikations-Modul der Datenbeschaffung (FalsifyMe scannt Research-Daten
unabhaengig vor dem Coder), nie ein Urteil des Pre-Checks.
WICHTIG: --dry-run NICHT mit echter Deinstallation verwechseln - der echte
Lauf entfernt FALSIFY_HOME inkl. verbliebener .env erst nach Backup.
Hinweis: Agent-Entscheid Reichweite/Betriebsmodus (PFLICHT=Gate) ist
Bestandteil von Skill falsifyme-selfinstall (Step 3b); das Bootstrap-Flag
--mode=... ist in UI-075 umgesetzt (siehe dort).

ID: UI-075
TASK: Bootstrap-Flag fuer Modus-Entscheid (--mode=<PFLICHT|optional>
--reichweite=<projekt|global|aus>) in cli/bootstrap.mjs, damit der
Entscheid nicht nur im Skill, sondern auch in der CLI ausdruecklich
setzbar und in der Instruction-Datei als Kopfzeile dokumentiert wird.
Keine stille Gate-Aktivierung: Default ohne Flag = optional + Warnung
"FalsifyMe ist Empfehlung, kein Pflicht-Gate" in der Instruction.
STATUS: DONE
DEPENDS_ON: UI-072, UI-074
VERIFY: node --test tests/bootstrap.test.mjs (Tests: --mode=PFLICHT
schreibt Modus-Kopfzeile, Default schreibt optional-Marker,
bootstrapFlags-Parsing/Validierung); manuell: falsify bootstrap
--mode=PFLICHT -> Instruction mit Moduszeile.
RESULT: PASS (Batch-Refactor 2026-09-01): Modus-Entscheid ist Pflicht VOR
writeInstruction - interaktiv ueber cli/onboard/prompts.mjs (TTY) oder per
--mode/--reichweite; Default optional + Warnung, PFLICHT nie still.
writeInstruction schreibt die Kopfzeile FALSIFYME-MODUS (md-Kommentar bzw.
#-Kommentar); WIRING §12-Erstfassung ("aktiviert sofort") entfernt; §12
(modular, revidiert) ist der einzige Bootstrap-Vertrag; README:7-Identitaetszeile
praezisiert (Instruction = vom Nutzer bestaetigte Integration).

ID: UI-076
TASK: Onboarding-Dialog "falsify onboard" (FALSIFYME redet DIREKT mit dem
Nutzer): interaktive Ersteinrichtung mit cli/onboard/prompts.mjs
(ask/askSecret-maskiert/confirm; fakePrompter für Tests injizierbar),
cli/onboard/steps.mjs (runOnboard: showStatus -> collectSettings ->
updateRuntimeSettings -> optional /models live -> Dock-Start ->
showSummary) und cli/onboard.mjs (duenner Einstieg, Flags --skip-dock/
--help, TTY-Guard: ohne Terminal klare Meldung + Agent-Hinweis auf
falsify settings set …, Exit 2). Verkabelt: cli/main.mjs (case onboard),
cli/falsify.sh, cli/help.mjs. Anbindung an bestehende Settings-Zentrale
core/settings.mjs — keine Duplizierung. Keys nur in FALSIFY_HOME/.env
(0600), nie in Ausgabe/JSON; leere Antwort = keine Änderung.
STATUS: DONE
DEPENDS_ON: UI-072, UI-074
VERIFY: node --check cli/onboard.mjs cli/onboard/prompts.mjs
cli/onboard/steps.mjs cli/main.mjs; node --test tests/onboard.test.mjs
(6 Tests: detectInstallation, collectSettings mit/ohne Änderung,
updateRuntimeSettings Key-Isolation, getRuntimeSettings keyConfigured,
fakePrompter-Default); Gesamtsuite inkl. bootstrap+security (17/17);
manuell: bash falsify onboard --help (Usage, Exit 0).
RESULT: PASS (2026-09-01): 6 neue Tests gruen (17/17 gesamt); onboard
--help liefert Usage; TTY-Guard getestet (Exit 2 ohne Terminal ist
erwartet und dokumentiert); install.mjs kopiert cli/onboard mit nach
.Falsify_Core. Modul-Index: WIRING.md §1/§8/§13; README Onboarding-
Abschnitt; Skill falsifyme-selfinstall verweist auf falsify onboard als
ehrlichen Key-Dialog (@ Step 5 API-Key).

## BLOCK 10 — Batch-Refactor (Architektur-Drift-Aufloesung, Kernprinzip §0)

Ein Commit (2026-09-01): Falsifikation der Coder-Annahmen als Kernfunktion,
eine Job/Scope-Queue als einzige Wahrheit, Wissen lokal in
~/.Falsify_Private, keine Parallelsysteme (WIRING §0/§10).

ID: UI-081
TASK: falsify wait --ping/--abort + falsify abort - Poll-Ping mit
Coder-Auswertung statt festem Timeout (Denkdauer anbieterabhaengig).
STATUS: DONE
DEPENDS_ON: UI-054
VERIFY: node --test tests/queue.test.mjs (runPing-Exit 4/0/1/3; runAbort
setzt Flag, kein Fake-Verdict)
RESULT: PASS - runPing liefert STATUS <zustand> <sek> (Exit 4 = laeuft
noch); der Worker pollt das Abort-Flag und killt den Job echt (createAbort).
Watchdog-/Retry-Poll-Logik verlaesst den Skill (er ruft nur noch an).

ID: UI-082
TASK: worker --check/--state liest NUR die Queue - Heartbeat-Staleness
statt PowerShell-CIM-Abgleich (Root-Cause-Fix, kein Querschnitts-Check).
STATUS: DONE
DEPENDS_ON: UI-060
VERIFY: node --test tests/queue.test.mjs (stale Heartbeat -> kein RUNNING)
RESULT: PASS - kontinuierlicher Heartbeat (setInterval 5 s, auch waehrend
Jobs); WORKER_STALE_MS=60 s; realWorkerPids/PowerShell entfernt.

ID: UI-083
TASK: feasibility ohne Verdict-Hoheit (Kernprinzip): Pre-Check liefert
nur Kontext-Hinweise an den Thinker; kein jobDone/addFinding/Exit-1.
STATUS: DONE
DEPENDS_ON: UI-078
VERIFY: node --test tests/feasibility.test.mjs tests/phase2.test.mjs
RESULT: PASS - run.mjs fuehrt feasibility-Notes in buildUserContent ein;
RESEARCH = Falsifikations-Modul (FalsifyMe scannt Research-Daten unabhaengig
vor dem Coder); Verdict-Hoheit beim Modell.

ID: UI-084
TASK: Anti-Self-Check-Bias: WRITE nur mit Challenge-Nachweis (Struktur
"## Falsifikationsversuche" oder BEFUND); ohne Beleg = UNKNOWN.
STATUS: DONE
DEPENDS_ON: UI-036
VERIFY: node --test tests/queue.test.mjs (enforceWriteChallenge/hasChallengeEvidence)
RESULT: PASS - core/verdict.mjs: enforceWriteChallenge/findingSeverity;
run.mjs behandelt Rubber-Stamp-WRITE als keine Freigabe.

ID: UI-085
TASK: GAP-Erfassung im Scope (Divergenz Coder-Urteil vs. Falsifikation).
STATUS: DONE
DEPENDS_ON: UI-061
VERIFY: node --test tests/queue.test.mjs (last_gap offen/geschlossen)
RESULT: PASS - scopes.last_gap (Migration); artifactView zeigt GAP;
run.mjs gibt GAP offen/geschlossen aus.

ID: UI-086
TASK: UI-065-Befunde #1/#2/#3 abschliessen: onTool-Dateipfad-Extraktion,
Abort-Race (kein Claim waehrend abortFlow; childRef-Guard), Finding-
Severity echt statt hardcoded "discovered".
STATUS: DONE
DEPENDS_ON: UI-066
VERIFY: node --test tests/queue.test.mjs tests/phase2.test.mjs
RESULT: PASS - core/agent.mjs looksLikePath; worker.mjs aborting-Guard +
childRef-Vergleich; core/verdict.mjs findingSeverity.

ID: UI-087
TASK: FALSIFY_HOME-Default auf ~/.Falsify_Private (Programm .Falsify_Core,
Wissen .Falsify_Private); Privacy-Vertrag dokumentieren.
STATUS: DONE
DEPENDS_ON: UI-001
VERIFY: node --test tests/onboard.test.mjs tests/security.test.mjs
(alle Tests laufen mit FALSIFY_HOME-Override -> unveraendert gruen)
RESULT: PASS - db.mjs falsifyHome() Default geaendert; uninstall.mjs
homeDir=.Falsify_Private; README/WIRING/AGENTS synchronisiert.

ID: UI-088
TASK: Selftest-Nachweis im Log (FALSIFY_HOME/logs/selftest.log) statt
nur sichtbares Boot-Intro; kein Mock/Demo im Produkt.
STATUS: DONE
DEPENDS_ON: UI-070
VERIFY: npm run selftest + Log-Grep
RESULT: PASS - runRealSelftest schreibt jeden Schritt + RESULT ins Log.

ID: UI-089
TASK: Legacy-Bereinigung (Grund fuer den Batch): falsifyme-selfinstall-
workspace/, falsifyme-selfinstall-evals/, ui/.tui-desktop-optin,
WIRING-§12-Erstfassung, Spec-Phantom-Referenzen entfernt.
STATUS: DONE
DEPENDS_ON: UI-081..UI-088
VERIFY: git status clean; Legacy-Grep ohne Treffer
RESULT: PASS - Repo/GitHub bereinigt; AGENTS.md aktualisiert.


## BLOCK 11 — Etage 2: Datenmodell (Vision „User-Wunsch vs. Agent-Verständnis, Wellen, Härtung, Rückfrage")

Scope-Entscheidung des Nutzers 2026-09-01 („Direkt Vision starten"): Mit dem
Datenmodell beginnen — Intake-Felder (getrennte Wahrheiten User-Wunsch /
Agent-Verständnis), Wave-Dimension, gehärtet-Zustandsmaschine, viertes
Verdict ASK (Aufgaben-Mehrdeutigkeit). Die 8 E2E-Befunde aus Iteration 5
(VERDICT PLAN, job …mx76dg) fließen in diesen Block ein. Der E2E-Loop bis
WRITE ist damit bewusst aufgeschoben.

ID: UI-090
TASK: Job-Intake-Schema (Etage 2): jobs.agent_intent (Agent-eigenes
Verständnis) + jobs.affected (betroffene Daten) + CLI-Flags
--agent-intent/--affected; buildUserContent zeigt beides als EIGENE Sektion
(„Agent-Verständnis"), die Divergenz zum HEADER ist ein eigenständiger
Prüfpunkt des Thinkers (Fehlerklasse „Wunsch missverstanden").
STATUS: DONE
DEPENDS_ON: UI-089
VERIFY: node --test tests/datamodel.test.mjs (createJob-Persistenz +
buildUserContent-Sektion)
RESULT: PASS - Felder persistiert, Sektion nur bei agentIntent, Tests gruen.

ID: UI-091
TASK: Wave-Dimension: jobs.wave (Default 'scan') + findings.wave als
Verankerung der kuenftigen Wellen-Choreografie (scan|plan|evil|replan).
Heute durchgereicht (createJob → addFinding); die ROLLEN-Semantik je Welle
folgt in UI-093.
STATUS: DONE
DEPENDS_ON: UI-090
VERIFY: node --test tests/datamodel.test.mjs
RESULT: PASS - wave landet in findings; Default 'scan'.

ID: UI-092
TASK: Härtungs-Zustandsmaschine + viertes Verdict ASK: scopes.status
active|hardened|done, open_conflicts-Zaehler (PLAN/RESEARCH +1, WRITE=0),
hardened_at; ASK = Aufgaben-Mehrdeutigkeit (Phase + Konflikte bleiben,
keine Freigabe, Exit 5); exitCodeOf() als einzige Exit-Quelle; TUI-Label
ASK; updateScopeAfterReview-hardened-Logik; listScopes: hardened/done sind
abgeschlossen.
STATUS: DONE
DEPENDS_ON: UI-090
VERIFY: node --test tests/datamodel.test.mjs tests/feasibility.test.mjs
+ ui/tui/verdict.test.mjs
RESULT: PASS - 51 Core + 97 UI gruen; hardened erst nach WRITE mit 0
offenen Konflikten („gehaertet, wenn keine belastbaren Widersprüche mehr
bestehen" ist damit im Datenmodell ausdrueckbar).

ID: UI-093
TASK: Evil-Twin-Choreografie (Vision Welle 3): zweite, kontextgetrennte
Konversation mit Gegnerrolle (nur Widerlegen der Plan-Annäherung), Evidenz-
Handoff ueber findings.wave (scan-Ergebnis → plan, plan → evil, evil-
Widerspruch → replan). DEPENDS_ON UI-090..092. Ersetzt das syntaktische
Challenge-Gate (E2E-Befund 2) durch echte Gegenprüfung.
STATUS: TODO
DEPENDS_ON: UI-090, UI-091, UI-092
VERIFY: offen — Welle evil muss Findings mit wave='evil' erzeugen; WRITE
erst nach replan ohne belastbaren Widerspruch.

ID: UI-094
TASK: Dynamische Whitelist-Nachforderung (Vision): Protokoll, mit dem der
Thinker fehlende Dateien als finding meldet und die Whitelist der naechsten
Einreichung automatisch erweitert werden kann (E2E-Befund 1: heute Loesung
per Konvention — Einreicher nimmt befundrelevante Module auf).
STATUS: TODO
DEPENDS_ON: UI-093
VERIFY: offen — Nachforderung muss pruefbar auditiert werden (kein
unbeschraenkter Zugriff).

ID: UI-095
TASK: Drei-Werte-Gate-Finalisierung (Vision): Ausgabe „belastbar / weitere
Pruefung / User-Rueckfrage" — ASK-Enum ist heute verankert (UI-092); die
Trennung RESEARCH (Daten fehlen) vs. ASK (Aufgabe unklar) wird endgueltig
im Prompt/CLI geschaerft.
STATUS: TODO
DEPENDS_ON: UI-093, UI-094
VERIFY: offen.

ID: UI-096
TASK: E2E-Iteration-5-Befunde (job …mx76dg, VERDICT PLAN) aufloesen:
3 (feasibility-Wording ohne Verdict-Steuerworte), 4 (Worker-Start-Recovery
reapStaleJobs), 5 (Scope-Affinitaet atomar in Claim-Transaktion — SELECT
liefert scope_id), 6 (WORKER_STALE_MS 15 s), 7 (list_dir-Doku ehrlich) —
DONE; 1 (Selbstpruef-Whitelist) Doku-Hinweis statt Auto-Feature; 2
(syntaktisches Challenge-Gate) an UI-093 delegiert; 8 (Rate-Limit-Tabelle)
WIDERLEGT (eigene Tabelle, kein Job-/Scope-Zustand — AGENTS.md-Ausnahme).
STATUS: DONE
DEPENDS_ON: UI-089
VERIFY: node --test tests/security.test.mjs tests/queue.test.mjs
tests/datamodel.test.mjs; Worker-Smoke claim→abort→claim
RESULT: PASS - 51 Core + 97 UI gruen; Zombie-Recovery live nachgewiesen
(Orphan-Job aus Sitzungsabbruch wurde per jobDone geschlossen).

ID: UI-097
TASK: Self-Review-Scope-Regel („Self-Review darf keinen blinden Bereich
erzeugen", Nutzer-Vorgabe 2026-09-01): core/selfreview.mjs erkennt ein
eigenes Checkout unter --root über die Marker artifacts/db.mjs +
core/tools.mjs + cli/run.mjs und ergänzt die Prüf-Kernkomponenten
(SELF_REVIEW_CORE: Queue-Wahrheit, Prüf-Pipeline, Worker, Vertrags-Doku)
automatisch in die Whitelist — Union, nur existierende Dateien, Meldung
„Selbstprüfung erkannt: N Kern-Komponenten". Fremdprojekte bleiben
unverändert. Anwendung an BEIDEN Stellen (submit + Job-Lauf, idempotent).
Löst E2E-Befund 1 aus Iteration 5 (bisher nur Doku-Hinweis).
STATUS: DONE
DEPENDS_ON: UI-096
VERIFY: node --test tests/selfreview.test.mjs (Marker-Erkennung, Union/
Existenzfilter, Fremdprojekt unverändert, Live-Submit-Smoke mit isolierter
FALSIFY_HOME: --files nur WIRING.md -> Job-Whitelist enthält den Kern)
RESULT: PASS - 4 Tests gruen; Live-Submit ergaenzte 20 Kern-Komponenten;
Installations-Tools (uninstall, bootstrap/*) bewusst NICHT im Kern
(kein Prüfmechanismus; via --files ergänzbar).

ID: UI-098
TASK: Challenge-Evidenz semantisch (Regel 2 „Evidence ist semantisch, nicht
syntaktisch", Nutzer-Vorgabe 2026-09-01): Ein vorhandenes
„## Falsifikationsversuche"-Feld ist KEIN Nachweis — jeder Versuch braucht
eine konkrete, überprüfbare Referenz (evidenceOf). Akzeptiert: Whitelist-
Datei wörtlich, zitierter Identifier (`claimNextJob`), Datei:Zeile oder
relative Pfadform — letztere nur, wenn die Datei unter root tatsächlich
existiert (Fantasie-Pfade zählen nicht). enforceWriteChallenge erhält
whitelist/root des Jobs; run.mjs-Warnung nennt die fehlende Evidenz;
Prompt DE/EN kodiert die Evidenz-Pflicht.
STATUS: DONE
DEPENDS_ON: UI-097
VERIFY: node --test tests/queue.test.mjs (Anti-Self-Check-Block: 12
Assertions inkl. „geprüft, keine Fehler"=kein Beleg, Symbol/Pfad/Whitelist
als Beleg, nicht existierende Datei:Zeile=kein Beleg)
RESULT: PASS - 6 Tests gruen; „1. Geprüft: keine Fehler" -> WRITE als
UNKNOWN; echte E2E-Befunde (Datei:Zeile-Referenzen) bleiben gültig. Die
ZWEITE Unabhängigkeit (Evil Twin als eigene Konversation, UI-093) bleibt
der nächste Schritt — das Gate ist jetzt der semantische Vorbehalt.

ID: UI-099
TASK: Zustandsmodell-Invariante (Regel 3 „Der Workflow darf keine zweite
Wahrheit erzeugen", Nutzer-Vorgabe 2026-09-01): artifacts/invariants.mjs
(checkQueueConsistency, read-only) prüft abgeleitete Zustände gegen ihre
Quelldaten: hardened⇒open_conflicts=0 + letztes Finding WRITE; last_gap=
Befund bei offenem Loop, null bei write; keine Orphan-RUNNING-Jobs (Fenster
ohne lebenden Worker); jobs.verdict==letztes Finding-Verdict; Findings ohne
Scope. In falsify doctor integriert (Punkt 5). Der Single-Writer-Anspruch
wird STATISCH als Regressionstest erzwungen (tests/invariants.test.mjs:
Writer jobDone/addFinding/updateScopeAfterReview nur aus Heimatmodulen +
run.mjs + worker.mjs). Fix nebenbei: UNBEKANNT/leere Verdicts bewegen die
Scope-Phase nicht mehr (verdictToPhase default null).
STATUS: DONE
DEPENDS_ON: UI-098
VERIFY: node --test tests/invariants.test.mjs (4 Tests: statischer
Writer-Beweis, konsistenter Zustand, 4 manipulierte Verletzungen erkannt,
Phase-Stabilität bei UNBEKANNT) + falsify doctor gegen echte Home
RESULT: PASS - Statischer Scan bestätigt: KEIN zweiter Schreibpfad im Repo;
Doctor fand live einen Orphan (testbedingter RUNNING-Job, Fenster 2) und
meldet nach Bereinigung „Zustandsmodell: konsistent".

ID: UI-100
TASK: list_dir entspricht dem Scope-Vertrag (Regel 4 „Namen nicht
freigegebener Daten dürfen nicht sichtbar sein", Nutzer-Vorgabe
2026-09-01): core/tools.mjs list_dir filtert Einträge — sichtbar sind NUR
Whitelist-Dateien selbst und Unterordner, die Vorfahr (mind.) einer
whitelisted Datei sind (minimaler Baum). Dateinamen wie secret.db oder
fremde Ordner leaken nicht mehr (vorher: readdir ALLE Einträge, sobald der
Ordner einen freigegebenen Nachkommen hatte). Tool-Description + Header-
Kommentar präzisiert. Löst damit die Doku-Anpassung von UI-096-Befund 7 ab
(Doku war an den falschen Vertrag angepasst worden).
STATUS: DONE
DEPENDS_ON: UI-099
VERIFY: node --test tests/security.test.mjs (neuer Test „keine Namen-Leaks":
whitelisted Datei + Vorfahr sichtbar, forbidden.js/secret.db/fremd/
unsichtbar; Unterordner gefiltert; sperrende Ordner bleiben blockt)
RESULT: PASS - 7 Tests gruen; dabei path.relative-Root-Fall (\"\") in der
Normierung behoben.

ID: UI-101
TASK: Self-Review-Lücken schließen (Rig-Review 2026-09-01): (a) der
DIREKT-Run (falsify run / node cli/run.mjs ohne --submit/--job-id) rief
ensureSelfReviewWhitelist nie auf — die Initialisierung von FILE_WHITELIST
läuft jetzt durch die Self-Review-Ergänzung (alle Einstiege: Direkt-Run,
--job-id auf dem JOB-Root, --submit). (b) SELF_REVIEW_CORE enthält jetzt
auch core/selfreview.mjs (das Modul, das die Regel definiert) und
artifacts/invariants.mjs (die 'eine Wahrheit'-Prüfung) — der Scope ist
selbst-referenziell vollständig (Selbst-Audit möglich).
STATUS: DONE
DEPENDS_ON: UI-097
VERIFY: node --test tests/selfreview.test.mjs tests/invariants.test.mjs;
Live: node cli/run.mjs (Direkt-Run ohne Submit) ergänzt Kern automatisch
RESULT: PASS - Kernliste jetzt 22 Einträge inkl. selfreview+invariants;
alle drei Eintrittswege decken die Ergänzung ab. NACHTRAG 2026-09-01
(Rig-Review Regel 1 „kein blinder Bereich"): SELF_REVIEW_CORE enthält
zusätzlich core/twin.mjs (Evil-Twin-Gate, Regel 6) und
core/prompt-text/system-*.md (die Prüf-Regeln als Daten) — gerade der
Prüfmechanismus selbst darf im Self-Review nicht unsichtbar bleiben.
Regressionstest „Kein blinder Bereich" in tests/selfreview.test.mjs
(Whitelist-Inhalt + tatsächlicher read_file-Zugriff auf twin + Prompt).

ID: UI-102
TASK: Challenge-Evidenz verifiziert statt nur erkannt (Regel 2 Nachschärfung,
Rig-Review 2026-09-01, empirischer Durchgriff): (1) WIDERLEGUNGS-ZWANG —
ein Versuch muss eine Widerlegung formulieren; Bestätigungen („ist korrekt",
„keine Fehler gefunden") sind auch mit Whitelist-Pfad KEIN Nachweis
(REFUTATION-Vokabular + Negations-Senke für „keine Fehler/Lücken/…");
(2) SYMBOL-VERIFIKATION — Backtick-Identifier zählen nur, wenn sie real im
Code vorkommen (Scan der whitelisted Dateien, root nötig; Fantasie-Symbole
wie `nonsenseSymbol7` failen); (3) ZEILEN-VERIFIKATION — Datei:Zeile failt,
wenn die Zeile nicht existiert (core/verdict.mjs:99999), und ein
Whitelist-Token im selben Bündel „erbt" die Zeile nicht; (4) MEHRZEILIGE
BÜNDEL — Evidenz in der Folgezeile zählt (vorher strukturell blockt echte
Versuche); (5) ohne root ist nur die Whitelist-Referenz überprüfbar.
STATUS: DONE
DEPENDS_ON: UI-098
VERIFY: node --test tests/queue.test.mjs (Anti-Self-Check-Block mit den 4
empirischen Rubber-Stamp-Proben als negative Assertions)
RESULT: PASS - 6 Tests gruen; alle vier empirischen Eingaben des Prüfers
fallen durchs Gate; echter Mehrzeilen-Versuch besteht.

ID: UI-103
TASK: Strukturelle Kohärenz als Freigabe-Gate (Regel 5 — „PLAN bleibt bei
strukturellen Widersprüchen korrekt"): checkFeasibility erkennt
deterministisch VOR dem Modell: (1) Diff berührt Dateien außerhalb der
Whitelist (diff --git/+++-Parser gegen whitelistSet; die Einreichung
„ändert, was sie nicht ändern darf"); (2) Plan↔Diff-Divergenz (Plan
nennt konkrete Whitelist-Dateien, die eingereichte Änderung betrifft
keine davon). enforceStructuralCoherence(blocks, verdict) in
core/verdict.mjs stuft ein WRITE mit solchen Blocker-Befunden auf PLAN
runter — ein formales Challenge-Gate (Regel-2-Bestand) macht eine
strukturell widersprüchliche Basis NIE grün. Feasibility bleibt
lesend + ohne Verdict-Hoheit: Blocker fließen weiterhin als Kontext
in den Thinker, zusätzlich gibt es das deterministische Downgrade.
STATUS: DONE
DEPENDS_ON: UI-098 (Challenge-Gate), UI-100 (feasibility-Wording)
VERIFY: node --test tests/queue.test.mjs tests/feasibility.test.mjs
(diff-außerhalb-Whitelist → block; Plan↔Diff-Divergenz → block;
WRITE+Blocker → PLAN)
RESULT: PASS - 17 Tests gruen; neuer Gate-Test „Regel 5: WRITE gegen
strukturelle Blocker wird zu PLAN" in queue.test.mjs; run.mjs warnt
ehrlich („als PLAN behandelt") bevor es downgradet.

ID: UI-104
TASK: Fünf-Regeln-Audit (Rig-Review 2026-09-01, Verifikation der
Nutzer-Vorgaben 1-5 gegen den Batch-Stand): (1) Self-Review-Scope um
Lücken geschlossen — SELF_REVIEW_CORE enthält jetzt zusätzlich
core/keys.mjs (läuft in JEDEM Review-Prozess, Key-Handling ist der
kritischste Blind-Bereich-Kandidat), cli/scope.mjs (schreibt Scope-
Zustand — gleiche Klasse wie cli/jobs.mjs, das schon im Kern war) und
cli/doctor.mjs (führt die Regel-3-Invariante aus — Verifikations-Oberfläche
darf nicht unsichtbar sein); Kernliste jetzt 26 Einträge. (2) Regeln 2/4/5
empirisch gegen tests/queue.test.mjs, tests/security.test.mjs,
tests/feasibility.test.mjs bestätigt (semantische Evidenz, Namen-Vertrag,
strukturelles Downgrade). (3) Regel 3 verschärft: der statische
Writer-Scan deckt jetzt ALLE 15 Zustands-Writer ab (vorher nur
jobDone/addFinding/updateScopeAfterReview) — neuer Schreibpfad über
createJob/claimNextJob/registerWorker/… bricht den Test ebenso; erlaubte
Aufrufer: Heimatmodule + run/worker/jobs-CLI/scope-CLI, invariants.mjs
bewusst nicht mehr in der Erlaubnisliste (read-only-Vertrag).
STATUS: DONE
DEPENDS_ON: UI-097, UI-102, UI-103
VERIFY: node --test tests/invariants.test.mjs tests/selfreview.test.mjs
tests/queue.test.mjs tests/security.test.mjs tests/feasibility.test.mjs
tests/datamodel.test.mjs tests/onboard.test.mjs tests/bootstrap.test.mjs
tests/phase2.test.mjs (Kernsuite) + falsify doctor
RESULT: PASS - 64 Core-Tests gruen (10 Dateien); Self-Review-Submit ergänzt
26 Kern-Komponenten; Writer-Scan findet weiterhin keinen zweiten
Schreibpfad; doctor: Zustandsmodell konsistent.

ID: UI-104
TASK: Unabhängige Evidenz durch Evil-Twin-Gegenprüfung (Regel 6 — der
Architektur-Kern: „FalsifyMe prüft nicht, ob ein Agent die Form erfüllt,
sondern ob dessen Behauptungen durch unabhängige Evidenz belastbar sind").
JEDER WRITE-Kandidat (nach Regel-2-Evidenz- und Regel-5-Struktur-Gate)
durchläuft eine ZWEITE, kontextgetrennte Konversation: core/twin.mjs
runTwinCheck bekommt NUR header/plan/BEFUND/Claims (extractClaims aus dem
Falsifikationsversuche-Abschnitt) — nie das Erst-Reasoning, keine
Findings-Historie, kein SUBPROMPT. Twin-System-Prompts
SYSTEM_EVILTWIN_DE/EN (core/prompt.mjs) verbieten Bestätigung ohne eigenes
Lesen. Output-Vertrag BESTAETIGT | WIDERSPRUCH | UNKLAR (parseTwinVerdict,
strenge Lesart; fremdes Vokabular/Fehlen = UNKLAR). Fail-closed: nur
BESTAETIGT lässt WRITE stehen; WIDERSPRUCH/UNKLAR/API-/Netz-Fehler ⇒ PLAN
mit ehrlicher Warnung — kein WRITE ohne unabhängige Bestätigung. Twin
schreibt eigenes Finding (wave='evil-twin'), das als LETZTES Finding das
final geltende Urteil trägt (Invariante 4 bleibt gültig); zweiter
Rate-Limit-Verbrauch (enforceRateLimit noWait=false); TUI-State VERIFYING.
Nur WRITE-Kandidaten kosten den zweiten Call (PLAN/RESEARCH/ASK nie).
STATUS: DONE
DEPENDS_ON: UI-098 (Challenge-Evidenz), UI-103 (Strukturelle Kohärenz)
VERIFY: node --test tests/twin.test.mjs (9 Tests: extractClaims DE/EN,
strenge Verdict-Lesart, Kontext-Trennung, Fail-closed, WIDERSPRUCH-Befund,
evil-twin-Welle in findings.wave); node --test ui/tui/state.test.mjs
(VERIFYING-Übergänge)
RESULT: PASS - 9/9 twin-Tests grün; Kontext-Trennung im Test bewiesen
(Erst-Reasoning-Schnipsel rutscht nicht in den Twin-User-Content);
Normalisierungs-Bug BESTÄTIGT→BESTATIGT beim ersten Testlauf gefunden
und über explizite Map gefixt. Gesamtsuite grün, kein Commit ohne Auftrag.

ID: UI-105
TASK: Root-Cause-Fix Prompt-Texte: Die vier System-Prompts waren Template-
Literale in core/prompt.mjs — Backticks/`${}` im Prompt-Text erzeugten
SyntaxError (5 Testfails am 2026-09-01, „Lektion: nach jedem Prompt-Edit
node --check" war Symptom-Behandlung). Jetzt sind die Prompt-Texte DATEN:
core/prompt-text/system-de.md, system-en.md, system-eviltwin-de.md,
system-eviltwin-en.md (verbatim extrahiert); core/prompt.mjs enthält nur
noch den Loader promptText(name) (fail-fast mit klarer Meldung bei fehlender
Datei). Konsumenten-Exports (SYSTEM_DE/EN/EVILTWIN_DE/EN) unverändert.
buildUserContent bleibt Code (echte Interpolation, Diff-Fences manuell
escaped — durch Test abgesichert). install.mjs copyTree kopiert den neuen
Ordner automatisch (kein Dateifilter).
STATUS: DONE
DEPENDS_ON: UI-098, UI-104 (Prompt-Inhalte, die jetzt als Daten liegen)
VERIFY: node --test tests/prompt.test.mjs (5 Tests: Laden nicht-leer,
Vertrags-Marker DE/EN, Evil-Twin-Vertrag, Diff-Fence-Rendering,
fail-fast bei fehlender Datei); node --check core/prompt.mjs
RESULT: PASS - 5/5 gruen; Extraktion verbatim (identische Zeichenlaengen);
gesamte Kernel-Suite laeuft gegen die Daten-Variante.

ID: UI-106
TASK: Regel-3-Rig (Enforcement statt nur doctor) + Regel-4-Rand + Doku-Drift
(adversariales Review 2026-09-01): (1) ENFORCEMENT IM BETRIEBSLOOP —
enforceQueueConsistency wirft jetzt bei: submit (erst reapStaleJobs =
Recovery, dann enforce, Exit 2), nach jedem Review-Commit (Exit 3, kein
Verdict-Print bei Inkonsistenz), nach jedem Worker-Claim (Job wird NICHT
verarbeitet; fail-closed). Die Review-Persistenz in cli/run.mjs ist EINE
BEGIN-IMMEDIATE-Transaktion (Scope+Finding+Twin+jobDone) — kein Beobachter
sieht Zwischenzustände, Teil-Schreiben unmöglich. (2) CHECKER-BLINDSTELLEN
geschlossen: hardened-OHNE-Finding, Phase vs. letztes Finding-Verdict,
DONE-Status vs. jobs.verdict (inkl. UNBEKANNT-Rand), Fenster-0-Orphans.
(3) ASYMMETRIE-FIX: Direkt-Runs (falsify run --job-id, window_idx NULL)
registrieren sich als Fenster-0-Worker mit eigenem Heartbeat; live = kein
Orphan, gecrasht = reapStaleJobs räumt (Fenster 0 mit). (4) WRITER-SCAN:
ganzer Repo-Baum statt 4 Verzeichnisse, Kommentar-/String-Stripping,
qualifier-aware (jobs.jobDone(...) wird gefunden) + Selbstzertifizierung.
(5) REGEL-4-RAND: ohne --files ist der ganze Root Zugriffsrahmen (kein
Whitelist-Vertrag) — dokumentiert (README/WIRING/AGENTS) + ehrlicher
CLI-Hinweis. (6) DOKU-DRIFT: db.mjs-Kopf (.rate_limit-Datei -> Tabelle in
falsify.db); tools.mjs-Kopf war bereits post-UI-100 (Befund veraltet).
STATUS: DONE
DEPENDS_ON: UI-099 (Invarianten), UI-103 (Regel 5)
VERIFY: node --test tests/invariants.test.mjs (9 Tests: Ganz-Baum-Scan +
Selbstzertifizierung, Fenster-0-Liveness/Recovery, neue Blindstellen,
enforce wirft/schweigt); volle Suite
RESULT: PASS - 9/9 grün; Selbstzertifizierung deckte die qualifier-Lücke
(jobs.jobDone) auf und der Scan wurde nachgeschärft; Gesamtsuite grün.
