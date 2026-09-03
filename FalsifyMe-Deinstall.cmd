@echo off
rem ============================================================
rem  FALSIFYME-DEINSTALL - clickable uninstaller (Doppelklick)
rem  Rueckabwicklung vollstaendig - "als waere FalsifyMe nie da":
rem    - sichtbare Worker-Fenster stoppen
rem    - ~/.Falsify_Core (Programm) entfernen
rem    - ~/.Falsify_Private (FALSIFY_HOME: Keys, DB, Logs) entfernen
rem      (enthaltene API-Keys werden VORHER nach
rem       ~/.Falsify.env.uninstall-backup gesichert)
rem    - ~/.agents/skills/falsifyme* entfernen
rem    - ~/.falsifyme-instructions.* + Marker-Zeilen aus
rem      .bashrc/.bash_profile/.profile/PowerShell-Profil entfernen
rem      (dot-source UND PATH-Eintraege von `falsify install`)
rem    - Desktop-Icons FalsifyMe*.lnk entfernen
rem    - npm-Global-Shims (falsify) entfernen
rem  Optionen durchreichen:  FalsifyMe-Deinstall.cmd --dry-run
rem                          FalsifyMe-Deinstall.cmd --keep-env
rem                          FalsifyMe-Deinstall.cmd --project-root <projekt>
rem    (--project-root entfernt zusaetzlich den FalsifyMe-Block aus
rem     AGENTS.md/FALSIFYME-WORKFLOW.md, den markierten .gitignore-Block
rem     und den Identitaets-Anker FalsifyME.md des Projekts)
rem ============================================================
cd /d "%~dp0"

echo.
echo  WARNUNG: Diese Deinstallation entfernt FalsifyMe VOLLSTAENDIG:
echo   - Programm, private Daten (Verlauf/Logs/Keys), Skills,
echo   - Instructions + PATH-/Profil-Eintraege, Desktop-Icons,
echo   - npm-Shims (und optional Projekt-Marker/-Anker).
echo.
set /p CONFIRM="Wirklich deinstallieren? [j/N] "
if /i not "%CONFIRM%"=="j" (
  echo.
  echo  Abgebrochen - nichts wurde geaendert.
  pause
  exit /b 0
)

echo.
node uninstall.mjs %*
if errorlevel 1 goto :fail

echo.
echo  ============================================================
echo   DEINSTALLATION ABGESCHLOSSEN - FalsifyMe ist vollstaendig
echo   rueckabgewickelt (Ausnahme: Key-Backup, falls Keys gesetzt
echo   waren - siehe Meldung oben).
echo  ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo  FEHLER - siehe Meldung oben. Fenster bleibt offen.
pause
exit /b 1