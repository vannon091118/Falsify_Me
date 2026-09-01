# FalsifyMe Workflow-Anweisung

FalsifyMe = unabh\xE4ngiger read-only Falsifizierungs-Agent
Coding-Agent = eigentliche Arbeits-/Write-Instanz
Bis VERDICT: WRITE bleibt der Coding-Agent READ-ONLY.
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

3. Verdict-Routing:
   Exit 0 = WRITE  -> Freigabe, implementieren, dann Review im selben Scope
   Exit 1 = PLAN/RESEARCH -> Loop fortsetzen (gleicher Scope)
   Exit 2/3 = Fehler -> KEINE Freigabe

Bis VERDICT: WRITE bleibt der Agent READ-ONLY.
