# FalsifyMe Workflow-Instructions fuer PowerShell-Agenten
{{MODE_HEADER}}
#
# FalsifyMe = unabhaengiger read-only Falsifizierungs-Agent
# USER AGENT = externe Arbeits-/Write-Instanz
# Bis VERDICT: WRITE bleibt der USER AGENT READ-ONLY.
# Exit 0 = VERDICT: WRITE; Exit 1 = PLAN/RESEARCH; Exit 2/3 = keine Freigabe.
# Dasselbe Ticket (User-Input 1:1) wird fuer PLAN -> RESEARCH -> WRITE ->
# IMPLEMENTATION REVIEW verwendet; die SCOPE-ID bestimmt FalsifyMe automatisch.
# Wird automatisch aus dem PowerShell-Profil geladen (siehe Marker unten).
# Danach: Invoke-FalsifyMeCheck -UserInput "<auftrag>" `
#   -PlanFile plan.txt -RootDir C:\projekt -Files "a.js,b.js"

$script:FALSIFYME_SKILLS_DIR = "{{SKILLS}}"
$script:FALSIFYME_FALSIFLOW_SKILL = "{{FALSIFLOW_SKILL}}"
$script:FALSIFYME_CORE_DIR = "{{CORE}}"

function Invoke-FalsifyMeCheck {
    param(
        [Parameter(Mandatory=$true)][string]$UserInput,
        [Parameter(Mandatory=$true)][string]$PlanFile,
        [Parameter(Mandatory=$true)][string]$RootDir,
        [Parameter(Mandatory=$true)][string]$Files
    )
    # Scope-ID bestimmt FalsifyMe automatisch – -ScopeId ist Operator-Flag,
    # kein Agent-Vertrag (der Agent-Skill lehnt es ab).
    $skill = Join-Path $script:FALSIFYME_SKILLS_DIR "agent-skill-falsify.ps1"
    $checkArgs = @(
        "-UserInput", $UserInput,
        "-PlanFile", $PlanFile,
        "-RootDir", $RootDir,
        "-Files", $Files
    )
    & $skill @checkArgs
    return $LASTEXITCODE
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

Write-Host "FalsifyMe-Integration fuer PowerShell-Agent geladen"
Write-Host "  Skills: $script:FALSIFYME_SKILLS_DIR"
