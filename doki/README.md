# DOKI Runtime Rev. 2

DOKI is a side-channel with no authority over FalsifyMe. It opens `falsify.db` read-only and persists its own derived state in `doki.db`.

## Fail-open contract

DOKI is strictly optional for the FalsifyMe production lifecycle.

```text
DOKI failure
  -> DOKI fallback / unavailable state / failed DOKI job
  -> FalsifyMe continues unchanged

DOKI MUST NOT
  -> block FalsifyMe
  -> pause FalsifyMe
  -> change a FalsifyMe lifecycle state
  -> change a FalsifyMe verdict or gate
  -> trigger or suppress a FalsifyMe abort
  -> authorize or perform a FalsifyMe write
```

This is enforced structurally by the current staging implementation: no FalsifyMe module is imported, `falsify.db` is opened with `readOnly: true`, and all derived state is persisted only in the separate DOKI database. The current staging diff contains only `doki/*` files relative to `main`.

Runtime contract:

`terminal loop_event -> read-only snapshot -> observation -> history comparison -> deterministic correlation -> Q-LEARNING -> MODEL WECHSEL -> PROMPT -> LLM CALL -> DokiMessage -> ENDE RUNTIME -> SQLite persistence`

The DOKI runtime itself may terminate with fallback or failure, but that termination belongs only to DOKI. FalsifyMe does not consume DOKI as a required lifecycle dependency.

No FalsifyMe module is imported. The interface is the documented table/JSON contract.

Node.js >= 22.5 is required because `node:sqlite` and `DatabaseSync` were introduced in Node 22.5. The `readOnly` database option is supported by that API.

## Live bridge (production, Step F/G)

`src/bridge.mjs` ist die EINZIGE Produktions-Orchestrierung, die den Observer
an echten FalsifyMe-Ereignissen durch seine Zustandsmaschine führt. Der
Worker (`ui/worker.mjs`, nur TTY) importiert sie lazily und fail-open:

```text
FM-EVT (echter run.mjs-Stream) → worker onEvent → bridge.ingest()
  → observer_observations (durable, exactly-once) + ingest_cursor
Idle-Loop: bridge.pump() pollt den REALEN Slot-Zustand (kein Fertigkeits-Proxy)
  → atomic slot claim (BEGIN IMMEDIATE auf doki.db) → PROMPT_READY
  → Kontext aus DURABLE Observations rekonstruiert (Restart-sicher)
  → THINKER_RUNNING → genau 1 Call → OUTPUT_READY → Grenze gerückt → COLLECTING
```

Getrennte Ebenen (werden NICHT vermischt):

- **Live Observation** — `ingest()`, durable in `observer_observations`,
  Fortschritt in `ingest_cursor`.
- **Replay** — `observation_cursor` gehört weiterhin allein der
  `loop_events`-Replay-Pipeline (`cli.mjs run/rebuild`). Getrennte Cursor,
  keine gegenseitige Beeinflussung.
- **Slot Reservation** — check + claim in EINER Transaktion
  (`tryClaimThinkerSlot`), Heartbeat (15 s), Stale-Takeover
  (`claimStaleMs`, Default 120 s). Ein Read allein ist keine Reservation.
- **Narrative Generation** — Kontext kommt aus der persistenten
  Observationshistorie (deterministisch sortiert), nie aus dem RAM-Buffer.
  Ein Crash verbraucht keine Observation; die Runde wird neu aufgebaut.

Identität: `source_event_id` (Producer-ID, z. B. FM-EVT-Inhalt) ist die
Ereignisidentität; `seq` ist Ordnung, NIE Identität. Inhalte ohne Producer-ID
bekommen eine stabile Content-Hash-Identität.

Provider-Isolation: Die Bridge liest KEINE Env-Variablen und importiert KEIN
FalsifyMe-Modul. `apiBase`/`apiKey`/`model` werden vom Worker INJIZIERT und
stammen aus FalsifyMe's EINZIGER Konfigurationswahrheit
(`core/config.mjs` + `core/keys.mjs` — derselbe Key wie der Thinker).
Damit ist die Evidenzlage: `doki/src/model.mjs` (CLI-/Replay-Pfad) liest
weiterhin `DOKI_*`-Variablen; der PRODUKTIONS-Lauf (Worker → Bridge) nutzt
ausschließlich den injizierten FalsifyMe-Provider.

Idle-time model switching (DOKI-Blocker 6): die Rotation hängt an
FALSIFYMEs ECHTEM Mechanismus — `cli/run.mjs` schreibt um den realen
Modell-Loop `thinker_start`/`thinker_done` in `loop_events` (inkl.
Fehler-fall; das Fenster schließt IMMER), und `doki/src/rotation.mjs`
liest genau diese Events (latest-start-vs-latest-done, gefixt: ein
offenes Erst-Fenster war vorher unsichtbar). Der Worker löst JEDE
Pump-Runde `loadConfig().model` neu auf (`currentModel`-Injektion) —
`falsify settings set model=…` während Thinker-Idle trägt der nächste
DOKI-Call automatisch. Keine zweite GREEN/RED-Architektur im
Produktionspfad: DOKI entscheidet nichts, es folgt der FalsifyMe-Wahrheit.

## Pure narrative-model placeholders (MIRROR_V1)

Der neue Kern ist absichtlich noch **nicht** in den Produktionspfad verdrahtet.
Er stellt nur die reine Logik bereit, die spaeter durch einen echten Persistenz-
Writer gespeist werden kann. Damit wird aus einem Wort wie `delta` nicht
automatisch eine neue, ungetestete Architektur.

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
`ui/tui/events.mjs`, `doki/src/falsify-reader.mjs`, `doki/src/ensemble-state.mjs`,
`doki/src/narrator-catalog.mjs` und `artifacts/loops.mjs`. Es werden hier keine
neuen Gewichte oder erfundenen Laufzeitwerte gesetzt.

`doki/src/etats.mjs` ist die zentrale Pure-Logic-Transition. Kein DB-Zugriff,
kein FalsifyMe-Import, kein UI, kein User und kein LLM. `doki/src/atled.mjs`
misst Bewegungen; `doki/src/ylamona.mjs` enthält reine Anomalie-Prädikate;
`doki/src/blocks.mjs` hält Primitive, Recall-Gate und Reaction-Contract als
strukturierte Daten.

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
nicht Teil dieses reinen Impact-/Recall-Kerns. Q-Learning und Narrative-Impact
werden nicht vermischt.

## Evidence ledger (ehrlich, Stand dieser Implementierung)

- PROVEN (doki/tests/bridge.test.mjs, 15/15): Exactly-once Ingestion + Dedup
  über Restart/Sidecar-Grenzen; Cursor-Trennung ingest vs. replay;
  Zustandskette COLLECTING→WAITING→PROMPT_READY→THINKER_RUNNING→
  OUTPUT_READY→COLLECTING aus echten ingest/pump-Zyklen; Variable-Waiting
  (poll nach Slot-Freiwerden OHNE neues Event); atomarer Claim (Verlierer ruft nicht);
  Stale-Takeover; Crash-Recovery ohne Observationsverbrauch; keine
  `DOKI_*`/`process.env`-Lesungen im Produktionspfad.
- PROVEN (doki/tests/bridge.test.mjs, Audit-Härtung 2026-09-03):
  Provider-Ausfall-Cooldown (`errorCooldownMs`, default 30 s) begrenzt den
  Retry-Sturm des 1-s-Idle-Polls; Idle-Short-Circuit bei unverändertem
  ingest-Cursor; konstanter Observer-Speicher.
- PROVEN (doki/tests/falsify-contract.test.mjs, 2/2): FM-EVT-Vokabular-Brücke
  `t → event_type`, externe Writer-Lücke bleibt off-stream und erzeugt keine
  Observation; Re-Review-Child wird sichtbar; `observer_id` kollidiert nicht
  mit Payload-IDs.
- NEW PURE SUITE: `doki/tests/mirror.test.mjs`, `doki/tests/etats.test.mjs`
  und `doki/tests/blocks.test.mjs` prüfen MIRROR_V1, Pure-Logic-Vertrag,
  Vokabular-Abgleich, monotone Leiter, deterministisches Replay, Recall-Gate,
  strukturierte Reaction-Verträge und reine Anomalie-Prädikate.
- NOT PROVEN / UNKNOWN: der neue Pure-Core ist absichtlich noch nicht in
  `runtime.mjs`/`bridge.mjs` aktiviert. Es gibt daher noch keinen behaupteten
  Produktions-E2E-Nachweis für die neue Narrative-Pipeline.

## Configuration

`DOKI_API_BASE`, `DOKI_API_KEY`, `DOKI_GREEN_MODEL`, `DOKI_THINKER_MODEL`, `DOKI_TIMEOUT_MS`, `DOKI_MAX_CALLS`, and `DOKI_TOKEN_BUDGET` configure model access and local budget.

The CLI requires the FalsifyMe database path and a separate DOKI database path:

`node doki/src/cli.mjs run --falsify-db <path/to/falsify.db> --doki-db <path/to/doki.db>`

DOKI never writes `falsify.db`, `rate_limit`, `.env`, `config.json`, or FalsifyMe logs.

## Current staging status

This implementation lives in `doki/` on the `codex/doki-rev2-staging` branch of FalsifyMe only because the available GitHub integration cannot create a brand-new repository. The code is deliberately isolated so it can be moved into its own repository without changing imports or runtime contracts.

Before any real API run, rotate every API key that has previously been pasted into chat or repository context.
