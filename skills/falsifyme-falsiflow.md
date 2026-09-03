---
name: falsifyme-falsiflow
description: Run the FalsiFlow mandatory falsification workflow before code changes using the locally installed FalsifyMe gateway. Use whenever the user asks to falsify, verify-before-write, run a FalsifyMe check, submit a plan for falsification, or mentions FalsiFlow / FalsifyMe / "falsyfiME" / scope protocol before implementing changes. Also use after implementation for the review-in-same-scope step.
---

# FalsifyMe / FalsiFlow Session Workflow

FalsifyMe is an external, read-only falsification gateway: Coding Agent → CLI → SQLite job/scope → visible worker → falsification agent → findings → verdict → exit code for you. It never writes into the checked project — the one explicit exception is the physical `FalsifyME.md` project anchor (identity + user-confirmed decision records, created once at bootstrap/`falsify anchor init`; it never holds scopes, findings, verdicts, or rules). You stay read-only until FalsifyMe releases you.

## Install locations (resolve — never hardcode a username)

The installer (`node install.mjs`, run from a FalsifyMe checkout) places everything
under the user's home. The exact paths of the last install are recorded in
`~/.Falsify_Core/install-location.json`:

- Program: `~/.Falsify_Core` (Windows: `%USERPROFILE%\.Falsify_Core`) — CLI entry
  `node cli/main.mjs`, worker check `node ui/worker.mjs --check`, dock start
  `ui/start-dock.cmd`
- Private data + runtime home: `~/.Falsify_Private` (FALSIFY_HOME: logs,
  config.json, .env, falsify.db)
- Agent skills (installed): `~/.agents/skills/falsifyme`
  (`agent-skill-falsify.sh/.mjs/.ps1`) and this skill
  (`~/.agents/skills/falsifyme-falsiflow`)

> **GOTCHA (the #1 breakage):** the install dir is `.Falsify_Core` — with a
> leading dot. `~/Falsify_Core` (without the dot) does NOT exist; any command
> against it fails with `MODULE_NOT_FOUND`. Always use `~/.Falsify_Core`.

The skill scripts resolve their install dir themselves (relative in the repo
checkout, fallback to `~/.Falsify_Core` in the installed copy), so they work on
any machine right after installation — never paste a `C:/Users/<name>/...` path
into a command.

## Ticket protocol (non-negotiable)

1. **The agent writes the job as a ticket** ("what should be done"). The user's input is passed 1:1 as `--user-input` on EVERY iteration — it becomes the scope HEADER and stays in every scope prompt. One scope per task; never mix contexts.
2. **FalsifyMe alone determines the scope ID.** Submit passes the ticket as `--header`; FalsifyMe resolves it deterministically per checkout: no open scope → creates one (minted ID), exactly one open scope → continues it, several → fail-closed (exit 2, scope list). The agent never passes, parses, or re-supplies a scope ID. `--scope` is an operator/diagnostics flag, not an agent contract.
3. Every job starts a fresh model conversation; only results from its own scope may be used.
4. Loop until the scope is fulfilled — the LAST review decides:
   - `VERDICT: PLAN` → rework the iteration, resubmit with the SAME ticket (`--user-input` 1:1).
   - `VERDICT: RESEARCH` → FalsifyMe needs more data: research read-only, add findings, resubmit (same ticket).
   - `VERDICT: WRITE` → release: you may switch read-only → write. Implement, then submit the implementation for review in the SAME scope (WRITE/REVIEW loop).
5. FalsifyMe stays read-only to the project (sole exception: the identity anchor `FalsifyME.md`; all runtime state lives in SQLite). Error/missing verdict = no release. Exit codes: 0 WRITE · 1 PLAN/RESEARCH · 5 ASK · 2 config/args · 3 API/runtime/no-verdict.

## Mandatory 10x protocol after every piece of work

After every plan, change, bug fix, refactor, feature, documentation change, or
configuration change, record both layers below. They are agent/reviewer
contracts, not a second queue or verdict path; only the existing falsification
pipeline can release `WRITE`.

### CHANGE_GATE_10X

Answer A1 through A10 with `JA` and include proof for each answer:

```text
A1: JA
Proof: <concrete evidence>
Test: <exact command or reproducible verification>
```

The ten checks cover scope, unchanged architecture, verdict authority, real
refutation evidence, root/scope binding, fail-closed release, Evil-Twin context
isolation, safe handling of empty/malformed/API-failed responses, executable
verification, and hostile-agent safety. Any `NEIN`, `UNBEKANNT`, or missing
proof means exactly:

```text
BLOCKED – mindestens eine Invariante ist nicht nachgewiesen.
```

### FALSIFICATION_RECORD_10X

The independent reviewer records for every plan, change, and iteration:

```text
F1: User-Agent-Ausgangsbehauptung
F2: user contract
F3: exact scope match or divergence
F4: falsifiable assumption
F5: attack performed
F6: verified evidence actually read
F7: counterevidence searched and result
F8: unexamined or merely assumed area
F9: strongest residual risk
F10: WRITE decision or concrete blocker
```

`F6` must identify evidence that exists in the accessible root and scope;
fictional files, lines, symbols, or confidence are invalid. No sufficient proof
means no `WRITE` claim.

## Workflow

1. **Open worker windows first** (up to 3, always visible, never headless):
   ```bash
   node ~/.Falsify_Core/ui/worker.mjs --check
   ```
   If it prints `STOPPED`, start a visible dock window — double-click the
   `FalsifyMe.lnk` desktop icon, or run `ui\start-dock.cmd 1` from
   `%USERPROFILE%\.Falsify_Core` in a Windows terminal. Never start headless.
   Step 4's submit script also ensures the dock is running.
2. **Start the ticket** (optional but visible; binds the job without submitting):
   ```bash
   falsify start "<user input exactly as given>"
   ```
   FalsifyMe reports whether it created a new scope or continues the open one — the ID is FalsifyMe's business, not yours.
3. **Write the plan** to a file (short, concrete, file-level).
4. **Submit** via the bundled skill script (it ensures windows, claims, polls, prints the verdict). The SAME command starts and continues — the ticket (`--user-input` 1:1) is the identity:
   ```bash
   bash ~/.agents/skills/falsifyme/agent-skill-falsify.sh \
     --user-input "<user input exactly as given>" \
     --plan plan.txt \
     --root <absolute project root> \
     --files "src/a.py,src/b.py"
   ```
   `--files` is the whitelist of model access (read-only tools: list_dir, read_file, glob). No `..`, absolute escapes, or symlink escapes.
5. **Act on the verdict** per the loop above. On WRITE: implement, then resubmit a review plan with the same ticket (`--user-input` 1:1). The final review's verdict is what counts.
6. Useful CLI: `falsify resume [--header "<ticket>"]` (re-engage the last open job) · `falsify history [--scope <id>]` (what happened & how FalsifyMe affected the project) · `jobs` · `status <job>` · `log <job>` · `answer <job>` · `state`. Settings: `falsify settings show|set` (provider/apiBase/model/apiKey — keys live only in `FALSIFY_HOME/.env`, never in repos).

## Hard rules

- Until `VERDICT: WRITE`, make zero edits to the target project.
- The TUI (`ui/START-TUI.cmd`, `node ui/tui-demo.mjs`) is observation only — it never accepts jobs from users and is not a control channel.
- Never claim a verdict you did not see in CLI output; exit code 3 or an error is a hard no.
- doctor check if anything misbehaves: `node ~/.Falsify_Core/cli/main.mjs doctor` (expects: Node ≥22, deps ink/react OK, config, API key, WAL DB).
