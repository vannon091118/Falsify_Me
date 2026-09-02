# FalsifyMe — Test-Audit (2026-09-02)

Umgebung: Node v24.18.0, Windows/Git Bash, Worktree `C:\Users\Vannon\Desktop\Falsify_ME
(alle Tests aus dem Worktree; lokale FalsifyMe-Installation war zum Audit-Zeitpunkt
bereits entfernt — Tests nutzen isolierte FALSIFY_HOME (mkdtemp) bzw. Fake-/Temp-Root).
Befehle siehe unten; kein Netz-Zwang (Models-Tests nutzen lokale Fake-Provider).

## Gesamtergebnis

| Suite | Befehl | Tests | Pass | Fail | Dauer |
|---|---|---:|---:|---:|---:|
| Gesamt `tests/` (24 Dateien, Stand nach F-1..F-5+F-8+F-9+F-9-Boot+F-11) | `node --test tests/*.test.mjs` | 161 | 161 | 0 | ~40 s |
| davon Kernsuite lt. AGENTS.md (14 Dateien, Stand 2026-09-01) | s. u. | 106 | 106 | 0 | ~47 s |
| Settings-Suite (9 Tests inkl. F-2/F-3) | `node --test tests/settings.test.mjs` | 9 | 9 | 0 | <1 s |
| Agent-Suite (7 Tests inkl. F-3-Retry + F-4-Nachbohren) | `node --test tests/agent.test.mjs` | 7 | 7 | 0 | <1 s |
| Prompt-Suite (7 Tests inkl. F-5-Phasensemantik) | `node --test tests/prompt.test.mjs` | 7 | 7 | 0 | <1 s |
| UI-Suite (Terminal-UI) | `node --test --test-force-exit --test-concurrency=1 "ui/tui/*.test.mjs" ui/tui.test.mjs ui/demo-agent.test.mjs` | 125 | 125 | 0 | ~28 s |

**Fazit: 133/133 Headless-Tests grün (inclusiv aller in AGENTS.md genannten
Teilsuiten) + 125/125 UI-Tests grün. Kein Fehlschlag, kein Skip, kein Todo.**

## Datei → Abdeckung (Mapping auf die Projekt-Regeln)

| Testdatei | Prüft (Regel / Bereich) |
|---|---|
| `onboard.test.mjs` | Onboarding-Dialog, Settings-Ablauf, Key-Maskierung, kein TTY-Verweigern |
| `bootstrap.test.mjs` | Install/Bootstrap: Flags, Modus-Entscheid, Instruction-Dateien, Merge idempotent, Dock-Pfad |
| `security.test.mjs` | Whitelist-Vertrag, list_dir-Namen-Leak (Regel 4), Traversal/Absolut/Symlink |
| `phase2.test.mjs` | FM-EVT-Verdrahtung: Marker-Gate, Parser→UI-Zustand, Worker-Loop (echte Kindprozesse) |
| `queue.test.mjs` | Eine Job/Scope-Queue (Regel 3), wait --ping/--abort, Heartbeat-Staleness, WRITE-Challenge |
| `feasibility.test.mjs` | Umsetzbarkeits-Puffer (Intent→Execution), Whitelist-Existenz, Traversal, Intent-Drift |
| `datamodel.test.mjs` | Schema v3/v4, Intake-Felder, atomare Claim-Affinität, reapStaleJobs, Härtung, ASK, exitCodeOf |
| `invariants.test.mjs` | checkQueueConsistency + statischer Repo-Scan (eine Wahrheit) |
| `selfreview.test.mjs` | Selbstprüfungs-Scope: Kern-Whitelist union, Fremdprojekt unverändert, Live-Submit-Smoke |
| `twin.test.mjs` | Evil Twin (Regel 6): extractClaims, parseTwinVerdict, Kontext-Trennung, Fail-closed, twinEvidenceOk, twinOwnFalsificationOk, anchoredFileLine, Twin-Diversität |
| `prompt.test.mjs` | Prompt-Texte als DATEN, Loader, User-Content-Fences |
| `agent.test.mjs` | Agent-Loop: Tools, Empty-/Verdict-Guards, Retry, maxToolRounds (abdeckt Teile von F-4) |
| `stats.test.mjs` | Progression-Statistik read-only, UNBEKANNT-Zählung, scope trace (UI-115/116) |
| `research-additions.test.mjs` | RESEARCH-Whitelist-Nachforderung, Security-Filter, Persistenz |
| `keys.test.mjs` (NEU, F-1-Fix) | Duplikat-Schatten-Falle beim Key-Laden (letzte befüllte Zeile gewinnt; leere Vorlagen zählen nie) |
| `settings.test.mjs` (erweitert, F-2+F-3-Fix) | zusätzlich: Twin-Einstellungen via settings set akzeptiert, Twin-Sicht in settings show (inkl. reasoningEffort), twinApiBase-Validierung, twinReasoningEffort-Akzeptanz/Enum/loadConfig-Fallback/Direkt-Edit-Abweisung |
| `agent.test.mjs` (erweitert, F-3+F-4-Fix) | zusätzlich: 400 im ersten Round → Retry ohne reasoning_effort MIT Tools; zweiter 4xx → Rettungsweg ohne Tools; verdict-lose Abschluss-Antwort → Nachbohren (2× bounded), ehrliche letzte Antwort |
| `prompt.test.mjs` (erweitert, F-5-Fix) | zusätzlich: PHASEN-SEMANTIK-Regel in DE/EN-System-Prompt, Alt-Formulierung „fehlende Umsetzung"/„missing implementation" entfernt, buildUserContent-ENTWURF-Frame bei Phase plan (write unverändert) |
| `exit-code-authority.test.mjs` | Exit-Code-Hoheit in exitCodeOf (0/1/3/5) |
| `foreign-project.test.mjs` | Fremdprojekt-Policy (--files-Pflicht, kein stiller Sondermodus) |
| `tool-evidence.test.mjs` | Objektive Tool-Evidence (Regel 6): nur erfolgreiche, erlaubte reads zählen |
| `scope-trace.test.mjs` | Loop-Trace (UI-116): GAP je Runde, Loop-Ausgang |
| `verdict.test.mjs` | parseVerdict/parseBefund: Formen, Überschriften, fail-closed bei Zweideutigkeit |
| `agent-stream-output.test.mjs` | Stream-Ausgabe/Chunk-Handling des Agenten |
| `stream-wrap.test.mjs` | Stream-Wrapper (Zeilen-/Chunk-Normalisierung) |
| `settings.test.mjs` | Runtime-Settings: freie Provider-Werte, Key außerhalb Repo, Models-Abfrage, apiBase-Validierung |

## Eigenständig dokumentierte Lücken (aus dem Live-E2E, siehe findings.md)

Die Headless-Suite deckt F-4 (Verdict-Guards in agent.test.mjs) nur teilweise ab —
die konkrete Live-Konstellation „ nicht-leere Textantwort OHNE VERDICT und ohne
Tool-Calls wird als final akzeptiert" hat KEINEN Regressionstest (F-4 offen).
Ebenso fehlen Regressionstests für F-1 (Duplikat-Schatten), F-2 (settings set +
twin*), F-3 (Twin-Reasoning-Effort). Die Live-E2E-Serie (4 Jobs, echte Provider)
lieferte dafür die Belege; Fix-Entwürfe stehen in findings.md F-1..F-5.

## Nicht Bestandteil dieses Audits (bewusst)

- `npm run selftest` (sichtbares Test-Fenster via PowerShell Start-Process):
  dokumentiert als BESTANDEN 2026-09-01; im Audit nicht erneut ausgeführt, weil
  die Session auf headless Verifikation ausgelegt war und das Fenster im
  Aufräum-Schritt bereits geschlossen wurde.
- Echte API-E2E mit Live-Providern: wurde als Teil des E2E live gefahren
  (NVIDIA + Groq, 4 Jobs) — Ergebnisse im Protokoll.
- Screenshot-/OCR-Verifikation des Docks (`ocr.py`): nicht erforderlich für
  Text-Outputs (Dock-Status via `--check` verifiziert).

## Empfehlungen

1. AGENTS.md-Testliste aktualisieren: Kernsuite nennt 14 Dateien, real existieren
   22 (`agent-stream-output`, `exit-code-authority`, `foreign-project`,
   `scope-trace`, `stream-wrap`, `tool-evidence`, `verdict`, `settings` fehlen) —
   „Stand 2026-09-01"-Anmerkung ist überholt.
2. Regressionstests für F-1..F-4 nach Fix-Umsetzung (Details findings.md).
3. `agent.test.mjs` um den F-4-Fall erweitern (Textantwort ohne VERDICT ⇒
   Nachbohren statt final) — die Guard-Logik existiert bereits für Stubs.