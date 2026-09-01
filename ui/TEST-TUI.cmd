@echo off
rem ─────────────────────────────────────────────────────────────────────────────
rem  FALSIFYME – TUI TEST START  (Phase 1 · UI ONLY)
rem  Laeuft:  1) komplette Unit-/Pipeline-Suite (105 Tests; Startup-Intro)
rem           2) Headless-Demo ueber alle Szenarien (write/plan/research/
rem              timeout/error; Startup-Intro wird durchlaufen)
rem           3) Abort-Kill-Check unter Output-Last
rem  Bei Fehlern bleibt das Fenster offen und zeigt die Ursache.
rem ─────────────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0.."

echo ============================================
echo  FALSIFYME TUI - TEST START
echo ============================================
echo.
echo [1/3] Unit-Suite + Pipeline-Tests ...
rem Der sichtbare Startup zeigt das FalsifyMe-Intro; Teststatus bleibt klein.
node --test --test-force-exit --test-concurrency=1 "ui/tui/*.test.mjs" ui/tui.test.mjs ui/demo-agent.test.mjs
if errorlevel 1 goto :fail
echo.
echo [2/3] Headless-Demo: alle Szenarien ...
node ui/tui-demo.mjs --plain --fast
if errorlevel 1 goto :fail
echo.
echo [3/3] Abort-Kill-Check unter Last ...
node ui/tui-demo.mjs --plain --stress --abort-after=1500 --scenarios=write
if errorlevel 1 goto :fail
echo.
echo ============================================
echo  ALLE TESTS GRUEN.
echo ============================================
pause
exit /b 0

:fail
echo.
echo  TEST FEHLGESCHLAGEN - siehe Ausgabe oben.
pause
exit /b 1