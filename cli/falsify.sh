#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# falsify – Bash-CLI (Hauptwerkzeug ALLER Agents) · FalsifyMe 2.0
# -----------------------------------------------------------------------------
# Alle Persistenz liegt in SQLite (WAL) unter FALSIFY_HOME (~/.Falsify) –
# ausserhalb des Repos: Keys, DB, Logs. Parallele, konfliktfreie Nutzung:
# Agents reichen Jobs ein und fragen sie ab, ohne sich (oder die Worker-
# Fenster) zu stoeren. Bis zu 3 Worker-Fenster verarbeiten die Queue parallel.
#
#   falsify install                          global in PATH einhaengen (einmalig)
#   falsify scope new "<user-input>"         Scope anlegen (HEADER = User-Input 1:1)
#   falsify submit --scope <id> --plan-file plan.txt --root <dir> --files "a.js,b.js" [--diff-file d.patch]
#             BLOCKIERT bis zum Verdict (Exit 0=WRITE 1=PLAN/RESEARCH 3=Fehler):
#             Agents duerfen erst nach VERDICT: WRITE (Freigabe) schreiben.
#             --no-wait NUR fuer interaktive Tools (danach: falsify wait <id>)
#   falsify wait <job-id>                    STILLER CHECKBACK (jede Sekunde, KEIN Timeout):
#                                            Ergebnis kommt im Moment der Fertigstellung.
#   falsify status <job-id> | falsify jobs | falsify state | falsify check
#   falsify scope show <id> | falsify scope list
#   falsify log <job-id> | falsify answer <job-id> [--file pfad]
#   falsify history [--last n]
#   falsify run <Plan-Text...> [Optionen]    direkter API-Lauf (ohne Worker-Fenster)
#   falsify ensure-home                      FALSIFY_HOME anlegen/prüfen
#   falsify help
# ─────────────────────────────────────────────────────────────────────────────

# ── Skript-Lage robust aufloesen (auch via PATH/Symlink, egal welche cwd) ────
_SRC="${BASH_SOURCE[0]:-$0}"
if [[ "$_SRC" != */* ]]; then
  _FOUND="$(command -v "$_SRC" 2>/dev/null || true)"
  [ -n "$_FOUND" ] && _SRC="$_FOUND"
fi
V2_DIR="$(cd "$(dirname "$_SRC")/.." >/dev/null 2>&1 && pwd)"

cmd="${1:-help}"
[ $# -gt 0 ] && shift

fail() { echo "FEHLER: $*" >&2; exit 2; }

case "$cmd" in
  install)
    line="export PATH=\"$V2_DIR/cli:\$PATH\"  # Falsify-CLI v2 (falsify submit|wait|scope|jobs|state|...)"
    marker="# Falsify-CLI v2 (falsify submit|wait|scope|jobs|state|...) – automatisch ergaenzt"
    touched=0
    for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
      if [ -f "$rc" ]; then
        if grep -qF "Falsify-CLI" "$rc" 2>/dev/null; then
          echo "Bereits eingetragen: $rc"
        else
          printf '\n%s\n%s\n' "$marker" "$line" >> "$rc"
          echo "PATH-Eintrag ergaenzt: $rc"
          touched=1
        fi
      fi
    done
    if [ "$touched" = "0" ]; then
      : > "$HOME/.bashrc" 2>/dev/null || true
      printf '\n%s\n%s\n' "$marker" "$line" >> "$HOME/.bashrc"
      echo "PATH-Eintrag ergaenzt: $HOME/.bashrc (neu angelegt)"
    fi
    echo ""
    echo "Fertig. Ab sofort in JEDER neuen Bash (auch Agents):"
    echo "  falsify scope new ... | submit ... | wait | status | jobs | state | check | history | log | answer | run"
    echo "Aktive Shells:  source ~/.bashrc"
    ;;
  submit)
    # PFLICHT-Regel: Agents muessen warten, bis ihr Job geprueft wurde, bevor sie
    # weiterarbeiten. `falsify submit` blockt deshalb standardmaessig bis zum
    # Verdict (Exit 0=WRITE, 1=PLAN/RESEARCH, 3=Fehler). Nur fuer interaktive
    # Tools, die die Kritik live im Fenster verfolgen, gibt es --no-wait.
    no_wait=0
    for a in "$@"; do [ "$a" = "--no-wait" ] && no_wait=1; done
    out="$(node "$V2_DIR/cli/run.mjs" --submit "$@")" || { echo "$out" >&2; exit 2; }
    echo "$out"
    id="$(echo "$out" | sed -n 's/^JOB_ID=//p' | head -1)"
    if [ -z "$id" ]; then exit 2; fi
    if [ "$no_wait" = "1" ]; then
      echo "Weiter mit: falsify wait $id"
      exit 0
    fi
    # Blockierend auf das Verdict warten – erst danach darf weitergearbeitet werden.
    exec bash "$V2_DIR/cli/falsify.sh" wait "$id"
    ;;
  wait)
    # STILLER CHECKBACK: pollt jede Sekunde die SQLite-DB, KEIN Timeout.
    id="${1:-}"
    [ -n "$id" ] || fail "Nutzung: falsify wait <job-id>"
    node "$V2_DIR/cli/main.mjs" status "$id" >/dev/null 2>&1 || fail "Unbekannter Job: $id"
    echo "Warte auf $id (Checkback jede Sekunde, Ergebnis kommt sofort)..." >&2
    while :; do
      line="$(node "$V2_DIR/cli/main.mjs" status "$id" 2>/dev/null | head -1)"
      case "$line" in
        QUEUED*|RUNNING*) sleep 1 ;;
        DONE*|ERROR*) break ;;
        *) sleep 1 ;;
      esac
    done
    echo "=== $id: $line ==="
    case "$line" in
      "DONE WRITE"*) exit 0 ;;
      "DONE PLAN"*|"DONE RESEARCH"*)
        echo "⚠️  VERDICT: ${line#DONE } – nicht freigegeben. Kritik lesen (falsify log $id), Loop fortsetzen." >&2
        exit 1 ;;      "DONE UNBEKANNT"*)
        echo "⚠️  KEIN gültiges Verdict erkannt – keine Freigabe (Exit 3)." >&2
        exit 3
 ;;
      ERROR*) exit 3 ;;
      *) exit 3 ;;
    esac
    ;;
  status)
    id="${1:-}"
    [ -n "$id" ] || fail "Nutzung: falsify status <job-id>"
    node "$V2_DIR/cli/main.mjs" status "$id"
    ;;
  jobs)
    node "$V2_DIR/cli/main.mjs" jobs
    ;;
  state|check)
    node "$V2_DIR/ui/worker.mjs" --"$cmd"
    ;;
  history)
    node "$V2_DIR/cli/main.mjs" history "$@"
    ;;
  log)
    id="${1:-}"
    [ -n "$id" ] || fail "Nutzung: falsify log <job-id>"
    node "$V2_DIR/cli/main.mjs" log "$id"
    ;;
  answer)
    node "$V2_DIR/cli/main.mjs" answer "$@"
    ;;
  scope)
    node "$V2_DIR/cli/main.mjs" scope "$@"
    ;;
  ensure-home)
    node "$V2_DIR/cli/main.mjs" ensure-home
    ;;
  doctor)
    node "$V2_DIR/cli/main.mjs" doctor
    ;;
  settings)
    node "$V2_DIR/cli/main.mjs" settings "$@"
    ;;
  models)
    node "$V2_DIR/cli/main.mjs" models "$@"
    ;;
  run)
    node "$V2_DIR/cli/run.mjs" "$@"
    ;;
  help|-h|--help)
    sed -n '2,34p' "$0"
    ;;
  *)
    fail "Unbekannter Befehl: $cmd (falsify help)"
    ;;
esac
