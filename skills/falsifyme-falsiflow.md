---
name: falsifyme-falsiflow
description: Run the FalsiFlow mandatory falsification workflow before code changes using the locally installed FalsifyMe gateway. Use whenever the user asks to falsify, verify-before-write, run a FalsifyMe check, submit a plan for falsification, or mentions FalsiFlow / FalsifyMe / "falsyfiME" / scope protocol before implementing changes. Also use after implementation for the review-in-same-scope step.
---

# FalsifyMe / FalsiFlow Session Workflow

FalsifyMe is an external, read-only falsification gateway: Coding Agent → CLI → SQLite job/scope → visible worker → falsification agent → findings → verdict → exit code for you. It never writes into the checked project; you stay read-only until it releases you.

## Install locations (resolve — never hardcode a username)

The installer (`node install.mjs`, run from a FalsifyMe checkout) places everything
under the user's home. The exact paths of the last install are recorded in
`~/.Falsify_Core/install-location.json`:

- Program: `~/.Falsify_Core` (Windows: `%USERPROFILE%\.Falsify_Core`) — CLI entry
  `node cli/main.mjs`, worker check `node ui/worker.mjs --check`, dock start
  `ui/start-dock.cmd`
- Private data: `~/.Falsify_Private` (logs); runtime home `~/.Falsify`
  (config.json, .env, falsify.db)
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

## Scope protocol (non-negotiable)

1. **PLAN is always the init action.** The user's input is stored 1:1 as the scope HEADER and stays in every scope prompt. One scope per task; never mix contexts.
2. Every job starts a fresh model conversation; only results from its own scope may be used.
3. Loop until the scope is fulfilled — the LAST review decides:
   - `VERDICT: PLAN` → rework the plan (keep HEADER), resubmit.
   - `VERDICT: RESEARCH` → FalsifyMe needs more data: research read-only, add findings, resubmit.
   - `VERDICT: WRITE` → release: you may switch read-only → write. Implement, then submit the implementation for review in the SAME scope (WRITE/REVIEW loop).
4. FalsifyMe stays absolutely read-only to the project. Error/missing verdict = no release. Exit codes: 0 WRITE · 1 PLAN/RESEARCH · 2 config/args · 3 API/runtime/no-verdict.

## Workflow

1. **Open worker windows first** (up to 3, always visible, never headless):
   ```bash
   node ~/.Falsify_Core/ui/worker.mjs --check
   ```
   If it prints `STOPPED`, start a visible dock window — double-click the
   `FalsifyMe.lnk` desktop icon, or run `ui\start-dock.cmd 1` from
   `%USERPROFILE%\.Falsify_Core` in a Windows terminal. Never start headless.
   Step 4's submit script also ensures the dock is running.
2. **Create the scope** (PLAN init, user input 1:1 as header):
   ```bash
   node ~/.Falsify_Core/cli/main.mjs scope new "<user input exactly as given>"
   ```
3. **Write the plan** to a file (short, concrete, file-level).
4. **Submit** via the bundled skill script (it ensures windows, claims, polls, prints the verdict):
   ```bash
   bash ~/.agents/skills/falsifyme/agent-skill-falsify.sh \
     --scope <scope-id> \
     --plan plan.txt \
     --root <absolute project root> \
     --files "src/a.py,src/b.py"
   ```
   `--files` is the whitelist of model access (read-only tools: list_dir, read_file, glob). No `..`, absolute escapes, or symlink escapes.
   On first submission omit `--scope` and pass `--user-input "<user input 1:1>"` instead — the script creates the scope.
5. **Act on the verdict** per the loop above. On WRITE: implement, then resubmit a review plan in the same scope. The final review's verdict is what counts.
6. Useful CLI: `falsify scope show <id>` · `jobs` · `status <job>` · `log <job>` · `answer <job>` · `state`. Settings: `falsify settings show|set` (provider/apiBase/model/apiKey — keys live only in `FALSIFY_HOME/.env`, never in repos).

## Hard rules

- Until `VERDICT: WRITE`, make zero edits to the target project.
- The TUI (`ui/START-TUI.cmd`, `node ui/tui-demo.mjs`) is observation only — it never accepts jobs from users and is not a control channel.
- Never claim a verdict you did not see in CLI output; exit code 3 or an error is a hard no.
- doctor check if anything misbehaves: `node ~/.Falsify_Core/cli/main.mjs doctor` (expects: Node ≥22, deps ink/react OK, config, API key, WAL DB).
