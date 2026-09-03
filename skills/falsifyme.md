---
name: falsifyme
description: Pflichtprüfung vor jeder Code-Änderung mit FalsiFlow. Bei Installation, Workflow-Start oder Codeänderung verwenden: Scope anlegen, User-Input unverändert als Header übernehmen, read-only prüfen und erst bei VERDICT WRITE freigeben.
---

# FalsifyMe / FalsiFlow

Dieser Skill startet den FalsiFlow für die aktuelle Agent-Session. Er sorgt
für eine nachvollziehbare Prüfung vor Änderungen; er ist keine versteckte
Steuerung. FalsifyMe bleibt read-only zum geprüften Projekt — die einzige
Schreibausnahme ist der physische `FalsifyME.md`-Projektanker (Identität und
bestätigte Decision-Records, einmal beim Bootstrap/`anchor init`, keine Scopes,
keine Verdicts, keine Regeln).

## Session-Start

1. Lies diesen Skill einmal zu Beginn der Session.
2. Lege genau einen Scope für den aktuellen Auftrag an.
3. Übernimm den User-Input unverändert als Scope-Header.
4. Verwende denselben Scope für alle Folgeprüfungen.

```bash
falsify scope new "<User-Input exakt>"
```

## Vor jeder Änderung

Erstelle einen kurzen Plan und reiche nur die erlaubten Dateien als Whitelist
ein:

```bash
bash ./skills/agent-skill-falsify.sh \
  --scope <scope-id> \
  --plan plan.txt \
  --root /absoluter/pfad/zum/projekt \
  --files "src/a.js,src/b.js"
```

Das Skill-Skript löst sein Install-Verzeichnis selbst auf: im Repo-Checkout
relativ, in der installierten Kopie (`~/.agents/skills/falsifyme`) als Fallback
`~/.Falsify_Core` (mit führendem Punkt — der Pfad ohne Punkt existiert nicht!).
Nach `node install.mjs` lautet der Aufruf daher z. B.:

```bash
bash ~/.agents/skills/falsifyme/agent-skill-falsify.sh \
  --user-input "<User-Input exakt>" \
  --plan plan.txt \
  --root /absoluter/pfad/zum/projekt \
  --files "src/a.js,src/b.js"
```

Bis `VERDICT: WRITE` vorliegt, bleibt der Agent read-only. `PLAN` bedeutet
Plan überarbeiten, `RESEARCH` bedeutet weitere read-only-Daten beschaffen,
`WRITE` gibt die konkrete Änderung frei. Nach der Änderung wird ein Review im
selben Scope eingereicht.

Der Skill bestätigt nach dem Einreichen, dass der Job im Dock-Fenster sichtbar
geworden ist (laufendes Worker-Fenster über `--check`, Job-Claim = Status nicht
mehr `QUEUED`), bevor er blockierend auf das Verdict wartet. Schlägt die
Bestätigung fehl, bleibt die Warnung sichtbar und der Job in der Queue.

## Pflichtprotokoll nach jeder Arbeit

Nach jedem Plan, jeder Änderung, jedem Bugfix, jedem Refactoring, jedem Feature,
jeder Dokumentations- und jeder Konfigurationsänderung:

1. **CHANGE_GATE_10X:** Beantworte A1 bis A10 mit `JA`; jede Antwort enthält
   `Proof:` und `Test:`. Prüfe Scope, Architektur, Verdict-Hoheit, echte
   Evidenz, Root-/Scope-Bindung, fail-closed WRITE, Twin-Isolation,
   Fehler-/Ausfallverhalten, ausführbaren Testbeleg und feindselige Agents.
2. **FALSIFICATION_RECORD_10X:** Der unabhängige Reviewer dokumentiert F1
   User-Agent-Ausgangsbehauptung, F2 User-Vertrag, F3 Scope-Abgleich, F4 falsifizierbare
   Annahme, F5 Angriff, F6 verifizierte Datei:Zeile/Symbol/Probe, F7
   Gegenbeweise, F8 ungeprüften Bereich, F9 Rest-Risiko und F10
   Release-Entscheidung.

`JA` ohne Beleg gilt nicht. Ein einziges `NEIN`, `UNBEKANNT` oder fehlender
Nachweis beendet die Arbeit mit:

```text
BLOCKED – mindestens eine Invariante ist nicht nachgewiesen.
```

Das Protokoll ist ein Agenten-/Review-Vertrag, keine neue Queue und kein
alternativer Verdict-Pfad. `WRITE` bleibt ausschließlich das Ergebnis der
bestehenden Falsifikationspipeline.

## Sicherheitsgrenzen

- Der Skill prüft, aber schreibt nicht in das Zielprojekt (einzige Ausnahme:
  der identitätstragende `FalsifyME.md`-Anker — keine Scopes, Findings,
  Verdicts oder Regeln; der Laufzeitzustand bleibt ausschließlich in SQLite).
- `--files` ist eine verpflichtende Whitelist relativ zum Root.
- Keine Pfade außerhalb des Roots, absoluten Ausweichpfade, `..`-Traversals
  oder Symlink-Escapes.
- API-Keys und SQLite-Daten liegen außerhalb des Repositories.
- Fehler oder fehlendes Verdict sind keine Freigabe.

## FalsiFlow und UI

Die FalsifyMe-TUI ist reine Beobachtung. Sie akzeptiert keine Jobs vom Nutzer.
Externe Worker können Events direkt per Parser/In-Process zuführen oder als
Alternative stdin-JSONL an einen TUI-Runner senden:

```text
Agent/Worker → FM-EVT: {json} oder JSONL → TUI-Runner → ui.applyEvent(evt)
```

Die TUI zeigt dabei Intro, Status, Findings und Verdict in maximal drei festen
Slots. Der FalsiFlow bleibt im Skill/Agent-Workflow; er wird nicht durch
Tastatur-Input in der Visualisierung ausgelöst.

## Installation

Die Benutzerinstallation wird aus dem Repository mit `node install.mjs`
angestoßen. Sie trennt Programmdateien (`.Falsify_Core`) von privaten Daten
(`.Falsify_Private`) und installiert diesen Skill im Benutzerbereich unter
`.agents/skills/falsifyme`, sofern der Agent diese Konvention unterstützt.
Zusätzlich wird der Session-Workflow-Skill `falsifyme-falsiflow` unter
`.agents/skills/falsifyme-falsiflow/SKILL.md` installiert — er beschreibt den
kompletten FalsiFlow (Fenster, Scope, Submit, Verdict-Schleife) mit
aufgelösten statt hartkodierten Pfaden. Der Self-Install-Skill
`falsifyme-selfinstall` (`.agents/skills/falsifyme-selfinstall/SKILL.md`)
weist einen Coding-Agenten an, sich selbst diesen ausführbaren Skill
nach `~/.agents/skills/` einzurichten und zu verifizieren.
