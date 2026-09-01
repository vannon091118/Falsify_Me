#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AGENT SKILL: FalsfyME Pflicht-Check (Bash - LLM-Standard) · FalsifyMe 2.0
# -----------------------------------------------------------------------------
# SCOPE-PROTOKOLL (nicht verhandelbar):
#   1. PLAN ist IMMER die Init-Aktion eines Scopes. User-Input 1:1 wird zum
#      HEADER des Prompts (falsify scope new) und bleibt in allen Scope-Prompts.
#   2. 1 Scope = 1 Artefakt (SQLite), von FalsifyMe aktualisiert: User-Input,
#      letzter vollständiger zusammenfassender Befund, ALLE Befunde.
#      Jeder Job startet das Modell NEU (Context = nur 1 Scope).
#   3. Loop bis Scope erfuellt (das LETZTE Review entscheidet):
#      - VERDICT: PLAN     -> Plan ueberarbeiten (HEADER behalten), erneut einreichen
#      - VERDICT: RESEARCH -> FalsifyMe braucht weitere Daten: read-only
#                             recherchieren, Befunde ergaenzen, erneut einreichen
#      - VERDICT: WRITE    -> FREIGABE: READ-ONLY -> WRITE. Jetzt umsetzen, dann
#                             die Umsetzung erneut reviewen (WRITE-/REVIEW-Loop)
#   4. FalsifyMe selbst bleibt ABSOLUT read-only zum Projekt.
#   5. Nach dem finalen Review endet der Modellkontext; der naechste Scope
#      startet frisch (getrennt, kein Vermischen).
#
# Verwendung:
#   bash agent-skill-falsify.sh --user-input "<User-Input 1:1>" --plan plan.txt --root /path --files "app.js,lib/auth.js"
#   bash agent-skill-falsify.sh --scope <scope-id> --plan plan.txt --root /path --files "app.js,lib/auth.js"   (Loop)
# ─────────────────────────────────────────────────────────────────────────────

# Skript-Lage robust aufloesen → V2_ROOT
_SRC="${BASH_SOURCE[0]:-$0}"
if [[ "$_SRC" != */* ]]; then
  _FOUND="$(command -v "$_SRC" 2>/dev/null || true)"
  [ -n "$_FOUND" ] && _SRC="$_FOUND"
fi
V2_DIR="$(cd "$(dirname "$_SRC")/.." >/dev/null 2>&1 && pwd)"
# Benutzerinstallation: relative Auflösung greift nur im Repo-Checkout. Liegt
# cli/ nicht neben dem Skill (z.B. installiert unter ~/.agents/skills/falsifyme),
# auf die echte Installation (~/.Falsify_Core) umschalten.
if [ ! -x "$V2_DIR/cli/falsify.sh" ] && [ -x "$HOME/.Falsify_Core/cli/falsify.sh" ]; then
  V2_DIR="$HOME/.Falsify_Core"
fi

# ── Hilfsfunktionen ─────────────────────────────────────────────────────────
log_step()  { echo "🔄 $*"; }
log_ok()    { echo "✅ $*"; }
log_info()  { echo "ℹ️  $*"; }
log_warn()  { echo "⚠️  $*"; }
log_error() { echo "❌ $*" >&2; }

# ── Worker-Fenster sicherstellen (bis zu 3, IMMER offen lassen!) ────────────
ensure_dock_window() {
  log_step "Prüfe ob Falsify-Worker-Fenster offen sind..."

  local check_result
  check_result=$(node "$V2_DIR/ui/worker.mjs" --check 2>&1)

  if echo "$check_result" | grep -q "RUNNING"; then
    local pids
    pids=$(echo "$check_result" | grep -oP 'RUNNING \K\d+' | tr '\n' ' ')
    log_ok "Falsify-Fenster laufen bereits (Worker: $pids)"
    return 0
  fi

  log_warn "Kein Falsify-Fenster offen - öffne Fenster (IMMER sichtbar!)..."
  # FENSTER MÜSSEN IMMER SICHTBAR SEIN: niemals headless starten.
  if [[ -f "$V2_DIR/ui/start-dock.cmd" ]]; then
    cmd.exe /c "start \"\" \"$V2_DIR/ui/start-dock.cmd" &
  elif [[ -f "$V2_DIR/ui/START.cmd" ]]; then
    cmd.exe /c "start \"\" \"$V2_DIR/ui/START.cmd" &
  else
    log_error "start-dock.cmd fehlt – Falsify-Fenster müssen IMMER sichtbar sein (ui/start-dock.cmd [1|2|3]). Kein headless Start erlaubt."
    return 1
  fi

  local max_wait=30
  local waited=0
  while [ $waited -lt $max_wait ]; do
    sleep 1
    waited=$((waited + 1))
    check_result=$(node "$V2_DIR/ui/worker.mjs" --check 2>&1)
    if echo "$check_result" | grep -q "RUNNING"; then
      log_ok "Falsify-Worker gestartet - Fenster bleiben offen"
      return 0
    fi
  done

  log_error "Falsify-Worker konnte nicht gestartet werden"
  return 1
}

# ── Scope sicherstellen: PLAN ist IMMER die Init-Aktion ─────────────────────
ensure_scope() {
  local scope_id="$1"
  local user_input="$2"
  if [ -n "$scope_id" ]; then
    echo "$scope_id"
    return 0
  fi
  if [ -z "$user_input" ]; then
    log_error "Beim Scope-Start ist --user-input Pflicht (User-Input 1:1 -> HEADER). Bei Loop-Fortsetzung --scope angeben."
    return 2
  fi
  log_step "PLAN = Init: Scope anlegen - User-Input wird 1:1 zum HEADER..."
  local out
  out=$(node "$V2_DIR/cli/main.mjs" scope new "$user_input" 2>&1) || { log_error "$out"; return 2; }
  local id
  id=$(echo "$out" | sed -n 's/^SCOPE_ID=//p' | head -1)
  [ -n "$id" ] || { log_error "Scope konnte nicht angelegt werden: $out"; return 2; }
  log_ok "Scope angelegt: $id (HEADER = User-Input 1:1)"
  echo "$id"
  return 0
}

# ── Hauptfunktion: Pflicht-Check ────────────────────────────────────────────
falsify_mandatory_check() {
  local plan_file="$1"
  local root_dir="$2"
  local files_list="$3"
  local diff_file="${4:-}"
  local scope_id="${5:-}"
  local user_input="${6:-}"

  if [ -z "$plan_file" ] || [ -z "$root_dir" ] || [ -z "$files_list" ]; then
    log_error "Verwendung: falsify_mandatory_check <plan-file> <root-dir> <files-list> [diff-file] [scope-id] [user-input]"
    return 2
  fi
  if [ ! -f "$plan_file" ]; then
    log_error "Plan-Datei nicht gefunden: $plan_file"
    return 2
  fi

  # ── 0. Fenster sicherstellen (bis zu 3, IMMER offen!) ────────────────────
  ensure_dock_window || return 3

  # ── 0b. Scope: beim Start anlegen (PLAN = Init, HEADER = User-Input 1:1) ──
  local scope
  scope=$(ensure_scope "$scope_id" "$user_input") || return $?

  log_step "FalsfyME Pflicht-Check wird gestartet..."
  log_info "Scope: $scope"
  log_info "Plan: $plan_file"
  log_info "Root: $root_dir"
  log_info "Dateien: $files_list"
  [ -n "$diff_file" ] && log_info "Diff: $diff_file"

  # ── 1. Job einreichen (NICHT blockierend) ─────────────────────────────────
  log_step "Job wird eingereicht ..."
  local submit_args=(
    "--no-wait"
    "--plan-file" "$plan_file"
    "--root" "$root_dir"
    "--files" "$files_list"
    "--scope" "$scope"
  )
  [ -n "$diff_file" ] && submit_args+=("--diff-file" "$diff_file")

  local submit_output
  submit_output=$(bash "$V2_DIR/cli/falsify.sh" submit "${submit_args[@]}" 2>&1) || { log_error "Einreichen fehlgeschlagen: $submit_output"; return 2; }

  local job_id
  job_id=$(echo "$submit_output" | sed -n 's/^JOB_ID=//p' | head -1)
  [ -n "$job_id" ] || { log_error "Keine JOB_ID erhalten: $submit_output"; return 2; }
  log_ok "Job eingereicht (Queue): $job_id"

  # ── 2. Bestätigen: Job IST IM DOCK-FENSTER SICHTBAR (Claim) – VOR dem
  #    blockierenden Warten. Ein Worker-Fenster muss laufen (--check) und den
  #    Job geclaimt haben (Status RUNNING = FM-EVT-Pipeline im Fenster).
  local dock_check
  dock_check=$(node "$V2_DIR/ui/worker.mjs" --check 2>&1)
  if echo "$dock_check" | grep -q "RUNNING"; then
    log_ok "Dock-Fenster läuft ($(echo "$dock_check" | grep -oP 'RUNNING \K.*' | head -1))"
  else
    log_warn "Kein laufendes Dock-Fenster – Job bleibt in der Queue. Fenster starten: ui/start-dock.cmd, dann erneut einreichen."
  fi
  local claimed=0
  local st=""
  for _i in $(seq 1 10); do
    st=$(node "$V2_DIR/cli/main.mjs" status "$job_id" 2>/dev/null | head -1)
    case "$st" in
      RUNNING*) claimed=1; break ;;
      # Fehler-/Abschlusszustand bedeutet: der Dock-Worker hat den Job
      # geclaimt und durchgezogen (Fast-Fail-Pfade RUNNING schneller als der
      # 1s-Poll) - der Job IST damit in der Dock-Pipeline. Kein QUEUED mehr.
      ERROR*|DONE*) claimed=1; break ;;
      QUEUED*) sleep 1 ;;
      *) break ;;
    esac
  done
  if [ "$claimed" = "1" ]; then
    log_ok "Job $job_id ist im Dock sichtbar (Fenster-Claim: Status $st) – warte auf Verdict ..."
  else
    log_warn "Job $job_id noch QUEUED – kein Worker-Claim erkannt (Status: ${st:-?}). Dock prüfen: falsify state"
  fi

  # ── 3. Blockierend auf das Verdict warten (PFLICHT) ───────────────────────
  log_step "Falsify-Check wird ausgeführt (blockierend – wartet auf Verdict)..."
  local wait_output
  wait_output=$(bash "$V2_DIR/cli/falsify.sh" wait "$job_id" 2>&1)
  local wait_exit=$?

  # Verdict aus der Warteschleife extrahieren (DONE <VERDICT>)
  local verdict
  verdict=$(echo "$wait_output" | grep -oP 'DONE \K(PLAN|RESEARCH|WRITE|UNBEKANNT)' | head -1)
  [ -z "$verdict" ] && verdict="UNBEKANNT"
  echo "$wait_output" | tail -1 >&2
  log_ok "Verdict: $verdict (Job $job_id)"

  # ── 2. Ergebnis auswerten (Loop-Routing) ─────────────────────────────────
  case "$verdict" in
    WRITE)
      log_ok "VERDICT: WRITE → Freigabe: READ-ONLY → WRITE (Scope $scope)"
      log_info "Protokoll: falsify log $job_id"
      return 0
      ;;
    RESEARCH)
      log_warn "VERDICT: RESEARCH → FalsifyMe braucht weitere Daten!"
      log_warn "Read-only recherchieren (Dateien lesen, Befunde sammeln), Artefakt ergänzen, erneut einreichen."
      log_info "Datenbedarf/Kritik: falsify log $job_id"
      return 1
      ;;
    PLAN)
      log_error "VERDICT: PLAN → Iteration überarbeiten (HEADER behalten), erneut einreichen."
      log_error "Kritik: falsify log $job_id"
      return 1
      ;;
    UNBEKANNT)
      log_error "VERDICT: UNBEKANNT – FalsifyMe hat NICHT zugestimmt (Exit 3). Agent darf NICHT weiterarbeiten."
      return 3
      ;;
    *)
      log_error "FEHLER bei der Falsifizierung (falsify log $job_id)"
      return 3
      ;;
  esac
}

# ── CLI-Modus (direkte Verwendung) ──────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  plan_file=""
  root_dir=""
  files_list=""
  diff_file=""
  scope_id=""
  user_input=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --plan)      plan_file="$2"; shift 2 ;;
      --root)      root_dir="$2"; shift 2 ;;
      --files)     files_list="$2"; shift 2 ;;
      --diff)      diff_file="$2"; shift 2 ;;
      --scope)     scope_id="$2"; shift 2 ;;
      --user-input) user_input="$2"; shift 2 ;;
      -h|--help)
        echo "AGENT SKILL: FalsfyME Pflicht-Check (Bash) · FalsifyMe 2.0"
        echo ""
        echo "SCOPE-PROTOKOLL: PLAN ist IMMER Init (User-Input 1:1 als HEADER)."
        echo "Loop: PLAN → überarbeiten · RESEARCH → read-only recherchieren · WRITE → Freigabe."
        echo ""
        echo "Verwendung:"
        echo "  bash agent-skill-falsify.sh --user-input \"<User-Input 1:1>\" --plan plan.txt --root /path --files \"a.js,b.js\""
        echo "  bash agent-skill-falsify.sh --scope <scope-id> --plan plan.txt --root /path --files \"a.js,b.js\"   (Loop)"
        echo ""
        echo "Optionen:"
        echo "  --user-input <text>  User-Input 1:1 – wird HEADER des Scopes (beim Start Pflicht)"
        echo "  --scope <id>         Scope-ID (bei Loop-Fortsetzung Pflicht)"
        echo "  --plan <datei>       Plan-/Iterations-Datei (PFLICHT)"
        echo "  --root <verz>        Arbeitsverzeichnis (PFLICHT)"
        echo "  --files <liste>      Zugriffs-Whitelist, kommagetrennt (PFLICHT)"
        echo "  --diff <datei>       Diff der Iteration (optional)"
        echo "  -h, --help           Diese Hilfe"
        echo ""
        echo "Exit-Codes: 0=WRITE (Freigabe) · 1=PLAN/RESEARCH (Loop) · 3=Fehler"
        exit 0
        ;;
      *)
        echo "Unbekannte Option: $1" >&2
        echo "Hilfe: bash agent-skill-falsify.sh --help" >&2
        exit 2
        ;;
    esac
  done

  falsify_mandatory_check "$plan_file" "$root_dir" "$files_list" "$diff_file" "$scope_id" "$user_input"
  exit $?
fi
