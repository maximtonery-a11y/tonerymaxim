@echo off
setlocal
cd /d "%~dp0"
title ToneryMaxim - kontrola skutocneho katalogu
set "ASTRO_TELEMETRY_DISABLED=1"
set "TM_DISABLE_BACKGROUND_WORKERS=1"

where node >nul 2>nul
if errorlevel 1 (
  echo CHYBA: Node.js nie je nainstalovany alebo nie je v PATH.
  pause
  exit /b 1
)

if not exist ".env" (
  echo CHYBA: V tomto priecinku chyba subor .env.
  echo Bez povodnych WOO_URL, WOO_CONSUMER_KEY a WOO_CONSUMER_SECRET sa skutocne produkty nemozu nacitat.
  echo Skopirujte povodny .env zo svojej funkcnej zalohy do:
  echo %CD%\.env
  echo Subor .env sa vdaka .gitignore neposle na GitHub.
  pause
  exit /b 1
)

findstr /r /c:"^WOO_URL=." ".env" >nul
if errorlevel 1 goto :missing_woo
findstr /r /c:"^WOO_CONSUMER_KEY=." ".env" >nul
if errorlevel 1 goto :missing_woo
findstr /r /c:"^WOO_CONSUMER_SECRET=." ".env" >nul
if errorlevel 1 goto :missing_woo

if not exist "node_modules" (
  echo Instalujem zavislosti cez npm ci...
  call npm ci
  if errorlevel 1 goto :fail
)

echo Overujem samotne WooCommerce napojenie na kontrolovanom katalogu...
call npm run test:woo
if errorlevel 1 goto :fail

echo Kontrolujem skutocne produkty cez vase lokalne WooCommerce nastavenie.
echo Test moze pri prvom nacitani katalogu trvat niekolko minut.
call npm run release:verify:local
if errorlevel 1 goto :fail

echo.
echo HOTOVO: Skutocny katalog presiel lokalnou kontrolou.
pause
exit /b 0

:missing_woo
echo CHYBA: V .env chyba WOO_URL, WOO_CONSUMER_KEY alebo WOO_CONSUMER_SECRET.
echo Hodnoty skopirujte z povodneho funkcneho .env. Kluc neposielajte do chatu ani na GitHub.
pause
exit /b 1

:fail
echo.
echo CHYBA: Lokalna kontrola katalogu nepresla. Projekt zatial neposielajte na GitHub.
pause
exit /b 1
