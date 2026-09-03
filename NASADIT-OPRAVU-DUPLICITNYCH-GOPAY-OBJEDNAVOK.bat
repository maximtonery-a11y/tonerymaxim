@echo off
setlocal
cd /d "%~dp0"

echo Kontrolujem projekt ToneryMaxim...
if not exist package.json goto missing
if not exist src\scripts\checkout.js goto missing
if not exist src\lib\checkout-submission.ts goto missing
if not exist src\pages\platba-dokoncena.astro goto missing

git diff --cached --quiet
if errorlevel 1 goto staged

echo Aktualizujem informacie z GitHubu...
git fetch origin
if errorlevel 1 goto fail

for /f %%A in ('git rev-list --count HEAD..origin/main') do set TM_GOPAY_BEHIND=%%A
if not "%TM_GOPAY_BEHIND%"=="0" goto behind

echo Testujem ochranu proti duplicitnym objednavkam...
node --experimental-strip-types --test scripts\checkout-hard-regression.test.ts
if errorlevel 1 goto fail

echo Kontrolujem TypeScript a Astro...
call npm run check
if errorlevel 1 goto fail

echo Vytvaram produkcny build...
set ASTRO_TELEMETRY_DISABLED=1
call npm run build
if errorlevel 1 goto fail

echo Pripravujem iba subory tejto opravy...
git add -- src\scripts\checkout.js src\lib\checkout-submission.ts src\pages\platba-dokoncena.astro scripts\checkout-hard-regression.test.ts NASADIT-OPRAVU-DUPLICITNYCH-GOPAY-OBJEDNAVOK.bat
if errorlevel 1 goto fail

git diff --cached --quiet
if not errorlevel 1 goto nothing

git commit -m "Oprava duplicitnych objednavok pri GoPay"
if errorlevel 1 goto fail

git push origin main
if errorlevel 1 goto fail

echo.
echo HOTOVO: oprava bola odoslana do GitHubu.
echo Teraz v Coolify spustite Redeploy.
git status -sb
pause
exit /b 0

:behind
echo.
echo CHYBA: Lokalny projekt je pozadu za origin/main.
echo Najskor ho bezpecne aktualizujte a potom spustite BAT znova.
git status -sb
pause
exit /b 1

:staged
echo.
echo CHYBA: V projekte uz su pripravene ine subory na commit.
echo BAT ich nebude miesat s touto opravou. Najskor ich skontrolujte alebo odoslite.
git status -sb
pause
exit /b 1

:missing
echo.
echo CHYBA: ZIP rozbalte priamo do hlavneho priecinka projektu tonerymaxim.
pause
exit /b 1

:nothing
echo.
echo Nie su ziadne nove zmeny na odoslanie.
git status -sb
pause
exit /b 0

:fail
echo.
echo CHYBA: Nasadenie bolo zastavene. Do GitHubu sa nic dalsie neposiela.
git status -sb
pause
exit /b 1
