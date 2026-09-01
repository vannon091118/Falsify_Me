# ─────────────────────────────────────────────────────────────────────────────
# Falsify-Dock-Runner (FalsifyMe 2.0): startet den Worker (ui/worker.mjs) im
# Fenster und SCHLIESST das Fenster automatisch, sobald der Worker endet
# (Strg+C, Crash). Wird mit -NoExit gestartet (nur so überlebt der Worker in
# der Konsole). Der Fenster-Index (1..3) wird als FALSIFY_WINDOW durchgereicht.
# ─────────────────────────────────────────────────────────────────────────────
param([int]$WindowIndex = 1)

$env:FALSIFY_WINDOW = "$WindowIndex"
& node (Join-Path $PSScriptRoot "worker.mjs")
$code = $LASTEXITCODE

# Fenster selbst schliessen – auch mit -NoExit – sobald der Worker beendet ist
try { Stop-Process -Id $PID -Force -ErrorAction SilentlyContinue } catch {}
exit $code
