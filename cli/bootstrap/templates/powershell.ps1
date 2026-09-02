# FalsifyMe Workflow-Instructions fuer PowerShell-Agenten
{{MODE_HEADER}}
#
# FalsifyMe = unabhaengiger read-only Falsifizierungs-Agent
# Coding-Agent = eigentliche Arbeits-/Write-Instanz
# Bis VERDICT: WRITE bleibt der Coding-Agent READ-ONLY.
# Exit 0 = VERDICT: WRITE; Exit 1 = PLAN/RESEARCH; Exit 2/3 = keine Freigabe.
# Derselbe Scope wird fuer PLAN -> RESEARCH -> WRITE -> IMPLEMENTATION REVIEW verwendet.
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
        [Parameter(Mandatory=$true)][string]$Files,
        [string]$ScopeId = ""
    )
    $skill = Join-Path $script:FALSIFYME_SKILLS_DIR "agent-skill-falsify.ps1"
    $checkArgs = @(
        "-UserInput", $UserInput,
        "-PlanFile", $PlanFile,
        "-RootDir", $RootDir,
        "-Files", $Files
    )
    if ($ScopeId) { $checkArgs += @("-ScopeId", $ScopeId) }
    & $skill @checkArgs
    return $LASTEXITCODE
}

# Pflichtprotokoll nach jeder Arbeit:
# CHANGE_GATE_10X = A1..A10 jeweils JA mit Proof und Test.
# FALSIFICATION_RECORD_10X = F1..F10 (Coder claim, User contract, Scope,
# Annahme, Angriff, verifizierte Evidenz, Gegenbeweise, offene Luecke,
# Rest-Risiko, Release-Entscheidung).
# NEIN/UNBEKANNT/fehlender Beleg = BLOCKED – mindestens eine Invariante ist nicht nachgewiesen.

Write-Host "FalsifyMe-Integration fuer PowerShell-Agent geladen"
Write-Host "  Skills: $script:FALSIFYME_SKILLS_DIR"
