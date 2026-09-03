# DOKI Scope Document

## 1. Vision

DOKI is the emotional, narrative user-facing layer above the technical FalsifyMe validation framework. FalsifyMe remains authoritative for technical findings, gates, verdicts, lifecycle state, and abort behavior. DOKI converts already-produced technical evidence into character-driven user-facing prose.

The Dock is the visible production projection. DOKI has an explicit visible output mode and can render the completed narrative message in the real Dock surface.

## 2. System boundaries

### FalsifyMe

Owns validation, code analysis, Evil-Twin verification, findings, verdicts, gates, lifecycle state, and abort semantics.

### DOKI Narrative SQLite

Owns only DOKI-derived narrative state: persona state, relationships, session history, recall_count, emotional axes, narrative observations, reports, and generated messages. It has no foreign-key relationship into the FalsifyMe database.

DOKI opens the FalsifyMe database read-only.

### Dock

The Dock is presentation only. A DOKI message is an additional visible output after the FalsifyMe result is already available. The DOKI message cannot mutate the FalsifyMe result.

## 3. Invisible Thinker

Infrastructure: one minimal NVIDIA-compatible LLM using the shared Thinker API key and a 40 RPM budget.

Execution is asynchronous/opportunistic and must never become part of the technical validation decision path.

The Thinker is not an analyst or decision-maker.

## 4. Deterministic narrative runtime

All narrative context selection is local and deterministic. No LLM call is used to decide narrator, mood, persona state, relationship state, recall/history, statistics, regex and trigger matches, correlation, or tracked technical facts.

Those values are computed before the model call and supplied to it as data.

## 5. LLM responsibility

Exactly one minimal Thinker model call is used for final prose synthesis.

Input:

FalsifyMe verdict + findings + loop state + history + statistics + matches + tracked data + deterministic narrator + deterministic mood + DOKI narrative state.

Output:

One user-facing character-voice message for Dock/X output.

The model must not issue commands, make technical decisions, reinterpret verdicts, invent causality, or change authority.

## 6. User experience / visible Run

The user sees the technical FalsifyMe result first. DOKI processes a terminal loop event only after the technical result exists.

For a visible Dock run:

```text
node doki/src/cli.mjs run \
  --falsify-db <FALSIFY_HOME>/falsify.db \
  --doki-db <FALSIFY_HOME>/doki.db \
  --event <terminal-loop-event-id> \
  --visible
```

Visible output is explicitly marked:

```text
[DOKI] <narrator> · NARRATIVE · THINKER_OUTPUT
<character voice prose>
[DOKI] authority=NONE · update=<deterministic update id>
```

A DOKI failure is a presentation failure only. FalsifyMe keeps its original technical result unchanged and the Dock can show a factual fallback.

## 7. Non-functional principles

| Principle | Requirement |
| --- | --- |
| Separation of concerns | DOKI state has zero authority over FalsifyMe logic. |
| Zero critical-path delay | DOKI never participates in technical validation decisions. |
| Determinism | Narrative state, narrator, mood, matches, and statistics are locally reproducible. |
| Resource efficiency | Shared Thinker key; hard 40 RPM limiter; opportunistic execution. |
| Visibility | DOKI has an explicit visible output mode for the production Dock. |
| Fail-open | DOKI failure never invalidates or alters a FalsifyMe verdict. |
