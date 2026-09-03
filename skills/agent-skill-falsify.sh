#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AGENT SKILL: FalsifyMe Pflicht-Check (Bash - LLM-Standard) · FalsifyMe 2.0
# -----------------------------------------------------------------------------
# TICKET-PROTOKOLL (nicht verhandelbar):
#   1. Der Agent schreibt den Job als TICKET („was soll gemacht werden“) und
#      liefert es bei JEDER Iteration 1:1 als --user-input (HEADER, nie
#      umformuliert). Er verwaltet KEINE Scope-ID – FalsifyMe bestimmt die
#      Scope-Zuordnung automatisch (neuer Scope beim ersten Ticket, sonst
#      Fortsetzung desselben Tickets). Ein Aufrufpfad fuer Start UND Loop.
#   2. 1 Scope = 1 Artefakt (SQLite), von FalsifyMe aktualisiert. Jeder Job
#      startet das Modell NEU (Context = nur 1 Scope).
#   3. Loop bis der Scope erfuellt ist (das LETZTE Review entscheidet):
#      - VERDICT: PLAN     -> Iteration ueberarbeiten, erneut einreichen
#                             (immer mit DEMSELBEN Ticket = --user-input 1:1)
#      - VERDICT: RESEARCH -> FalsifyMe braucht weitere Daten: read-only
#                             recherchieren, Befunde ergaenzen, erneut einreichen
#      - VERDICT: WRITE    -> FREIGABE: READ-ONLY -> WRITE. Jetzt umsetzen, dann
#                             die Umsetzung erneut reviewen (WRITE-/REVIEW-Loop)
#   4. FalsifyMe selbst bleibt read-only zum Projekt (einzige Schreibausnahme:
#      der identitätstragende FalsifyME.md-Anker – nie Scopes/Verdicts/Regeln).
#   5. --scope <id> ist ein OPERATOR-/DIAGNOSE-Flag und im Agent-Pfad VERBOTEN
#      (der Agent darf die Scope-Zuordnung nie selbst entscheiden).
#
# Verwendung (JEDE Iteration – Start UND Fortsetzung sind EIN Pfad):
#   bash agent-skill-falsify.sh --user-input "<User-Input 1:1 / Ticket>" --plan plan.txt --root /path --files "app.js,lib/auth.js"
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
  # Start MSYS-sicher (WIRING §4): cygpath -w + PowerShell Start-Process statt
  # "cmd.exe /c start ..." - Git-Bash zerlegt dort Argumente mit Leerzeichen
  # und konvertiert Pfade falsch (Fehler 0x80070002 / kaputte %~dp0-Ketten),
  # was das Fenster öffnet, aber mit falscher Umgebung (z.B. kaputtem
  # FALSIFY_HOME) - genau die Falle, an der der E2E-Test 2026-09-01 hing.
  local DOCK_CMD="$V2_DIR/ui/start-dock.cmd"
  if [[ -f "$DOCK_CMD" ]]; then
    local dock_win
    dock_win="$(cygpath -w "$DOCK_CMD" 2>/dev/null || printf '%s' "$DOCK_CMD")"
    powershell.exe -NoProfile -Command "Start-Process -WindowStyle Normal -FilePath 'cmd.exe' -ArgumentList '/k','\"$dock_win\"'" &
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

# ── Ticket sicherstellen (Agent-Pfad): --user-input ist bei JEDER Iteration
# Pflicht (Ticket = User-Input 1:1). Die Scope-ID bestimmt FalsifyMe ueber
# --header beim Submit (Auto-Anlage/Fortsetzung) – der Agent waehlt nichts.
# --scope im Agent-Pfad wird abgelehnt (Operator-Flag, kein Agent-Vertrag).
ensure_ticket() {
  local user_input="$1"
  if [ -z "$user_input" ]; then
    log_error "--user-input ist bei JEDER Iteration Pflicht (Ticket = User-Input 1:1, der HEADER des Scopes)."
    return 2
  fi
  return 0
}

# ── Hauptfunktion: Pflicht-Check ────────────────────────────────────────────
falsify_mandatory_check() {
  local plan_file="$1"
  local root_dir="$2"
  local files_list="$3"
  local diff_file="${4:-}"
  local user_input="${5:-}"

  if [ -z "$plan_file" ] || [ -z "$root_dir" ] || [ -z "$files_list" ]; then
    log_error "Verwendung: falsify_mandatory_check <plan-file> <root-dir> <files-list> [diff-file] [user-input]"
    return 2
  fi
  if [ ! -f "$plan_file" ]; then
    log_error "Plan-Datei nicht gefunden: $plan_file"
    return 2
  fi

  # ── 0. Fenster sicherstellen (bis zu 3, IMMER offen!) ────────────────────
  ensure_dock_window || return 3

  # ── 0b. Ticket (User-Input 1:1) – Scope bestimmt FalsifyMe automatisch ───
  ensure_ticket "$user_input" || return $?

  log_step "FalsifyMe Pflicht-Check wird gestartet..."
  log_info "Ticket (HEADER 1:1): $user_input"
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
    "--header" "$user_input"
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
  #    Retry-Poll: Ein gerade startendes Fenster (Node-/INK-Boot ~2-4s) darf
  #    NICHT als fehlend gemeldet werden; erst nach ~10s gilt es als abwesend.
  local dock_check=""
  local dock_ok=0
  for _i in $(seq 1 10); do
    dock_check=$(node "$V2_DIR/ui/worker.mjs" --check 2>&1)
    if echo "$dock_check" | grep -q "RUNNING"; then
      dock_ok=1
      break
    fi
    sleep 1
  done
  if [ "$dock_ok" = "1" ]; then
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
    case "$st" in
      ERROR*|DONE*)
        # Schneller Fehler (z.B. HTTP 403): NICHT "✅ sichtbar + warte" sagen —
        # der Job ist bereits FINAL. Ehrlich melden und direkt auswerten.
        log_warn "Job $job_id endete SOFORT (Status: $st) – Worker hat geclaimt, aber der Lauf brach früh ab (typisch: Provider/Auth-Fehler)."
        ;;
      *)
        log_ok "Job $job_id ist im Dock sichtbar (Fenster-Claim: Status $st) – warte auf Verdict ..."
        ;;
    esac
  else
    # Kein Worker hat geclaimt: Job bleibt QUEUED. ABBRUCH statt Endlos-
    # Warten - falsify wait pollt per Design OHNE Timeout („loopt“-Falle).
    log_error "Job $job_id ist NICHT im Dock sichtbar (Status: ${st:-?}) – kein Worker-Fenster hat geclaimt. Abbruch statt Endlos-Warten. Dock starten (ui/start-dock.cmd), dann erneut einreichen."
    return 3
  fi

  # ── 3. Blockierend auf das Verdict warten (PFLICHT) ───────────────────────
  log_step "Falsify-Check wird ausgeführt (blockierend – wartet auf Verdict)..."
  local wait_output
  wait_output=$(bash "$V2_DIR/cli/falsify.sh" wait "$job_id" 2>&1)
  local wait_exit=$?

  # Verdict aus der Warteschleife extrahieren (DONE <VERDICT>); ERROR-Zweig
  # getrennt: ein ERROR ist KEIN UNBEKANNT-Verdict, sondern ein Lauf-Fehler
  # mit Ursache — die Fehler-Ausgabe muss die Ursache nennen (UI-135).
  local verdict
  verdict=$(echo "$wait_output" | grep -oP 'DONE \K(PLAN|RESEARCH|WRITE|UNBEKANNT)' | head -1)
  local err_line
  err_line=$(echo "$wait_output" | grep -oP 'ERROR \K.{0,300}' | head -1)
  [ -z "$verdict" ] && verdict="UNBEKANNT"
  echo "$wait_output" | tail -1 >&2
  if [ -n "$err_line" ]; then
    log_error "Lauf-FEHLER (kein Verdict): $err_line"
  else
    log_ok "Verdict: $verdict (Job $job_id)"
  fi

  # ── 2. Ergebnis auswerten (Loop-Routing) ─────────────────────────────────
  case "$verdict" in
    WRITE)
      log_ok "VERDICT: WRITE → Freigabe: READ-ONLY → WRITE (Scope wird von FalsifyMe verwaltet)"
      log_info "Protokoll: falsify log $job_id"
      return 0
      ;;
    RESEARCH)
      log_warn "VERDICT: RESEARCH → FalsifyMe braucht weitere Daten!"
      log_warn "Read-only recherchieren (Dateien lesen, Befunde sammeln), Artefakt ergänzen, erneut einreichen – mit DEMSELBEN Ticket (--user-input 1:1)."
      log_info "Datenbedarf/Kritik: falsify log $job_id"
      return 1
      ;;
    PLAN)
      log_error "VERDICT: PLAN → Iteration überarbeiten und erneut einreichen (gleiches Ticket = --user-input 1:1)."
      log_error "Kritik: falsify log $job_id"
      return 1
      ;;
    UNBEKANNT)
      if [ -n "$err_line" ]; then
        log_error "VERDICT: UNBEKANNT – Lauf-FEHLER (Exit 3), NICHT eine inhaltliche Ablehnung: $err_line"
        case "$err_line" in
          *401*|*403*)
            log_error "URSACHE: Provider hat den API-Key abgelehnt (Auth). Der Job ist KEINE Kritik an deinem Plan."
            log_error "FIX (User/Agent): Key in %USERPROFILE%\\.Falsify_Private\\.env eintragen (falsify onboard im Terminal), Dock-Fenster schließen + NEU starten (sonst erbt es weiter den alten Key), dann GLEICHES Ticket erneut einreichen."
            ;;
          *429*|*5\ 0\ 0*|*timeout*|*Überlastung*)
            log_warn "URSACHE: Provider-Überlastung/Rate-Limit (transient). Kurz warten, GLEICHES Ticket erneut einreichen."
            ;;
          *)
            log_error "Details: falsify log $job_id"
            ;;
        esac
      else
        log_error "VERDICT: UNBEKANNT – FalsifyMe hat NICHT zugestimmt (Exit 3). Agent darf NICHT weiterarbeiten."
      fi
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
  user_input=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --plan)      plan_file="$2"; shift 2 ;;
      --root)      root_dir="$2"; shift 2 ;;
      --files)     files_list="$2"; shift 2 ;;
      --diff)      diff_file="$2"; shift 2 ;;
      --user-input) user_input="$2"; shift 2 ;;
      --scope|--header)
        echo "FEHLER: --scope/--header sind hier nicht erlaubt. Der Agent liefert das Ticket ueber --user-input (1:1); die Scope-ID bestimmt FalsifyMe automatisch (--scope ist Operator-Flag)." >&2
        exit 2
        ;;
      -h|--help)
        echo "AGENT SKILL: FalsifyMe Pflicht-Check (Bash) · FalsifyMe 2.0"
        echo ""
        echo "TICKET-PROTOKOLL: Der Agent schreibt den Job als Ticket (User-Input 1:1)."
        echo "FalsifyMe bestimmt die Scope-ID automatisch (Start UND Fortsetzung = EIN Pfad)."
        echo "Loop: PLAN → überarbeiten · RESEARCH → read-only recherchieren · WRITE → Freigabe."
        echo ""
        echo "Verwendung (JEDE Iteration):"
        echo "  bash agent-skill-falsify.sh --user-input \"<User-Input 1:1 / Ticket>\" --plan plan.txt --root /path --files \"a.js,b.js\""
        echo ""
        echo "Optionen:"
        echo "  --user-input <text>  Ticket = User-Input 1:1 (HEADER) – bei JEDER Iteration Pflicht;"
        echo "                       FalsifyMe legt den Scope an oder setzt die Fortsetzung automatisch"
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

  falsify_mandatory_check "$plan_file" "$root_dir" "$files_list" "$diff_file" "$user_input"
  exit $?
fi
