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

This is enforced structurally: no FalsifyMe module is imported, `falsify.db` is opened with `readOnly: true`, and all derived state is persisted only in the separate DOKI database. The implementation is additive under `doki/`.

Runtime contract:

`terminal loop_event -> read-only snapshot -> observation -> history comparison -> deterministic correlation -> Q-LEARNING -> MODEL WECHSEL -> PROMPT -> LLM CALL -> DokiMessage -> ENDE RUNTIME -> SQLite persistence`

The DOKI runtime itself may terminate with fallback or failure, but that termination belongs only to DOKI. FalsifyMe does not consume DOKI as a required lifecycle dependency.

No FalsifyMe module is imported. The interface is the documented table/JSON contract.

Node.js >= 22.5 is required because `node:sqlite` and `DatabaseSync` are used by the runtime.

## Configuration

`DOKI_API_BASE`, `DOKI_API_KEY`, `DOKI_GREEN_MODEL`, `DOKI_THINKER_MODEL`, `DOKI_TIMEOUT_MS`, `DOKI_MAX_CALLS`, `DOKI_TOKEN_BUDGET`, and `DOKI_RPM` configure model access and local budget. `DOKI_RPM` defaults to 40 and is hard-capped to a minimum inter-request delay of 1.5 seconds so local parallel callers cannot exceed the 40 requests/minute budget.

The CLI requires the FalsifyMe database path and a separate DOKI database path:

`node doki/src/cli.mjs run --falsify-db <path/to/falsify.db> --doki-db <path/to/doki.db>`

DOKI never writes `falsify.db`, FalsifyMe lifecycle state, FalsifyMe verdicts, or FalsifyMe logs.

## Current status

This branch is based directly on the current `main` baseline. DOKI is carried only as additive `doki/*` content, with the model-call rate limiter in `doki/src/rate-limit.mjs`.

Before any real API run, rotate every API key that has previously been pasted into chat or repository context.
