@echo off
setlocal
cd /d "%~dp0"
title ToneryMaxim - overenie produkcie SK

if "%TM_VERIFY_ADMIN_KEY%"=="" (
  set /p TM_VERIFY_ADMIN_KEY=Vlozte TM_ANALYTICS_ADMIN_KEY z Coolify: 
)

call npm run release:verify:sk
if errorlevel 1 goto :fail

echo.
echo HOTOVO: Produkcia na tonerymaxim.sk presla uplnou kontrolou.
pause
exit /b 0

:fail
echo.
echo CHYBA: Produkcna kontrola zlyhala. Pozrite vypis vyssie.
pause
exit /b 1
