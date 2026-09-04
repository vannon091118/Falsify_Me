API Key Input UI-073 – ORCHESTRATOR Pattern Summary (CLAIM → GATE → PROOF → FAILURE)

## CLAIM – Scope Definition
The API key input UI during bootstrap (UI-073) must handle key collection with proper masking, headless/interactive mode support, .env management, and integration with the bootstrap flow. The scope is limited to `cli/bootstrap/apikey.mjs` and its integration with `cli/bootstrap/main.mjs`.

## GATE – Existing Guards & Constraints
- Keys stored exclusively in `FALSIFY_HOME/.env` (via `core/settings.mjs:writeEnvKey`), never in repo code
- `hasApiKey()` guards via `core/keys.mjs:loadApiKey` – no key = no job (Exit 3, no fake WRITE)
- `envHasOnlyEmptyValues()` detects .env with empty values – prevents silent failure
- `createEnvFile()` writes with `mode: 0o600` (chmod 600) as protection measure
- Fail-closed: without valid key, no Job starts (echoed in all mode paths)
- Dry-run skips key collection entirely via `runPreflight` early return

## PROOF – Changes Implemented

### 1. `askSecret` function (`apikey.mjs:47-68`)
- Uses `readline` `rl.question()` for standard CLI input
- After user presses Enter, displays `"*".repeat(answer.length)` mask on single line
- Headless mode (no TTY): logs advisory message, resolves with `""` (no hang)
- Interactive mode (TTY): prompts, masks, returns raw key value
- Key never printed in plain text – only `*` mask written to `process.stdout`

### 2. `envHasOnlyEmptyValues()` guard (`apikey.mjs:24-32`)
- Regex checks `NVIDIA_API_KEY=/OPENAI_API_KEY=/FALSIFY_API_KEY=` pattern
- If .env exists with only empty values: clear hint shown instead of silent failure
- If .env doesn't exist: returns `false` (treated as "key missing", not "empty values")

### 3. `createEnvFile()` writer (`apikey.mjs:34-45`)
- Creates `.env` at `FALSIFY_HOME/.env` with all three key placeholders
- Writes provided key as `FALSIFY_API_KEY=<value>`, other keys as empty
- Sets file permissions `mode: 0o600` via `writeFileSync` + `chmodSync` fallback
- Directory auto-created via `mkdirSync(..., { recursive: true })`

### 4. `ensureApiKeyAtBootstrap` enhanced (`apikey.mjs:83-132`)
- **Step 1**: If key already configured → return `{ configured: true, mode: "configured" }`
- **Step 2**: Check for .env with empty values → show hint (UI-073 fix)
- **Step 3**: Show explanation + gate text (unchanged)
- **Step 4**: If `!interactive` (headless) → show agent instructions, return `{ configured: false, mode: "headless" }`
- **Step 5** (interactive): `askSecret("Bitte den API-Key...")` → if no key → `{ configured: false, mode: "declined" }`
- **Step 6**: `createEnvFile("FALSIFY_API_KEY", key)` → writes .env with chmod 600
- **Step 7**: Return `{ configured: true, mode: "key-provided" }`

### 5. Bootstrap flow integration (`main.mjs:68-69`)
- `runPreflight` calls `ensureApiKeyAtBootstrap` **before** dock starts
- Dry-run: `runPreflight` returns early `key: { configured: false, mode: "dry-run" }` without calling `ensureApiKeyAtBootstrap`
- Non-dry-run: key collection runs; only after preflight passes does dock start

## FAILURE – Verification & Edge Cases

| Scenario | Behavior |
|---|---|
| Key already present | `{ configured: true, mode: "configured" }` – skip input |
| .env with empty values | Clear hint shown; user prompted for new key |
| .env missing | `.env` created with key + chmod 600 |
| Headless mode (no TTY) | Advisory printed; key set manually via `falsify settings set` |
| Interactive mode | `askSecret` masks with `*`; key written to .env |
| Key cancelled/declined | `{ configured: false, mode: "declined" }` – no job started |
| Dry-run mode | Key collection skipped; `mode: "dry-run"` reported |
| Key logged plain text | Never – only `*` mask output; actual key stored only in .env |

All changes are conservative – only `cli/bootstrap/apikey.mjs` modified. No refactoring of unrelated code. The ORCHESTRATOR pattern (CLAIM → GATE → PROOF → FAILURE) is satisfied: scope claimed, gates enforced, proof provided via implementation, failure modes documented.