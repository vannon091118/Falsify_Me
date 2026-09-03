# DOKI Scope Document

## 1. Vision

DOKI is the emotional, narrative user-facing layer above the technical FalsifyMe validation framework. FalsifyMe remains authoritative for technical findings, gates, verdicts, lifecycle state, and abort behavior. DOKI converts already-produced technical evidence into character-driven user-facing prose.

The Dock is the visible production projection. DOKI must be visible there when a completed FalsifyMe job produces a terminal loop event.

## 2. System boundaries

### FalsifyMe

Owns validation, code analysis, Evil-Twin verification, findings, verdicts, gates, lifecycle state, and abort semantics.

### DOKI Narrative SQLite

Owns only DOKI-derived narrative state: persona state, relationships, session history, recall_count, emotional axes, narrative observations, reports, and generated messages. It has no foreign-key relationship into the FalsifyMe database.

DOKI opens the FalsifyMe database read-only.

### Dock

The Dock is presentation only. It receives the completed DOKI message as an additional visible output after the FalsifyMe job has already completed. The DOKI message cannot mutate the FalsifyMe result.

## 3. Invisible Thinker

Infrastructure: one minimal NVIDIA-compatible LLM using the shared Thinker API key and a 40 RPM budget.

Execution is asynchronous and opportunistic. DOKI is launched only after the FalsifyMe job has reached its terminal result, so the critical validation path is never delayed by narrative generation.

The Thinker is not an analyst or decision-maker.

## 4. Deterministic narrative runtime

All narrative context selection is local and deterministic. No LLM call is used to decide:

- narrator
- mood
- persona state
- relationship state
- recall/history
- statistics
- regex and trigger matches
- correlation
- tracked technical facts

Those values are computed before the model call and supplied to it as data.

## 5. LLM responsibility

Exactly one minimal Thinker model call is used for final prose synthesis.

Input:

FalsifyMe verdict + findings + loop state + history + statistics + matches + tracked data + deterministic narrator + deterministic mood + DOKI narrative state.

Output:

One user-facing character-voice message for the Dock/X output surface.

The model must not issue commands, make technical decisions, reinterpret verdicts, invent causality, or change authority.

## 6. User experience

The user sees the actual FalsifyMe validation flow first. Once the technical job is finished, DOKI runs in the background and posts a clearly marked DOKI narrative message into the same visible Dock window.

Example visible sequence:

```text
FALSIFY
  findings → verification → verdict → job complete

DOKI
  local narrative analysis
  → persona/mood/history/matches/statistics
  → one Thinker prose call
  → DOKI message visible in Dock
```

A DOKI failure is a presentation failure only. FalsifyMe keeps its original technical result unchanged and the Dock remains truthful by showing a factual fallback.

## 7. Non-functional principles

| Principle | Requirement |
| --- | --- |
| Separation of concerns | DOKI state has zero authority over FalsifyMe logic. |
| Zero critical-path delay | DOKI starts only after the technical job is complete. |
| Determinism | Narrative state, narrator, mood, matches, and statistics are locally reproducible. |
| Resource efficiency | Shared Thinker key; hard 40 RPM limiter; opportunistic execution. |
| Visibility | DOKI output is surfaced in the real production Dock, not only a standalone CLI. |
| Fail-open | DOKI failure never invalidates or alters a FalsifyMe verdict. |
