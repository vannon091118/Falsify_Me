# DOKI Runtime Rev. 3

DOKI is a side-channel with no authority over FalsifyMe. It opens `falsify.db` read-only and persists its own derived state in `doki.db`.

## Non-negotiable boundary

```text
FALSIFY FACTS
  -> DOKI local deterministic analysis
     regex / matches / statistics / correlations / history / persona / mood / relationships
  -> deterministic X-output prompt
  -> ONE minimal Thinker LLM call
  -> user-facing prose only
```

The Thinker is **not** an analyst, judge, selector, controller, or second truth source. It does not decide a verdict, choose a technical path, perform reasoning for DOKI, or modify DOKI state. All facts and all narrative inputs are prepared locally before the API call.

DOKI MUST NOT:

- block, pause, change, authorize, or suppress any FalsifyMe lifecycle action;
- change FalsifyMe verdicts, gates, aborts, or writes;
- use an LLM to calculate patterns, statistics, correlations, narrator choice, mood, or relationships;
- use Q-learning or model switching to decide whether or how to render an event.

## Shared Thinker key

The Thinker uses the shared Thinker API key: `DOKI_THINKER_API_KEY`. `DOKI_API_KEY` remains a compatibility fallback only. One configured Thinker model, one prose call path.

The request is rate-limited locally to the configured `DOKI_RPM`, defaulting to **40 RPM** with a minimum spacing of **1.5 seconds** between model requests. The limiter executes only inside the DOKI side-channel. It is not part of FalsifyMe's validation path.

## Deterministic runtime

Before the model call, DOKI computes locally:

- technical input copied from the read-only Falsify snapshot;
- finding, verdict, wave, file and phase statistics;
- regex and match results;
- historical references and continuity information;
- deterministic correlation information;
- narrator and mood selection;
- persistent persona state including recall count, fatigue and emotional weight;
- persistent directed persona relationships;
- the complete deterministic prompt envelope.

The model receives those results and turns them into concise user-facing prose for X. It may express the supplied persona voice and mood, but it may not invent facts, make decisions, or reinterpret the technical verdict.

## Independent storage

`falsify.db` contains FalsifyMe runtime truth. DOKI never writes it.

`doki.db` contains only DOKI-derived narrative state: observations, reports, prompt records, dialog messages, persona state and persona relationships.

There are no foreign-key relationships from DOKI tables into the FalsifyMe schema.

## CLI

`node doki/src/cli.mjs run --falsify-db <path/to/falsify.db> --doki-db <path/to/doki.db>`

`node doki/src/cli.mjs rebuild --falsify-db <path/to/falsify.db> --doki-db <path/to/doki.db>`

Node.js >= 22.5 is required because the runtime uses `node:sqlite` and `DatabaseSync`.
