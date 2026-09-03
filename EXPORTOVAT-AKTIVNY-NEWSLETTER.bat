@echo off
setlocal
cd /d "%~dp0"
set /p "TM_KEY=Zadajte ADMIN API kluc: "
if "%TM_KEY%"=="" (echo CHYBA: kluc nebol zadany & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=@{'x-admin-key'=$env:TM_KEY}; Invoke-WebRequest -Uri 'https://www.tonerymaxim.sk/api/admin/newsletter' -Headers $h -OutFile 'newsletter-aktivni.csv'"
set "TM_KEY="
if errorlevel 1 (echo CHYBA: export zlyhal. & pause & exit /b 1)
echo HOTOVO: newsletter-aktivni.csv obsahuje iba aktualne aktivnych odberatelov.
pause
