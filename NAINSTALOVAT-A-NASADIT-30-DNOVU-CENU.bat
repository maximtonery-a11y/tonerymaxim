@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo TONERYMAXIM - HISTORIA A NAJNIZSIA CENA ZA 30 DNI
echo ============================================================
echo.

if not exist package.json (
  echo CHYBA: Balik musi byt rozbaleny v koreni projektu ToneryMAXIM.
  pause
  exit /b 1
)

if not exist node_modules\.bin\astro.cmd (
  echo Instalujem zavislosti projektu...
  call npm ci
  if errorlevel 1 goto :error
)

echo [1/4] Test historie cien a nocneho casovania...
call npm run test:price-history
if errorlevel 1 goto :error

echo [2/4] WooCommerce regresny test...
call npm run test:woo
if errorlevel 1 goto :error

echo [3/4] Produkcne testy a Astro kontrola...
call npm run test:production
if errorlevel 1 goto :error
call npm run check
if errorlevel 1 goto :error

echo [4/4] Produkcny build...
set ASTRO_TELEMETRY_DISABLED=1
call npm run build
if errorlevel 1 goto :error

where git >nul 2>nul
if errorlevel 1 goto :nogit
if not exist .git goto :nogit

git add -- ".env.production.example" "README-INSTALACIA.txt" "package.json" "scripts/price-history.test.ts" "src/components/CatalogInitialRows.astro" "src/lib/nightly-price-worker.ts" "src/lib/price-history.ts" "src/lib/tm-products-cache.ts" "src/middleware.ts" "src/pages/api/products.ts" "src/pages/produkt/[slug].astro" "src/pages/produkty.astro" "src/scripts/catalog.js" "src/scripts/product-detail.js" "src/styles/product-detail.css" "src/styles/products-catalog.css" "NAINSTALOVAT-A-NASADIT-30-DNOVU-CENU.bat"
if errorlevel 1 goto :error

git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Doplnit nocnu historiu a najnizsiu cenu za 30 dni"
  if errorlevel 1 goto :error
) else (
  echo Nie je co commitnut. Subory uz mozu byt v repozitari.
)

echo Odosielam aktualnu vetvu main na GitHub...
git push origin main
if errorlevel 1 goto :error

:success
echo.
echo ============================================================
echo HOTOVO
echo ============================================================
echo V Coolify ponechajte trvaly volume pre /app/data a nastavte:
echo   TM_PERSISTENT_DATA_DIR=/app/data
echo   TM_PRICE_HISTORY_ENABLED=1
echo   TM_PRICE_HISTORY_TIME_ZONE=Europe/Bratislava
echo   WOO_SYNC_PAGE_DELAY_MS=250
echo Potom spustite Redeploy. Prvy zaznam vznikne pri prvej nocnej
echo kontrole medzi 01:00 a 04:00 slovenskeho casu.
echo.
pause
exit /b 0

:nogit
echo.
echo Testy aj build presli. Git nebol najdeny alebo toto nie je Git projekt.
goto :success

:error
echo.
echo CHYBA: Proces sa zastavil. Pozrite si poslednu spravu vyssie.
echo Nic sa nevymazalo a git push sa nevykonal.
pause
exit /b 1
