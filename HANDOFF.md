# FalsifyMe Handoff — Audit 2026-09-02

## Status

This worktree contains a verified P0 probe-cutover implementation plus
mandatory agent/reviewer documentation. The current runtime hardening pass is
**not complete**. The queue/config additions for job snapshots and retries are
present as groundwork, but their full execution wiring is still pending.

The repository is intentionally left uncommitted. All current tracked changes
and current product files are to remain available for the next agent or human;
no files were deleted or reset during this audit.

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
191 tests passed, 0 failed

node --check cli/run.mjs
node --check artifacts/db.mjs
node --check artifacts/jobs.mjs
node --check core/config.mjs
node --check core/probes.mjs
node --check core/twin.mjs
node --check core/prompt.mjs

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
F1: Coder claim – P0 probe cutover and mandatory documentation were added; runtime snapshot/retry/web hardening is only partly present.
F2: User contract – audit the actual work, pull documentation to truth, preserve parallel Ollama/tests, create a handoff, stage without deleting or committing.
F3: Scope match – documentation and audit completed; pending runtime items remain explicitly unresolved.
F4: Falsifiable assumption – green tests might conceal missing production wiring.
F5: Attack – inspected call sites, schema consumers, worker spawn path, key path, and documentation claims; ran the complete suite and syntax checks.
F6: Evidence – cli/run.mjs, artifacts/jobs.mjs, core/config.mjs, core/probes.mjs, core/twin.mjs, WIRING.md, ui/PLAN.md; npm test: 191 passed.
F7: Counterevidence – searched for runtime_config consumers, retry consumers, web tools, and help guards; snapshot/retry fields exist but worker consumption and web implementation were not verified.
F8: Unexamined area – live remote-provider execution, Windows locked-directory behavior, and real Ollama process behavior were not run in this audit.
F9: Residual risk – documentation can still drift if pending runtime contracts are marked DONE without dedicated E2E evidence.
F10: Release decision – BLOCKED – mindestens eine Invariante ist nicht nachgewiesen. The current tree is not a claim of full completion.
```
