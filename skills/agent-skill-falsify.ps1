# ─────────────────────────────────────────────────────────────────────────────
# AGENT SKILL: FalsfyME Pflicht-Check (PowerShell) · FalsifyMe 2.0
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
#   .\agent-skill-falsify.ps1 -UserInput "<User-Input 1:1>" -PlanFile "plan.txt" -RootDir "C:\projekt" -Files "app.js,lib/auth.js"
#   .\agent-skill-falsify.ps1 -ScopeId <scope-id> -PlanFile "plan.txt" -RootDir "C:\projekt" -Files "app.js,lib/auth.js"   (Loop)
# ─────────────────────────────────────────────────────────────────────────────

param(
    [Parameter(Mandatory=$false)]
    [string]$PlanFile,

    [Parameter(Mandatory=$false)]
    [string]$RootDir,

    [Parameter(Mandatory=$false)]
    [string]$Files,

    [Parameter(Mandatory=$false)]
    [string]$DiffFile,

    [Parameter(Mandatory=$false)]
    [string]$ScopeId,

    [Parameter(Mandatory=$false)]
    [string]$UserInput,

    [Parameter(Mandatory=$false)]
    [switch]$EnsureDock,

    [Parameter(Mandatory=$false)]
    [switch]$Help
)

# ── Skript-Lage ─────────────────────────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$V2Dir = (Resolve-Path "$ScriptDir\..").Path
# Installierte Lage (~/.agents/skills/falsifyme): cli/ liegt NICHT neben dem
# Skill – auf die Benutzerinstallation (~/.Falsify_Core, erzeugt von
# install.mjs) umschalten, damit der Skill direkt nach der Installation laeuft
# (Paritaet mit agent-skill-falsify.sh).
if (-not (Test-Path (Join-Path $V2Dir "cli\falsify.sh")) -and (Test-Path (Join-Path $HOME ".Falsify_Core\cli\falsify.sh"))) {
    $V2Dir = Join-Path $HOME ".Falsify_Core"
}

# ── Hilfsfunktionen ────────────────────────────────────────────────────────
function Write-Step    { param([string]$Msg) Write-Host "🔄 $Msg" -ForegroundColor Cyan }
function Write-OK      { param([string]$Msg) Write-Host "✅ $Msg" -ForegroundColor Green }
function Write-Info    { param([string]$Msg) Write-Host "ℹ️  $Msg" -ForegroundColor Gray }
function Write-Warn    { param([string]$Msg) Write-Host "⚠️  $Msg" -ForegroundColor Yellow }
function Write-Error2  { param([string]$Msg) Write-Host "❌ $Msg" -ForegroundColor Red }

# ── Worker-Fenster sicherstellen (bis zu 3, IMMER offen) ────────────────────
function Ensure-FalsifyDock {
    Write-Step "Prüfe ob Falsify-Worker-Fenster laufen..."

    $checkResult = & node (Join-Path $V2Dir "ui\worker.mjs") --check 2>&1

    if ($checkResult -match "RUNNING") {
        $pids = ([regex]::Matches(($checkResult -join "`n"), "RUNNING (\d+)") | ForEach-Object { $_.Groups[1].Value }) -join ', '
        Write-OK "Falsify-Fenster laufen bereits (Worker: $pids)"
        return $true
    }

    Write-Warn "Kein Falsify-Fenster offen - öffne Fenster..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$(Join-Path $V2Dir 'ui\start-dock.cmd')`"" -WindowStyle Normal

    $maxWait = 30
    $waited = 0
    while ($waited -lt $maxWait) {
        Start-Sleep -Seconds 1
        $waited++
        $checkResult = & node (Join-Path $V2Dir "ui\worker.mjs") --check 2>&1
        if ($checkResult -match "RUNNING") {
            Write-OK "Falsify-Worker gestartet - Fenster bleiben offen"
            return $true
        }
    }

    Write-Error2 "Falsify-Worker konnte nicht gestartet werden"
    return $false
}

# ── Scope sicherstellen: PLAN ist IMMER die Init-Aktion ─────────────────────
function Ensure-FalsifyScope {
    param([string]$ScopeId, [string]$UserInput)

    if ($ScopeId) { return $ScopeId }

    if (-not $UserInput) {
        throw "Beim Scope-Start ist -UserInput Pflicht (User-Input 1:1 -> HEADER). Bei Loop-Fortsetzung -ScopeId angeben."
    }

    Write-Step "PLAN = Init: Scope anlegen - User-Input wird 1:1 zum HEADER..."
    $out = & node (Join-Path $V2Dir "cli\main.mjs") scope new $UserInput 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Scope konnte nicht angelegt werden: $out" }

    $scopeId = ""
    foreach ($line in $out) {
        if ($line -match "^SCOPE_ID=(.+)") { $scopeId = $Matches[1].Trim(); break }
    }
    if (-not $scopeId) { throw "Scope konnte nicht angelegt werden: $out" }

    Write-OK "Scope angelegt: $scopeId (HEADER = User-Input 1:1)"
    return $scopeId
}

# ── Hauptfunktion: Pflicht-Check ────────────────────────────────────────────
function Invoke-FalsifyCheck {
    param(
        [Parameter(Mandatory=$true)]
        [string]$PlanFile,

        [Parameter(Mandatory=$true)]
        [string]$RootDir,

        [Parameter(Mandatory=$true)]
        [string[]]$Files,

        [Parameter(Mandatory=$false)]
        [string]$DiffFile,

        [Parameter(Mandatory=$false)]
        [string]$ScopeId,

        [Parameter(Mandatory=$false)]
        [string]$UserInput
    )

    if (-not (Test-Path $PlanFile)) {
        Write-Error2 "Plan-Datei nicht gefunden: $PlanFile"
        return @{ Passed = $false; Verdict = "UNBEKANNT"; ExitCode = 2 }
    }
    if (-not (Test-Path $RootDir)) {
        Write-Error2 "Root-Verzeichnis nicht gefunden: $RootDir"
        return @{ Passed = $false; Verdict = "UNBEKANNT"; ExitCode = 2 }
    }

    # ── 0b. Scope: beim Start anlegen (PLAN = Init, HEADER = User-Input 1:1) ──
    $scope = Ensure-FalsifyScope -ScopeId $ScopeId -UserInput $UserInput

    Write-Step "FalsfyME Pflicht-Check wird gestartet..."
    Write-Info "Scope: $scope"
    Write-Info "Plan: $PlanFile"
    Write-Info "Root: $RootDir"
    Write-Info "Dateien: $($Files -join ', ')"
    if ($DiffFile) { Write-Info "Diff: $DiffFile" }

    # ── 1+2. Job einreichen + blockierend warten (PFLICHT) ───────────────────
    Write-Step "Falsify-Check wird ausgeführt (blockierend – wartet auf Verdict)..."
    $filesString = $Files -join ','

    $submitArgs = @(
        (Join-Path $V2Dir "cli\falsify.sh"),
        "submit",
        "--plan-file", $PlanFile,
        "--root", $RootDir,
        "--files", $filesString,
        "--scope", $scope
    )
    if ($DiffFile) { $submitArgs += @("--diff-file", $DiffFile) }

    $submitOutput = & bash $submitArgs 2>&1
    $submitExit = $LASTEXITCODE
    $outText = $submitOutput -join "`n"

    $jobId = ""
    foreach ($line in $submitOutput) {
        if ($line -match "^JOB_ID=(.+)") { $jobId = $Matches[1].Trim(); break }
    }
    if ($jobId) { Write-OK "Job geprüft: $jobId (Verdict liegt vor)" }

    # Verdict aus der Warteschleife extrahieren (DONE <VERDICT>)
    $verdict = "UNBEKANNT"
    if ($outText -match "DONE (PLAN|RESEARCH|WRITE|UNBEKANNT)") {
        $verdict = $Matches[1].ToUpper()
    }

    # ── 3. Ergebnis aus der DB lesen (Kritik / Datenbedarf) ─────────────────
    $reason = ""
    $logOut = (& node (Join-Path $V2Dir "cli\main.mjs") log $jobId 2>&1) -join "`n"
    $ergebnisIdx = $logOut.IndexOf("### Ergebnis")
    if ($ergebnisIdx -ge 0) {
        $reason = $logOut.Substring($ergebnisIdx + "### Ergebnis".Length).Trim()
        $reason = $reason -replace "^\s*\(volle Antwort\)\s*", ""
    }
    if (-not $reason) { $reason = $outText.Split("`n") | Where-Object { $_ } | Select-Object -Last 6 }

    $passed = $verdict -eq "WRITE"

    if ($passed) {
        Write-OK "VERDICT: WRITE → Freigabe: READ-ONLY → WRITE (Scope $scope)"
        Write-Info "Protokoll: falsify log $jobId"
    }
    elseif ($verdict -eq "RESEARCH") {
        Write-Warn "VERDICT: RESEARCH → FalsifyMe braucht weitere Daten!"
        Write-Warn "Read-only recherchieren (Dateien lesen, Befunde sammeln), Artefakt ergänzen, erneut einreichen."
        Write-Info "Datenbedarf/Kritik: falsify log $jobId"
    }
    elseif ($verdict -eq "PLAN") {
        Write-Error2 "VERDICT: PLAN → Iteration überarbeiten (HEADER behalten), erneut einreichen."
        Write-Error2 "Kritik: falsify log $jobId"
    }
    else {
        Write-Error2 "VERDICT: $verdict → nicht freigegeben."
    }

    return @{ Passed = $passed; JobId = $jobId; ScopeId = $scope; Verdict = $verdict; Reason = $reason; ExitCode = $submitExit }
}

# ── Export-Funktionen (nur beim Import als Modul, nicht beim -File-Aufruf) ──
if ($MyInvocation.InvocationName -eq '.') {
    Export-ModuleMember -Function Invoke-FalsifyCheck, Ensure-FalsifyDock, Ensure-FalsifyScope
}

# ── CLI-Modus ──────────────────────────────────────────────────────────────
if ($Help) {
    Write-Host @"
AGENT SKILL: FalsfyME Pflicht-Check (PowerShell) · FalsifyMe 2.0

SCOPE-PROTOKOLL: PLAN ist IMMER Init (User-Input 1:1 als HEADER).
Loop: PLAN → überarbeiten · RESEARCH → read-only recherchieren · WRITE → Freigabe.

VERWENDUNG:
  .\agent-skill-falsify.ps1 -UserInput "<User-Input 1:1>" -PlanFile "plan.txt" -RootDir "C:\projekt" -Files "app.js,lib/auth.js"
  .\agent-skill-falsify.ps1 -ScopeId <scope-id> -PlanFile "plan.txt" -RootDir "C:\projekt" -Files "app.js,lib/auth.js"   (Loop)
  .\agent-skill-falsify.ps1 -EnsureDock  # Nur Fenster starten/prüfen

OPTIONEN:
  -UserInput <text>   User-Input 1:1 – wird HEADER des Scopes (beim Start Pflicht)
  -ScopeId <id>       Scope-ID (bei Loop-Fortsetzung Pflicht)
  -PlanFile <pfad>    Plan-/Iterations-Datei (PFLICHT)
  -RootDir <verz>     Arbeitsverzeichnis (PFLICHT)
  -Files <liste>      Zugriffs-Whitelist, kommagetrennt (PFLICHT)
  -DiffFile <pfad>    Diff der Iteration (optional)
  -EnsureDock         Nur Fenster starten/prüfen, keinen Check durchführen
  -Help               Diese Hilfe

EXIT-CODES:
  0 = WRITE → Freigabe (READ-ONLY → WRITE)
  1 = PLAN/RESEARCH → Loop (überarbeiten / read-only recherchieren)
  2 = Konfigurationsfehler
  3 = API/Netzwerkfehler / kein Verdict

WICHTIG:
  - KEIN Bash! Nur PowerShell + Node.js
  - Bis zu 3 Falsify-Fenster, IMMER offen
  - Persistenz in SQLite (~/.Falsify), FalsifyMe bleibt read-only zum Projekt
"@
    exit 0
}

# ── Hauptausführung ────────────────────────────────────────────────────────
if ($MyInvocation.InvocationName -ne '.') {

    if ($EnsureDock) {
        $result = Ensure-FalsifyDock
        exit ([int](-not $result))
    }

    if (-not $PlanFile -or -not $RootDir -or -not $Files) {
        Write-Error2 "Verwendung: .\agent-skill-falsify.ps1 -PlanFile <datei> -RootDir <verz> -Files <liste>"
        Write-Error2 "Hilfe: .\agent-skill-falsify.ps1 -Help"
        exit 2
    }

    $dockOk = Ensure-FalsifyDock
    if (-not $dockOk) {
        Write-Error2 "Falsify-Worker muss laufen! Starte mit: .\agent-skill-falsify.ps1 -EnsureDock"
        exit 3
    }

    $filesArray = $Files -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }

    $result = Invoke-FalsifyCheck -PlanFile $PlanFile -RootDir $RootDir -Files $filesArray -DiffFile $DiffFile -ScopeId $ScopeId -UserInput $UserInput
    exit $result.ExitCode
}
