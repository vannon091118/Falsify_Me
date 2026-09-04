# DOKI Full-Feature-Implementierungsplan

## Developer-Gate

`FULL_COMPLETE_VERSION` — kein MVP, kein PoC, kein headless-only.

Das Ziel ist ein sichtbarer, persistenter DOKI-Observer, der in das
bestehende FalsifyMe-Terminal-Dock integriert ist, ohne die technische
Autorität von FalsifyMe zu verändern.

## Quelle der Wahrheit

- FalsifyMe/Git bleiben die technische Wahrheit.
- Der sichtbare Terminal-/Dock-Stream ist die beobachtete Runtime-Oberfläche.
- DOKI besitzt nur rekonstruierbares narratives Gedächtnis und Ensemble-Zustand.
- SQLite ist Gedächtnis, nie eine zweite Wahrheit.
- Der Thinker ist die einzige externe LLM-Integration und schreibt nur finale Prosa.

## Runtime-Modell

```text
FalsifyMe sichtbares Terminal
  -> DOKI-Observer-Puffer
  -> exactly-once Observation-Cursor
  -> deterministische narrative Rekonstruktion
  -> 14-Charakter-Ensemble-Zustand
  -> 15. Erzähler-Kontext
  -> automatisch generierter Prompt
  -> gemeinsame Falsify-Thinker-API
  -> genau ein Thinker-Call, wenn der reservierte Slot verfügbar ist
  -> Commit-Message-Prosa
  -> sichtbarer Dock-Output
```

DOKI beobachtet, während FalsifyMe und Evil Twin aktiv sind. Es steuert keinen
der beiden Pfade. Es darf Terminalmaterial weiter sammeln, während ein
externer Coding-Agent auf Evil-Twin-Befunde reagiert. Die Wartezeit ist
absichtlich variabel, weil die Runtime nicht wissen kann, wie lange der
externe Agent braucht.

## Persistentes Ensemble

Die 14 Charaktere sind persistente Identitäten, keine prompt-geschalteten
Personas. Jeder Charakter hat rekonstruierbare Historie, Gedächtnis,
Beziehungen, Perspektiven-/Überzeugungs-Zustand, Thread-Teilnahme,
emotionalen Zustand und Recall-Zustand.

Beziehungen sind gerichtet: `A -> B` ist unabhängig von `B -> A`.

Der 15. Erzähler ist eine separate Erzähler-Rolle. Er wandelt den
aufbereiteten historischen Ensemble-Kontext in die finale
Commit-Message-Prosa um. Seine Stimme ist bewusst zynisch, sarkastisch und
manchmal beißend. Er darf aus gelieferter Evidenz andeuten und kommentieren,
aber keine technischen Fakten erfinden oder FalsifyMe-Autorität verändern.

## Terminal-Observation-Vertrag

Der Observer konsumiert den tatsächlichen Terminal-Monolog-/Dialog-Stream.
Jede Observation erhält eine stabile Ereignis-Identität und wird als
beobachtet genau einmal persistiert. Bereits gesehene Ereignisse werden nie
als neue narrative Ereignisse behandelt.

Der Observer muss bewahren:

- rohen beobachteten Text / strukturierte Ereignisdaten
- Quell-Ereignis-Identität
- Reihenfolge
- Session-/Job-Zuordnung, wenn verfügbar
- Zeitstempel nur für die Ordnung
- Quellen-Referenzen

Interpretation wird später abgeleitet, nie in rohe Observations geschrieben.

## Narrative Rekonstruktions-Ebenen

1. Observation: Quell-Terminal-Fakten nur.
2. Beziehungseffekte: deterministische gerichtete Deltas aus beobachteten Ereignissen.
3. Thread-Zustand: deterministisches Merge/Split aus evidenzgestützter Kontinuität.
4. Perspektive/Überzeugungen: charakter-spezifische Interpretation mit Evidenz-Referenzen.
5. Gedächtnis/Charakter-Zustand: persistenter Recall plus nicht-destruktiver emotionaler Zerfall.
6. Konflikt/Relevanz: abgeleitete Widersprüche, Salienz und narratives Gewicht.
7. Narrativer Kontext: read-only zusammengesetzter Kontext für den 15. Erzähler.

Das Quellmaterial ist rekonstruierbar. Abgeleiteter Zustand trägt
Regelversionen. Das Wiederaufbauen aus derselben beobachteten Historie muss
denselben Zustand reproduzieren.

## Thinker-Gate

Der Thinker ist kein Analyst und kein Entscheider.

Vor dem API-Call muss DOKI bereits wissen:

- was passiert ist
- was beobachtet wurde
- welche Charaktere relevant sind
- deren historischen Zustand
- Beziehungen
- Thread-Zustand
- Perspektiven-/Überzeugungs-Zustand
- emotionalen Zustand
- aktuelle narrative Relevanz
- Rolle und Stimme des 15. Erzählers

Der generierte Prompt ist deterministisch aus diesem aufbereiteten Kontext.

Für den narrativen Output wird genau ein Thinker-Call gemacht. Keine
Q-Learning-Entscheidungsschleife, keine GREEN/RED-Modellwahl und keine
Multi-Call-Reswitch-Kette gehört in den Ziel-Narrativ-Pfad.

## Gemeinsamer Key / Idle-Modellwechsel

Das sind explizite By-Design-Constraints und unverändert:

- ein gemeinsamer Falsify-Thinker-API-Key
- Thinker-Modellwechsel, sobald der Thinker gemäß dem bestehenden
  Rotations-Vertrag idle wird
- keine zweite DOKI-Provider-/Key-Architektur

## Evil Twin

Evil Twin bleibt ein technischer FalsifyMe-Akteur. DOKI beobachtet seinen
sichtbaren Output und arbeitet die Evidenz in den narrativen Zustand ein.
DOKI steuert, ersetzt oder schreibt Evil-Twin-Befunde nie neu.

## Sichtbare Dock-Integration

Das bestehende FalsifyMe-Dock bleibt die Präsentationsfläche. DOKI wird als
zusätzliche Observations-/Output-Spur in dieser Fläche hinzugefügt, nicht als
zweite Terminal-Anwendung.

Der Nutzer muss sehen können:

- FalsifyMe technischen Fortschritt
- Thinker-/Evil-Twin-Aktivität, die FalsifyMe bereits anzeigt
- DOKI-Observations-Zustand
- Puffer-/Warte-Zustand
- Erzähler-Identität
- 15.-Erzähler-Output
- finale Commit-Message-Prosa
- DOKI-Autorität = KEINE
- DOKI-Fehler-/Fallback-Zustand

## Variables Idle-Bridging

Die Observer-Zustandsmaschine muss unterstützen:

```text
COLLECTING
  -> WAITING_FOR_THINKER_SLOT
  -> COLLECTING (neues Terminalmaterial trifft ein)
  -> PROMPT_READY
  -> THINKER_RUNNING
  -> OUTPUT_READY
  -> COLLECTING
```

Kein fester Sleep wird als Proxy für Abschluss verwendet. Die Runtime hat
kein verlässliches Wissen über die Reaktionszeit des externen Coding-Agenten
nach Evil-Twin-Befunden.

## Exactly-once narrative Konsumption

Der Observer führt einen dauerhaften Cursor/Digest. Sobald ein
Terminal-Ereignis in die narrative Historie eingegangen ist, kann das erneute
Sehen desselben Ereignisses kein zweites narratives Ereignis erzeugen.

Replays sind idempotent. Neue Ereignisse erweitern die Historie.

## Fehler-Vertrag

Jeder DOKI-Fehler ist präsentations-only:

- FalsifyMe-Verdict unverändert
- FalsifyMe-Lebenszyklus unverändert
- Abbruch-Semantik unverändert
- Queue unverändert
- Evil Twin unverändert
- sichtbarer faktenbasierter Fallback erlaubt

## Datentrennung

DOKI darf FalsifyMe-Zustand read-only lesen. DOKI schreibt nur seine eigene
Datenbank. Keine Fremdschlüssel-Abhängigkeit in FalsifyMe wird eingeführt.

## Implementierungsreihenfolge

### Schritt A — Observer-Fundament

Terminal-Ereignis-Envelope, stabile Observation-Identität, Cursor,
Deduplizierung und append-only Observation-Store erstellen.

### Schritt B — Ensemble-Fundament

SnipWar-Erzähler-Katalog und persistentes Charakter-Zustandsmodell
portieren/anpassen. Die 14 gerichteten Beziehungs-Kanten pro
Charakter-Paar ohne Self-Edges materialisieren.

### Schritt C — Narrative Ebenen

Beziehungseffekte, Thread-Zustand, Perspektiven-/Überzeugungs-Zustand,
Gedächtnis-/Charakter-Zustand, emotionalen Zerfall, Konflikt/Relevanz und
Evidenz-Referenzen implementieren.

### Schritt D — Historischer Wiederaufbau

Volles Replay aus persistierter Observations-Historie und Byte-/
Semantik-Determinismus-Checks implementieren.

### Schritt E — Erzähler-Kontext

Den 15.-Erzähler-Kontext-Builder hinzufügen. Sein Stil ist fest: zynisch,
sarkastisch, gelegentlich beißend. Er erhält Fakten und abgeleiteten
narrativen Zustand, aber keine technische Autorität.

### Schritt F — Thinker-Orchestrierung

Den Prompt automatisch generieren. Den gemeinsamen Thinker-Slot reservieren.
Genau einen Call machen. Die resultierende narrative Message persistieren.
Den Slot freigeben.

### Schritt G — Dock-Verdrahtung

Observer-Events und finalen DOKI-Output an das bestehende sichtbare Dock
anhängen, ohne dessen Zustandsmaschine zu ersetzen oder einen zweiten
UI-Writer hinzuzufügen.

### Schritt H — E2E

Einen echten sichtbaren FalsifyMe-Workflow ausführen, inklusive Thinker,
Evil Twin, externer-Agent-Wartezeit, DOKI-Pufferung, Frei-Slot-Erwerb, einem
Thinker-Call und finaler sichtbarer Commit-Prosa.

## Commit-Protokoll

Die Implementierungsreihenfolge ist auch die Git-Commit-Reihenfolge auf
`codex/doki-rev2`.

- Genau ein Implementierungspunkt pro Commit.
- Keine Misch-Punkt-Commits.
- Kein unabhängiges Cleanup innerhalb eines Feature-Punkt-Commits.
- Jeder Commit muss unabhängig gegen den Planpunkt reviewbar sein, den er
  implementiert.
- Nach jedem Commit den geänderten Scope und die Tests verifizieren, bevor der
  nächste Punkt beginnt.
- Der Branch bleibt für die gesamte Implementierungsreihenfolge
  `codex/doki-rev2`.
- `main` wird durch die Implementierungsarbeit nicht verändert.
- Ein Punkt gilt nicht allein deshalb als abgeschlossen, weil Dateien
  existieren; seine Abnahme-/Tests müssen bestehen, bevor der nächste Punkt
  beginnt.

Commit-Namenskonvention:

```text
DOKI A: observer foundation
DOKI B: ensemble foundation
DOKI C: narrative layers
DOKI D: historical rebuild
DOKI E: narrator context
DOKI F: Thinker orchestration
DOKI G: Dock wiring
DOKI H: full visible E2E
```

Muss ein Punkt intern aus technischem Grund geteilt werden, wird die Teilung
zuerst explizit als separate nummerierte Unterpunkte zu diesem Plan
hinzugefügt. Keine stille Unterteilung und keine stille Neugruppierung.

## Erforderliche Test-Matrix

Unit: Identität, Deduplizierung, Beziehungsrichtung, Thread-Merge/Split,
Überzeugungs-Evidenz, Gedächtnis-Rekonstruktion, emotionaler Zerfall,
Erzähler-Auswahl, Erzähler-Stimm-Constraints, Prompt-Determinismus.

Integration: Terminal-Observer, SQLite-Trennung, Falsify read-only,
Shared-Key-Gate, Thinker-Slot, Modell-Idle-Wechsel, DOKI-Persistenz,
Dock-Events.

E2E: normaler Abschluss, Evil-Twin-Pfad, externer-Agent-Verzögerung,
gleichzeitige Observation, wiederholte Terminal-Ereignisse, Replay/Restart,
Thinker-Fehler, Thinker-Timeout, Rate-Limit, fehlende DOKI-DB,
Falsify-DB-read-only-Fehler, Abbruch und Falsify-Fehler.

## Explizit unverändert

- FalsifyMe technische Verdict-Autorität
- FalsifyMe Lebenszyklus-/Loop-State-Zuständigkeit
- FalsifyMe Abbruch-Semantik
- Evil-Twin technische Rolle
- gemeinsamer Thinker-API-Key
- Idle-Zeit-Thinker-Modellwechsel
- bestehende FalsifyMe-Queue-Semantik
- bestehende FalsifyMe-Dock-Ownership-Regeln

## Gate: keine stillen Änderungen

Jede Produktions-Änderung muss mit Datei, Symbol, Grund, Autoritäts-Wirkung,
Persistenz-Wirkung und Tests gelistet werden. Was nicht gelistet ist, wird
nicht geändert.

## Abnahme

Ein normaler Nutzer kann eine sichtbare FalsifyMe-Terminal-Session inklusive
Evil-Twin-Arbeit beobachten, während DOKI parallel beobachtet, persistente
narrative Historie aufbaut, variable Idle-Phasen ohne Ereignis-Duplikate
überbrückt und schließlich eine 15.-Erzähler-Commit-Message sieht, die von
genau einem Thinker-Call erzeugt wurde — ohne dass ein technisches
FalsifyMe-Ergebnis verändert wird.