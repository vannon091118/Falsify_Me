---
name: falsifyme-selfinstall
description: Richtet FalsifyMe für den Coding-Agenten selbst ein — den ausführbaren Pflicht-Check-Skill nach ~/.agents/skills/ installieren oder verifizieren. Diese Skill verwenden, wenn der Nutzer FalsifyMe installieren, den Agent-Skill einrichten oder prüfen will ("Installier bitte falsifyme von github", "set up falsifyme for your agent", "instaliere den falsify-Skill", "bootstrap falsifyme"), auch wenn er nicht wörtlich "Skill" sagt. Startet den FalsiFlow erst NACH erfolgreicher Installation.
---

# FalsifyMe Self-Install (Agent-Skill)

Dieser Skill hat genau eine Aufgabe: Du (der Coding-Agent) bringst FalsifyMe
dazu, **für dich selbst** zu funktionieren — ein ausführbarer, verifizierter
Agent-Skill landet in `~/.agents/skills/`, damit du vor jeder Code-Änderung
den FalsiFlow-Pflichtcheck ausführen kannst.

FalsifyMe ist ein read-only Falsifikations-Gateway. Es schreibt **niemals** in
das geprüfte Projekt. Bis `VERDICT: WRITE` (Exit 0) bleibt der Coding-Agent
read-only. Das gilt auch während dieser Installation.

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

### 3. Agent-Integration aktivieren

```bash
node cli/bootstrap.mjs
```

Der Bootstrap erkennt den Agenten (Codebuff/Freebuff, Bash, PowerShell,
generisch), schreibt die persistente Instruction-Datei (z. B. `AGENTS.md` im
Projekt-Root für Codebuff/Freebuff, `~/.falsifyme-instructions.sh`/`.ps1`
sonst) und startet das sichtbare Worker-Dock (Windows).

### 4. Ausführbarkeit verifizieren (Pflicht — keine Behauptungen ohne Beleg)

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

`falsify doctor` zeigt `Kein API-Key`, wenn `~/.Falsify/.env` nur die leere
Vorlage enthält (`ensureFalsifyHome()` schreibt `NVIDIA_API_KEY=`,
`OPENAI_API_KEY=`, `FALSIFY_API_KEY=` **ohne Wert**).

- **Key vorhanden (vom Nutzer)?** → eintragen (niemals selbst erfinden):
  ```bash
  node ~/.Falsify_Core/cli/main.mjs settings set apiKeyName="NVIDIA_API_KEY" apiKey="<wert>"
  ```
  Keys gehören ausschließlich in `~/.Falsify/.env` (Rechte 0600) — nie ins
  Repo, nie in chat/Logs ausgeben.
- **Kein Key vorhanden?** → Installationsziel ist erreicht; ehrlich sagen:
  „Ohne API-Key endet jeder echte Job mit Exit 3 (keine Freigabe). Key kann
  jederzeit später per `falsify settings set apiKeyName=… apiKey=…` ergänzt
  werden." (Detaillierte Anleitung: README → „API-Key / `.env` manuell einrichten".)

### 6. Abschlussbericht

Melde dem Nutzer knapp und ehrlich: installiert nach `~/.Falsify_Core` ✓,
Skills unter `~/.agents/skills/` ✓, ausführbar (Exit 0 beim `--help`-Test) ✓,
Dock RUNNING ✓/✕, API-Key konfiguriert ✓/✕. Dann — und erst dann — darf der
FalsiFlow für den eigentlichen Auftrag starten (Skill `falsifyme`).

## Grenzen (nicht verhandelbar)

- FalsifyMe bleibt read-only; die Installation ändert nie Dateien im
  Zielprojekt des Users.
- Keine Pfade außerhalb `~/.Falsify_Core`, `~/.Falsify_Private`,
  `~/.agents/skills/…` und `~/.Falsify` (FALSIFY_HOME) anfassen.
- Keine Keys, keine Secrets im Klartext ausgeben oder committen.
- Bei Fehlern: wörtliche Meldung übernehmen, nicht raten, nicht „War schon so".