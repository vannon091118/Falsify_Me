# ─────────────────────────────────────────────────────────────────────────────
# FalsifyMe · scripts/run-tests.sh – Tiered test runner (Test-Konsolidierung)
# -----------------------------------------------------------------------------
# Ein Einstieg für alle Test-Stränge. Tiers (datenbasiert, Sept 2026):
#   fast  = Unit-Verträge < 3 s pro Datei — jeder Commit.
#   core  = fast + Prozess-/DB-Suiten (inkl. DOKI-Live-Bridge-Kontrakt) —
#           vor jedem Push.
#   full  = `npm test` (alle Dateien, node-parallel) — Release.
# Der alte AGENTS.md-Pfadsatz (19 Dateien) war bereits stale (14 fehlten) —
# Tiers ersetzen die hardcoded Liste; `bash scripts/run-tests.sh` ohne Arg = core.
# DOKI (2026-09-03): die schnellen Unit-Suiten laufen in fast, die DB-/Bridge-
# Suiten in core (gemessen 2026-09-03: persistent-store ~4 s, bridge ~22 s,
# doki-rotation ~4 s, falsify-contract ~10 s), runtime.test (~47 s) nur in full.
# Pfadlisten PFLEGEN WEGEN: bei neuen Dateien hier eintragen.
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Static SQL safety guard runs for every tier, including fast.
node scripts/check-sql-identifiers.mjs

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
tests/dead-files.test.mjs
tests/agent-stream-output.test.mjs
tests/sql-identifiers.test.mjs
tests/worker-kill.test.mjs
tests/install-drift.test.mjs
ui/tui/views/output-view.test.mjs
doki/tests/reconstruction.test.mjs
doki/tests/replay.test.mjs
doki/tests/full-feature-skeleton.test.mjs
doki/tests/narrator-catalog.test.mjs
doki/tests/mirror.test.mjs
doki/tests/etats.test.mjs
doki/tests/blocks.test.mjs
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
      tests/scope-trace.test.mjs \
      tests/stats.test.mjs \
      tests/handoff-report.test.mjs \
      doki/tests/persistent-store.test.mjs \
      doki/tests/bridge.test.mjs \
      doki/tests/falsify-contract.test.mjs \
      tests/doki-rotation.test.mjs
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
