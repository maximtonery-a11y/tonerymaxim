@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo TONERYMAXIM - KOMPLETNY HTTP MIGRATION GATE V69
echo =================================================
echo.

if not exist "package.json" goto :missing_package
if not exist "scripts\run-migration-gate.mjs" goto :missing_runner
if not exist "migration\TM_URL_MAPOVANIE_V1.csv" goto :missing_map
if not exist "node_modules" goto :missing_modules

set "ASTRO_TELEMETRY_DISABLED=1"

echo Test spusti vlastny produkcny server na porte 4399.
echo Background workery budu pocas testu vypnute.
echo Produktova cache sa pripravi iba raz pred kontrolou URL.
echo Skontroluje sa vsetkych 18 941 starych URL cez HTTP.
echo Toto okno nezatvarajte, kym sa test nedokonci.
echo.

call npm run migration:gate -- --base-url http://127.0.0.1:4399
set "TM_EXIT_CODE=%ERRORLEVEL%"

echo.
if exist "migration\reports\latest.html" (
  echo Otvaram vysledny HTML report...
  start "" "migration\reports\latest.html"
)

echo.
if "%TM_EXIT_CODE%"=="0" goto :success
if "%TM_EXIT_CODE%"=="2" goto :blocked

echo VYSLEDOK: Test sa nepodarilo dokoncit. Exit kod %TM_EXIT_CODE%.
goto :finish

:success
echo VYSLEDOK: Cela URL mapa presla. Report moze ukazat DNS ANO.
goto :finish

:blocked
echo VYSLEDOK: Report obsahuje blokujuce URL. DNS zatial nemenit.
goto :finish

:missing_package
echo CHYBA: Tento subor musi byt v korenovom priecinku projektu.
set "TM_EXIT_CODE=1"
goto :finish

:missing_runner
echo CHYBA: Chyba scripts\run-migration-gate.mjs.
set "TM_EXIT_CODE=1"
goto :finish

:missing_map
echo CHYBA: Chyba migration\TM_URL_MAPOVANIE_V1.csv.
set "TM_EXIT_CODE=1"
goto :finish

:missing_modules
echo CHYBA: Chyba node_modules. Najskor spustite npm install.
set "TM_EXIT_CODE=1"
goto :finish

:finish
echo.
echo Na kontrolu poslite subor migration\reports\latest.json.
echo.
pause
endlocal
