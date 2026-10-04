@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ==============================================================
echo TONERYMAXIM - PRINTER FINDER V4.6 PRE WINDOWS
echo ==============================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1"
if errorlevel 1 (
  echo.
  echo INSTALACIA ZLYHALA. Odfotografujte alebo skopirujte tuto chybu.
  echo.
  pause
  exit /b 1
)
echo.
echo Hotovo. V prehliadaci sa otvori ToneryMaxim.
timeout /t 3 /nobreak >nul
exit /b 0
