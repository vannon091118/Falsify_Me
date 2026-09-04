# Plan: FalsifyMe-Change-Review

Ziel: Den tatsächlichen Change in diesem FalsifyMe-Repo verstehen, klar erklären und entscheiden, was als Nächstes zu tun ist (visuelle Erklärung, begrenzte Design-Arbeit oder ein anderer nächster Schritt).

Hintergrund:
- Die Session startete mit einem Spec-Brainstorm-Durchgang zu FalsifyMe.
- Der Nutzer bat dann darum, den Brainstorming-Skill zu aktivieren, danach um einen diff-verankerten Brainstorm.
- Ich habe den Diff noch nicht.
- Das Repo ist FalsifyMe, ein read-only Falsifikations-Gateway für Coding-Agenten mit CLI + TUI/Dock + Evil Twin + strukturellen/Evidenz-Gates.

Scope dieser Session:
- Den betreffenden Change finden.
- Die umgebende Architektur genug lesen, um ihn akkurat zu beurteilen.
- Eine konkrete Empfehlung geben.
- Falls sinnvoll, eine einzelne in sich geschlossene HTML-Visualisierung in `.freebuff/` bauen.

Constraints:
- Produktcode nicht nur zum Bauen der Erklärung editieren.
- Keine Implementierung starten, bis Design/Plan genehmigt sind.

## Phasen

### Phase 1: Den Change lokalisieren
Status: in_progress
Abhängigkeit: keine
Erwartetes Ergebnis: ein konkreter Diff, Commit, Datei- oder Patch-Ort als Anker.

### Phase 2: Umgebende Architektur verstehen
Status: todo
Abhängigkeit: Phase 1
Erwartetes Ergebnis: kurze Findings-Notiz zu den relevanten Flows (CLI, Worker/Dock, Verdict, Twin, Agent-Events, UI-State), die zur Beurteilung des Changes nötig sind.

### Phase 3: Den Change beurteilen
Status: todo
Abhängigkeit: Phase 2
Erwartetes Ergebnis: eine knappe schriftliche Einschätzung: was der Change tut, was er verbessert, was ihm fehlt und was eine größere Verbesserung sein könnte.

### Phase 4: Nächstes Artefakt entscheiden
Status: todo
Abhängigkeit: Phase 3
Erwartetes Ergebnis: ein genehmigter nächster Schritt. Wahrscheinlicher Kandidat: eine in sich geschlossene visuelle Erklärung in `.freebuff/`.

## Getroffene Entscheidungen

(Noch keine)

## Aufgetretene Fehler

(Noch keine)

## Nächster Schritt

Phase 1 ausführen: den Diff oder exakten Change lokalisieren, den der Nutzer meint. Hat der Nutzer ihn, nach Pfad/Commit/Patch fragen. Falls nicht, die jüngsten Repo-Änderungen prüfen, um den wahrscheinlichsten Kandidaten zu finden.