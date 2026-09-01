#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# falsify (Root-Forwarder) → FalsifyMe 2.0 (cli)
# Die modulare Implementierung lebt direkt im Repo-Root (artifacts/ core/
# cli/ ui/ skills/) – hier wird nur weitergereicht.
# ─────────────────────────────────────────────────────────────────────────────
_SRC="${BASH_SOURCE[0]:-$0}"
if [[ "$_SRC" != */* ]]; then
  _FOUND="$(command -v "$_SRC" 2>/dev/null || true)"
  [ -n "$_FOUND" ] && _SRC="$_FOUND"
fi
ROOT_DIR="$(cd "$(dirname "$_SRC")" >/dev/null 2>&1 && pwd)"
exec bash "$ROOT_DIR/cli/falsify.sh" "$@"
