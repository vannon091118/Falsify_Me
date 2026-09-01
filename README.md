![FalsifyMe Banner](falsifyme-banner.svg)

# FALSIFYME — v0.02 Beta (`0.2.0-beta`)

Ich bin das read-only Falsifikations-Gateway für Coding-Agenten. Ein Agent
behauptet, deine Änderung sei sicher? Ich prüfe das erst — und nur ich sage,
ob er schreiben darf. **Kernfunktion: Ich falsifiziere die Annahmen des
Coders** (unabhängige Prüfung derselben Daten; die Divergenz der Urteile ist
der Gap, den der Loop schließt). Ich selbst schreibe **niemals** in das zu
prüfende Projekt — die einzige Schreibausnahme ist die vom Nutzer bestätigte
Workflow-Instruction (Modus dokumentiert, siehe Bootstrap).

**Terminal-UI (Phase 1 + 2) ist implementiert und live verdrahtet** — siehe unten.
Die sichtbare manuelle Abnahme (Checkpoints UI-030/034/035/038) ist noch offen;
die Verdrahtung der UI in den echten Worker/CLI läuft (FM-EVT-Marker,
Worker-TUI über `ui/start-dock.cmd`). Der genaue Status steht in `ui/PLAN.md`.

---

## Für Agents: LIES DAS. Wirklich.

Dieses Repo beschreibt sich selbst. Bevor du irgendetwas anfasst:

1. **Rate nicht.**
   Lies erst. Wenn du etwas nicht geprüft hast, ist es in deiner Antwort keine
   Tatsache, sondern Geräusch. Behauptungen ohne `node --test …` sind hier
   Behauptungen — der nächste Agent wird deine Lügen sonst reparieren müssen.
2. **Dein Auftrag hat einen Scope.**
   Fass nur an, wozu du beauftragt bist. Nicht „nebenbei" reparieren, nicht
   refactoren, nicht aufräumen. Gerade laufende Parallel-Arbeit in `ui/`,
   `cli/` und `tests/` fassen nur an, wenn dein Task es sagt.
3. **TUI-Wissen liegt bereit:**
   - `WIRING.md` (Root) — Architektur-, Integrations- und Modul-Landkarte
   - `ui/PLAN.md` — persistente Task-Chain, **Single Source of Truth**
   - `ui/README-tui.md` — UI-Bedienung, Event-Contract, Design-Check
   Bei Kontextverlust: `WIRING.md` → `ui/PLAN.md` → machen. Nicht raten.
4. **Verifiziere mit den echten Skripten** (unten unter Tests) — oder sag
   ehrlich, dass du es nicht verifiziert hast. Beides ist okay. Nur das
   Dritte, das Erfinden, ist es nicht.
5. **Doku ist Vertrag.**
   Wenn du das README änderst, hältst du es auf dem Stand der Wahrheit —
   sonst lasse es. Halbfertige Halbsätze reparieren ist erlaubt; neue
   Behauptungen ohne Beleg nicht.

---

## Was FalsifyMe ist

Externes, read-only Falsifikations-Gateway: Coding-Agent → CLI → persistierter
Job/Scope → sichtbarer Worker → Falsifikations-Agent → Findings → Verdict →
Folgeaktion für den aufrufenden Agenten.

```text
Coding-Agent
  → CLI (falsify submit …)
  → SQLite-Job und Scope (WAL, ausserhalb des Repos)
  → sichtbarer Worker (Fenster, nie headless)
  → Falsifikations-Agent (read-only Tools: list_dir, read_file, glob)
  → Findings und Verdict
  → Exit-Code für den aufrufenden Agenten
```

Ein Scope ist genau ein Kontext. Jeder Job startet eine neue
Modell-Konversation und darf ausschließlich die Ergebnisse seines eigenen
Scopes verwenden.

### Umsetzbarkeits-Puffer (Intent → Execution)

FalsifyMe steht zwischen dem gesendeten User-Input (= Scope-Header, der
Intent) und der Execution: Bevor das Modell läuft, prüft ein deterministischer
read-only-Check, ob die Einreichung überhaupt umsetzbar ist — Whitelist-
Dateien müssen unter dem Root existieren, Pfade dürfen nicht aus dem
Arbeitsverzeichnis ausbrechen, und der Plan muss den Kopf des Auftrags
adressieren (kein Literalismus-Drift). Die Hinweise gehen als KONTEXT an den
Falsifikations-Agent (Thinker), der die Coder-Annahmen selbst gegen die
echten Dateien prüft (`core/feasibility.mjs`) – der Check erteilt selbst
**kein** Verdict und schließt keinen Job (Verdict-Hoheit bleibt beim Thinker).
Dadurch blockt FalsifyMe fehlerhafte Absichten, ohne das System zu stören.

### Verdicts (so entscheide ich)

| Verdict | Bedeutung |
|---|---|
| `PLAN` | Plan überarbeiten und mit derselben Scope-ID erneut einreichen. |
| `RESEARCH` | FalsifyMe braucht Daten: read-only recherchieren, erneut einreichen. |
| `ASK` | Aufgaben-Mehrdeutigkeit: die Anforderung selbst ist unklar — Rückfrage an den User, danach neu einreichen (Phase bleibt). |
| `WRITE` | Freigabe: der aufrufende Agent darf von read-only auf write wechseln. Ich selbst bleibe read-only. |
| Fehler / kein Verdict | keine Freigabe. Punkt. |

### Unabhängige Gegenprüfung (Evil Twin)

FalsifyMe prüft nicht, ob ein Agent die vorgeschriebene Form erfüllt — es
prüft, ob dessen Behauptungen durch **unabhängige Evidenz** belastbar sind.
Deshalb durchläuft jeder `WRITE`-Kandidat (nach Form-, Evidenz- und
Struktur-Gate) eine **zweite, kontextgetrennte Konversation**: Der
Gegenprüfer (Evil Twin) kennt nur die Falsifikationsversuche des Erstprüfers,
liest die zitierten Dateien selbst und bestätigt (`BESTAETIGT`),
widerspricht (`WIDERSPRUCH`) oder erklärt sie für ungeprüft (`UNKLAR`).
**Fail-closed:** Nur ein sauberes `BESTAETIGT` lässt `WRITE` stehen — jede
Abweichung (auch ein API-Fehler) wird ehrlich als `PLAN` beantwortet, und die
Gegenprüfung landet als eigenes Finding (`wave=evil-twin`) im Scope-Artefakt.
Im Dock erscheint die Phase als `VERIFYING`.

### Exit-Codes (verifiziert in `cli/run.mjs` + `core/verdict.mjs`)

| Code | Bedeutung |
|---:|---|
| 0 | `VERDICT: WRITE` — freigegeben |
| 1 | `VERDICT: PLAN` oder `RESEARCH` — erneut einreichen |
| 2 | ungültige Argumente oder Konfiguration |
| 3 | API-, Laufzeit- oder Verdict-Fehler — **keine Zusage** |
| 5 | `VERDICT: ASK` — Aufgabe mehrdeutig, Rückfrage an den User |

### Scope-Protokoll (Kernregeln)

- Der User-Input wird beim Scope-Start **1:1 als HEADER** gespeichert und
  bleibt in allen Scope-Prompts.
- Nach jedem Modelljob kann ein `SUBPROMPT:`-Block (genau drei Zeilen) das
  Prompt justieren; er wirkt als Fallback gegen Scope-Drift. Die DB wird
  dabei nicht geleert.
- Berechtigungen: Tools sind read-only, Root-Grenzen werden durchgesetzt.
- Whitelist-Vertrag (`--files` bei Einreichung): nicht freigegebene Daten
  sind unsichtbar (auch Namen). Ausnahme, ehrlich benannt: ein Direkt-Run
  ohne `--files` hat keinen Whitelist-Vertrag — der ganze Root ist
  Zugriffsrahmen (das sagt die CLI beim Start dazu).
- Cross-Scope- oder Kontext-Mixing gibt es nicht.

---

## Schnellstart — für neue Nutzer (direkter Installationsweg)

Ein neuer Benutzer kommt mit genau **drei** Befehlen vom GitHub-Repository zum
ersten geprüften Auftrag — ohne einen Entwicklungs-Checkout auseinanderzunehmen.
Es gibt keine hartkodierten Pfade: Programm- und Laufzeitordner werden beim
Installieren automatisch bestimmt und angelegt.

### Voraussetzungen (alle dokumentiert, keine stillen)

| Voraussetzung | Warum | Prüfen |
|---|---|---|
| Node.js ≥ 22.5 | `node:sqlite` (eingebaut) + ink/react | `node --version` |
| Git Bash (Windows) | Die CLI ist eine Bash-CLI — `bash` muss auf dem PATH sein | `bash --version` |
| API-Key (optional) | Nur für einen echten Falsifikations-Lauf nötig (OpenAI-kompatibler Endpunkt) | siehe unten |

Die Installation legt nichts in dein Projekt an: Das Programm liegt im
npm-globalen Ordner, alle Laufzeitdaten (SQLite, Keys, Logs) entstehen
automatisch unter `FALSIFY_HOME` (Default: `~/.Falsify_Private` — private
Wissensdaten, getrennt vom Programm in `~/.Falsify_Core`), außerhalb des Repos.

### INSTALL (ein Befehl, global)

```bash
npm install -g https://github.com/vannon091118/Falsify_Me.git
```

Danach ist `falsify` auf dem PATH. npm erzeugt die Start-Shims für Windows,
Linux und macOS und installiert die Runtime-Abhängigkeiten (`ink`, `react`)
automatisch mit. Hinweis für spätere Veröffentlichung: sobald das Paket auf
npm liegt, geht auch `npm install -g falsifyme`.

### START & Prüfung

```bash
falsify doctor
```

Erwartet: Node-Version, Abhängigkeiten (ink/react) OK, `FALSIFY_HOME`-Pfad,
API-Key-Status, SQLite-WAL — am Ende eine klare Meldung, was fehlt (falls
etwas fehlt) und `OK`, wenn alles passt.

### Erster Auftrag (User-Workflow)

```bash
falsify ensure-home                                    # FALSIFY_HOME (~/.Falsify_Private) anlegen
falsify scope new "Mein Auftrag 1:1"                   # Scope mit HEADER = User-Input
# Plan-Datei anlegen (z.B. plan.txt), dann:
falsify submit --scope <scope-id> --plan-file plan.txt --root <projekt> --files "app.js,lib/auth.js"
```

- Der Submit legt den Job in die SQLite-Queue (`JOB_ID=…`) und wartet bis zum
  Verdict (Exit 0=WRITE · 1=PLAN/RESEARCH · 5=ASK · 3=Fehler).
- Optional beim Einreichen: `--agent-intent "…"` (Agent-eigenes Verständnis
der Aufgabe — FalsifyMe prüft die Divergenz zum User-Wunsch als eigenen
Punkt) und `--affected "a.js,b.js"` (betroffene Daten).
- **Selbstprüfung ohne blinde Bereiche:** Ist das Ziel ein eigenes
  FalsifyMe-Checkout (Marker unter `--root`), erweitert FalsifyMe die
  Whitelist automatisch um die Prüf-Kernkomponenten (`Selbstprüfung
erkannt: …`) — der Prüfmechanismus ist nie unsichtbar. Fremdprojekte
  bleiben unverändert.
- Ein Worker verarbeitet den Job live: sichtbares Dock-Fenster über
  `ui/start-dock.cmd` bzw. das Desktop-Icon, oder headless über
  `node "$(npm root -g)/falsifyme/ui/worker.mjs"`.
- Ergebnis: `=== <job-id>: DONE WRITE/PLAN/RESEARCH ===`, Befund + Findings via
  `falsify log <job-id>`, Antwort via `falsify answer <job-id>`.

### API-Key konfigurieren (falls noch keiner gesetzt ist)

```bash
falsify settings set apiBase="https://…" model="…" apiKeyName="MEIN_API_KEY"
falsify models        # listet verfügbare Modelle des konfigurierten Endpunkts
```

Keys liegen ausschließlich in `FALSIFY_HOME/.env` (private Rechte), nie im
Repo und nie in `config.json`.

### API-Key / `.env` manuell einrichten

> Wegweiser: Der automatische Key-Onboarding ist als Task `UI-073` im PLAN
> notiert; bis dahin gilt diese Anleitung. Der häufigste Fehler: `falsify doctor`
> meldet `Kein API-Key`, obwohl die Datei existiert — dann enthält die `.env`
> nur die leere Vorlage aus `ensureFalsifyHome()` (Werte hinter `=` fehlen).

**Schritt 1 — `FALSIFY_HOME` finden** (Default `~/.Falsify_Private` — die
privaten Wissensdaten von FalsifyMe, getrennt vom Programm in
`~/.Falsify_Core`; per `FALSIFY_HOME`-Env-Variable überschreibbar):

```bash
falsify ensure-home        # legt ~/.Falsify_Private mit .env-Vorlage + logs/ an
```

**Schritt 2 — Key eintragen.** Entweder per CLI (empfohlen, schreibt automatisch
mit privaten Rechten):

```bash
# Provider-neutral: Name des Key laut Dienste-Anbieter wählen
falsify settings set apiKeyName="NVIDIA_API_KEY" apiKey="<dein-key>"
# bzw. für einen anderen OpenAI-kompatiblen Endpunkt:
falsify settings set apiBase="https://mein.endpunkt/v1" model="mein/modell"
```

Oder direkt die Datei `~/.Falsify_Private/.env` (Windows:
`%USERPROFILE%\.Falsify_Private\.env`) mit einem Editor öffnen und den Wert
hinter das `=` setzen:

```text
# ~/.Falsify_Private/.env  (UTF-8, eine Zeile je Key, KEINE Anführungszeichen nötig)
NVIDIA_API_KEY=abc123…
OPENAI_API_KEY=
FALSIFY_API_KEY=
```

**Schritt 3 — verifizieren:**

```bash
falsify doctor
```

Erwartet: `✅ Config: …` und `✅ API-Key` (bzw. kein `Kein API-Key`-Eintrag).
Der Key ist nie leer auszufüllen: `NVIDIA_API_KEY=` (ohne Wert) zählt als
„nicht konfiguriert". Nach dem Setzen wirken Änderungen beim nächsten
CLI-Aufruf — `falsify settings set …` muss einmalig ausgeführt werden, damit
auch `config.json` (`apiKeyName`) passend geschrieben wird.

**Hinweis Open-Source/Backup:** Die `.env` enthält private Zugangsdaten —
niemals committen, niemals teilen; bei Migrationen `FALSIFY_HOME` sichern.

### Onboarding (FALSIFYME redet direkt mit dir)

Nach der Installation kannst du die Ersteinrichtung als echten Dialog laufen
lassen — FalsifyMe fragt dich Schritt für Schritt:

```bash
falsify onboard            # interaktiv: API-Endpunkt → Modell → Key-Name →
                           # API-Key (maskiert) → /models abrufen? → Dock-Start
falsify onboard --skip-dock
```

Der Dialog schreibt die Runtime-Settings (Keys nur in `FALSIFY_HOME/.env`,
Rechte 0600, nie in Ausgabe/JSON), ruft optional die Modellliste des
Endpunkts live ab und startet danach das sichtbare Worker-Dock (Windows).
Ohne Terminal verweigert der Befehl ehrlich (Exit 2) und verweist Agents auf
`falsify settings set …`.

### Fehlerfälle (erwartetes Verhalten)

| Situation | Ausgabe / Verhalten |
|---|---|
| Kein API-Key konfiguriert | `FEHLER: Kein API-Key gefunden (gesucht: …)`, Exit 2 |
| Kein `bash` (Windows ohne Git Bash) | `FEHLER: bash wurde nicht gefunden …`, Exit 3 |
| Node < 22.5 | npm-Warnung `EBADENGINE`; `falsify doctor` meldet die Node-Anforderung |
| FalsifyMe/Worker nicht erreichbar | Job bleibt `QUEUED`; `falsify wait` pollt weiter (kein Fake-Verdict) |
| Provider nicht erreichbar | HTTP-Fehler von `falsify submit`/`run`, Exit 3 |
| `falsify onboard` ohne Terminal | klare Meldung + Hinweis auf `settings set`, Exit 2 |

### Volle Installation (optional: Desktop-Icons, Worker-Dock, Agent-Skills)

```bash
node "$(npm root -g)/falsifyme/install.mjs"
```

Installiert die Desktop-Icons (`FalsifyMe.lnk`, `FalsifyMe-TUI-Test.lnk`),
legt den Worker-Dock an und kopiert die Agent-Skills (`falsifyme`,
`falsifyme-falsiflow` und `falsifyme-selfinstall`) nach `~/.agents/skills/`.
`falsifyme-selfinstall` weist den Coding-Agenten an, sich selbst einen
funktionierenden, ausführbaren FalsifyMe-Skill einzurichten (siehe auch
`skills/falsifyme-selfinstall.md`). Überspringen mit `--no-desktop`.

---

## Installation aus GitHub / Benutzerinstallation

Die empfohlene Installation legt FalsifyMe getrennt von privaten Laufzeitdaten
an:

- Programmdateien und npm-Abhängigkeiten: `%USERPROFILE%\\.Falsify_Core`
- SQLite, API-Keys und Logs: `%USERPROFILE%\\.Falsify_Private`
- globale Agent-Skills: `%USERPROFILE%\\.agents\\skills\\falsifyme`
- FalsiFlow-Session-Skill: `%USERPROFILE%\\.agents\\skills\\falsifyme-falsiflow`
- Self-Install-Skill: `%USERPROFILE%\\.agents\\skills\\falsifyme-selfinstall`
- Windows-Desktop-Icons: `FalsifyMe.lnk` (startet den Worker-Dock, echte Jobs
  live sichtbar) + `FalsifyMe-TUI-Test.lnk` (kompletter Verifikationslauf);
  Überspringbar mit `--no-desktop`

Aus einem GitHub-Checkout oder Release-Verzeichnis:

```bash
npm install
npm run install:user
```

Der Installer kopiert das Projekt nach `.Falsify_Core`, installiert dort die
npm-Abhängigkeiten und erkennt den globalen Benutzerordner `.agents`. Fehlt er,
wird er mit dem FalsifyMe-Skillpfad angelegt. Die Installation ist idempotent.
Auf Windows werden zwei Desktop-Icons erstellt: `FalsifyMe.lnk` (startet den
Worker-Dock — echte Jobs aus der SQLite-Queue, live in der TUI sichtbar; kein
Demo-Modus) und `FalsifyMe-TUI-Test.lnk` (kompletter Verifikationslauf). Mit
`node install.mjs --no-desktop` werden sie ausgelassen.

`winget` wird nicht als Voraussetzung behauptet: Es ist nur ein möglicher Weg,
Node.js/Git bereitzustellen. npm installiert FalsifyMe nicht automatisch aus
diesem privaten Repository, solange kein veröffentlichter npm-Paketname und kein
GitHub-Release-Workflow eingerichtet ist.

## Betrieb

Alle Laufzeitdaten liegen **ausserhalb des Repos** in `FALSIFY_HOME`
(Standard: `~/.Falsify_Private` bzw. `%USERPROFILE%\.Falsify_Private` —
private Wissensdaten des Nutzers, kein Sammeln, keine Telemetrie; die
Programmdateien liegen getrennt in `~/.Falsify_Core`):

```text
FALSIFY_HOME/
├── .env          API-Keys (provider-neutral, z.B. NVIDIA_API_KEY / OPENAI_API_KEY)
├── config.json   optionale Konfiguration (apiBase, model, maxTokens, …)
├── falsify.db    SQLite im WAL-Modus
└── logs/         Worker- und Antwortprotokolle
```

Priorität: Prozessumgebung → `config.json` → Defaults. OpenAI-kompatible
Endpunkte (OpenAI, NVIDIA NIM, Ollama, …) können zur Laufzeit frei gesetzt
werden. Provider, API-Base und Modell werden nicht aus einer festen Modellliste
gewählt; sie kommen aus den Runtime-Settings. Die Modellliste wird optional
live vom konfigurierten Provider über `/models` abgerufen. Pricing wird nur
angezeigt, wenn es der Provider liefert oder du es in `config.json` hinterlegst
— FalsifyMe erfindet keine Preise.

```bash
falsify settings show
falsify settings set provider="Mein Provider" apiBase="https://example.invalid/v1" model="mein/modell"
falsify settings set apiKeyName="MEIN_API_KEY" apiKey="secret"
falsify models
falsify models --api-base "https://example.invalid/v1" --api-key "$MEIN_API_KEY"
```

`settings show` maskiert Secrets. API-Keys werden ausschließlich außerhalb des
Repos in `FALSIFY_HOME/.env` gespeichert; Provider, Modell und API-Base liegen
in `FALSIFY_HOME/config.json`. Änderungen wirken beim nächsten Runtime-Aufruf,
ohne Codeänderung. Ungültige Werte werden abgewiesen. Keys gehören nie ins Repo.

Arbeiter läuft **immer sichtbar in einem Fenster** (`ui/start-dock.cmd`,
bis zu 3 parallel, atomarer Claim über SQLite). Headless-Betrieb gibt es
nicht.

## Terminal-UI (Phase 1 + Phase 2 — live verdrahtet)

Ein sichtbares Worker-Fenster: Man schaut zu, mehr nicht (plus `Q`/`STRG-C`
= Abort). Maschinen-Boot-Intro, fallende Code-Partikel als Aktivität,
THINKING/REASONING-Umschalter (`T`), echte Progress-Balken ohne
Fake-Prozente, Findings-Zähler, Verdict-Animation. 105 Unit-/Pipeline-/E2E-/Kill-Tests grün; Abort tötet echte
Kindprozesse inkl. PID-Check.

**Phase 2 ist verdrahtet (kein Demo mehr):** Der Produktpfad emittiert
`FM-EVT:`-Marker — `cli/run.mjs` (Job/Scope, LOADING/THINKING/Phasen, echte
Tool-Aktivität über den additiven `onTool`-Callback in `core/agent.mjs`,
FINDINGS/Befund, Verdict, done) und `ui/worker.mjs` (Claim/Abort). Das
Dock-Fenster (`ui/start-dock.cmd` 1..3) hostet die TUI direkt: `createTui` +
`createParser`-Feed aus dem run.mjs-Kind, `Q` killt den echten Job
(PID-verifiziert), die Headless-/Text-Ausgabe des Workers bleibt unverändert.
Marker erscheinen nur mit `FALSIFY_UI=1` (setzt der Worker) — die CLI-
Ausgabe für Agents ändert sich nicht. Verifikation: `npm run test:phase2`
(4 Tests mit echten Kindprozessen: Marker-Gate, Parser→UI-Zustand,
Worker-Loop). Die sichtbare E2E-Abnahme läuft via `npm run selftest`: das
Testfenster öffnet sich per PowerShell `Start-Process` (MSYS-sicher, auch
aus Agent-Shells) und wurde am 2026-09-01 BESTANDEN (Exit 0, alle 7
Schritte grün).

```text
Doppelklick:  ui\START-TUI.cmd   (Intro -> WARTE AUF EINGABE; kein Auto-Job)
              ui\TEST-TUI.cmd    (kompletter Verifikationslauf)
Desktop:      FalsifyMe.lnk (Dock - echte Jobs live) ·
              FalsifyMe-TUI-Test.lnk (Verifikation) ·
              FalsifyMe-TUI-Start.lnk (Beobachtung, opt-in)
Terminal:     node ui/tui-demo.mjs                  (Intro -> WARTE AUF EINGABE)
              node ui/tui-demo.mjs --auto --fast     (opt-in Demo)
```

**FalsiFlow:** Der globale Skill `skills/falsifyme.md` beschreibt den
Session-Workflow: ein Scope, User-Input unverändert als Header, read-only
Prüfung vor Änderungen und Review im selben Scope. Der Session-Skill
`skills/falsifyme-falsiflow.md` (installiert als `falsifyme-falsiflow`)
führt den kompletten FalsiFlow aus und nutzt dabei aufgelöste Pfade
(`~/.Falsify_Core` — mit führendem Punkt), nie hartkodierte Benutzerpfade.
Die TUI bleibt reine Beobachtung; Skills lösen keine versteckte UI-Steuerung
aus.

**Ehrlich bleiben:** Phase 2 ist umgesetzt und per `npm run test:phase2`
verifiziert (siehe oben). Die sichtbare Selbsttest-Abnahme (`npm run selftest`,
aus einer User-Konsole) und die manuellen visuellen Checkpoints der Phase 1
(`ui/PLAN.md` UI-030/034/035/038) stehen noch offen — UI-053/054 sind dort
ehrlich `IN_PROGRESS`. Neue Behauptungen über die Verdrahtung gehören zu
WIRING.md + `ui/PLAN.md` (BLOCK 6), nie nur in eine Antwort.

## CLI

```bash
falsify ensure-home | doctor
falsify scope new "<user-input>" | scope show <id> | scope list
falsify submit --scope <id> --plan-file plan.txt --root <dir> --files "a,b"
falsify wait <job-id> [--ping|--abort] | status <job-id> | jobs | state
#   --ping = eine Auswertungsrunde (STATUS <zustand> <sek>; Exit 4 = läuft noch,
#   der Coder wertet selbst aus) · --abort = Job abbrechen (keine Freigabe)
falsify abort <job-id>          # CLI-Abbruch: setzt Flag, Worker killt den Job echt
falsify log <job-id> | answer <job-id> | history
falsify onboard [--skip-dock]   # interaktive Ersteinrichtung (Dialog)
falsify uninstall [--dry-run]   # vollständige Deinstallation
```

`--files` ist die Whitelist des Modellzugriffs. Die Agent-Tools können nur
`list_dir`, `read_file` und `glob` — schreiben können sie nicht.
Root-Brüche, `..`, absolute Pfade und Symlink-Escapes werden blockiert.

## Tests (die echten, nicht die erfundenen)

```bash
npm run test:security     # Security-/Regressionstests (tests/security.test.mjs)
npm run selftest          # Produkt-E2E: CLI→Queue→sichtbares Fenster→Worker→
                          # run.mjs→ERROR-Pfad ohne Key; Read-only-Checksummen
npm run doctor            # Umgebungs-/Config-Checks ("bash falsify doctor")

npm run test:phase2       # FM-EVT-Verdrahtung (tests/phase2.test.mjs): Marker-Gate,
                          # Parser→UI-State, Worker-Loop headless

# Terminal-UI (105 Tests):
node --test --test-force-exit --test-concurrency=1 "ui/tui/*.test.mjs" ui/tui.test.mjs ui/demo-agent.test.mjs

# Runtime-Settings und Provider-Modelle:
falsify settings show
falsify settings set provider="Provider-Name" apiBase="https://host/v1" model="model-id"
falsify settings set apiKeyName="PROVIDER_KEY" apiKey="secret"
falsify models --api-base "https://host/v1"
```

Der Selbsttest startet den echten Produktions-Worker über den sichtbaren
`ui/start-dock.cmd`-Pfad, prüft den atomaren Claim, den persistenten
Fehlerstatus und die Read-only-Checksummen des Repos. Ohne Windows-`cmd.exe`
bricht er bewusst ab — es gibt keinen headless Fallback.

## Struktur

```text
artifacts/   SQLite (WAL), Scopes, Findings, Jobs, atomarer Worker-Claim
core/        Agent, Prompts, Verdict, Config, Keys, Sandbox, Rate-Limit
cli/         CLI-Kommandos und Bash-Forwarder (falsify)
tests/       Security- und Regressionstests
ui/          Terminal-UI (Phase 1+2, live verdrahtet) + Worker-Fenster +
             Teststarter/Beobachtung (tui-demo.mjs nur für Tests/Demo)
skills/      Agent-Integrationen für Bash, Node.js und PowerShell
WIRING.md    Integrations-/Modul-Landkarte (Einstieg für Agents)
```

## Technik

- Node.js `>=22.5.0` (engines), `node:sqlite` eingebaut; Windows/Linux/macOS.
- Produktkern dependency-frei; einzige Runtime-Dependencies sind `ink` +
  `react` (Terminal-UI). `npm install` ist dennoch nötig.
- MIT-Lizenz, siehe `LICENSE`.
### INSTALL + BOOTSTRAP (ein Befehl, aktiviert den Workflow)

Der Bootstrap ist der Einstiegspunkt für Coding-Agenten. Nach der Installation
aktiviert er den FalsifyMe-Workflow — ohne weitere manuelle Aktivierung.

```bash
# Vollständige Installation + Agent-Integration + Dock-Start
node install.mjs
node cli/bootstrap.mjs

# Oder über die Bash-CLI:
falsify bootstrap

# Flags: --dry-run (kein Schreiben), --skip-dock (kein Dock-Start),
#        --no-desktop (keine Desktop-Icons; Default = volle Installation
#        inkl. Icons, wie node install.mjs)
# Node-CLI-Pfad: node cli/main.mjs bootstrap
```

Der Bootstrap:

1. **Installiert FalsifyMe** — das existierende `install.mjs` (Paket-Root).
2. **Detektiert den Agenten** — Codebuff/Freebuff, Bash, PowerShell oder generisch.
3. **Schreibt eine persistente Instruction-Datei** — `AGENTS.md` im Projekt-Root
   (Codebuff/Freebuff), `~/.falsifyme-instructions.sh` (Bash) oder
   `~/.falsifyme-instructions.ps1` (PowerShell), `FALSIFYME-WORKFLOW.md` (generisch).
   Die Datei enthält die realen Skill-Pfade (`~/.agents/skills/falsifyme/`,
   `~/.agents/skills/falsifyme-falsiflow/SKILL.md`) und das Verdict-Routing
   (Exit 0 = WRITE/Freigabe, 1 = PLAN/RESEARCH/Loop, 2/3 = keine Freigabe)
   und zwingt den Agenten in den FalsiFlow.
4. **Startet das sichtbare Dock** — Windows-only (`ui/start-dock.cmd`);
   auf anderen Plattformen meldet der Bootstrap das ehrlich und nennt
   den Worker-Aufruf (`node ui/worker.mjs`).

**Zwingende Entscheidung (Skill `falsifyme-selfinstall`):** Nach der
Installation legt der Coding-Agent mit dem Nutzer Reichweite (`projekt` /
`global` / `aus`) und Betriebsmodus (`PFLICHT` / `optional`) fest und
dokumentiert ihn als Kopfzeile in der Instruction-Datei. **Nur bei `PFLICHT`**
wird FalsifyMe zum letzten Git-Check-Gate (Agent bleibt bis `VERDICT: WRITE`
read-only); bei `optional` ist FalsifyMe Empfehlung ohne Enforcement. Keine
stille Gate-Aktivierung.

Rollen: FalsifyMe = unabhängiger read-only Falsifizierungs-Agent ·
Coding-Agent = eigentliche Arbeits-/Write-Instanz ·
Dock = sichtbare Visualisierung der laufenden FalsifyMe-Arbeit ·
Installation = aktiviert die FalsifyMe-Workflow-Integration.

**Deinstallation (vollständig und sauber):**

```bash
node uninstall.mjs --dry-run          # Vorschau, ändert nichts
node uninstall.mjs --project-root DIR  # + Zielprojekt-Instruction entfernen
node uninstall.mjs                    # komplette Rückabwicklung
```

Entfernt Worker-Fenster, `~/.Falsify_Core`, `~/.Falsify_Private`,
`~/.agents/skills/falsifyme*`, die Instruction-Dateien und Profil-Marker,
den Instruction-Block im Zielprojekt, `~/.Falsify_Private` (FALSIFY_HOME inkl.
DB/Logs; enthaltene API-Keys werden VORHER nach
`~/.Falsify.env.uninstall-backup` gesichert) und npm-Global-Shims.
`--keep-env` behält FALSIFY_HOME.

Verifikation:

```bash
node --test tests/bootstrap.test.mjs
node cli/bootstrap.mjs --dry-run --skip-dock
node uninstall.mjs --dry-run
```

FalsifyMe bleibt read-only; der Coding-Agent bleibt für alle Änderungen
verantwortlich.
