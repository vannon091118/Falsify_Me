# DOKI Full Feature Implementation Plan

## Developer Gate

`FULL_COMPLETE_VERSION` — not MVP, not PoC, not headless-only.

The target is a visible, persistent DOKI observer integrated into the existing FalsifyMe terminal Dock without changing FalsifyMe technical authority.

## Source of truth

- FalsifyMe/Git remain technical truth.
- The visible terminal/Dock stream is the observed runtime surface.
- DOKI owns only reconstructable narrative memory and ensemble state.
- SQLite is memory, never a second truth.
- The Thinker is the only external LLM integration and only writes final prose.

## Runtime model

```text
FalsifyMe visible terminal
  -> DOKI observer buffer
  -> exactly-once observation cursor
  -> deterministic narrative reconstruction
  -> 14-character ensemble state
  -> 15th narrator context
  -> auto-generated prompt
  -> shared Falsify Thinker API
  -> exactly one Thinker call when the reserved slot is available
  -> commit-message prose
  -> visible Dock output
```

DOKI observes while FalsifyMe and Evil Twin are active. It does not control either path. It may continue collecting terminal material while an external coding agent is reacting to Evil-Twin findings. The waiting period is intentionally variable because the runtime cannot know how long the external agent needs.

## Persistent ensemble

The 14 characters are persistent identities, not prompt-switched personas. Each character has rebuildable history, memory, relationships, perspective/belief state, thread participation, emotional state and recall state.

Relationships are directed: `A -> B` is independent from `B -> A`.

The 15th narrator is a separate narrator role. It converts the prepared historical ensemble context into the final commit-message prose. Its voice is intentionally cynical, sarcastic and sometimes caustic. It may imply and editorialize from supplied evidence, but it may not invent technical facts or alter FalsifyMe authority.

## Terminal observation contract

The observer consumes the actual terminal monologue/dialog stream. Every observation receives a stable event identity and is persisted as observed exactly once. Already-seen events are never treated as new narrative events.

The observer must preserve:

- raw observed text / structured event data
- source event identity
- ordering
- session / job association when available
- timestamps for ordering only
- source references

Interpretation is derived later, never written into raw observations.

## Narrative reconstruction layers

1. Observation: source terminal facts only.
2. Relationship effects: deterministic directed deltas from observed events.
3. Thread state: deterministic merge/split from evidence-backed continuity.
4. Perspective/beliefs: character-specific interpretation with evidence references.
5. Memory/character state: persistent recall plus non-destructive emotional decay.
6. Conflict/relevance: derived contradictions, salience and narrative weight.
7. Narrative context: read-only assembled context for the 15th narrator.

The source material is reconstructable. Derived state carries rule versions. Rebuilding from the same observed history must reproduce the same state.

## Thinker gate

The Thinker is not an analyst or decision-maker.

Before the API call, DOKI must already know:

- what happened
- what was observed
- which characters are relevant
- their historical state
- relationships
- thread state
- perspective/belief state
- emotional state
- current narrative relevance
- the role and voice of the 15th narrator

The generated prompt is deterministic from that prepared context.

Exactly one Thinker call is made for the narrative output. No Q-learning decision loop, no GREEN/RED model choice and no multi-call reswitch chain belongs in the target narrative path.

## Shared key / idle model switching

These are explicit by-design constraints and are unchanged:

- one shared Falsify Thinker API key
- Thinker model switching whenever the Thinker becomes idle according to the existing rotation contract
- no second DOKI provider/key architecture

## Evil Twin

Evil Twin remains a FalsifyMe technical actor. DOKI observes its visible output and incorporates the evidence into narrative state. DOKI never controls, replaces or rewrites Evil-Twin findings.

## Visible Dock integration

The existing FalsifyMe Dock remains the presentation surface. DOKI is added as an additional observation/output lane in that surface, not as a second terminal application.

The user must be able to see:

- FalsifyMe technical progress
- Thinker / Evil-Twin activity already exposed by FalsifyMe
- DOKI observation state
- buffering / waiting state
- narrator identity
- 15th narrator output
- final commit-message prose
- DOKI authority = NONE
- DOKI failure/fallback state

## Variable idle bridging

The observer state machine must support:

```text
COLLECTING
  -> WAITING_FOR_THINKER_SLOT
  -> COLLECTING (new terminal material arrives)
  -> PROMPT_READY
  -> THINKER_RUNNING
  -> OUTPUT_READY
  -> COLLECTING
```

No fixed sleep is used as a proxy for completion. The runtime has no reliable knowledge of the external coding agent's reaction time after Evil-Twin findings.

## Exactly-once narrative consumption

The observer maintains a durable cursor/digest. Once a terminal event has entered the narrative history, seeing the same event again cannot create a second narrative event.

Replays are idempotent. New events extend the history.

## Failure contract

Any DOKI failure is presentation-only:

- FalsifyMe verdict unchanged
- FalsifyMe lifecycle unchanged
- abort semantics unchanged
- queue unchanged
- Evil Twin unchanged
- visible factual fallback permitted

## Data separation

DOKI may read FalsifyMe state read-only. DOKI writes only its own database. No foreign-key dependency into FalsifyMe is introduced.

## Implementation sequence

### Step A — observer foundation

Create the terminal event envelope, stable observation identity, cursor, deduplication and append-only observation store.

### Step B — ensemble foundation

Port/adapt the SnipWar narrator catalog and persistent character state model. Materialize the 14 directed relationship edges per character pair without self-edges.

### Step C — narrative layers

Implement relationship effects, thread state, perspective/belief state, memory/character state, emotional decay, conflict/relevance and evidence references.

### Step D — historical rebuild

Implement full replay from persisted observation history and byte/semantic determinism checks.

### Step E — narrator context

Add the 15th narrator context builder. Its style is fixed: cynical, sarcastic, occasionally caustic. It receives facts and derived narrative state but no technical authority.

### Step F — Thinker orchestration

Generate the prompt automatically. Reserve the shared Thinker slot. Make exactly one call. Persist the resulting narrative message. Release the slot.

### Step G — Dock wiring

Attach observer events and final DOKI output to the existing visible Dock without replacing its state machine or adding a second UI writer.

### Step H — E2E

Run a real visible FalsifyMe workflow including Thinker, Evil Twin, external-agent waiting, DOKI buffering, free-slot acquisition, one Thinker call and final visible commit prose.

## Commit protocol

The implementation sequence is also the Git commit sequence on `codex/doki-rev2`.

- Exactly one implementation point per commit.
- No mixed-point commits.
- No unrelated cleanup inside a feature-point commit.
- Every commit must be independently reviewable against the plan point it implements.
- After each commit, verify the changed scope and tests before starting the next point.
- The branch remains `codex/doki-rev2` for the entire implementation sequence.
- `main` is not modified by the implementation work.
- A point is not considered complete merely because files exist; its acceptance/tests must pass before the next point begins.

Commit naming convention:

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

If a point must be split internally for a technical reason, the split must first be added explicitly to this plan as separate numbered sub-points. No silent subdivision and no silent regrouping.

## Required test matrix

Unit: identity, deduplication, relationship direction, thread merge/split, belief evidence, memory reconstruction, emotional decay, narrator selection, narrator voice constraints, prompt determinism.

Integration: terminal observer, SQLite separation, Falsify read-only, shared-key gate, Thinker slot, model idle switch, DOKI persistence, Dock events.

E2E: normal completion, Evil-Twin path, external-agent delay, concurrent observation, repeated terminal events, replay/restart, Thinker failure, Thinker timeout, rate limit, missing DOKI DB, Falsify DB read-only failure, abort and Falsify error.

## Explicitly unchanged

- FalsifyMe technical verdict authority
- FalsifyMe lifecycle / loop-state ownership
- FalsifyMe abort semantics
- Evil Twin technical role
- shared Thinker API key
- idle-time Thinker model switching
- existing FalsifyMe queue semantics
- existing FalsifyMe Dock ownership rules

## No silent changes gate

Every production modification must be listed with file, symbol, reason, authority impact, persistence impact and tests. Anything not listed is not changed.

## Acceptance

A normal user can watch one visible FalsifyMe terminal session, including Evil-Twin work, while DOKI observes in parallel, accumulate persistent narrative history, bridge variable idle periods without duplicating events, and finally see one 15th-narrator commit message produced by exactly one Thinker call, without any technical FalsifyMe result being modified.
