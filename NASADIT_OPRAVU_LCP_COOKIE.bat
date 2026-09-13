@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul 2>&1
title ToneryMaxim - bezpecne nasadenie LCP opravy

cd /d "%~dp0"

echo ============================================================
echo ToneryMaxim - kontrola a nasadenie LCP opravy
echo ============================================================
echo.

where git >nul 2>&1 || goto :missing_git
where node >nul 2>&1 || goto :missing_node
where npm >nul 2>&1 || goto :missing_npm

if not exist ".git" goto :wrong_folder
if not exist "package.json" goto :wrong_folder
if not exist "src\components\CookieConsent.astro" goto :missing_patch
if not exist "public\tm-google-tags.js" goto :missing_patch
if not exist "scripts\first-visit-performance.test.mjs" goto :missing_patch

for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "TM_BRANCH=%%B"
if /I not "%TM_BRANCH%"=="main" goto :wrong_branch

echo [1/6] Overujem GitHub a aktualnost vetvy main...
git remote get-url origin >nul 2>&1 || goto :missing_origin
git fetch --quiet origin main || goto :failed
for /f "delims=" %%H in ('git rev-parse HEAD') do set "TM_LOCAL_HEAD=%%H"
for /f "delims=" %%H in ('git rev-parse origin/main') do set "TM_REMOTE_HEAD=%%H"
if /I not "%TM_LOCAL_HEAD%"=="%TM_REMOTE_HEAD%" goto :branch_not_current

git diff --cached --quiet || goto :staged_changes

echo [2/6] Vytvaram cistu izolovanu kopiu pre test...
set "TM_TEST_DIR=%TEMP%\tonerymaxim-lcp-test-%RANDOM%-%RANDOM%"
git worktree add --quiet --detach "%TM_TEST_DIR%" origin/main || goto :failed

copy /Y "src\components\CookieConsent.astro" "%TM_TEST_DIR%\src\components\CookieConsent.astro" >nul || goto :test_failed
copy /Y "public\tm-google-tags.js" "%TM_TEST_DIR%\public\tm-google-tags.js" >nul || goto :test_failed
copy /Y "scripts\first-visit-performance.test.mjs" "%TM_TEST_DIR%\scripts\first-visit-performance.test.mjs" >nul || goto :test_failed

pushd "%TM_TEST_DIR%" || goto :test_failed

echo [3/6] Instalujem presne zamknute zavislosti...
call npm ci --ignore-scripts || goto :test_failed_popd

echo [4/6] Spustam cielene, bezpecnostne a produkcne testy...
node --test scripts/first-visit-performance.test.mjs || goto :test_failed_popd
call npm run test:security || goto :test_failed_popd
node --experimental-strip-types --test scripts/production-readiness.test.ts || goto :test_failed_popd
call npm run check || goto :test_failed_popd
call npm run build || goto :test_failed_popd

popd
git worktree remove --force "%TM_TEST_DIR%" >nul 2>&1
set "TM_TEST_DIR="

echo [5/6] Pripravujem commit iba zo styroch povolenych suborov...
git add -- "src/components/CookieConsent.astro" "public/tm-google-tags.js" "scripts/first-visit-performance.test.mjs" "NASADIT_OPRAVU_LCP_COOKIE.bat" || goto :failed
git diff --cached --check || goto :unstage_failed
git diff --cached --quiet && goto :nothing_to_deploy

git commit -m "fix: render cookie consent before LCP" || goto :unstage_failed

echo [6/6] Odosielam bez force push iba do origin/main...
git push origin main || goto :push_failed

echo.
echo HOTOVO: Oprava bola bezpecne odoslana na GitHub.
echo Coolify moze nasadit novy commit z vetvy main.
echo Ine neupravene subory v projekte neboli pridane do commitu.
echo.
pause
exit /b 0

:test_failed_popd
popd

:test_failed
if defined TM_TEST_DIR git worktree remove --force "%TM_TEST_DIR%" >nul 2>&1
echo.
echo CHYBA: Test alebo build zlyhal. Nic nebolo commitnute ani odoslane.
goto :end_error

:unstage_failed
git reset --quiet HEAD -- "src/components/CookieConsent.astro" "public/tm-google-tags.js" "scripts/first-visit-performance.test.mjs" "NASADIT_OPRAVU_LCP_COOKIE.bat" >nul 2>&1
echo.
echo CHYBA: Kontrola pripraveneho commitu zlyhala. Nic nebolo odoslane.
goto :end_error

:push_failed
echo.
echo CHYBA: GitHub odmietol push. Commit zostal iba lokalne a nic sa neprepisovalo nasilu.
goto :end_error

:wrong_folder
echo.
echo CHYBA: BAT musi byt spusteny priamo v korenovom priecinku projektu.
echo Ocakavany je package.json a priecinok .git vedla BAT suboru.
goto :end_error

:missing_patch
echo.
echo CHYBA: Chyba niektory subor opravy. Rozbalte cely ZIP do korena projektu.
goto :end_error

:wrong_branch
echo.
echo CHYBA: Aktivna vetva musi byt main. Aktualna vetva: %TM_BRANCH%
goto :end_error

:missing_origin
echo.
echo CHYBA: Projekt nema nakonfigurovany vzdialeny repozitar s nazvom origin.
goto :end_error

:branch_not_current
echo.
echo CHYBA: Lokalna main nie je zhodna s origin/main.
echo Najprv bezpecne zosuladte vetvu; BAT nebude robit merge ani reset.
goto :end_error

:staged_changes
echo.
echo CHYBA: Git uz obsahuje ine pripravene zmeny v stagingu.
echo Zruste ich zo stagingu alebo ich najprv samostatne commitnite.
goto :end_error

:nothing_to_deploy
git reset --quiet HEAD -- "src/components/CookieConsent.astro" "public/tm-google-tags.js" "scripts/first-visit-performance.test.mjs" "NASADIT_OPRAVU_LCP_COOKIE.bat" >nul 2>&1
echo.
echo Nie je co nasadit. Vsetky subory uz zodpovedaju aktualnej verzii.
goto :end_ok

:missing_git
echo CHYBA: Git nebol najdeny v PATH.
goto :end_error

:missing_node
echo CHYBA: Node.js nebol najdeny v PATH.
goto :end_error

:missing_npm
echo CHYBA: npm nebolo najdene v PATH.
goto :end_error

:failed
echo.
echo CHYBA: Operacia zlyhala. Nic nebolo odoslane nasilu.

:end_error
echo.
pause
exit /b 1

:end_ok
echo.
pause
exit /b 0
