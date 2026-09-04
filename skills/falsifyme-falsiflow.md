---
name: falsifyme-falsiflow
description: Den verpflichtenden FalsiFlow-Falsifikations-Workflow vor Codeänderungen mit dem lokal installierten FalsifyMe-Gateway ausführen. Verwenden, wenn der Nutzer um Falsifizieren, Verify-before-Write, einen FalsifyMe-Check, das Einreichen eines Plans zur Falsifikation bittet oder vor Implementierungsänderungen FalsiFlow / FalsifyMe / "falsyfiME" / Scope-Protokoll erwähnt. Auch nach der Implementierung für den Review-im-gleichen-Scope-Schritt verwenden.
---

# FalsifyMe / FalsiFlow Session-Workflow

FalsifyMe ist ein externes, read-only Falsifikations-Gateway: Coding-Agent → CLI → SQLite-Job/Scope → sichtbarer Worker → Falsifikations-Agent → Befunde → Verdict → Exit-Code für dich. Es schreibt nie in das geprüfte Projekt — die eine explizite Ausnahme ist der physische `FalsifyME.md`-Projekt-Anker (Identität + nutzerbestätigte Entscheidungs-Records, einmalig bei Bootstrap/`falsify anchor init` erzeugt; er hält nie Scopes, Befunde, Verdicts oder Regeln). Du bleibst read-only, bis FalsifyMe dich freigibt.

## Installationsorte (auflösen — nie einen Benutzernamen hartkodieren)

Der Installer (`node install.mjs`, aus einem FalsifyMe-Checkout ausgeführt) legt
alles unter dem Home-Verzeichnis des Nutzers ab. Die exakten Pfade der letzten
Installation stehen in `~/.Falsify_Core/install-location.json`:

- Programm: `~/.Falsify_Core` (Windows: `%USERPROFILE%\.Falsify_Core`) — CLI-Einstieg
  `node cli/main.mjs`, Worker-Check `node ui/worker.mjs --check`, Dock-Start
  `ui/start-dock.cmd`
- Private Daten + Runtime-Home: `~/.Falsify_Private` (FALSIFY_HOME: Logs,
  config.json, .env, falsify.db)
- Agent-Skills (installiert): `~/.agents/skills/falsifyme`
  (`agent-skill-falsify.sh/.mjs/.ps1`) und dieser Skill
  (`~/.agents/skills/falsifyme-falsiflow`)

> **GOTCHA (der #1-Bruch):** das Installationsverzeichnis heißt
> `.Falsify_Core` — mit führendem Punkt. `~/Falsify_Core` (ohne Punkt)
> existiert NICHT; jeder Befehl dagegen schlägt mit `MODULE_NOT_FOUND` fehl.
> Immer `~/.Falsify_Core` verwenden.

Die Skill-Skripte lösen ihr Installationsverzeichnis selbst auf (relativ im
Repo-Checkout, Fallback auf `~/.Falsify_Core` in der installierten Kopie),
funktionieren also direkt nach der Installation auf jeder Maschine — nie einen
`C:/Users/<name>/...`-Pfad in einen Befehl einfügen.

## Ticket-Protokoll (nicht verhandelbar)

1. **Der Agent schreibt den Job als Ticket** („was getan werden soll“). Die
   Nutzer-Eingabe wird 1:1 als `--user-input` bei JEDER Iteration durchgereicht —
   sie wird zum Scope-HEADER und bleibt in jedem Scope-Prompt. Ein Scope pro
   Task; Kontexte nie mischen.
2. **Allein FalsifyMe bestimmt die Scope-ID.** Submit reicht das Ticket als
   `--header` durch; FalsifyMe löst es deterministisch pro Checkout auf: kein
   offener Scope → erzeugt einen (gemintete ID), genau ein offener → führt ihn
   fort, mehrere → fail-closed (Exit 2, Scope-Liste). Der Agent reicht nie eine
   Scope-ID durch, parst sie nicht und liefert sie nicht erneut. `--scope` ist
   ein Operator-/Diagnose-Flag, kein Agent-Vertrag.
3. Jeder Job startet eine frische Modell-Konversation; nur Ergebnisse aus dem
   eigenen Scope dürfen verwendet werden.
4. Loopen, bis der Scope erfüllt ist — das LETZTE Review entscheidet:
   - `VERDICT: PLAN` → Iteration überarbeiten, mit demselben Ticket erneut
     einreichen (`--user-input` 1:1).
   - `VERDICT: RESEARCH` → FalsifyMe braucht mehr Daten: read-only
     recherchieren, Befunde ergänzen, erneut einreichen (dasselbe Ticket).
   - `VERDICT: WRITE` → Freigabe: du darfst read-only → write wechseln.
     Implementieren, dann die Implementierung zum Review im SELBEN Scope
     einreichen (WRITE/REVIEW-Loop).
5. FalsifyMe bleibt read-only zum Projekt (einzige Ausnahme: der
   Identitäts-Anker `FalsifyME.md`; aller Runtime-Zustand lebt in SQLite).
   Fehler/fehlendes Verdict = keine Freigabe. Exit-Codes: 0 WRITE · 1
   PLAN/RESEARCH · 5 ASK · 2 Config/Args · 3 API/Runtime/kein Verdict.

## Verpflichtendes 10x-Protokoll nach jeder Arbeit

Nach jedem Plan, jeder Änderung, jedem Bugfix, Refactoring, Feature, jeder
Dokumentations- oder Konfigurationsänderung beide Ebenen unten festhalten. Sie
sind Agent-/Reviewer-Verträge, keine zweite Queue oder Verdict-Pfad; nur die
bestehende Falsifikations-Pipeline kann `WRITE` freigeben.

### CHANGE_GATE_10X

A1 bis A10 mit `JA` beantworten und für jede Antwort einen Beleg liefern:

```text
A1: JA
Proof: <konkreter Beleg>
Test: <exakter Befehl oder reproduzierbare Verifikation>
```

Die zehn Checks decken Scope, unveränderte Architektur, Verdict-Autorität,
echte Widerlegungs-Evidenz, Root-/Scope-Bindung, fail-closed-Freigabe,
Evil-Twin-Kontext-Isolation, sichere Behandlung leerer/fehlerhafter/
API-fehlerhafter Antworten, ausführbare Verifikation und Feindseliger-Agent-
Sicherheit ab. Jedes `NEIN`, `UNBEKANNT` oder fehlender Beleg bedeutet exakt:

```text
BLOCKED – mindestens eine Invariante ist nicht nachgewiesen.
```

### FALSIFICATION_RECORD_10X

Der unabhängige Reviewer hält für jeden Plan, jede Änderung und jede
Iteration fest:

```text
F1: User-Agent-Ausgangsbehauptung
F2: user contract
F3: exakter Scope-Match oder Divergenz
F4: falsifizierbare Annahme
F5: durchgeführter Angriff
F6: verifizierte, tatsächlich gelesene Evidenz
F7: gesuchte Gegenbeweise und Ergebnis
F8: ungeprüfter oder nur vermuteter Bereich
F9: stärkstes verbleibendes Risiko
F10: WRITE-Entscheidung oder konkreter Blocker
```

`F6` muss Evidenz benennen, die im zugänglichen Root und Scope existiert;
fiktive Dateien, Zeilen, Symbole oder Selbstvertrauen sind ungültig. Ohne
ausreichenden Nachweis keine `WRITE`-Behauptung.

## Workflow

1. **Zuerst Worker-Fenster öffnen** (bis zu 3, immer sichtbar, nie headless):
   ```bash
   node ~/.Falsify_Core/ui/worker.mjs --check
   ```
   Wenn `STOPPED` ausgegeben wird, ein sichtbares Dock-Fenster starten —
   Desktop-Icon `FalsifyMe.lnk` doppelklicken oder `ui\start-dock.cmd 1` aus
   `%USERPROFILE%\.Falsify_Core` in einem Windows-Terminal ausführen. Nie
   headless starten. Das Submit-Skript aus Schritt 4 stellt das Dock ebenfalls
   sicher.
2. **Das Ticket starten** (optional, aber sichtbar; bindet den Job ohne
   Einreichen):
   ```bash
   falsify start "<user input genau wie gegeben>"
   ```
   FalsifyMe meldet, ob es einen neuen Scope erzeugt oder den offenen
   fortführt — die ID ist FalsifyMes Sache, nicht deine.
3. **Den Plan in eine Datei schreiben** (kurz, konkret, auf Dateiebene).
4. **Submit über das gebündelte Skill-Skript** (es stellt Fenster sicher,
   claimt, pollt, gibt das Verdict aus). Derselbe Befehl startet und führt
   fort — das Ticket (`--user-input` 1:1) ist die Identität:
   ```bash
   bash ~/.agents/skills/falsifyme/agent-skill-falsify.sh \
     --user-input "<user input genau wie gegeben>" \
     --plan plan.txt \
     --root <absoluter Projekt-Root> \
     --files "src/a.py,src/b.py"
   ```
   `--files` ist die Whitelist des Modell-Zugriffs (read-only Tools:
   list_dir, read_file, glob). Kein `..`, keine absoluten Escapes oder
   Symlink-Escapes.
5. **Auf das Verdict gemäß dem Loop oben reagieren.** Bei WRITE:
   implementieren, dann einen Review-Plan mit demselben Ticket (`--user-input`
   1:1) erneut einreichen. Das Verdict des finalen Reviews zählt.
6. Nützliche CLI: `falsify resume [--header "<ticket>"]` (letzten offenen Job
   wieder aufnehmen) · `falsify history [--scope <id>]` (was passiert ist und
   wie FalsifyMe das Projekt beeinflusst hat) · `jobs` · `status <job>` ·
   `log <job>` · `answer <job>` · `state`. Settings:
   `falsify settings show|set` (Provider/apiBase/model/apiKey — Keys leben nur
   in `FALSIFY_HOME/.env`, nie in Repos).

## Harte Regeln

- Bis `VERDICT: WRITE` null Edits am Zielprojekt.
- Die TUI (`ui/START-TUI.cmd`, `node ui/tui-demo.mjs`) ist reine Beobachtung —
   sie nimmt nie Jobs von Nutzern an und ist kein Steuerkanal.
- Nie ein Verdict behaupten, das du nicht in der CLI-Ausgabe gesehen hast;
   Exit-Code 3 oder ein Fehler ist ein hartes Nein.
- Doctor-Check, wenn etwas falsch läuft:
   `node ~/.Falsify_Core/cli/main.mjs doctor` (erwartet: Node ≥22, deps
   ink/react OK, config, API-Key, WAL-DB).