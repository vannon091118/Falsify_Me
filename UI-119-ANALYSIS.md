# External UI Presentation Layer Analysis (UI-119)
## Context-Separated Falsification by Subagent B

## Overview
This analysis examines how an external UI might violate presentation-only constraints in the FalsifyMe system, specifically focusing on the external UI presentation layer concept against the existing Worker/FM-EVT contract. The analysis follows the ORCHESTRATOR framework: CLAIM → GATE → PROOF → FAILURE → COUNTERARGUMENT → JUSTIFICATION.

## Attack Vector Analysis

### 1. Worker TUI Interactions
**CLAIM**: An external UI could modify system state through interactions with the worker's Terminal User Interface (TUI).

**GATE**: If the external UI could send commands to the TUI that the worker process interprets as control instructions, it might bypass presentation-layer restrictions.

**PROOF**: 
- The TUI is created in `worker.mjs` lines 369-385 with `onAbort` and `onExit` callbacks
- These callbacks can abort running jobs (`abortFlow()`) or terminate the worker process (`process.exit()`)
- The TUI receives FM-EVTs via `ui.applyEvent()` and updates only its internal presentation state

**FAILURE**: 
- The TUI's `onAbort` and `onExit` callbacks only perform controlled termination operations
- These operations follow existing protocols for job termination and worker shutdown
- No TUI interaction can modify database state, job statuses, or loop states directly
- Actual system state remains isolated in SQLite and modified only by worker/run.mjs processes

**COUNTERARGUMENT**: 
*What if rapid TUI interactions could cause race conditions in job processing?*

**JUSTIFICATION**: 
- Job processing is synchronized through atomic database transactions (BEGIN IMMEDIATE)
- The TUI has no access to job processing logic or database connections
- Termination operations are idempotent and fail-closed (worker.mjs lines 387-400)
- Reference: `artifacts/invariants.mjs` enforces queue consistency after worker operations

### 2. FM-EVT Injection
**CLAIM**: An external UI could inject fake FM-EVTs to modify system state or bypass security restrictions.

**GATE**: 
- If an external UI could write to the worker process's stdio streams, it might inject fake FM-EVTs
- The parser in `ui/tui/parser.mjs` lines 31-41 processes lines starting with "FM-EVT:" as JSON
- Successful parsing triggers `ui.applyEvent()` which updates TUI state

**PROOF**:
- Worker spawns run.mjs child process with piped stdio (worker.mjs lines 499-507)
- Parent reads child's stdout/stderr and feeds to FM-EVT parser (worker.mjs lines 510-526)
- Parser validates JSON and sends objects to TUI via `ui.applyEvent({ ...evt, slot: WINDOW_IDX })`

**FAILURE**:
- FM-EVT processing only updates TUI presentation state (events.mjs apply function)
- TUI state is strictly presentational - it mirrors but cannot modify actual system state
- Actual system state (job statuses, loop states, etc.) resides in SQLite database
- Database modifications occur only through direct worker operations or run.mjs jobDone() calls
- Reference: `core/verdict.mjs` and `artifacts/jobs.mjs` show state modification pathways

**COUNTERARGUMENT**: 
*What if the TUI's presentation state somehow influenced worker behavior?*

**JUSTIFICATION**: 
- Zero feedback loop exists from TUI to worker decision-making
- Worker decisions based solely on: database state, child process results, system signals
- TUI is consumer-only for presentation (events.mjs: all apply() handlers modify only UI state)
- Reference: UI-123 in AGENTS.md confirms "UI possesses no state truth"

### 3. Stdin/stdout Channels
**CLAIM**: An external UI could modify system state by writing to worker process stdin or reading stdout/stderr.

**GATE**:
- If external UI could inject data into stdio streams, it might be interpreted as commands
- Worker inherits stdio from parent process; in TTY mode, pipes child process output

**PROOF**:
- Worker child process stdio configuration (worker.mjs lines 504-506):
  - TTY: { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FALSIFY_UI: "1" } }
  - Headless: { stdio: "inherit" }
- Worker does not appear to read stdin for commands during operation

**FAILURE**:
- Neither worker nor run.mjs processes interpret stdin data as control commands
- Stdio used only for: standard output/error reporting, and (TTY) piping child output to parent
- No command parsers or listeners exist on stdin in either process
- Reference: run.mjs processes only command-line arguments and database/job inputs

**COUNTERARGRIPT**: 
*What if stdin data could be interpreted as part of job payloads or configuration?*

**JUSTIFICATION**: 
- All configuration comes from: command-line args, environment variables (at startup), database
- Stdin is never used as input source for configuration or control in worker or run.mjs
- Reference: worker.mjs argument processing (lines 219-243) shows only status/check functions

### 4. Environmental Variable Exploitation
**CLAIM**: An external UI could modify system state by manipulating environment variables.

**GATE**:
- If external UI could change environment variables seen by worker, it might alter behavior
- Worker reads FALSIFY_WINDOW, FALSIFY_AGENT_NAME, FALSIFY_MAX_WINDOWS at startup

**PROOF**:
- Environment variable usage (worker.mjs lines 51-55):
  - FALSIFY_WINDOW → WINDOW_IDX (worker registration/indexing)
  - FALSIFY_AGENT_NAME → AGENT_NAME (display purposes)
  - FALSIFY_MAX_WINDOWS → MAX_WINDOWS (window limit enforcement)

**FAILURE**:
- Environment variables affect only worker identity/window management, not core system state
- They determine: which slot/index worker uses, how it's displayed, max window count
- Actual system state (jobs, scopes, loops) stored in SQLite and modified via database operations
- Reference: `artifacts/jobs.mjs` and `artifacts/scopes.mjs` show state modification pathways

**COUNTERARGUMENT**: 
*What if changing FALSIFY_WINDOW could interfere with another worker's job processing?*

**JUSTIFICATION**: 
- Each worker registers for specific index via `registerWorker(db, WINDOW_IDX, ...)` (line 301)
- `claimNextJob(db, WINDOW_IDX)` only claims jobs for that specific index (jobs.mjs)
- Workers cannot access jobs meant for other indices due to atomic claiming mechanism
- Reference: `artifacts/jobs.mjs` claimNextJob function shows index-specific job claiming

### 5. Process Manipulation and Signals
**CLAIM**: An external UI could modify system state through signals or process manipulation.

**GATE**:
- If external UI could send signals or manipulate worker process, it might cause state changes
- Worker sets up signal handlers for termination and crash scenarios

**PROOF**:
- Signal handlers (worker.mjs lines 260-261, 267-274):
  - SIGINT/SIGTERM: process.exit(0) (clean termination)
  - uncaughtException/unhandledRejection: log crash + process.exit(1)
- Cleanup handler: process.on("exit", cleanup) (line 259)

**FAILURE**:
- Available signals only cause termination, not arbitrary state modification
- Termination triggers cleanup (unregister worker, close DB) but doesn't modify job/state data
- Orphaned jobs handled by reapStaleJobs on next worker startup (lines 282-300)
- No signal handlers exist that modify database state or job processing logic
- Reference: Signal handling limited to termination operations only

**COUNTERARGUMENT**: 
*What if ptrace/debugger access could modify worker memory?*

**JUSTIFICATION**: 
- Requires elevated privileges - outside normal UI interaction scope
- Detectable as security breach, not presentation-layer bypass
- Not specific to FalsifyMe - any process vulnerable given sufficient access
- Presentation-layer constraint assumes normal interaction boundaries

### 6. Resource Exhaustion
**CLAIM**: An external UI could exhaust worker resources to modify system state.

**GATE**:
- If external UI could cause excessive resource consumption, it might lead to state changes
- Worker creates resources: DB connection, timers, memory for processing/TUI rendering

**PROOF**:
- Worker resources: DB connection (line 250), heartbeat timer (lines 308-310)
- TUI rendering potential memory consumption from excessive data
- Worker processes jobs from queue, each spawning run.mjs child process

**FAILURE**:
- Resource exhaustion causes denial of service, not unauthorized state modification
- System designed for graceful handling: reapStaleJobs cleans orphaned jobs (lines 282-300)
- Queue consistency enforcement prevents inconsistent states (`artifacts/invariants.mjs`)
- Job state transitions atomic and fail-closed - exhaustion only disrupts service
- Reference: `artifacts/loops.mjs` and `artifacts/loopflow.mjs` show fail-closed transitions

**COUNTERARGUMENT**: 
*What if resource exhaustion bypasses timing-dependent security checks?*

**JUSTIFICATION**: 
- Security checks not timing-dependent: atomic DB transactions, deterministic gates
- Example: Probe-based WRITE decision (`core/probes.mjs computeVerdict`) is deterministic
- Even if delayed, same restrictions enforced - no timing windows to exploit
- Reference: `core/probes.mjs` shows formal/structural validation without timing dependencies

## Conclusion
All potential attack vectors fail to bypass presentation-layer restrictions due to:
1. Strict separation of presentation state (TUI) and system state (database/worker logic)
2. Fail-closed design ensuring unauthorized modifications prevent rather than enable state changes
3. Atomic transactions and synchronization preventing race conditions
4. Lack of feedback loops from presentation layer to decision-making processes
5. Architectural boundaries that isolate UI presentation from core falsification logic

The external UI presentation layer remains constrained to observation and limited controlled interactions (job abortion, worker termination) without ability to modify system state or bypass security restrictions. This maintains the integrity of the ORCHESTRATOR framework's CLAIM → GATE → PROOF → FAILURE → COUNTERARGUMENT → JUSTIFICATION pattern for UI-119 scope validation.

## Deliverables Completed
1. ✓ Independent analysis of external UI violation attempts
2. ✓ Identification of potential attack vectors/channels
3. ✓ Counter-arguments explaining why each vector fails/is mitigated
4. ✓ Summary following ORCHESTRATOR framework (this document)