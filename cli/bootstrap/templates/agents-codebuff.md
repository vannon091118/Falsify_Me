# FalsifyMe Workflow-Anweisung (AGENTS.md)

Dieses AGENTS.md wird vom Coding-Agenten gelesen und zwingt ihn in den
FalsifyMe-Falsifizierungs-Workflow.

FalsifyMe = unabh\xE4ngiger read-only Falsifizierungs-Agent
Coding-Agent = eigentliche Arbeits-/Write-Instanz
Bis VERDICT: WRITE bleibt der Coding-Agent READ-ONLY.
Dock = sichtbare Visualisierung der laufenden FalsifyMe-Arbeit

## PFLICHT vor jeder Code-\xC4nderung

Der Agent darf erst schreiben, wenn FalsifyMe VERDICT: WRITE liefert.
Bis dahin ist der Agent READ-ONLY.

1. FalsiFlow-Skill lesen:
   cat {{FALSIFLOW_SKILL}}/SKILL.md

2. Pflicht-Check \xFCber den existierenden Agent-Skill:
   bash {{SKILLS}}/agent-skill-falsify.sh \
     --user-input "<Original-User-Auftrag 1:1>" \
     --plan plan.txt \
     --root {{ROOT}} \
     --files "app.js,lib/auth.js"

3. Das Skill-Skript legt den Scope an (PLAN = Init, User-Input 1:1 als
   HEADER), stellt das sichtbare Dock sicher, reicht den Job ein,
   best\xE4tigt den Dock-Claim und wartet blockierend auf das Verdict.

4. Verdict-Routing:
   Exit 0 = WRITE  -> Freigabe, implementieren, dann Review im selben Scope
   Exit 1 = PLAN/RESEARCH -> Plan \xFCberarbeiten bzw. read-only recherchieren,
            erneut einreichen (gleicher Scope)
   Exit 2/3 = Fehler -> KEINE Freigabe

## Regeln

- Kein eigenes Review: nur das echte FalsifyMe-Verdict entscheidet.
- FalsifyMe schreibt nie ins Zielprojekt; der Agent bleibt f\xFCr alle
  \xC4nderungen verantwortlich.
- Bestehenden FalsiFlow (PLAN -> RESEARCH -> WRITE -> IMPLEMENTATION REVIEW)
  verwenden, nicht neu implementieren.
