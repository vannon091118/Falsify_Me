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

## Modi

- `PLAN` ist die Init-Aktion und hält den Header unverändert.
- `RESEARCH` bedeutet, dass weitere Informationen read-only beschafft werden
  müssen.
- `WRITE` ist ausschließlich eine Freigabe an den aufrufenden Agenten.

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
Fenster. Unter Windows:

```bat
START.cmd
start-dock.cmd 1
```

Bis zu drei Worker-Fenster können parallel laufen. Linux und macOS unterstützen
CLI, SQLite und Worker-Prozess; die `.cmd`-Fensterstarter sind Windows-spezifisch.
Der kurzlebige `selbsttest.sh` ist nur ein automatisierter Fehlerpfad-Test und
öffnet kein Fenster.

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
npm run selftest
```

`npm run test:security` prüft Sandbox, Whitelist, Symlink-Schutz,
Konfigurationsvalidierung und konkurrierende SQLite-Rate-Limit-Reservierungen.
