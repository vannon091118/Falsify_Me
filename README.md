# FALSIFYME — v0.02 Beta (`0.2.0-beta`)

Ich bin das read-only Falsifikations-Gateway für Coding-Agenten. Ein Agent
behauptet, deine Änderung sei sicher? Ich prüfe das erst — und nur ich sage,
ob er schreiben darf. Ich selbst schreibe **niemals** in das geprüfte Projekt.
Frag mich nicht, wie oft das jemand übersehen hat. Es steht trotzdem hier.

**Terminal-UI (Phase 1) ist implementiert und als Demo lauffähig** — siehe unten.
Die sichtbare manuelle Abnahme ist noch offen; die Verdrahtung der UI in den
echten Worker ist bewusst **Phase 2 (aufgeschoben/offen)**. Der genaue Status
steht in `ui/PLAN.md`.

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

### Verdicts (so entscheide ich)

| Verdict | Bedeutung |
|---|---|
| `PLAN` | Plan überarbeiten und mit derselben Scope-ID erneut einreichen. |
| `RESEARCH` | FalsifyMe braucht Daten: read-only recherchieren, erneut einreichen. |
| `WRITE` | Freigabe: der aufrufende Agent darf von read-only auf write wechseln. Ich selbst bleibe read-only. |
| Fehler / kein Verdict | keine Freigabe. Punkt. |

### Exit-Codes (verifiziert in `cli/run.mjs`)

| Code | Bedeutung |
|---:|---|
| 0 | `VERDICT: WRITE` — freigegeben |
| 1 | `VERDICT: PLAN` oder `RESEARCH` — erneut einreichen |
| 2 | ungültige Argumente oder Konfiguration |
| 3 | API-, Laufzeit- oder Verdict-Fehler — **keine Zusage** |

### Scope-Protokoll (Kernregeln)

- Der User-Input wird beim Scope-Start **1:1 als HEADER** gespeichert und
  bleibt in allen Scope-Prompts.
- Nach jedem Modelljob kann ein `SUBPROMPT:`-Block (genau drei Zeilen) das
  Prompt justieren; er wirkt als Fallback gegen Scope-Drift. Die DB wird
  dabei nicht geleert.
- Berechtigungen: Tools sind read-only, Root-Grenzen werden durchgesetzt.
- Cross-Scope- oder Kontext-Mixing gibt es nicht.

---

## Installation aus GitHub / Benutzerinstallation

Die empfohlene Installation legt FalsifyMe getrennt von privaten Laufzeitdaten
an:

- Programmdateien und npm-Abhängigkeiten: `%USERPROFILE%\\.Falsify_Core`
- SQLite, API-Keys und Logs: `%USERPROFILE%\\.Falsify_Private`
- globale Agent-Skills: `%USERPROFILE%\\.agents\\skills\\falsifyme`
- Windows-Desktop-Icon: optional, nach Bestätigung

Aus einem GitHub-Checkout oder Release-Verzeichnis:

```bash
npm install
npm run install:user
```

Der Installer kopiert das Projekt nach `.Falsify_Core`, installiert dort die
npm-Abhängigkeiten und erkennt den globalen Benutzerordner `.agents`. Fehlt er,
wird er mit dem FalsifyMe-Skillpfad angelegt. Die Installation ist idempotent.
Auf Windows wird ein `FalsifyMe.lnk`-Desktop-Icon erstellt; mit
`node install.mjs --no-desktop` kann es ausgelassen werden.

`winget` wird nicht als Voraussetzung behauptet: Es ist nur ein möglicher Weg,
Node.js/Git bereitzustellen. npm installiert FalsifyMe nicht automatisch aus
diesem privaten Repository, solange kein veröffentlichter npm-Paketname und kein
GitHub-Release-Workflow eingerichtet ist.

## Betrieb

Alle Laufzeitdaten liegen **ausserhalb des Repos** in `FALSIFY_HOME`
(Standard: `~/.Falsify` bzw. `%USERPROFILE%\.Falsify`):

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

## Terminal-UI (Phase 1 — fertig, Demo-Status)

Ein sichtbares Worker-Fenster: Man schaut zu, mehr nicht (plus `Q`/`STRG-C`
= Abort). Maschinen-Boot-Intro, fallende Code-Partikel als Aktivität,
THINKING/REASONING-Umschalter (`T`), echte Progress-Balken ohne
Fake-Prozente, Findings-Zähler, Verdict-Animation.105 Unit-/Pipeline-/E2E-/Kill-Tests grün; Abort tötet echte
Kindprozesse inkl. PID-Check.

```text
Doppelklick:  ui\START-TUI.cmd   (Intro -> WARTE AUF EINGABE; kein Auto-Job)
              ui\TEST-TUI.cmd    (kompletter Verifikationslauf)
Desktop:      FalsifyMe-TUI-Start.lnk / FalsifyMe-TUI-Test.lnk
Terminal:     node ui/tui-demo.mjs                  (Intro -> WARTE AUF EINGABE)
              node ui/tui-demo.mjs --auto --fast     (opt-in Demo)
```

**FalsiFlow:** Der globale Skill `skills/falsifyme.md` beschreibt den
Session-Workflow: ein Scope, User-Input unverändert als Header, read-only
Prüfung vor Änderungen und Review im selben Scope. Die TUI bleibt reine
Beobachtung; Skills lösen keine versteckte UI-Steuerung aus.

**Ehrlich bleiben:** Die Echt-Integration in `ui/worker.mjs`/`cli/run.mjs`
ist **Phase 2 und noch nicht gemacht** — es gibt weder `FM-EVT:`-Marker in
`run.mjs` noch einen umgestellten Worker. Wer das behauptet, hat gelogen.
Wie es geht: `WIRING.md`.

## CLI

```bash
falsify ensure-home | doctor
falsify scope new "<user-input>" | scope show <id> | scope list
falsify submit --scope <id> --plan-file plan.txt --root <dir> --files "a,b"
falsify wait <job-id> | status <job-id> | jobs | state
falsify log <job-id> | answer <job-id> | history
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
ui/          Terminal-UI (Phase 1) + Worker-Fenster + Demo-/Teststarter
skills/      Agent-Integrationen für Bash, Node.js und PowerShell
WIRING.md    Integrations-/Modul-Landkarte (Einstieg für Agents)
```

## Technik

- Node.js `>=22.5.0` (engines), `node:sqlite` eingebaut; Windows/Linux/macOS.
- Produktkern dependency-frei; einzige Runtime-Dependencies sind `ink` +
  `react` (Terminal-UI). `npm install` ist dennoch nötig.
- MIT-Lizenz, siehe `LICENSE`.