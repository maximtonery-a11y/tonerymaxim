@echo off
setlocal
cd /d "%~dp0"

echo Kontrolujem projekt...
if not exist package.json goto missing
if not exist src\pages\api\ai-tomas.ts goto missing

echo Aktualizujem informacie z GitHubu...
git fetch origin
if errorlevel 1 goto fail

for /f %%A in ('git rev-list --count HEAD..origin/main') do set TM_BEHIND=%%A
if not "%TM_BEHIND%"=="0" goto behind

echo Testujem opravene scenare AI Tomasa a kosika...
node --experimental-strip-types --test scripts\ai-tomas-tn2421-regression.test.ts scripts\cart-current-product-regression.test.ts scripts\products-exact-skus.test.ts
if errorlevel 1 goto fail

echo Kontrolujem projekt...
call npm run check
if errorlevel 1 goto fail

echo Vytvaram produkcny build...
set ASTRO_TELEMETRY_DISABLED=1
call npm run build
if errorlevel 1 goto fail

echo Pripravujem iba subory opravy V8.4...
git add -- package.json scripts\ai-tomas-tn2421-regression.test.ts scripts\cart-current-product-regression.test.ts scripts\products-exact-skus.test.ts src\lib\cart-product-refresh.ts src\lib\product-slug-aliases.ts src\pages\api\ai-tomas.ts src\pages\api\products.ts src\pages\produkt\[slug].astro src\scripts\ai-sales-assistant.js src\scripts\cart.js src\styles\cart.css NASADIT-AI-TOMAS-A-KOSIK-V8-4.bat
if errorlevel 1 goto fail

git diff --cached --quiet
if not errorlevel 1 goto nothing

git commit -m "Oprava aktualnosti kosika a kontextu AI Tomasa V8.4"
if errorlevel 1 goto fail

git push origin main
if errorlevel 1 goto fail

echo.
echo HOTOVO: oprava V8.4 bola odoslana do GitHubu.
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
