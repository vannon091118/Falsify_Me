# FalsifyMe Agent Skill

FalsifyMe ist vor jeder Code-Änderung verpflichtend. Der Coding-Agent bleibt
read-only, bis FalsifyMe für denselben Scope `VERDICT: WRITE` liefert.

## Verbindliches Protokoll

1. Einen Scope mit dem unveränderten User-Input anlegen:

   ```bash
   falsify scope new "User-Input exakt übernehmen"
   ```

2. Plan oder Iteration mit derselben Scope-ID einreichen:

   ```bash
   bash skills/agent-skill-falsify.sh \
     --scope <scope-id> \
     --plan plan.txt \
     --root /absoluter/pfad/zum/projekt \
     --files "src/a.js,src/b.js"
   ```

3. Das Ergebnis auswerten:
   - Exit `0`: `WRITE`; Umsetzung ist freigegeben.
   - Exit `1`: `PLAN` oder `RESEARCH`; nicht schreiben, sondern den Loop fortsetzen.
   - Exit `2`/`3`: Fehler; nicht weitermachen.

Nach dem Einreichen bestätigt der Skill, dass der Job im Dock-Fenster sichtbar
geworden ist (Fenster-Claim; Status verlässt `QUEUED`), bevor er blockierend
auf das Verdict wartet. Bei fehlendem Claim bleibt der Job in der Queue und
der Agent sieht eine Warnung mit `falsify state`-Hinweis.

## Modi

- `PLAN` ist die Init-Aktion und hält den Header unverändert.
- `RESEARCH` bedeutet, dass weitere Informationen read-only beschafft werden
  müssen.
- `WRITE` ist ausschließlich eine Freigabe an den aufrufenden Agenten.

## Pflichtprotokoll nach jeder Arbeit

Nach jedem Plan, jeder Änderung, jedem Bugfix, jedem Refactoring, jedem Feature,
jeder Dokumentations- und jeder Konfigurationsänderung werden zwei Protokolle
geführt. Sie erzeugen weder eine neue Queue noch einen zweiten Verdict-Pfad.
`WRITE` bleibt ausschließlich Ergebnis der bestehenden Falsifikationspipeline.

### CHANGE_GATE_10X

Beantworte alle zehn Fragen mit `JA`; jede Antwort braucht diesen Nachweis:

```text
A1: JA
Proof: <konkreter Beleg>
Test: <exakter Befehl oder reproduzierbare Verifikation>
```

A1 Scope · A2 bestehende Architektur · A3 Verdict-Hoheit beim Falsifikations-
prozess · A4 echte Falsifikation statt Lob · A5 Evidenz an Root/Scope gebunden ·
A6 fail-closed `WRITE` · A7 kontextgetrennter Evil Twin · A8 sichere Fehler-,
Timeout- und API-Ausfälle · A9 echter Test/E2E-Beleg · A10 Sicherheit gegen
literalistische, manipulierte oder kaputte Agents.

Ein einziges `NEIN`, `UNBEKANNT` oder fehlender Beleg bedeutet exakt:

```text
BLOCKED – mindestens eine Invariante ist nicht nachgewiesen.
```

### FALSIFICATION_RECORD_10X

Der unabhängige Reviewer dokumentiert bei jedem Plan, jeder Änderung und jeder
Iteration konkret:

```text
F1: Coder claim
F2: User contract
F3: Scope match oder konkrete Divergenz
F4: falsifizierbare Annahme
F5: unternommener Angriff
F6: tatsächlich gelesene und verifizierte Evidenz
F7: gesuchte Gegenbeweise und Ergebnis
F8: ungeprüfter oder nur vermuteter Bereich
F9: stärkstes verbleibendes Risiko
F10: WRITE-Entscheidung oder konkretes Hindernis
```

`F6` darf keine Fantasie-Datei, Fantasie-Zeile oder unbelegte Sicherheit
enthalten. Ohne Nachweis wird `WRITE` nicht behauptet.

Nach jedem Job wird der Scope in SQLite mit Befund, allen Findings und dem
optionalen dreizeiligen `SUBPROMPT:`-Fallback aktualisiert. Jobs starten jeweils
eine neue Modell-Konversation; Scopes werden niemals vermischt.

## Sicherheitsvertrag

FalsifyMe schreibt nicht in das Zielprojekt. Der Modellzugriff besteht nur aus
`list_dir`, `read_file` und `glob` und wird auf Root und Whitelist beschränkt.
Absolute Pfade, `..`, Symlink-Escapes und nicht erlaubte Dateien werden blockiert.
Persistenz liegt ausschließlich in `FALSIFY_HOME` außerhalb des Repositories.

## Sichtbare Worker

Im normalen Produktionsbetrieb läuft jeder dauerhafte Worker in einem sichtbaren
Fenster. Unter Windows startet das Desktop-Icon `FalsifyMe.lnk` den Dock direkt
(Fenster 1); weitere Fenster öffnet man mit `ui\start-dock.cmd 1|2|3` (bis zu
drei parallel). Das Fenster zeigt die Live-TUI: WARTE AUF EINGABE, dann Jobs aus
der SQLite-Queue (FM-EVT-Pipeline) bis zum Verdict.

Linux und macOS unterstützen CLI, SQLite und Worker-Prozess; die `.cmd`-Fenster-
starter sind Windows-spezifisch. Der kurzlebige `selbsttest.sh` ist ein
automatisierter Fehlerpfad-Test, der das echte sichtbare Worker-Fenster über
`ui/start-dock.cmd` startet (Windows; kein headless Fallback).

## API-Konfiguration

OpenAI-kompatible Endpunkte werden außerhalb des Repositories konfiguriert:

```text
FALSIFY_API_BASE
FALSIFY_MODEL
FALSIFY_API_KEY_ENV
FALSIFY_MAX_TOKENS
FALSIFY_MAX_RPM
FALSIFY_TIMEOUT_MS
FALSIFY_LANG
```

Keys gehören in `FALSIFY_HOME/.env`. Ungültige Konfigurationswerte führen zu
Exit-Code `2`.

## Diagnose und Tests

```bash
falsify ensure-home
falsify doctor
npm run test:security
npm run test:phase2
npm run selftest
```

`npm run test:security` prüft Sandbox, Whitelist, Symlink-Schutz,
Konfigurationsvalidierung und konkurrierende SQLite-Rate-Limit-Reservierungen.
