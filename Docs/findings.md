# Befunde

## Identifizierter Change
Höchstwahrscheinlich gemeint ist die aktuelle Commit-Reihe im Repo:

- b8f5942 — Progression-Anker in `falsify state` (UI-115)
- 52c7493 — Loop-Trace: `falsify scope trace <id>` (UI-116)
- fbdb821 — Cleanup im Test (dead scaffolding entfernt)

## Was die Änderung tut
- `falsify state` gibt jetzt zusätzlich nach `IDLE`/`BUSY` aus:
  - `PROGRESSION jobs=... tasks=... errorsCaught=... releases=... modelCalls=...`
  - `ANCHOR <Progression-Satz>`
- Es gibt neu `falsify scope trace <id>`:
  - Je Runde: Job, Welle, Verdict, Laufzeit, Intent, Befund, Fehler
  - Scope-Status, offene Konflikte, Divergenz-Anker
  - Loop-Ausgang: GESCHLOSSEN bei hardened/done, sonst OFFEN mit nächstem Schritt

## Architekturelle Einordnung
- Die Statistik kommt aus `artifacts/stats.mjs` (collectStats + progressionStatement).
- Sie liest aus jobs/findings/scopes/rate_limit und schreibt nichts.
- `falsify scope trace` ist in `cli/scope.mjs` implementiert und nutzt `listJobs`, `getFindings`, `getScope`.
- Beides passt zum wiederholten Prinzip im Code: eine Wahrheit in der Queue, keine zweite Persistenz.
- Der Abgleich im Trace ist jobbasiert (Jobs ↔ Findings über job_id).

## Bewertung (Phase 3, vorläufig)
- Starke Punkte:
  - Konsistenz: read-only, keine neue Persistenz, keine neue Queue.
  - Hoher Nutzwert bei geringem Aufwand, weil ein reales Verständnisproblem gelöst wird (Loop war bisher nur als Einzelscheiben lesbar).
  - UI-115 verbindet die Gesamtstatistik mit der Status-API, die Agents/Skripte wirklich nutzen.
- Risiken / Aufmerksamkeit:
  - Der Abgleich zwischen Jobs und Findings basiert auf job_id. Das ist in Ordnung, solange die Felder konsistent bleiben.
  - `scope trace` ist eine lesende Sicht, keine eigene Loop-Steuerung. Das ist die richtige erste Form.
- Fehlender Tieffaktor:
  - Trace zeigt Verlauf, aber noch keine klare „Warum“-Schicht für den Loop-Ausgang. Das ist der Punkt, an dem eine größere Verbesserung ansetzen könnte.

## Größere Verbesserungsidee (für spätere Phase)
 statt nur „Loop-Verlauf anzeigen“ das Scope als Loop-Oberfläche behandeln:
- Trace + Show + State + (optional) nationale Aufforderung im Loop zusammenführen.
- Ziel: auf einen Blick sagen, wo der Loop hängt, warum, welche Ressource / welcher Schritt als Nächstes fehlt.

## Offen
- Ob das Ziel ein visuelles HTML-Erklärtool ist oder eine andere Ausgabe.
- Ob ein anderer Patch gemeint ist.
