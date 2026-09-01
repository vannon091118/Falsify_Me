@echo off
rem ─────────────────────────────────────────────────────────────────────────────
rem  FALSIFYME – TUI START  (Beobachtungsfenster, Phase 1 · UI ONLY)
rem  Oeffnet ein sichtbares Konsolenfenster: Boot-Intro -> WARTE AUF EINGABE
rem  (animiert, fest). KEIN Auto-Job: Jobs kommen von ausserhalb (Agents/
rem  Worker pipen JSONL-Events, siehe WIRING.md). --auto = Demo-Timeline auf
rem  Slots 1..3 (bis zu 3 Fenster-Slots parallel im einen Terminal-pid).
rem  Tasten:  T = THINKING/REASONING   Q / STRG-C = ABORT alle Slots / schliessen
rem  Optionen:
rem    START-TUI.cmd              WARTE-Screen; erster Lauf = Icon-Opt-in
rem    START-TUI.cmd --auto        Demo-Timeline (sichtbar)
rem    START-TUI.cmd -desktop     Icons (Start + Test) erzeugen, ohne Frage
rem    START-TUI.cmd --plain ...  nur für headless Tests; kein sichtbares TTY
rem ─────────────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0.."

if /i "%~1"=="-desktop" goto :icons

rem Opt-in: beim ERSTEN Lauf fragen, ob Desktop-Verknuepfungen entstehen sollen
if not exist "ui\.tui-desktop-optin" (
    echo.
    echo  FalsifyMe TUI: Desktop-Icons anlegen?
    echo  (Start + Test als Verknuepfungen auf dem Desktop)
    choice /c JN /m "J=ja  N=nein"
    if errorlevel 2 goto :run
    call "ui\START-TUI.cmd" -desktop
)

:run
rem Sichtbares Konsolenfenster – Projekteigene start-Mechanik (kein wt-Bruch)
rem Beobachtung ist KEINE Demo: gleiche Pipeline, WARTE AUF EINGABE, kein --auto.
start "FalsifyMe-TUI-Beobachtung" cmd /k node ui\tui-demo.mjs %*
exit /b 0

:icons
powershell -NoProfile -ExecutionPolicy Bypass -File "ui\tui-make-icons.ps1"
if not exist "ui\.tui-desktop-optin" echo created> "ui\.tui-desktop-optin"
exit /b 0