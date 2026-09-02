@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title ToneryMaxim - firmware poradna

echo ============================================================
echo TONERYMAXIM - FIRMWARE PORADNA A DENNA AKTUALIZACIA ABIX
echo ============================================================
echo.

if not exist "package.json" goto :missing_project
if not exist "src\lib\firmware-info.ts" goto :missing_patch
if not exist "src\components\FirmwareStatusPanel.astro" goto :missing_patch
if not exist "scripts\firmware-info.test.ts" goto :missing_patch

where node >nul 2>nul
if errorlevel 1 goto :missing_node
where git >nul 2>nul
if errorlevel 1 goto :missing_git

if not exist "node_modules" (
  echo [1/5] Instaluju sa baliky projektu...
  call npm install
  if errorlevel 1 goto :fail_before_git
) else (
  echo [1/5] Baliky projektu su uz nainstalovane.
)

echo.
echo [2/5] Test firmware poradne a spracovania ABIX udajov
node --experimental-strip-types --test scripts\firmware-info.test.ts
if errorlevel 1 goto :fail_before_git

echo.
echo [3/5] Produkcne testy webu
call npm run test:production
if errorlevel 1 goto :fail_before_git

echo.
echo [4/5] Kontrola Astro a produkcny build
call npm run check
if errorlevel 1 goto :fail_before_git
set "ASTRO_TELEMETRY_DISABLED=1"
call npm run build
if errorlevel 1 goto :fail_before_git

echo.
echo [5/5] Commit a push iba suborov firmware opravy
git add -- .env.production.example README-INSTALACIA.txt package.json NAINSTALOVAT-A-NASADIT-FIRMWARE-PORADNU.bat scripts/firmware-info.test.ts src/components/AdviceArticlePage.astro src/components/FirmwareStatusPanel.astro src/data/advice-extra.ts src/data/ai-knowledge.ts src/lib/firmware-info.ts src/middleware.ts src/styles/advice.css
if errorlevel 1 goto :fail_git

git diff --cached --quiet
if not errorlevel 1 goto :nothing

git commit -m "Firmware poradna: denny prehlad cipov ABIX"
if errorlevel 1 goto :fail_git
git push origin main
if errorlevel 1 goto :fail_git

echo.
echo ============================================================
echo HOTOVO: Oprava presla testami a bola odoslana na GitHub.
echo ============================================================
echo.
echo V Coolify este nastavte ako tajne premenne:
echo   ABIX_FIRMWARE_ENABLED=1
echo   ABIX_FIRMWARE_USERNAME=vas prihlasovaci e-mail do ABIX
echo   ABIX_FIRMWARE_PASSWORD=vase heslo do ABIX
echo.
echo Ak Coolify nenasadzuje automaticky, spustite Redeploy.
echo Prva kontrola ABIX prebehne asi 90 sekund po spusteni webu.
echo Stranka: /poradna/aktualizacia-firmveru-a-kompatibilny-toner
pause
exit /b 0

:nothing
echo.
echo Nie je co commitnut. Subory uz mozu byt na GitHube.
pause
exit /b 2

:missing_project
echo.
echo CHYBA: ZIP musi byt rozbaleny priamo do korenoveho priecinka projektu.
echo V rovnakom priecinku ako tento BAT musi byt subor package.json.
pause
exit /b 1

:missing_patch
echo.
echo CHYBA: Opravny balik nie je kompletne rozbaleny.
echo Rozbalte ZIP znova priamo do korena projektu a povolte nahradenie suborov.
pause
exit /b 1

:missing_node
echo.
echo CHYBA: Node.js nie je nainstalovany alebo nie je v PATH.
pause
exit /b 1

:missing_git
echo.
echo CHYBA: Git nie je nainstalovany alebo nie je v PATH.
pause
exit /b 1

:fail_before_git
echo.
echo CHYBA: Test alebo build zlyhal. Commit ani push sa nespustil.
echo Pozrite poslednu chybu vo vypise vyssie.
pause
exit /b 1

:fail_git
echo.
echo CHYBA: Git commit alebo push zlyhal.
echo Oprava presla testami, ale nebola uspesne odoslana na GitHub.
pause
exit /b 1
