#!/usr/bin/env bash
{{MODE_HEADER}}
# FalsifyMe Workflow-Instructions fuer Bash-Agenten
#
# FalsifyMe = unabhaengiger read-only Falsifizierungs-Agent
# USER AGENT = externe Arbeits-/Write-Instanz
# Sourcen dieses Skripts, dann: falsifyme_check --user-input "<auftrag>" \
#   --plan plan.txt --root /projekt --files "a.js,b.js"

export FALSIFYME_SKILLS_DIR="{{SKILLS}}"
export FALSIFYME_FALSIFLOW_SKILL="{{FALSIFLOW_SKILL}}"
export FALSIFYME_CORE_DIR="{{CORE}}"

# TICKET-WORKFLOW: --user-input ist das Ticket (User-Input 1:1) und bei JEDER
# Iteration Pflicht. Die SCOPE-ID bestimmt FalsifyMe automatisch – der Agent
# verwaltet keine IDs und nutzt nie --scope (Operator-Flag).
falsifyme_check() {
  local user_input="" plan_file="" root_dir="" files=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --user-input) user_input="$2"; shift 2 ;;
      --plan) plan_file="$2"; shift 2 ;;
      --root) root_dir="$2"; shift 2 ;;
      --files) files="$2"; shift 2 ;;
      --scope) echo "FEHLER: --scope ist Operator-Flag, kein Agent-Vertrag (Ticket = --user-input 1:1)." >&2; return 2 ;;
      *) shift ;;
    esac
  done
  if [[ -z "$user_input" || -z "$plan_file" || -z "$root_dir" || -z "$files" ]]; then
    echo "Verwendung: falsifyme_check --user-input <text> --plan <file> --root <dir> --files <list>" >&2
    return 1
  fi
  bash "${FALSIFYME_SKILLS_DIR}/agent-skill-falsify.sh" \
    --user-input "$user_input" \
    --plan "$plan_file" \
    --root "$root_dir" \
    --files "$files"
  return $?
}

# Pflichtprotokoll nach jeder Arbeit:
# CHANGE_GATE_10X = A1..A10 jeweils JA mit Proof und Test.
# FALSIFICATION_RECORD_10X = F1..F10 (User-Agent claim, User contract, Scope,
# Annahme, Angriff, verifizierte Evidenz, Gegenbeweise, offene Luecke,
# Rest-Risiko, Release-Entscheidung).
# NEIN/UNBEKANNT/fehlender Beleg = BLOCKED – mindestens eine Invariante ist nicht nachgewiesen.

# Startup-Skill-Check-Fehler (jeder falsify-Befehl ausser doctor: Exit 3 +
# FEHLER-Hinweis auf doctor): GENAU EINMAL `falsify doctor --repair-skills`
# ausfuehren und auf gruen warten, BEVOR `falsify onboard` / der erste
# Pflicht-Check startet. Kein Onboarding auf kaputter Skill-Anlage.

echo "FalsifyMe-Integration fuer Bash-Agent geladen"
echo "  Skills: ${FALSIFYME_SKILLS_DIR}"
