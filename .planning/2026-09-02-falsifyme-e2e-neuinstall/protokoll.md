# FalsifyMe — E2E-Protokoll (Neuinstallation + Live-Lauf, 2026-09-02)

Session-Ziel (Nutzer-Vorgabe): FalsifyMe KOMPLETT deinstallieren → frisch installieren
(Home-Installation, Dock sichtbar) → neuen User-Workflow live am Workingtree durchlaufen,
bis VERDICT: WRITE. Kritische Bugs = NOTIEREN. Bei Blocker: Abbruch + Root-Cause im
Projekt. Fixes erst nach BLOCK/PASS des gesamten E2E. Modell-Rotation: Qualitätsmodus
(Nemotron Super 120B / Qwen 3.6 27B-Groq) vs. Speed-Modus (Nemotron 3.5 Lightning 30B A3B).

System: Windows, Node v24.18.0, Git Bash. Worktree: `C:\Users\Vannon\Desktop\Falsify_ME`.

## 1. Ausgangszustand (vor Session)

- Alt-Installation vorhanden: `~/.Falsify_Core`, `~/.Falsify_Private` (`.env` mit
  NVIDIA_KEY, DB, logs), `~/.agents/skills/falsifyme*`, `~/.falsifyme-instructions.ps1`,
  Desktop-Icons `FalsifyMe.lnk` + `FalsifyMe-TUI-Test.lnk`, Alt-Backup
  `~/.Falsify.env.uninstall-backup`.
- Kein npm-Global-Shim. Kein registrierter Worker (`--check`: STOPPED).
- Repo-AGENTS.md ohne Bootstrap-Marker (unverändert nach Install/Uninstall).

## 2. Deinstallation (komplett)

`node uninstall.mjs` → 10 Elemente entfernt: Skills (3), Instruction-ps1,
PowerShell-Profil-Marker, `~/.Falsify_Core`, 2 Desktop-Icons, `~/.Falsify_Private`
(Key-Inhalt vorher nach `~/.Falsify.env.uninstall-backup` gesichert).
Clean-Slate-Verifikation: alle 9 Zielpfade „clean". ✅

## 3. Frische Installation (Bootstrap)

`node cli/bootstrap.mjs --mode=PFLICHT --reichweite=projekt`

- Install: `~/.Falsify_Core` (38 npm-Pakete in 15s), `~/.Falsify_Private`, Skills,
  Desktop-Icons ✅
- Agent erkannt: **PowerShell-Agent** → Instruction `~/.falsifyme-instructions.ps1`
  (Modus-Kopf: `projekt · PFLICHT`), Profil-Dot-Source ergänzt. Repo-AGENTS.md NICHT
  angetastet (kein Codebuff-Marker im Env → ps1-Ziel, korrekt). ✅
- Dock: „gestartet und bestaetigt (Worker RUNNING nach 2s)" — `--check` bestätigt
  `RUNNING 9864 (Fenster 1)`. ✅ DOCK SICHTBAR.

## 4. Modus-Entscheid (Pflicht, nicht still)

Nutzer wählte interaktiv: **PFLICHT · projekt** (Kopfzeile in der Instruction). ✅

## 5. API-Key-/Provider-Einrichtung

- Keys: NVIDIA (`NVIDIA_API_KEY`) als Primär, Groq (`OPENAI_API_KEY`) als Twin.
  Werte nur in `~/.Falsify_Private/.env` (JSON-gequotet, wie `settings set` schreibt);
  Namen/Stellen nie im Repo. ✅
- **Falle live getroffen**: Append einer zweiten `OPENAI_API_KEY=`-Zeile → leere
  Vorlagen-Zeile schattete die befüllte Duplikat-Zeile (Loader `.find()` → erste
  Zeile). Behoben durch Dedupe-Rewrite der `.env` (Vorlagen-Zeile ersetzt). → Befund F-1.
- Providers mitslives: NVIDIA-Smoke `nvidia/nemotron-3-super-120b-a12b` HTTP 200,
  `nvidia/nemotron-3.5-lightning-30b-a3b` HTTP 200, Groq-Smoke `qwen/qwen3.6-27b`
  HTTP 400 bei `reasoning_effort=high` (nur `none`/`default`) → Befund F-3.
- config.json Hand-Edit nötig (`settings set` kann twin* nicht → Befund F-2).
  Endstand Qualitätsmodus: `model=nvidia/nemotron-3-super-120b-a12b`,
  `twinModel=qwen/qwen3.6-27b`, `twinApiBase=https://api.groq.com/openai/v1`,
  `twinApiKeyEnv=OPENAI_API_KEY`, `reasoningEffort=off` (Parameter weggelassen,
  weil ein gemeinsamer Wert beide Provider bedienen muss), `lang=de`.

## 6. `falsify doctor`

8/8 ✅ (inkl. Twin-Diversitäts-Zeile). Vor der Twin-Konfig: 7/8, Exit 2 durch
Twin-Warnung — gewollt sichtbar (kein stiller Verzicht).

## 7. Live-E2E im Dock (Qualitätsmodus)

Scope: `scope-1788359116366-4fwvvz` — HEADER 1:1 = 3 Befunde härten
(F-1..F-3, siehe Befunde.md) + Regressionstests.
Plan: `.planning/e2e-plan-quality.md` (mit echten Datei:Zeile-Ankern).
Whitelist: `core/keys.mjs, core/settings.mjs, core/config.mjs, cli/run.mjs,
core/twin.mjs` + Selbstprüfung: **26 Kern-Komponenten auto ergänzt** ✅

| Job | Modell | Ergebnis | Dauer | Kern-Erkenntnis |
|---|---|---|---|---|
| job-…bcaeev (It. 1) | Super 120B | **PLAN** | ~225s | ECHTEN Plan-Widerspruch gefunden (config.mjs „unverändert" vs. twinReasoningEffort) → SCOPE-DIVERGENZ, SUBPROMPT persistiert |
| job-…rxbpmf (It. 2) | Super 120B | **UNBEKANNT** | ~63s (code=3) | Antwort endete als Text ohne VERDICT → gilt als final → kein Verdict (fail-closed, ehrlich). Befund F-4 |
| job-…19kur8 (It. 2-Retry) | Super 120B | **PLAN** | ~270s | PLAN-Falle: Modell liest Plan als Implementierungs-Behauptung („Änderungen fehlen im Arbeitsbaum") — SUBPROMPT-Persistenz + „fehlende Umsetzung" im Prompt. Befund F-5 |
| (It. 3, korrigiert mit Ist/Soll-Tabelle) | Super 120B | abgebrochen (Nutzer-Stopp) | — | Rotation beendet; Speed-Lauf nicht mehr gestartet |

Kein Job endete je mit Fake-WRITE — alle vier Pfade fail-closed. ✅

## 7a. Dock-Sichtbarkeit: Screenshot-Befund (OCR-verifiziert, 6 Bilder)

Nutzer übermittelte Screenshots aus Lauf 1–3 (OCR via `ocr.py`):

- **Lauf 1 (AEEV/PLAN):** Banner `FEN 2 · JOB AEEV · SCOPE WVVZ · – 0% · STARTING` +
  BootView (`F · · ·`/„ACTIVATING") — die GESAMTEN 225 s; kein THINKING, kein
  Output, FINDINGS/FILES 00.
- **Lauf 2 (BPMF/UNBEKANNT):** Slots-Panel `FEN 3 · JOB BPMF · STARTING · – 0%`,
  keine Verdict-Pills; **kein Evil-Twin-Fenster** (architektonisch korrekt: Twin
  läuft nur bei WRITE-Kandidaten, Run 2 endete UNBEKANNT — aber auch RUN 1/3
  erreichten nie eine sichtbare Prüfungsphase).
- **Lauf 3 (KUR8/PLAN), gegen Ende:** `FEN 1 · JOB KUR8 · BEREIT`, Footer
  `VERDICT ! PLAN`, FINDINGS ▲ 01, FILES 31 — die TAIL-Events (files/finding/
  verdict/done) kommen also an; die Live-Panes (THINKING-VERLAUF/Output/Activity)
  blieben dagegen leer.
- **Metriken:** RENDER 5026→15408 frames, **max 370.7→1094.0 ms/Frame**, 4–5→10 FPS,
  **RAM 730→2150 MB**. → Befunde F-9 (Event-Loop-Starvation führt zu
  Marker-Bursts; Slots frieren visuell in STARTING) + F-10 (Frame > 1 s, RAM-Leak-Verdacht).
- Korrektur eigener Frühannahme: `t:Text`/`t:Status` im Banner ist KEIN Label-Leak,
  sondern die [T]-Toggle-Selbsterklärung (Header.mjs).

## 7b. Speed-Lauf (Lightning 30B A3B + Qwen-Twin) — Rotation Teil 2

| Job | Modell | Ergebnis | Dauer | Kern-Erkenntnis |
|---|---|---|---|---|
| job-…kdqywn (Speed, It. 1) | Lightning 30B A3B | **PLAN** (Modell: WRITE!) | ~250s | Lightning verifizierte alle drei Befunde als behoben (reale Datei:Zeile) und gab VERDICT: WRITE — aber der TWIN (qwen@Groq) scheiterte mit HTTP 400 `max_tokens <= 16384` → fail-closed PLAN. **Erste echte Twin-Ausführung des E2E → Befund F-11.** |
| job-…bjserq (Speed, It. 2) | Lightning + qwen@**OpenRouter** | abgebrochen | >14 min RUNNING | Twin-Transit per Ersatz-Key auf OpenRouter umgestellt (F-11-Fix implementiert, doctor 8/8; twinMaxTokens=3000). Job lief > 14 min ohne Verdict → per `falsify abort` beendet (fail-closed `ERROR Abgebrochen (CLI)`). Ursache offen (Transit-Latenz? hängender Twin-Call?) — Plan-Notiz, kein Live-Fix. |

Rotations-Fazit qualitativ (soweit belastbar):
- **Super 120B (Qualität):** tiefe Kritik, fand echten Plan-Widerspruch (It. 1); anfällig für F-4/F-5 (behoben: Prompt-Sanierung).
- **Lightning 30B (Speed):** schnell & präzise beim Abgleich realer Datei:Zeilen, ehrliches WRITE — transparent vom Twin-Gate geblockt (Infrastruktur, nicht Urteil).
- **Twin qwen@Groq:** nie belastbar (F-3 high-400, F-11 max_tokens-400). **Twin qwen@OpenRouter:** erster Versuch lief > 14 min ohne Abschluss — Latenz/Stabilität offen.

## 8. Aufräumen (Nutzer-Vorgabe: lokale Daten weg, nur Worktree bleibt)

`node uninstall.mjs` → erneut vollständig entfernt (Worker/`--check`, Core, Private,
Skills, Instruction, Profil-Marker, Icons) + `~/.Falsify.env.uninstall-backup`
gelöscht (Keys sind in dieser Sitzung übergeben). Verifikation Clean-Slate siehe
Ende dieses Protokolls. ✅

## 9. Test-Audit

Siehe `tests-audit.md` im selben Ordner.

## 10. Speed-Audit (Nutzer-Auftrag: Task schneller als 90 s)

Ergebnis dokumentiert in `speed-audit.md` (Messprotokoll + Maßnahmen-Plan):
- **Kernmessung:** Groq qwen3.6-27b TTFT 0,22 s / 489 tok/s; OpenRouter qwen
  TTFT 25 s; NVIDIA lightning aktuell 400 „DEGRADED function" (provider-seitig),
  nano 410 Gone.
- **Hauptlatenzquelle:** Tool-Runden × Transit-TTFT (bis 14 Runden je >20 s).
- Plan (kein Code): Twin zurück auf Groq (Vorbedingung F-3/F-11 sind FIXT),
  maxToolRounds für Speed-Profil senken, Preflight-TTFT-Check, UI-Phase-Bar +
  Fortschritts-/Delta-Anzeige + Reasoning-Ticker (F-9/F-12-Umsetzung).
- Akzeptanzziel: E2E-Job < 90 s im Speed-Modus (aktuell ~225–400 s).

## Session-Regel (Nutzer-Vorgabe, ab sofort)

- **Workshop-Regel:** F-1..F-5 sind FIXT; F-11-Fix liegt UNCOMMITTED im
  Worktree (core/config.mjs, core/settings.mjs, cli/run.mjs, cli/doctor.mjs,
  tests/settings.test.mjs; 150/150 PASS). Nutzer pusht eigene Anpassungen —
  NICHT committen/pushen ohne ausdrückliches Votum.
- **Betriebsregel:** vor JEDEM Testlauf alle Orphans beenden (hängende node-
  Test-/CLI-Prozesse, tote Worker-Registrierungen) — d. h. `node --test` nur
  nach `taskkill` der Alt-Prozesse / Leerung der meta-Registrierung, sonst
  SQLite-BUSY und Duplikat-Guard-Blockaden (live erlebt: stale PID 11164
  blockierte Dock-Starts trotz totem Prozess → erst nach meta-Leerung ging
  Fenster 1 wieder an).
- **Plan-Modus ab jetzt:** keine Live-Jobs/Fixes mehr ohne Votum; nur
  auditieren/dokumentieren.

## Offen / nächste Schritte (nach Freigabe durch den Nutzer)

1. F-11-Fix committen (Worktree-Änderungen, 150/150) — in Nutzers Bump-Push
   integrieren oder separat nach Votum.
2. F-12: [T]-Toggle entkernen ODER real verdrahten (erst nach F-9-Fix
   sichtbar).
3. Job-bjserq-Ursache (Speed-Lauf 2) untersuchen: OpenRouter-Latenz vs.
   hängender Twin-Call — `--ping`-Protokoll beim nächsten Live-Lauf.
4. Version-Drift beheben (0.7.0-beta vs. 2.0, ein Vokabular).
5. F-9/F-10 (Dock-Sichtbarkeit/RAM) erst mit Repro-Zahlen angehen
   (AGENTS.md: --expose-gc-Soak).
## E2E-User-Test-Session (2026-09-02 Abend) — Nutzer testet den Workflow selbst

- **Ablauf:** Nutzer hat den User-Workflow live getestet (Draft-Flow über das
  Dock, Scope scope-178836…, Notebook-Notizen parallel). Verständnis:
  NOTE-Stand konsolidieren → danach E2E-User-Test → auffällige Befunde
  auditieren, inkl. „Lasten der eigenen Entwicklungen" (FalsifyMe prüft
  seine eigene Entwicklung kritisch mit).
- **Neuer Plan-Input (verbindlich, Status GO):** P0-Cutover Probe-basierte
  WRITE-Entscheidung (Revision 5) — konsolidiert in
  `.planning/2026-09-02-falsify-p0-probe-cutover.md`. Kern: Validator
  (formal) → Twin (semantische Probenausführung, ProbeResult[]) → Gate
  (deterministisch, WRITE nur wenn jede Pflicht-Probe BESTAETIGT ∧ Evidence
  ∧ harte Gates). 6 Schritte, Sequenz-/STOPP-/BLOCKED-Grenzen unverhandelbar.
- **Beobachtung F-9 (erneut live, Nutzer-Screenshot):** Dock zeigte beim
  laufenden Job weiter den ALTEN Boot-Screen („F · · · · · ·" + ACTIVATING +
  STARTING im Banner, RENDER 609 frames / max 700,3 ms, RAM 273 MB).
  Root-Cause (geprüft): Der laufende Worker (Fenster 1, PID 12780) läuft auf
  der INSTALLIERTEN Kopie `~/.Falsify_Core` — dort fehlen BootView-Vollbild
  + jobsStarted-Gate (0 Treffer in App.mjs; alte BootView). Der getestete
  Fix (161/161) liegt im Worktree; Sync + Dock-Neustart standen zur Wahl —
  Nutzer-Votum: erst Workflow-Test abschließen, dann entscheiden.

## E2E-User-Test: Gate-Verhalten live (2026-09-02, DOKI-Projekt; Transkript-Auswertung)

Der Nutzer hat den FalsifyMe-Gate-Workflow an einem Fremdprojekt (DOKI,
Desktop\doki, PFLICHT·projekt) live durchgespielt und parallel berichtet.
Konsolidierter Befund (kein Eingriff, kein Code):

1. **Gate fail-closed wie designed (zweimal live belegt):** Zwei Einreichungen
   desselben Plans (Iteration 2/3: automatische Modellauswahl via
   Logik-String-Matrix + Fullscan) endeten beide mit `VERDICT: UNBEKANNT`
   (Exit 3, keine Freigabe) — obwohl das Modell in beiden Antworten
   `VERDICT: WRITE` schrieb. Mechanismus verifiziert in der installierten
   Kopie: `enforceWriteChallenge` (core/evidence.mjs, ~:105) stuft WRITE ohne
   mind. einen Falsifikationsversuch mit Widerlegungs-Vokabular + Evidenz auf
   null zurück; „Keine gefunden"-Formulierungen fallen durch den
   NEGATION-Sink und zählen nicht. **Kein Bug — das Anti-Sycophancy-Gate
   griff exakt wie spezifiziert.**
2. **Side-Effekt der Slack-Falle dokumentieren:** Ein reiner Doku-/Plan-
   Wechsel ohne Code-Anker (Whitelist = AGENTS.md + plan.txt) erschwert dem
   Falsifikator das Erbringen nachweisbarer Widerlegung (Datei:Zeile-Symbol-
   Pfad-Triade). Der Nutzer löste es in Iteration 4 über explizite
   „Widerlegungskandidaten" mit Ankern (AGENTS.md-Zeilen 1–44 stabil).
   Beobachtung für speed-audit/UI-Plan: keine UI-Ausgabe des Gate-Grundes
   (warum UNBEKANNT) im Dock — nur „KEIN gültiges Verdict".
3. **Modellwahl-/Tier-Gap bestätigt (konfigurativ offen, kein Fix):**
   Per-Run-Overrides existieren nativ (`FALSIFY_MODEL`, `FALSIFY_TWIN_MODEL`,
   `FALSIFY_API_BASE`, `FALSIFY_API_KEY_ENV`/`FALSIFY_TWIN_API_KEY_ENV` in
   core/config.mjs:83–155), aber nur als Einzel-Env-Vars — es gibt keinen
   Tier-/Matrix-Mechanismus, der sie gebündelt pro Aufgabe wählt. Der
   Nutzer-Plan (falsify-check.sh + falsifyme-matrix.json, projekt-lokal,
   FalsifyMe read-only) adressiert genau diese Lücke inkl. des selbst
   gefundenen Designfehlers: Research-Tier muss zusätzlich `FALSIFY_API_BASE`
   (+ passender Key) setzen, sonst 404 (qwen-Modell ist nicht auf dem
   NVIDIA-Endpunkt).
4. **Installierte Kopie, Verifikation:** Live-Läufe nutzten Worker 12780
   (Fenster 1). `core/config.mjs`-Overrides per pick() gleichwertig zu
   config.json — env-Weg ist der saubere Mechanismus für den geplanten
   Wrapper (kein settings set nötig, keine persistente Änderung).

- **Live-Repro-Fenster (18:4x, Nutzer-Screenshot):** Iteration 4 läuft als
  job-1788367240029-5i7flx (RUNNING, Scope jcnrex). Der Dock zeigte in der
  installierten (UNgefixten) Kopie: THINKING-VERLAUF + `read_file(plan.txt)`
  + TOOL-ACTIVITY blau + OUTPUT ~20/s — FM-EVT-Kette funktioniert. Zugleich:
  `RENDER 16343 frames max 754.5ms`, `RAM 1710MB` → F-10-Baseline VOR dem
  F-9-Fix, live gemessen. Sync + Dock-Neustart weiter offen (Votum).

- **NUTZER-VORGABE (verbindlich):** „Worktree-Daten und Installationsdaten
  müssen IMMER eins sein (.core / .Core_DEV — nichts mischen)“. Umsetzung:
  Worktree bleibt einzige Wahrheit; nach jedem Worktree-Standwechsel
  `node install.mjs` im Repo-Root → `~/.Falsify_Core` neu syncen (kopiert
  komplett, keine Hand-Edits in der Installation). Verifiziert 18:5x:
  ui/tui.mjs, App.mjs, BootView.mjs SYNC; Dock neu gestartet, Worker 9632
  (Fenster 1) läuft auf dem synchronisierten Stand; jobsStarted-Gate in der
  installierten App.mjs vorhanden (2 Treffer).
- **Iteration 4 fortgeschritten:** job-…5i7flx (18:40→18:45) endete
  `DONE PLAN` statt UNBEKANNT — der Plan-Loop kennt jetzt wieder echte
  Verdicts; F-9-Fix-Baseline gemessen (16.343 Frames max 754,5 ms, RAM
  1,7 GB) vor dem Sync.
