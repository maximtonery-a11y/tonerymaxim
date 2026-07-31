@echo off
setlocal
cd /d "%~dp0"
title ToneryMaxim - overenie nasadenia INFO

if "%TM_VERIFY_ADMIN_KEY%"=="" (
  set /p TM_VERIFY_ADMIN_KEY=Vlozte TM_ANALYTICS_ADMIN_KEY z Coolify: 
)

call npm run release:verify:info
if errorlevel 1 goto :fail

echo.
echo HOTOVO: Testovacie nasadenie preslo uplnou kontrolou.
pause
exit /b 0

:fail
echo.
echo CHYBA: Nasadenie nie je pripravene na zmenu DNS.
pause
exit /b 1
