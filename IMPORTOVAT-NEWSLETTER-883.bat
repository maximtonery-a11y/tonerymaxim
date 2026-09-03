@echo off
setlocal
cd /d "%~dp0"
if not exist NEWSLETTER-IMPORT-883.json (echo CHYBA: chyba NEWSLETTER-IMPORT-883.json & pause & exit /b 1)
set /p "TM_KEY=Zadajte ADMIN API kluc: "
if "%TM_KEY%"=="" (echo CHYBA: kluc nebol zadany & pause & exit /b 1)
echo Importujem 883 uz potvrdenych newsletterovych suhlasov...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=@{'x-admin-key'=$env:TM_KEY}; $body=Get-Content -Raw -Encoding UTF8 'NEWSLETTER-IMPORT-883.json'; Invoke-RestMethod -Method Post -Uri 'https://www.tonerymaxim.sk/api/admin/newsletter' -Headers $h -ContentType 'application/json; charset=utf-8' -Body $body | ConvertTo-Json"
if errorlevel 1 (echo CHYBA: import zlyhal. Subor so suhlasmi zostal zachovany. & set "TM_KEY=" & pause & exit /b 1)
set "TM_KEY="
del /q NEWSLETTER-IMPORT-883.json
echo HOTOVO. Importny subor s e-mailami bol po uspesnom importe zmazany, aby nemohol byt omylom commitnuty do GitHubu.
echo Uz odhlasene adresy sa z bezpecnostnych dovodov nikdy znovu neaktivuju.
pause
