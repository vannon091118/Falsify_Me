@echo off
rem ============================================================
rem  FALSIFYME-SETUP - clickable installer (Doppelklick)
rem  Installiert FalsifyMe vollstaendig in den Benutzerbereich:
rem    ~/.Falsify_Core    (Programm + Dock-Start)
rem    ~/.Falsify_Private (FALSIFY_HOME: Keys, DB, Logs)
rem    ~/.agents/skills/  (Agent-Skills falsifyme*)
rem    Desktop-Icons      (FalsifyMe.lnk + FalsifyMe-TUI-Test.lnk)
rem  Optionen durchreichen:  FalsifyMe-Setup.cmd --no-desktop
rem  Deinstallieren:         FalsifyMe-Deinstall.cmd (Doppelklick)
rem ============================================================
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :no-node

rem Node.js >= 22.5 (package.json engines) - sonst klare Meldung statt Blink
node -e "const m=/^v?(\d+)\.(\d+)/.exec(process.version);if(!m||+m[1]<22||(+m[1]===22&&+m[2]<5))process.exit(1)"
if errorlevel 1 goto :old-node

echo.
echo  Installiere FalsifyMe (Programm, Skills, Desktop-Icons) ...
echo.
node install.mjs %*
if errorlevel 1 goto :fail

echo.
echo  ============================================================
echo   INSTALLATION ABGESCHLOSSEN
echo    - Programm:    %USERPROFILE%\.Falsify_Core
echo    - Private Daten (Keys/DB/Logs): %USERPROFILE%\.Falsify_Private
echo    - Agent-Skills: %USERPROFILE%\.agents\skills\falsifyme
echo    - Start:        Desktop-Icon "FalsifyMe" (sichtbares Dock-Fenster)
echo    - Deinstallieren: FalsifyMe-Deinstall.cmd (Doppelklick)
echo  ============================================================
echo.
pause
exit /b 0

:no-node
echo.
echo  FEHLER: Node.js wurde nicht gefunden.
echo  Bitte Node.js >= 22.5 installieren, z.B. https://nodejs.org
goto :fail

:old-node
echo.
echo  FEHLER: Node.js ist zu alt fuer FalsifyMe (mindestens 22.5 noetig).
for /f "delims=" %%v in ('node --version 2^>nul') do echo  Installiert: %%v
echo  Bitte Node.js aktualisieren: https://nodejs.org
goto :fail

:fail
echo.
echo  FEHLER - siehe Meldung oben. Fenster bleibt offen.
pause
exit /b 1