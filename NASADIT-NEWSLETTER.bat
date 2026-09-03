@echo off
setlocal
cd /d "%~dp0"

echo ==============================================
echo ToneryMaxim.sk - nasadenie NEWSLETTER modulu
echo ==============================================

if not exist package.json goto missing
if not exist src\pages\newsletter.astro goto missing
if not exist src\lib\newsletter.ts goto missing

for /f "delims=" %%B in ('git branch --show-current') do set TM_BRANCH=%%B
if /I not "%TM_BRANCH%"=="main" goto wrongbranch

git diff --cached --quiet
if errorlevel 1 goto staged

echo.
echo [1/6] Kontrolujem GitHub...
git fetch origin
if errorlevel 1 goto fail
for /f %%A in ('git rev-list --count HEAD..origin/main') do set TM_BEHIND=%%A
if not "%TM_BEHIND%"=="0" goto behind

echo.
echo [2/6] Kontrolujem Astro/TypeScript...
call npm run check
if errorlevel 1 goto fail

echo.
echo [3/6] Testujem newsletter lifecycle, tokeny, odhlasenie a legacy import...
node --experimental-strip-types --test scripts\newsletter.test.ts
if errorlevel 1 goto fail

echo.
echo [4/6] Vytvaram produkcny build...
set ASTRO_TELEMETRY_DISABLED=1
call npm run build
if errorlevel 1 goto fail

echo.
echo [5/6] Pridavam LEN subory newsletter opravy...
git add -- .gitignore scripts\newsletter.test.ts src\components\AccountShell.astro src\components\Footer.astro src\lib\mail.ts src\lib\newsletter.ts src\lib\security.ts src\middleware.ts src\pages\registracia.astro src\pages\newsletter.astro src\pages\newsletter\potvrdit.astro src\pages\ucet\newsletter.astro src\pages\api\newsletter\subscribe.ts src\pages\api\newsletter\unsubscribe.ts src\pages\api\newsletter\account-unsubscribe.ts src\pages\api\newsletter\status.ts src\pages\api\admin\newsletter.ts src\pages\newsletter\odhlasit.astro IMPORTOVAT-NEWSLETTER-883.bat EXPORTOVAT-AKTIVNY-NEWSLETTER.bat src\styles\footer.css src\styles\newsletter.css NASADIT-NEWSLETTER.bat
if errorlevel 1 goto fail

git diff --cached --quiet
if not errorlevel 1 goto nothing

echo.
echo [6/6] Commit a push do GitHubu...
git commit -m "Newsletter bezpecne odhlasenie import a export suhlasov"
if errorlevel 1 goto fail
git push origin main
if errorlevel 1 goto pushfail

echo.
echo HOTOVO: Newsletter modul bol odoslany do GitHubu.
echo Coolify by mal nasadit zmenu automaticky; ak nie, spustite Redeploy.
git status -sb
pause
exit /b 0

:wrongbranch
echo.
echo CHYBA: Aktualna Git vetva je "%TM_BRANCH%". Nasadenie je povolene iba z vetvy main.
echo BAT nic necommitol ani neposlal.
git status -sb
pause
exit /b 1

:staged
echo.
echo CHYBA: V Gite uz mate pripravene ine subory na commit.
echo Aby sa nic cudzie omylom neposlalo, najskor ich commitnite alebo odstageujte.
git status -sb
pause
exit /b 1

:behind
echo.
echo CHYBA: Lokalny projekt je pozadu za origin/main.
echo Najskor projekt bezpecne aktualizujte. BAT nic nezmenil ani neposlal.
git status -sb
pause
exit /b 1

:missing
echo.
echo CHYBA: Najskor rozbalte ZIP do hlavneho priecinka projektu tonerymaxim.
pause
exit /b 1

:nothing
echo.
echo Nie su ziadne nove zmeny na odoslanie.
git status -sb
pause
exit /b 0

:pushfail
echo.
echo CHYBA: Commit vznikol, ale push na GitHub zlyhal.
echo Vraciam iba prave vytvoreny newsletter commit do pracovnych zmien, aby sa dal bezpecne zopakovat.
git reset HEAD~1
git status -sb
pause
exit /b 1

:fail
echo.
echo CHYBA: Kontrola alebo build zlyhal. Git push sa NEVYKONAL.
git status -sb
pause
exit /b 1
