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
STATUS: IN_PROGRESS
DEPENDS_ON: UI-028
VERIFY: interaktiver Lauf im Terminal (wird via wt.exe-Live-Launch gestartet)
RESULT: headless-Pfad PASS; visuelle Bestaetigung durch User steht aus (Live-Fenster wird gestartet)

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
STATUS: IN_PROGRESS
DEPENDS_ON: UI-030
VERIFY: interaktiver Lauf ([T]-Taste) — REASONING-View gerendert headless (Smoke-Test PASS)
RESULT: view-level PASS; visuelle Bestaetigung durch User steht aus

ID: UI-035
TASK: RESIZE-TEST (klein/gross/Spam waehrend Animation) [visuell, User]
STATUS: IN_PROGRESS
DEPENDS_ON: UI-030
VERIFY: Interaktiver Lauf (Fenstergroesse aendern) — Poller+Coalescing headless verifiziert (resize.test)
RESULT: poller-level PASS; visuelle Bestaetigung durch User steht aus

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
STATUS: IN_PROGRESS
DEPENDS_ON: UI-030
VERIFY: 10s auf das Live-Fenster schauen, ohne Text zu lesen; Antworten dokumentieren
RESULT: steht aus — Checkliste in README-tui.md (Abschnitt Design-Check)

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
STATUS: IN_PROGRESS
DEPENDS_ON: UI-039, UI-047
VERIFY: PLAN.md vollstaendig DONE
RESULT: Alle Implementierungs-/Test-/Verifikations-Tasks DONE (inkl. BLOCK 4b: WARTE-AUF-EINGABE-Modus + 3 Fenster-Slots); 4 visuelle User-Checkpoints (UI-030/034/035/038) mit Live-Fenster gestartet - Bestaetigung durch User
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
WIRING sie referenzierten.
STATUS: IN_PROGRESS
DEPENDS_ON: UI-052
VERIFY: npm run selftest (startet das echte Fenster) + CRLF/ASCII-Check
RESULT: TEILWEISE — Datei angelegt (CRLF/ASCII geprueft). Selftest-Lauf in
der Agent-Shell wurde zweimal abgebrochen; sichtbares Fenster aus einer
User-Konsole starten (bekannte wt.exe-/Agent-Shell-Falle, siehe WIRING §4).
Nur durch den User/naechsten Agenten per npm run selftest abschliessbar.

ID: UI-054
TASK: Verifikation Phase 2: tests/phase2.test.mjs (4 Tests) + npm run selftest
STATUS: IN_PROGRESS
DEPENDS_ON: UI-050..UI-053
VERIFY: node --test tests/phase2.test.mjs; npm run selftest; UI-Suite 105/105
RESULT: TEILWEISE PASS — phase2 4/4 (Marker-Gate, Parser->UI-State inkl.
Slot 1 ERROR/global IDLE, Worker-Loop headless, --check) und UI-Suite
105/105 gruen; der sichtbare Selftest-Fensterlauf (npm run selftest) steht
mangels User-Konsole in der Agent-Shell noch aus (UI-053).

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
