@echo off
setlocal
cd /d "%~dp0"

echo Kontrola projektu...
if not exist package.json goto wrongfolder

echo Aktualizujem informacie z GitHubu...
git fetch origin
if errorlevel 1 goto failed

git merge-base --is-ancestor origin/main HEAD
if errorlevel 1 goto outdated

echo Testujem cely scenar TN2421 pred aj po vybere typu...
node --experimental-strip-types --test scripts\ai-tomas-tn2421-regression.test.ts
if errorlevel 1 goto failed

echo Kontrolujem projekt...
call npm run check
if errorlevel 1 goto failed

echo Vytvaram produkcny build...
call npm run build
if errorlevel 1 goto failed

echo Pripravujem iba subory opravy V8.3...
git add src\pages\api\ai-tomas.ts
git add scripts\ai-tomas-tn2421-regression.test.ts
git add NASADIT-AI-TOMAS-V8-3.bat
if errorlevel 1 goto failed

git diff --cached --quiet
if not errorlevel 1 goto nochanges

git commit -m "Oprava naslednej formulacie TN2421 AI Tomasa V8.3"
if errorlevel 1 goto failed

git push origin main
if errorlevel 1 goto failed

echo.
echo HOTOVO: oprava V8.3 bola odoslana do GitHubu.
echo Teraz spustite Redeploy v Coolify.
git status -sb
pause
exit /b 0

:wrongfolder
echo CHYBA: ZIP nebol rozbaleny v hlavnom priecinku projektu tonerymaxim.
pause
exit /b 1

:outdated
echo CHYBA: Lokalny projekt je starsi ako origin/main.
echo Nic nebolo commitnute ani odoslane.
pause
exit /b 1

:nochanges
echo Oprava uz je v projekte. Nie je co commitnut.
git status -sb
pause
exit /b 0

:failed
echo.
echo CHYBA: Nasadenie bolo zastavene. Push sa nevykonal.
git status -sb
pause
exit /b 1
