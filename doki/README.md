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

Node.js >= 22.5 is required because `node:sqlite` and `DatabaseSync` were introduced in Node 22.5. The `readOnly` database option is supported by that API. citeturn159180search0turn159180search1

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

### Evidence ledger (ehrlich, Stand dieser Implementierung)

- PROVEN (doki/tests/bridge.test.mjs, 15/15): Exactly-once Ingestion + Dedup
  über Restart/Sidecar-Grenzen; Cursor-Trennung ingest vs. replay;
  Zustandskette COLLECTING→WAITING→PROMPT_READY→THINKER_RUNNING→
  OUTPUT_READY→COLLECTING aus echten ingest/pump-Zyklen; Variable-Waiting
  (poll nach Slot-Freiwerden OHNE neues Event); atomarer Claim (Verlierer
  ruft nicht); Stale-Takeover; Crash-Recovery ohne Observationsverbrauch;
  keine `DOKI_*`/`process.env`-Lesungen im Produktionspfad.
- PROVEN (doki/tests/bridge.test.mjs, Audit-Härtung 2026-09-03):
  Provider-Ausfall-Cooldown (`errorCooldownMs`, default 30 s) begrenzt den
  Retry-Sturm des 1-s-Idle-Polls — sofortige Folge-pump() liefert
  ERROR_COOLDOWN OHNE neuen Call, nach Ablauf wird ehrlich erneut versucht
  (Observations bleiben durabel, Grenze unverrückt); Idle-Short-Circuit:
  unveränderter ingest-Cursor seit dem letzten Leer-Scan → NO_NEW ohne
  Voll-Tabellen-Scan + JSON.parse jeder Zeile pro Idle-Tick;
  observer.buffered ist ein Zähler statt der unbegrenzt wachsenden
  Buffer-Liste (nur .length wurde je gelesen; Semantik identisch,
  Speicher konstant).
- PROVEN (doki/tests/falsify-contract.test.mjs, 2/2, Abgleich 2026-09-03):
  FM-EVT-Vokabular-Brücke `t → event_type` (Live-Observations tragen ihren
  Typ — C.A.R.E. CLAIM='job'/ATTACK='finding' und die UI-137-Loop-Events
  handoff/loop/scope_auto sind sichtbar) und der externe-Writer-Loop: der
  WRITE-Job-Strom (inkl. 'handoff' + 'loop' WRITE_AUTHORIZED) wird
  exactly-once beobachtet, die agentenseitige Lücke (`falsify handoff
  report`/`complete` sind bewusst OHNE FM-EVT) erzeugt keine Observation und
  keinen Thinker-Call, der Re-Review-Child-Strom (RE_REVIEW_RUNNING …) die
  zweite Runde. Dazu der Identitäts-Fix in observer.mjs: die berechnete
  observation_id kollidiert nie mit einem Payload-`id` (job.id/handoff_id),
  Duplikat-Guard + Cursor bleiben konsistent, Payload bleibt intakt.
- NOT PROVEN / UNKNOWN: **FalsifyMe-seitige Reservation**. Der gemeinsame
  Thinker-Slot ist aus DOKI-Sicht atomar (doki.db), aber FalsifyMe selbst
  reserviert den Provider NICHT atomar gegen DOKI — ein im claim-Fenster
  startender FalsifyMe-Job und der DOKI-Call könnten den Provider doppelt
  belasten. Die Rotation-Ereignisse (`thinker_start/done`) machen das
  Belegungsfenster SICHTBAR und der Worker-Slot-Check (JEDER RUNNING-Job
  über alle Fenster) hält es klein; geschlossen ist es durch eine atomare
  gemeinsame Reservation nicht. Abort bleibt Safety-, Reservation
  Coordination-Mechanismus.
- Headless-Worker: keine Bridge (bewusst — DOKI ist Dock-/Darstellungslane).

## Configuration

`DOKI_API_BASE`, `DOKI_API_KEY`, `DOKI_GREEN_MODEL`, `DOKI_THINKER_MODEL`, `DOKI_TIMEOUT_MS`, `DOKI_MAX_CALLS`, and `DOKI_TOKEN_BUDGET` configure model access and local budget.

The CLI requires the FalsifyMe database path and a separate DOKI database path:

`node doki/src/cli.mjs run --falsify-db <path/to/falsify.db> --doki-db <path/to/doki.db>`

DOKI never writes `falsify.db`, `rate_limit`, `.env`, `config.json`, or FalsifyMe logs.

## Current staging status

This implementation lives in `doki/` on the `codex/doki-rev2-staging` branch of FalsifyMe only because the available GitHub integration cannot create a brand-new repository. The code is deliberately isolated so it can be moved into its own repository without changing imports or runtime contracts.

Before any real API run, rotate every API key that has previously been pasted into chat or repository context.
