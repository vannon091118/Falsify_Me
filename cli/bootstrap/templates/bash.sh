#!/usr/bin/env bash
{{MODE_HEADER}}
# FalsifyMe Workflow-Instructions fuer Bash-Agenten
#
# FalsifyMe = unabhaengiger read-only Falsifizierungs-Agent
# Coding-Agent = eigentliche Arbeits-/Write-Instanz
# Sourcen dieses Skripts, dann: falsifyme_check --user-input "<auftrag>" \
#   --plan plan.txt --root /projekt --files "a.js,b.js"

export FALSIFYME_SKILLS_DIR="{{SKILLS}}"
export FALSIFYME_FALSIFLOW_SKILL="{{FALSIFLOW_SKILL}}"
export FALSIFYME_CORE_DIR="{{CORE}}"

falsifyme_check() {
  local user_input="" plan_file="" root_dir="" files="" scope_id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --user-input) user_input="$2"; shift 2 ;;
      --plan) plan_file="$2"; shift 2 ;;
      --root) root_dir="$2"; shift 2 ;;
      --files) files="$2"; shift 2 ;;
      --scope) scope_id="$2"; shift 2 ;;
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
    --files "$files" \
    --scope "$scope_id"
  return $?
}

echo "FalsifyMe-Integration fuer Bash-Agent geladen"
echo "  Skills: ${FALSIFYME_SKILLS_DIR}"
