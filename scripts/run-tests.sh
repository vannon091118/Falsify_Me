# ─────────────────────────────────────────────────────────────────────────────
# FalsifyMe · scripts/run-tests.sh – Tiered test runner (Test-Konsolidierung)
# -----------------------------------------------------------------------------
# Ein Einstieg für alle Test-Stränge. Tiers (datenbasiert, Sept 2026):
#   fast  = Unit-Verträge < 3 s pro Datei (~7 s gesamt) — jeder Commit.
#   core  = fast + Prozess-/DB-Suiten (~2.5 min) — vor jedem Push.
#   full  = `npm test` (alle 33 Dateien, ~2 min node-parallel) — Release.
# Der alte AGENTS.md-Pfadsatz (19 Dateien) war bereits stale (14 fehlten) —
# Tiers ersetzen die hardcoded Liste; `bash scripts/run-tests.sh` ohne Arg = core.
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TIER="${1:-core}"

FAST="
tests/verdict.test.mjs
tests/keys.test.mjs
tests/prompt.test.mjs
tests/exit-code-authority.test.mjs
tests/feasibility.test.mjs
tests/probes.test.mjs
tests/loop-state-writer-freeze.test.mjs
tests/stream-wrap.test.mjs
tests/tool-evidence.test.mjs
tests/onboard.test.mjs
tests/verdict-parsing.test.mjs
tests/settings.test.mjs
tests/bootstrap.test.mjs
tests/agent.test.mjs
tests/tui-regime.test.mjs
tests/agent-stream-output.test.mjs
"

case "$TIER" in
  fast)
    echo "── Tier: fast (Unit-Verträge, ~7 s) ──"
    exec node --test --test-concurrency=1 $FAST
    ;;
  core)
    echo "── Tier: core (fast + Prozess-/DB-Suiten, ~2.5 min) ──"
    exec node --test --test-concurrency=1 $FAST \
      tests/queue.test.mjs \
      tests/datamodel.test.mjs \
      tests/identity.test.mjs \
      tests/uninstall.test.mjs \
      tests/ticketflow.test.mjs \
      tests/invariants.test.mjs \
      tests/security.test.mjs \
      tests/foreign-project.test.mjs \
      tests/selfreview.test.mjs \
      tests/research-additions.test.mjs \
      tests/full-loop-e2e.test.mjs \
      tests/full-loop-negative.test.mjs \
      tests/twin.test.mjs \
      tests/scope-trace.test.mjs
    ;;
  full)
    echo "── Tier: full (alle Tests via npm) ──"
    exec npm test
    ;;
  *)
    echo "Nutzung: bash scripts/run-tests.sh [fast|core|full]" >&2
    exit 2
    ;;
esac
