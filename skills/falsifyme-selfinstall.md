---
name: falsifyme-selfinstall
description: Richtet FalsifyMe für den Coding-Agenten selbst ein — installieren, dann ZWINGEND mit dem Nutzer Reichweite und Betriebsmodus entscheiden (nur bei PFLICHT wird FalsifyMe zum Git-Check-Gate), und auf Wunsch vollständig deinstallieren. Diese Skill verwenden, wenn der Nutzer FalsifyMe installieren, den Agent-Skill einrichten, prüfen oder entfernen will ("Installier bitte falsifyme von github", "INSTALLIER BITTE https://github.com/vannon091118/Falsify_Me", "set up falsifyme for your agent", "instaliere den falsify-Skill", "bootstrap falsifyme", "deinstalliere falsifyme"), auch wenn er nicht wörtlich "Skill" sagt. Formuliert die Verbindlichkeit (PFLICHT vs. optional) als ehrliche Nutzer-Entscheidung — keine stille Gate-Aktivierung. Startet den FalsiFlow erst NACH erfolgreicher Installation UND bestätigtem Betriebsmodus.
---

# FalsifyMe Self-Install (Agent-Gate)

Ein Coding-Agent bekommt schlicht
„INSTALLIER BITTE https://github.com/vannon091118/Falsify_Me" — und übernimmt
danach selbständig FalsifyMe als installierbares Agent-Gate. Ablauf:

```text
1. Installation (zuerst)      node install.mjs
2. ERZWUNGENE Entscheidung    Reichweite + Betriebsmodus (mit dem Nutzer)
3. Aktivierung nach Modus     nur PFLICHT macht FalsifyMe zum Git-Check-Gate
4. Verifikation               ausführbar, ehrlich berichten
5. (später) Deinstallation    node uninstall.mjs —— vollständig rückabwickeln
```

FalsifyMe ist ein read-only Falsifikations-Gateway. Es schreibt **niemals** in
das geprüfte Projekt — die einzige Ausnahme ist der physische
`FalsifyME.md`-Projektanker (Identität + vom Nutzer bestätigte Decision-
Records, einmal beim Bootstrap/`falsify anchor init`; er enthält nie Scopes,
Findings, Verdicts oder Regeln). Bis `VERDICT: WRITE` (Exit 0) bleibt der
Coding-Agent read-only. Und: **Du aktivierst kein Gate still.** Die Verbindlichkeit
(PFLICHT oder optional) ist eine ausdrückliche Nutzer-Entscheidung.

## Warum das wichtig ist

Ohne den installierten Skill endet jede `falsify submit`-Einreichung in
Raten statt in einer Freigabe. Mit installiertem Skill:

```text
Du → bash ~/.agents/skills/falsifyme/agent-skill-falsify.sh → FalsifyMe → Dock → Verdict → Du
```

Exit 0 = WRITE (Freigabe) · Exit 1 = PLAN/RESEARCH (Loop) · Exit 2/3 = keine Freigabe.

## Ablauf (in dieser Reihenfolge)

### 1. Quelle bestimmen

- **GitHub-URL** (Standard): `https://github.com/vannon091118/Falsify_Me.git`
- **Lokaler Checkout**, falls vorhanden (das ist dein aktuelles Projekt-Root,
  wenn du im Repo stehst; dann ist `install.mjs` direkt dort).
- Bevorzugt den lokalen Checkout, wenn er existiert — er ist die aktuelle
  Wahrheit und spart einen Netzwerk-Fetch.

### 2. Installieren (ein Befehl)

Aus dem Checkout-Root (oder nach `git clone`):

```bash
node install.mjs
```

Das legt an (alles idempotent, keine hartkodierten Nutzerpfade im Code):

| Ziel | Inhalt |
|---|---|
| `~/.Falsify_Core` | Programm (CLI, Worker, UI), `install-location.json` |
| `~/.Falsify_Private/logs` | private Laufzeit-Daten |
| `~/.agents/skills/falsifyme/` | ausführbare Skills (`.sh`, `.mjs`, `.ps1`) |
| `~/.agents/skills/falsifyme-falsiflow/` | Session-FalsiFlow (SKILL.md) |
| `~/.agents/skills/falsifyme-selfinstall/` | dieser Skill |
| Desktop-Icons (Windows, optional `--no-desktop`) | `FalsifyMe.lnk` + `FalsifyMe-TUI-Test.lnk` |

Schlägt der Befehl fehl: **stoppen**, Fehlermeldung wörtlich übernehmen,
nicht weiterraten.

### 3. Agent-Integration bereitstellen (noch kein Gate)

```bash
node cli/bootstrap.mjs
```

Der Bootstrap erkennt den Agenten (Codebuff/Freebuff, Bash, PowerShell,
generisch), schreibt die persistente Instruction-Datei (z. B. `AGENTS.md` im
Projekt-Root für Codebuff/Freebuff, `~/.falsifyme-instructions.sh`/`.ps1`
sonst) und startet das sichtbare Worker-Dock (Windows).

**Wichtig:** An dieser Stelle ist FalsifyMe installiert, aber noch KEIN
zwingendes Gate. Die Instruction-Datei wird erst im nächsten Schritt auf den
vereinbarten Modus zugeschnitten.

### 3b. ZWINGENDE Entscheidung: Reichweite + Betriebsmodus (mit dem Nutzer)

Bevor irgendetwas als Gate wirkt, legst du mit dem Nutzer zwei Dinge fest
und dokumentierst sie in der Instruction-Datei. Das ist kein Höflichkeitsschritt,
sondern Teil des Auftrags: **keine stille Gate-Aktivierung.**

**Frage A — Reichweite (wo gilt FalsifyMe?):**

| Option | Bedeutung |
|---|---|
| `projekt` | Nur das aktuelle Zielprojekt (AGENTS.md / FALSIFYME-WORKFLOW.md dort) |
| `global` | Alle Projekte dieses Nutzers/Rechners (Home-Instruction-Datei + Profil-Marker) |
| `aus` | Keine aktive Integration — Installation nur als Werkzeug, kein Workflow |

**Frage B — Betriebsmodus (wie verbindlich?):**

| Option | Bedeutung |
|---|---|
| `PFLICHT` | FalsifyMe IST das letzte Git-Check-Gate: vor jedem Write/Commit `VERDICT: WRITE` erforderlich; Agent bleibt bis dahin read-only |
| `optional` | Empfohlen, aber nicht blockierend: FalsifyMe wird genutzt, wenn der Nutzer es verlangt; kein erzwungener Check |

Regel:

- **Nur `PFLICHT`** macht FalsifyMe zum zwingenden Check-Gate (`VERDICT: WRITE`
  vor Write/Commit, Loop bei PLAN/RESEARCH, Exit 2/3 = keine Freigabe).
- Bei `optional` oder unklarer Antwort aktivierst du **kein** Enforcement —
  die Instruction-Datei dokumentiert den Modus ehrlich („FalsifyMe ist
  installiert und empfohlen; der PFLICHT-Check ist deaktiviert").
- Sag dem Nutzer wörtlich, was gewählt wurde — und was das heißt.

**Eintrag in die Instruction-Datei** (Kopfzeile, je Format):

```text
# FALSIFYME-MODUS: <projekt|global> · <PFLICHT|optional>
```

- `AGENTS.md` / `FALSIFYME-WORKFLOW.md` (Markdown):
  `<!-- FALSIFYME-MODUS: … -->`
- `.sh` / `.ps1` Instruction: `# FALSIFYME-MODUS: …`

Ohne diesen dokumentierten Modus-Eintrag gilt der Bootstrap als nicht
abgeschlossen — melde es, statt zu raten.

### 4. Ausführbarkeit verifizieren (Pflicht — keine Behauptungen ohne Beleg)

Danach — und erst danach — wirkt der Modus: Bei `PFLICHT` ist FalsifyMe das
letzte Git-Check-Gate; bei `optional` bleibt es Empfehlung.

Prüfe jede Zeile, bevor du „installiert" sagst:

```bash
# a) Node-Version erfüllt (>= 22.5)
node --version

# b) Der installierte Skill IST ausführbar (Node-CLI):
node ~/.agents/skills/falsifyme/agent-skill-falsify.mjs --help
#    → Exit 0 UND Hilfe-Text; jeder andere Exit = Fehler

# c) Die CLI meldet die erwartete Leistung:
node ~/.Falsify_Core/cli/main.mjs doctor
#    → FALSIFY_HOME, DB (WAL), Dependencies ok; `Kein API-Key` ist KEIN
#      Installationsfehler (siehe Abschnitt API-Key unten), nur ein Hinweis.

# d) Worker-Dock läuft (Windows):
node ~/.Falsify_Core/ui/worker.mjs --check
#    → "RUNNING" erwartet; sonst: ui/start-dock.cmd 1 manuell starten.
```

Verifikation ehrlich berichten: Was du NICHT geprüft hast, sagst du auch —
kein erfundener Exit-Code.

### 5. API-Key (nur wenn ein echter Falsifikations-Lauf gewünscht ist)

`falsify doctor` zeigt `Kein API-Key`, wenn `~/.Falsify_Private/.env` nur die leere
Vorlage enthält (`ensureFalsifyHome()` schreibt `NVIDIA_API_KEY=`,
`OPENAI_API_KEY=`, `FALSIFY_API_KEY=` **ohne Wert**).

- **Key vorhanden (vom Nutzer)?** → eintragen (niemals selbst erfinden):
  ```bash
  falsify onboard          # Dialog: FALSIFYME fragt Endpunkt/Modell/Key-Name/Key
                           # (maskiert) direkt ab und schreibt die Settings
  # oder non-interaktiv (Agents):
  node ~/.Falsify_Core/cli/main.mjs settings set apiKeyName="NVIDIA_API_KEY" apiKey="<wert>"
  ```
  Keys gehören ausschließlich in `~/.Falsify_Private/.env` (Rechte 0600) — nie ins
  Repo, nie in chat/Logs ausgeben.
- **Kein Key vorhanden?** → Installationsziel ist erreicht; ehrlich sagen:
  „Ohne API-Key endet jeder echte Job mit Exit 3 (keine Freigabe). Key kann
  jederzeit später per `falsify settings set apiKeyName=… apiKey=…` ergänzt
  werden." (Detaillierte Anleitung: README → „API-Key / `.env` manuell einrichten".)

### 6. Abschlussbericht

Melde dem Nutzer knapp und ehrlich: installiert nach `~/.Falsify_Core` ✓,
Skills unter `~/.agents/skills/` ✓, ausführbar (Exit 0 beim `--help`-Test) ✓,
Dock RUNNING ✓/✕, **Modus: `<projekt|global> · <PFLICHT|optional>`** (explizit
bestätigt) ✓, API-Key konfiguriert ✓/✕. Dann — und erst dann — darf der
FalsiFlow für den eigentlichen Auftrag starten (Skill `falsifyme`).

### 7. Deinstallation (auf Wunsch, vollständig und sauber)

FalsifyMe vollständig rückabwickeln (Gegenstück zu install.mjs — auch von
`~/.Falsify_Core` ausführbar, da uninstall.mjs mit installiert wird):

```bash
# 1) Vorschau, was entfernt würde (nichts wird geändert):
node uninstall.mjs --dry-run

# 2) Zielprojekt-Instruction (AGENTS.md / FALSIFYME-WORKFLOW.md) mitentfernen,
#    falls Reichweite=projekt war:
node uninstall.mjs --project-root /pfad/zum/zielprojekt

# 3) Komplett deinstallieren (Keys werden VORHER nach
#    ~/.Falsify.env.uninstall-backup gesichert):
node uninstall.mjs
```

Was `uninstall.mjs` entfernt: laufende Worker-Fenster, `~/.Falsify_Core`,
`~/.Falsify_Private`, `~/.agents/skills/falsifyme*`, `~/.falsifyme-instructions.{sh,ps1}`,
Marker-Zeilen aus `~/.bashrc` und PowerShell-Profil, `FALSIFYME-WORKFLOW.md`-/`AGENTS.md`-Block
im Zielprojekt, `~/.Falsify_Private` (FALSIFY_HOME: Keys → Backup, DB, Logs) und
npm-Global-Shims. Flags: `--keep-env` behält `~/.Falsify_Private`, `--dry-run` zeigt nur.

**Nach der Deinstallation** verifizierst du ehrlich: `~/.Falsify_Core` weg,
keine `falsify`-Shims auf dem PATH, kein RUNNING-Worker, keine Skill-Ordner
unter `~/.agents/skills/falsifyme*` — und du sagst dem Nutzer, dass die
API-Keys (falls welche da waren) unter `~/.Falsify.env.uninstall-backup` liegen.

## Grenzen (nicht verhandelbar)

- FalsifyMe bleibt read-only; die Installation ändert nie Dateien im
  Zielprojekt des Users — einzige Ausnahme: der `FalsifyME.md`-Anker
  (Identität, keine Scopes/Verdicts/Regeln; Laufzeitzustand nur in SQLite).
- Keine Pfade außerhalb `~/.Falsify_Core`, `~/.Falsify_Private`,
  `~/.agents/skills/…` und `FALSIFY_HOME` (Default `~/.Falsify_Private`) anfassen.
- Keine Keys, keine Secrets im Klartext ausgeben oder committen.
- Bei Fehlern: wörtliche Meldung übernehmen, nicht raten, nicht „War schon so".