@echo off
setlocal
cd /d "%~dp0"

echo Kontrolujem projekt...
if not exist package.json goto missing
if not exist src\lib\tm-products-cache.ts goto missing

echo Aktualizujem informacie z GitHubu...
git fetch origin
if errorlevel 1 goto fail

for /f %%A in ('git rev-list --count HEAD..origin/main') do set TM_BEHIND=%%A
if not "%TM_BEHIND%"=="0" goto behind

echo Testujem jednotnu produktovu cache, sklad, zaruku a kosik...
node --experimental-strip-types --test scripts\woocommerce-catalog.test.ts scripts\production-readiness.test.ts scripts\products-exact-skus.test.ts
if errorlevel 1 goto fail

echo Kontrolujem TypeScript a Astro...
call npm run check
if errorlevel 1 goto fail

echo Vytvaram produkcny build...
set ASTRO_TELEMETRY_DISABLED=1
call npm run build
if errorlevel 1 goto fail

echo Pripravujem iba subory tejto opravy...
git add -- scripts\production-readiness.test.ts scripts\woocommerce-catalog.test.ts src\lib\tm-products-cache.ts src\middleware.ts src\pages\api\product.ts src\pages\api\products.ts src\scripts\product-detail.js NASADIT-OPRAVU-JEDNOTNEJ-CACHE.bat
if errorlevel 1 goto fail

git diff --cached --quiet
if not errorlevel 1 goto nothing

git commit -m "Oprava jednotnej aktualnosti skladu a produktovej cache"
if errorlevel 1 goto fail

git push origin main
if errorlevel 1 goto fail

echo.
echo HOTOVO: oprava bola odoslana do GitHubu.
echo Teraz spustite Redeploy v Coolify.
git status -sb
pause
exit /b 0

:behind
echo.
echo CHYBA: Lokalny projekt je pozadu za origin/main.
echo Najskor bezpecne aktualizujte projekt a potom spustite tento subor znova.
git status -sb
pause
exit /b 1

:missing
echo.
echo CHYBA: BAT musi byt v hlavnom priecinku projektu tonerymaxim.
pause
exit /b 1

:nothing
echo.
echo Nie su ziadne nove subory na odoslanie.
git status -sb
pause
exit /b 0

:fail
echo.
echo CHYBA: Nasadenie bolo zastavene. Nic dalsie sa neposiela.
git status -sb
pause
exit /b 1
