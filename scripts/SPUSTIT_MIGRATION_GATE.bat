@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo TONERYMAXIM - MIGRATION GATE 2.0
echo ================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo CHYBA: Node.js nie je nainstalovany alebo nie je v PATH.
  pause
  exit /b 1
)
if not exist "scripts\run-migration-gate.mjs" (
  echo CHYBA: Chyba scripts\run-migration-gate.mjs.
  pause
  exit /b 1
)
if not exist node_modules (
  echo CHYBA: Chyba priecinok node_modules. Spustite npm install.
  pause
  exit /b 1
)
node "scripts\run-migration-gate.mjs"
set CODE=%ERRORLEVEL%
echo.
if exist "migration\reports\latest.html" (
  echo Otvaram report...
  start "" "migration\reports\latest.html"
)
echo.
if %CODE% EQU 0 (
  echo VYSLEDOK: TEST PRESIEL.
) else if %CODE% EQU 2 (
  echo VYSLEDOK: REPORT ESTE OBSAHUJE BLOKERY.
) else (
  echo VYSLEDOK: Test sa nepodarilo dokoncit. Exit kod %CODE%.
)
pause
exit /b %CODE%
