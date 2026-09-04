# DOKI Runtime Rev. 2

DOKI ist ein Seitenkanal ohne Autorität über FalsifyMe. Es öffnet `falsify.db`
read-only und persistiert seinen eigenen abgeleiteten Zustand in `doki.db`.

## Fail-open-Vertrag

DOKI ist strikt optional für den FalsifyMe-Produktionslebenszyklus.

```text
DOKI-Fehler
  -> DOKI-Fallback / Nichtverfügbar-Zustand / fehlgeschlagener DOKI-Job
  -> FalsifyMe läuft unverändert weiter

DOKI DARF NICHT
  -> FalsifyMe blockieren
  -> FalsifyMe pausieren
  -> einen FalsifyMe-Lebenszyklus-Zustand ändern
  -> ein FalsifyMe-Verdict oder -Gate ändern
  -> einen FalsifyMe-Abbruch auslösen oder unterdrücken
  -> einen FalsifyMe-Write autorisieren oder ausführen
```

Das wird strukturell von der aktuellen Staging-Implementierung erzwungen:
kein FalsifyMe-Modul wird importiert, `falsify.db` wird mit `readOnly: true`
geöffnet, und aller abgeleitete Zustand wird nur in der separaten DOKI-
Datenbank persistiert. Der aktuelle Staging-Diff enthält relativ zu `main`
nur `doki/*`-Dateien.

Runtime-Vertrag:

`terminaler loop_event -> read-only Snapshot -> Observation -> Historienvergleich
-> deterministische Korrelation -> Q-LEARNING -> MODELLWECHSEL -> PROMPT ->
LLM-CALL -> DokiMessage -> ENDE RUNTIME -> SQLite-Persistenz`

Die DOKI-Runtime selbst darf mit Fallback oder Fehler enden, aber dieser
Abschluss gehört nur DOKI. FalsifyMe konsumiert DOKI nicht als erforderliche
Lebenszyklus-Abhängigkeit.

Kein FalsifyMe-Modul wird importiert. Die Schnittstelle ist der dokumentierte
Tabellen-/JSON-Vertrag.

Node.js >= 22.5 ist erforderlich, weil `node:sqlite` und `DatabaseSync` in
Node 22.5 eingeführt wurden. Die `readOnly`-Datenbankoption wird von dieser
API unterstützt.

## Live-Bridge (Produktion, Schritt F/G)

`src/bridge.mjs` ist die EINZIGE Produktions-Orchestrierung, die den Observer
an echten FalsifyMe-Ereignissen durch seine Zustandsmaschine führt. Der
Worker (`ui/worker.mjs`, nur TTY) importiert sie lazily und fail-open:

```text
FM-EVT (echter run.mjs-Stream) → worker onEvent → bridge.ingest()
  → observer_observations (durable, exactly-once) + ingest_cursor
Idle-Loop: bridge.pump() pollt den REALEN Slot-Zustand (kein Fertigkeits-Proxy)
  → atomarer Slot-Claim (BEGIN IMMEDIATE auf doki.db) → PROMPT_READY
  → Kontext aus DURABLE Observations rekonstruiert (Restart-sicher)
  → THINKER_RUNNING → genau 1 Call → OUTPUT_READY → Grenze gerückt → COLLECTING
```

Getrennte Ebenen (werden NICHT vermischt):

- **Live-Observation** — `ingest()`, durable in `observer_observations`,
  Fortschritt in `ingest_cursor`.
- **Replay** — `observation_cursor` gehört weiterhin allein der
  `loop_events`-Replay-Pipeline (`cli.mjs run/rebuild`). Getrennte Cursor,
  keine gegenseitige Beeinflussung.
- **Slot-Reservierung** — check + claim in EINER Transaktion
  (`tryClaimThinkerSlot`), Heartbeat (15 s), Stale-Takeover
  (`claimStaleMs`, Default 120 s). Ein Read allein ist keine Reservierung.
- **Narrative Generierung** — Kontext kommt aus der persistenten
  Observationshistorie (deterministisch sortiert), nie aus dem RAM-Buffer.
  Ein Crash verbraucht keine Observation; die Runde wird neu aufgebaut.

Identität: `source_event_id` (Producer-ID, z. B. FM-EVT-Inhalt) ist die
Ereignisidentität; `seq` ist Ordnung, NIE Identität. Inhalte ohne Producer-ID
bekommen eine stabile Content-Hash-Identität.

Provider-Isolation: Die Bridge liest KEINE Env-Variablen und importiert KEIN
FalsifyMe-Modul. `apiBase`/`apiKey`/`model` werden vom Worker INJIZIERT und
stammen aus FalsifyMes EINZIGER Konfigurationswahrheit
(`core/config.mjs` + `core/keys.mjs` — derselbe Key wie der Thinker).
Damit ist die Evidenzlage: `doki/src/model.mjs` (CLI-/Replay-Pfad) liest
weiterhin `DOKI_*`-Variablen; der PRODUKTIONS-Lauf (Worker → Bridge) nutzt
ausschließlich den injizierten FalsifyMe-Provider.

Idle-Zeit-Modellwechsel (DOKI-Blocker 6): die Rotation hängt an
FALSIFYMEs ECHTEM Mechanismus — `cli/run.mjs` schreibt um den realen
Modell-Loop `thinker_start`/`thinker_done` in `loop_events` (inkl.
Fehlerfall; das Fenster schließt IMMER), und `doki/src/rotation.mjs`
liest genau diese Events (latest-start-vs-latest-done, gefixt: ein
offenes Erst-Fenster war vorher unsichtbar). Der Worker löst JEDE
Pump-Runde `loadConfig().model` neu auf (`currentModel`-Injektion) —
`falsify settings set model=…` während Thinker-Idle trägt der nächste
DOKI-Call automatisch. Keine zweite GREEN/RED-Architektur im
Produktionspfad: DOKI entscheidet nichts, es folgt der FalsifyMe-Wahrheit.

## Pure-Narrative-Model-Platzhalter (MIRROR_V1)

Der neue Kern ist absichtlich noch **nicht** in den Produktionspfad verdrahtet.
Er stellt nur die reine Logik bereit, die spaeter durch einen echten
Persistenz-Writer gespeist werden kann. Damit wird aus einem Wort wie `delta`
nicht automatisch eine neue, ungetestete Architektur.

```text
reale FM-EVT-/Snapshot-Daten
        ↓
OBSERVED → PERSISTED → DERIVED → NARRATIVELY_RELEVANT
        ↓
reine Transition-Logik (`doki/src/etats.mjs`)
        ↓
strukturierte Bewegung / Anomalie / Block-Wahl
        ↓
Prompt erst hinter dem Recall-Gate
```

`doki/src/signals.mjs` katalogisiert nur bereits vorhandene Quellen:
`ui/tui/events.mjs`, `doki/src/falsify-reader.mjs`,
`doki/src/ensemble-state.mjs`, `doki/src/narrator-catalog.mjs` und
`artifacts/loops.mjs`. Es werden hier keine neuen Gewichte oder erfundenen
Laufzeitwerte gesetzt.

`doki/src/etats.mjs` ist die zentrale Pure-Logic-Transition. Kein
DB-Zugriff, kein FalsifyMe-Import, kein UI, kein User und kein LLM.
`doki/src/atled.mjs` misst Bewegungen; `doki/src/ylamona.mjs` enthält reine
Anomalie-Prädikate; `doki/src/blocks.mjs` hält Primitive, Recall-Gate und
Reaction-Contract als strukturierte Daten.

MIRROR_V1:

```text
state    ↔ etats
delta    ↔ atled
threshold↔ dlohserht
decay    ↔ yaced
rotate   ↔ etator
history  ↔ yrotsih
anomaly  ↔ ylamona
```

Die Spiegelnamen sind ein Freeze-Vertrag, kein kryptographischer Schutz.

Persistenz bleibt in `doki.db`; `doki/src/db.mjs` hat aktuell Schema-Version 2.
In dieser Stufe werden **keine leeren Schema-V3-Tabellen nur für Platzhalter**
angelegt. Ein neuer Writer bekommt erst dann Migrationen, wenn die Daten auch
wirklich geschrieben und gelesen werden.

Wichtig: `q_table` bleibt unangetastet. `qlearning.mjs` ist vorhanden, aber
nicht Teil dieses reinen Impact-/Recall-Kerns. Q-Learning und
Narrative-Impact werden nicht vermischt.

## Evidenz-Ledger (ehrlich, Stand dieser Implementierung)

- PROVEN (doki/tests/bridge.test.mjs, 15/15): Exactly-once-Ingestion + Dedup
  über Restart-/Sidecar-Grenzen; Cursor-Trennung ingest vs. replay;
  Zustandskette COLLECTING→WAITING→PROMPT_READY→THINKER_RUNNING→
  OUTPUT_READY→COLLECTING aus echten ingest/pump-Zyklen; Variable-Waiting
  (Poll nach Slot-Freiwerden OHNE neues Event); atomarer Claim (Verlierer ruft
  nicht); Stale-Takeover; Crash-Recovery ohne Observationsverbrauch; keine
  `DOKI_*`/`process.env`-Lesungen im Produktionspfad.
- PROVEN (doki/tests/bridge.test.mjs, Audit-Härtung 2026-09-03):
  Provider-Ausfall-Cooldown (`errorCooldownMs`, default 30 s) begrenzt den
  Retry-Sturm des 1-s-Idle-Polls; Idle-Short-Circuit bei unverändertem
  ingest-Cursor; konstanter Observer-Speicher.
- PROVEN (doki/tests/falsify-contract.test.mjs, 2/2): FM-EVT-Vokabular-Brücke
  `t → event_type`, externe Writer-Lücke bleibt off-stream und erzeugt keine
  Observation; Re-Review-Child wird sichtbar; `observer_id` kollidiert nicht
  mit Payload-IDs.
- NEUE PURE-SUITE: `doki/tests/mirror.test.mjs`, `doki/tests/etats.test.mjs`
  und `doki/tests/blocks.test.mjs` prüfen MIRROR_V1, Pure-Logic-Vertrag,
  Vokabular-Abgleich, monotone Leiter, deterministisches Replay, Recall-Gate,
  strukturierte Reaction-Verträge und reine Anomalie-Prädikate.
- NOT PROVEN / UNKNOWN: der neue Pure-Core ist absichtlich noch nicht in
  `runtime.mjs`/`bridge.mjs` aktiviert. Es gibt daher noch keinen behaupteten
  Produktions-E2E-Nachweis für die neue Narrative-Pipeline.

## Reiner Kern (MIRROR_V1 — PLATZHALTER-ETUDE, nicht verdrahtet)

Fünf PURE Module bilden den narrativen Transition-Kern als Platzhalter-Logik
mit echten, getesteten Invarianten. Kein Aufrufer in bridge/runtime —
Aktivierung (Schema v3 + Writer) ist eigener Task.

```text
Grenz-Ereignis (source_event_id Pflicht — Falsify erreicht DOKI nur als Beobachtung)
  → signals.eventSignal (null = ehrliches Nichtwissen)
  → atled (Bewegung; DEFAULT-Werte sind KEINE Beobachtung und wirken nie)
  → impact (MESSGROESSE mit Evidenz-Referenzen, nie erzählerische Wahrheit)
  → ylamona (UNBACKED_MOVE / NO_SIGNAL / NO_MATCH; Ruhestand: 3 in ≥2 Läufen)
  → primitives (strukturiert, kein Text) → blocks.selectBlocks (Anker-Gate)
  → reactionContract (VOR jeder Prosa; rage/insult/obscene vertraglich verboten)
  → etats.step (die EINE Maschine: Übergang + abgeleitete Werte + Entscheidung)
```

Harte Regeln: Leiter `OBSERVED → PERSISTED → DERIVED → NARRATIVELY_RELEVANT`
(genau eine Stufe je Schritt; die Maschine lügt sich nichts hoch —
`prompt_relevant` ist false bis ein echter Relevanz-Filter existiert);
`scoreBlock` ist der EINZIGE Recall-Freigaber (anchor_ok + state_key-Match,
kein LLM-Parameterpfad) — der kreative Score ist separates Record, gedeckelt
(0.3) und entscheidet nur den Tiebreak unter verankerten Gleichen; ein Block
sagt sich einmal je Muster. MIRROR_V1: state↔etats, delta↔atled,
threshold↔dlohserht, decay↔yaced, history↔yrotsih, anomaly↔ylamona
(Freeze-Vertrag: doki/tests/mirror.test.mjs). q_table bleibt Relikt —
der Kern referenziert sie nicht (getestet).

## Konfiguration

`DOKI_API_BASE`, `DOKI_API_KEY`, `DOKI_GREEN_MODEL`, `DOKI_THINKER_MODEL`,
`DOKI_TIMEOUT_MS`, `DOKI_MAX_CALLS` und `DOKI_TOKEN_BUDGET` konfigurieren
Modellzugriff und lokales Budget.

Die CLI benötigt den FalsifyMe-Datenbankpfad und einen separaten
DOKI-Datenbankpfad:

`node doki/src/cli.mjs run --falsify-db <pfad/zu/falsify.db> --doki-db <pfad/zu/doki.db>`

DOKI schreibt nie `falsify.db`, `rate_limit`, `.env`, `config.json` oder
FalsifyMe-Logs.

## Aktueller Staging-Status

Diese Implementierung lebt nur deshalb in `doki/` im Branch
`codex/doki-rev2-staging` von FalsifyMe, weil die verfügbare
GitHub-Integration kein brandneues Repository anlegen kann. Der Code ist
bewusst isoliert, damit er ohne Änderung von Imports oder Runtime-Verträgen
in ein eigenes Repository verschoben werden kann.

Vor jedem echten API-Lauf jeden API-Key rotieren, der zuvor in
Chat- oder Repository-Kontext eingefügt wurde.