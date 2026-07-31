@echo off
setlocal
cd /d "%~dp0"
title ToneryMaxim - kontrola pred GitHubom
set "ASTRO_TELEMETRY_DISABLED=1"

where node >nul 2>nul
if errorlevel 1 (
  echo CHYBA: Node.js nie je nainstalovany alebo nie je v PATH.
  pause
  exit /b 1
)

echo [1/2] Cista instalacia zavislosti
call npm ci
if errorlevel 1 goto :fail

echo [2/2] Testy, produkcny build a bezpecnostny audit
call npm run release:check
if errorlevel 1 goto :fail

echo.
echo HOTOVO: Projekt presiel kontrolou pred GitHubom.
pause
exit /b 0

:fail
echo.
echo CHYBA: Projekt nepresiel kontrolou. Neposielajte ho na GitHub.
pause
exit /b 1
