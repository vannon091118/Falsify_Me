# FalsifyMe Handoff — Audit 2026-09-03 (supersedes 2026-09-02)

## Status

This worktree contains the verified P0 probe-cutover **plus the complete
production runtime loop** (Phases 1–5 of
`plan/feature-runtime-loop-production-1.md`): the chain
`THINKER → EVIL TWIN → GATE → WRITE_AUTHORIZED → external Coder →
CHANGE_CAPTURED → RE_REVIEW_QUEUED → THINKER` is executable and e2e-tested.
The consolidation record lives in that plan file; module ownership in
`WIRING.md` §18.

**Not yet complete (honest gaps):** UI-119/UI-124 (Brench event contract +
loop-state E2E visibility), the runtime enforcement of the structured 10X
protocol gates (`core/protocols.mjs` is implemented
and tested but deliberately not wired into the release path — the system
prompts do not yet emit structured records), full doctor/uninstall hardening
(items 4–7 below), and the final release audit (TASK-023 remainder).

The repository is intentionally left uncommitted. All current tracked changes
and current product files are to remain available for the next agent or human;
no files were deleted or reset during this audit.

## Loop Verification (new 2026-09-03)

- `artifacts/loops.mjs` is the single loop-transition owner (12 states,
  illegal transitions and terminal rewrites fail-closed; enforced by the
  writer scan in `tests/invariants.test.mjs` where it is a registered
  orchestrator).
- `completeHandoff` validates report/handoff/change correlation inside one
  `BEGIN IMMEDIATE` transaction, creates exactly one child job with full
  correlation (`parent_job_id`, `handoff_id`, `iteration_id`, `change_digest`,
  `header_digest`), and is idempotent for duplicate deliveries (verified with
  100 identical reports).
- `header_digest` + base `change_digest` are frozen at submit and direct-run;
  a drifted header rejects the job before any model call.
- The external writer path (`falsify handoff brief` → change →
  `falsify handoff complete`) is proven end-to-end in
  `tests/full-loop-e2e.test.mjs`; the negative matrix (NO_CHANGE, loop limit,
  unauthorized paths, forged correlation, secrets, terminal immutability) in
  `tests/full-loop-negative.test.mjs`.
- The coder brief (`renderCoderBrief`) is a pure derivation of the persisted
  handoff and fails closed on any invalid handoff — it carries no authority.

## What Was Verified (2026-09-02 audit, still valid)

## What Was Verified

- `core/probes.mjs` provides deterministic requirement splitting, probe-set
  parsing, structural validation, per-probe evidence checks, and the single
  probe-based `computeVerdict` gate.
- `core/twin.mjs` provides isolated `runProbeExecution`; malformed, incomplete,
  missing, or failed probe results remain fail-closed.
- `cli/run.mjs` invokes the probe validator and Twin executor for WRITE
  candidates, checks structural and divergence gates, and compares whitelist
  file mtime/size before and after Twin execution.
- Prompt data is loaded from `core/prompt-text/*.md`; the Thinker and probe
  executor contracts are present in German and English.
- The mandatory `CHANGE_GATE_10X` and `FALSIFICATION_RECORD_10X` contract is
  propagated to `AGENTS.md`, README, WIRING, skills, and bootstrap templates.
- `FALSIFY_HOME` uses the documented `~/.Falsify_Private` default, separate
  from the program installation in `~/.Falsify_Core`.
- Existing Ollama/OpenAI-compatible configuration behavior remains in the
  tree. Loopback detection exists in `core/config.mjs`; this audit does not
  claim that every worker/API-key path consumes it correctly.
- The banner file and package/license/documentation changes already present in
  the worktree were preserved. The requested split-identity banner concept is
  design direction only unless separately verified in the SVG.

## Verification Evidence

Executed successfully from the repository root:

```text
npm test
221 tests passed, 0 failed   (2026-09-03; baseline 198 pre-loop, 191 at the 09-02 audit)

node --check cli/run.mjs
node --check artifacts/db.mjs
node --check artifacts/jobs.mjs
node --check artifacts/loops.mjs
node --check core/config.mjs
node --check core/handoff.mjs
node --check core/changes.mjs
node --check core/protocols.mjs
node --check core/probes.mjs
node --check core/twin.mjs
node --check core/prompt.mjs
node --check cli/handoff.mjs

bash -n falsify.sh
bash -n cli/falsify.sh
bash -n selbsttest.sh

git diff --check
```

The suite includes probe cutover E2E cases, fail-closed missing-probe cases,
Twin evidence tests, queue invariants, bootstrap tests, settings/key tests,
security tests, stream tests, and the existing UI/test integration coverage.

## Implemented Documentation Changes

- Added the reusable 10x completion and independent-review protocol to the
  canonical agent contract and executable workflow documentation.
- Added the P0 probe-cutover contract and test command references to README,
  WIRING, prompts, and `ui/PLAN.md`.
- Corrected WIRING's open-work statement so it no longer says that only the
  API-key onboarding task remains open.
- Added this handoff so verified behavior and incomplete work cannot be
  confused during context loss or parallel development.

## Pending Implementation Contracts

The following items remain pending. Their presence in configuration/schema
must not be read as proof that the behavior is complete.

1. **Immutable per-job runtime snapshots and explicit overrides**
   `core/config.mjs` has `snapshotConfig()` and `configFromSnapshot()`;
   `artifacts/jobs.mjs` stores `runtime_config`. `cli/run.mjs` still resolves
   execution from process-global `CFG` in important paths, does not snapshot
   all explicit per-run overrides into submitted jobs, and the worker does not
   restore the stored snapshot before launching a job. Add regression tests for
   submit -> settings change -> worker execution, including Ollama-compatible
   keyless loopback behavior and separate Twin model/API/key settings.

2. **Structured attack-round / NO_EVIDENCE contract**
   The P0 probe contract is implemented and fail-closed, but the broader
   attack-round/NO_EVIDENCE workflow item is not a separately completed
   runtime contract. Any implementation must remain context/evidence only or
   downgrade/veto; it must never create a second WRITE path.

3. **Verdict parsing and bounded transient retry**
   `parseVerdict()` is robust against several placement variants and queue
   retry helpers exist. Worker crash/provider retry orchestration is not yet
   fully wired, and retry metadata must never reopen a terminal `DONE` or
   `ERROR` job. Add tests for transient retry, backoff eligibility, attempt
   exhaustion, abort classification, and immutable terminal rows.

4. **CLI help and bootstrap targeting**
   Bootstrap flag parsing and explicit mode/reach are present, but every CLI
   subcommand still needs a side-effect-free `--help` audit. In particular,
   verify that `falsify scope new --help` cannot create a scope and that agent
   and instruction targets are explicit at both bootstrap entry points.

5. **Canonical secret paths and diagnostics**
   The canonical home and private env writing groundwork exists, including
   `0600` attempts on POSIX. Doctor still needs a complete audit for file mode,
   duplicate/legacy homes, local-provider key exemptions, and honest diagnostics
   when `.env` exists only as an empty template.

6. **Uninstall safety**
   The uninstall flow handles several known paths, workers, backups, and
   dry-run behavior. Active sessions, locked directories, legacy homes, and
   protection of unrelated user files still require adversarial tests and
   bounded removal retries. Do not broaden deletion beyond explicitly owned
   paths.

7. **Opt-in allowlisted web research**
   `core/config.mjs` contains web-search settings, but there is no verified
   end-to-end allowlisted web tool with isolated Twin context, throttling,
   source references, and source persistence. Keep the default disabled and
   fail closed on missing credentials, disallowed domains, network errors, and
   malformed source results.

8. **Final completion and staging**
   Documentation propagation and verification are in progress. The final
   staging operation must include all current requested, documentation, and
   pre-existing product changes, while leaving ignored session scratch out.
   No commit has been created in this handoff.

## Next Execution Order

1. Add focused tests for the current snapshot/retry helpers before changing
   their consumers.
2. Wire one immutable config object through submit, direct-run, worker spawn,
   Thinker, and Twin paths; preserve legacy rows with explicit fallback.
3. Complete CLI help, secrets/doctor, uninstall, and opt-in web boundaries with
   fail-closed tests.
4. Update README/WIRING/`ui/PLAN.md` only with behavior proven by tests.
5. Run the full suite and static checks again.
6. Review `git diff` and `git log`, stage all intended current changes, and
   leave the commit uncreated unless explicitly requested.

## Audit Record

```text
F1: User-Agent-Ausgangsbehauptung: Die gewünschte Kette lautet USER AGENT → THINKER → EVIL TWIN → USER AGENT → REPOSITORY CHANGE → THINKER.
F2: User contract: Prüfen, ob diese Kette bereits vollständig im ausführbaren System vorhanden ist.
F3: Scope match oder konkrete Divergenz: THINKER und EVIL TWIN existieren; der Handoff zurück zum USER AGENT, der Repository-Write und der automatische Re-entry fehlen im Runtime-Code.
F4: Falsifizierbare Annahme: Die dokumentierte Loop-Kette könnte vollständig implementiert sein, obwohl der Runtime-Code nur bis zum finalen Verdict führt.
F5: Unternommener Angriff: Suche nach tatsächlichem Repository-Write, direktem Twin→USER-AGENT-Handoff, automatischer Resubmission und automatischem Re-entry in THINKER.
F6: Tatsächlich gelesene und verifizierte Evidenz: cli/run.mjs, core/agent.mjs, core/twin.mjs, core/probes.mjs, core/tools.mjs, ui/worker.mjs und die relevanten Tests.
F7: Gesuchte Gegenbeweise und Ergebnis: Es wurde nach Produktionspfaden für Write, Git-Änderungserkennung, automatische Resubmission und erneuten THINKER-Start gesucht. Kein solcher vollständiger automatischer Pfad wurde gefunden.
F8: Ungeprüfter oder nur vermuteter Bereich: Das tatsächliche Verhalten eines externen USER AGENT nach Erhalt des Verdicts liegt außerhalb des Runtime-Prozesses.
F9: Stärkstes verbleibendes Risiko: Der USER AGENT erhält kein dediziertes strukturiertes Twin-Ergebnis, sondern primär das finale Verdict, den Status und den Exit-Code.
F10: WRITE-Entscheidung oder konkretes Hindernis: BLOCKED – die Review-Hälfte ist implementiert und getestet, die vollständige USER-AGENT → REPOSITORY CHANGE → THINKER Loop jedoch nicht.
```
