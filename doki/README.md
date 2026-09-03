# DOKI Runtime Rev. 2

DOKI is a side-channel with no authority over FalsifyMe. It opens `falsify.db` read-only and persists its own derived state in `doki.db`.

Runtime contract:

`terminal loop_event -> read-only snapshot -> observation -> history comparison -> deterministic correlation -> Q-LEARNING -> MODEL WECHSEL -> PROMPT -> LLM CALL -> DokiMessage -> ENDE RUNTIME -> SQLite persistence`

No FalsifyMe module is imported. The interface is the documented table/JSON contract.

Node.js >= 22.5 is required because `node:sqlite` and `DatabaseSync` were introduced in Node 22.5. The `readOnly` database option is supported by that API. citeturn159180search0turn159180search1

## Configuration

`DOKI_API_BASE`, `DOKI_API_KEY`, `DOKI_GREEN_MODEL`, `DOKI_THINKER_MODEL`, `DOKI_TIMEOUT_MS`, `DOKI_MAX_CALLS`, and `DOKI_TOKEN_BUDGET` configure model access and local budget.

The CLI requires the FalsifyMe database path and a separate DOKI database path:

`node doki/src/cli.mjs run --falsify-db <path/to/falsify.db> --doki-db <path/to/doki.db>`

DOKI never writes `falsify.db`, `rate_limit`, `.env`, `config.json`, or FalsifyMe logs.

## Current staging status

This implementation lives in `doki/` on the `codex/doki-rev2-staging` branch of FalsifyMe only because the available GitHub integration cannot create a brand-new repository. The code is deliberately isolated so it can be moved into its own repository without changing imports or runtime contracts.

Before any real API run, rotate every API key that has previously been pasted into chat or repository context.
