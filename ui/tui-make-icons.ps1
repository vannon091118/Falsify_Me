# FALSIFYME - Desktop-Icons (opt-in) fuer TUI START + TUI TEST
# Legt zwei Verknuepfungen auf dem Desktop des angemeldeten Users an.
# Aufruf:  powershell -NoProfile -ExecutionPolicy Bypass -File ui\tui-make-icons.ps1
param()

$ErrorActionPreference = "Stop"
$Desktop = [Environment]::GetFolderPath("Desktop")
if ([string]::IsNullOrWhiteSpace($Desktop)) {
    Write-Host "Desktop-Pfad nicht ermittelbar." -ForegroundColor Yellow
    exit 1
}
$Root = Split-Path -Parent $PSScriptRoot
$Icon = Join-Path $Root "falsify.ico"
$IconLocation = if (Test-Path $Icon) { "$Icon,0" } else { "$env:ComSpec,0" }
$ComSpec = $env:ComSpec

function New-TuiLink {
    param([string]$Name, [string]$Script)
    $ws = New-Object -ComObject WScript.Shell
    $link = $ws.CreateShortcut((Join-Path $Desktop "$Name.lnk"))
    $link.TargetPath = $ComSpec
    $link.Arguments = '/c ""' + $Script + '""'
    $link.WorkingDirectory = $Root
    $link.IconLocation = $IconLocation
    $link.Description = "FalsifyMe $Name (Terminal-UI)"
    $link.Save()
    Write-Host "  Desktop: $Name.lnk" -ForegroundColor Green
}

Write-Host "FalsifyMe TUI - Desktop-Icons (opt-in):"
New-TuiLink "FalsifyMe-TUI-Start" (Join-Path $PSScriptRoot "START-TUI.cmd")
New-TuiLink "FalsifyMe-TUI-Test"  (Join-Path $PSScriptRoot "TEST-TUI.cmd")
Write-Host "Fertig. Doppelklick = START-Demo bzw. TEST-Lauf."