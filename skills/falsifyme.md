---
name: falsifyme
description: Pflichtprüfung vor jeder Code-Änderung mit FalsiFlow. Bei Installation, Workflow-Start oder Codeänderung verwenden: Scope anlegen, User-Input unverändert als Header übernehmen, read-only prüfen und erst bei VERDICT WRITE freigeben.
---

# FalsifyMe / FalsiFlow

Dieser Skill startet den FalsiFlow für die aktuelle Agent-Session. Er sorgt
für eine nachvollziehbare Prüfung vor Änderungen; er ist keine versteckte
Steuerung und schreibt niemals in das geprüfte Projekt.

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

Bis `VERDICT: WRITE` vorliegt, bleibt der Agent read-only. `PLAN` bedeutet
Plan überarbeiten, `RESEARCH` bedeutet weitere read-only-Daten beschaffen,
`WRITE` gibt die konkrete Änderung frei. Nach der Änderung wird ein Review im
selben Scope eingereicht.

## Sicherheitsgrenzen

- Der Skill prüft, aber schreibt nicht in das Zielprojekt.
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
