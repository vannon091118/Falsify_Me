{{MODE_HEADER}}

# FalsifyMe Workflow-Anweisung

FalsifyMe = unabh\xE4ngiger read-only Falsifizierungs-Agent
USER AGENT = externe Arbeits-/Write-Instanz
Bis VERDICT: WRITE bleibt der USER AGENT READ-ONLY.
Dock = sichtbare Visualisierung der laufenden FalsifyMe-Arbeit

## PFLICHT vor jeder Code-\xC4nderung

1. FalsiFlow-Skill lesen:
   cat {{FALSIFLOW_SKILL}}/SKILL.md

2. Pflicht-Check \xFCber den existierenden Agent-Skill:
   bash {{SKILLS}}/agent-skill-falsify.sh \
     --user-input "<Original-User-Auftrag 1:1>" \
     --plan plan.txt \
     --root {{ROOT}} \
     --files "app.js,lib/auth.js"

   Die SCOPE-ID bestimmt FalsifyMe automatisch ueber das Ticket
   (--user-input = User-Input 1:1, bei JEDER Iteration) – der Agent
   verwaltet keine IDs und nutzt nie --scope (Operator-Flag).

3. Verdict-Routing:
   Exit 0 = WRITE  -> Freigabe, implementieren, dann Review im selben Auftrag
   Exit 1 = PLAN/RESEARCH -> Loop fortsetzen (gleiches Ticket = --user-input 1:1)
   Exit 2/3 = Fehler -> KEINE Freigabe

Bis VERDICT: WRITE bleibt der Agent READ-ONLY.

## Reparatur vor Onboarding

- Schlaegt der FalsifyMe-Startup-Skill-Check fehl (jeder falsify-Befehl
  ausser doctor bricht mit Exit 3 + FEHLER-Hinweis auf doctor), fuehrt der
  Agent GENAU EINMAL `falsify doctor --repair-skills` aus und wartet auf
  gruen, BEVOR er `falsify onboard` / den ersten Pflicht-Check startet.
  Kein Onboarding auf kaputter oder veralteter Skill-Anlage.

## Pflichtprotokoll nach jeder Arbeit

Nach jedem Plan, jeder Änderung, jedem Bugfix, jedem Refactoring, jedem Feature,
jeder Dokumentations- und jeder Konfigurationsänderung:

- `CHANGE_GATE_10X`: A1 bis A10 müssen `JA` sein; jede Antwort braucht
  `Proof:` und `Test:`.
- `FALSIFICATION_RECORD_10X`: F1 User-Agent-Ausgangsbehauptung, F2 User contract, F3 Scope match,
  F4 falsifizierbare Annahme, F5 Angriff, F6 verifizierte Evidenz, F7
  Gegenbeweise, F8 ungeprüfter Bereich, F9 Rest-Risiko, F10
  Release-Entscheidung.

Ein einziges `NEIN`, `UNBEKANNT` oder fehlender Beleg bedeutet:
`BLOCKED – mindestens eine Invariante ist nicht nachgewiesen.`
