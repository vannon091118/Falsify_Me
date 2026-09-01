@echo off
rem ─────────────────────────────────────────────────────────────────────────────
rem  FALSIFYME - DOCK-START: oeffnet ein SICHTBARES Worker-Fenster (TUI).
rem    start-dock.cmd        -> Fenster 1
rem    start-dock.cmd 2      -> Fenster 2   (bis zu FALSIFY_MAX_WINDOWS, max. 3)
rem  Das Fenster zeigt die Terminal-UI: Boot-Intro -> WARTE AUF EINGABE; Jobs
rem  aus der SQLite-Warteschlange erscheinen live (FM-EVT-Pipeline via run.mjs).
rem  Q / STRG-C: laeuft ein Job -> Abbruch + Kill; sonst schliesst das Fenster.
rem  Kein headless Start - der Worker laeuft NUR in diesem sichtbaren Fenster.
rem ─────────────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"
set "FEN=%~1"
if "%FEN%"=="" set FEN=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dock-runner.ps1" -WindowIndex %FEN%
exit /b %errorlevel%