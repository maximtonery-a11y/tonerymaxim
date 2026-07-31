@echo off
setlocal
cd /d "%~dp0"
title ToneryMaxim - upratanie pred GitHubom

echo Tento skript odstrani iba stare instalacne baliky, build a lokalne cache.
echo Subory .env ani .git neodstrani.
set /p TM_CONFIRM=Pokračovat? Napisat ANO: 
if /I not "%TM_CONFIRM%"=="ANO" (
  echo Zrusene.
  pause
  exit /b 0
)

for %%F in (
  "APLIKOVAT_FINALNU_MIGRACIU_V69.bat"
  "APLIKOVAT_MIGRACIU_V68.bat"
  "APLIKOVAT_MIGRATION_GATE_V68_2.bat"
  "APLIKOVAT_SEO_DOMINATOR_V67.bat"
  "APLIKOVAT_SEO_GEO_LANDING_PAGES.bat"
  "APLIKOVAT_SITEMAP_SYSTEM_V65.bat"
  "APLIKOVAT_TECHNICKY_ZAKLAD.bat"
  "README_PATCH.txt"
  "README_PATCH3.md"
  "README_PATCH4.md"
  "README_PATCH5.md"
  "README_PATCH6.md"
  "README_PATCH7.md"
  "README_PATCH8.md"
  "README_PATCH9.md"
  "robots.additions.txt"
) do if exist "%%~F" del /q "%%~F"

for %%D in (".astro" "dist" "node_modules" ".tm-cache" "migration\reports") do (
  if exist "%%~D" rmdir /s /q "%%~D"
)

echo.
echo HOTOVO: Pomocne subory a lokalne artefakty boli odstranene.
echo .env zostal zachovany a je chraneny cez .gitignore.
pause
exit /b 0
