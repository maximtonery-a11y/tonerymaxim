@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title ToneryMAXIM - Production Clean V2

echo ==============================================
echo ToneryMAXIM - Production Clean V2
echo ==============================================
echo.

if not exist package.json (
  echo CHYBA: Skript nie je v hlavnom priecinku projektu.
  echo Vloz ho do C:\Users\roman\tonerymaxim a spusti znova.
  pause
  exit /b 1
)

echo [1/8] Zaloha .env mimo projektu...
if exist .env (
  if not exist "..\tonerymaxim_local_backup" mkdir "..\tonerymaxim_local_backup"
  copy /Y ".env" "..\tonerymaxim_local_backup\.env.backup" >nul
  echo OK: .env je zalohovany v ..\tonerymaxim_local_backup\.env.backup
) else (
  echo INFO: .env neexistuje.
)

echo.
echo [2/8] Odstranovanie cache, buildov a lokalnych dat...
for %%D in (.astro dist node_modules .wrangler .tm-cache .tm-data .output) do (
  if exist "%%D" (
    rmdir /s /q "%%D"
    if exist "%%D" (
      echo UPOZORNENIE: %%D sa nepodarilo uplne odstranit.
    ) else (
      echo OK: %%D odstranene.
    )
  ) else (
    echo OK: %%D neexistuje.
  )
)

echo.
echo [3/8] Cistenie reportov a logov...
if exist "migration\reports" (
  del /q "migration\reports\*.csv" 2>nul
  del /q "migration\reports\*.html" 2>nul
  del /q "migration\reports\*.json" 2>nul
)
del /q npm-debug.log* 2>nul
del /q yarn-debug.log* 2>nul
del /q yarn-error.log* 2>nul
del /q pnpm-debug.log* 2>nul

echo.
echo [4/8] Upratanie dokumentacie z hlavneho priecinka...
if not exist "docs" mkdir "docs"
if not exist "docs\archive" mkdir "docs\archive"

for %%F in (
  ACCOUNT_PERFORMANCE_V1_README.md
  AI_SALES_ASSISTANT_V3.md
  ASYNC_ORDER_QUEUE_V1_README.md
  AUDIT_REPORT.md
  CHECKOUT_HOTFIX.md
  CHECKOUT_PROFILER_README.md
  CHECKOUT_PROFILER_V2_README.md
  GOPAY_FAST_CHECKOUT_V1_README.md
  INSTALL.md
  INSTALL_AI_SALES_ASSISTANT_V2.md
  INSTALL_AI_SALES_ASSISTANT_VISIBLE_V1.md
  INSTALL_ETAPA_1_SSR_NOINDEX.md
  INSTALL_ETAPA_2_CATALOG_INSPECTOR.md
  INSTALL_ONLY_CHANGED_FILES.md
  INSTALL_TOMAS_DIGITAL_WORKER_V4.md
  MIGRATION_GATE_README.md
  PERFORMANCE_STEP1_PRODUCTS.md
  SEARCH_PERFORMANCE_V1_README.md
  SECURITY_GO_LIVE_UPDATE.md
  SECURITY_PATCH_54_README.md
  SECURITY_STEP1_CHECKOUT_AUDIT.md
  TM_ADS_EXPORT_V1_README.md
  TM_Update_023_README.md
  UPDATE_005_README.md
  UPDATE_006_README.md
  UPDATE_007_README.md
  UPDATE_008_README.md
  CLEAN_PROJECT_README.txt
) do (
  if exist "%%F" move /Y "%%F" "docs\archive\" >nul
)

echo OK: Vyvojova dokumentacia je v docs\archive.

echo.
echo [5/8] Upratanie jednorazovych instalacnych skriptov...
if not exist "scripts\archive" mkdir "scripts\archive"
for %%F in (install-ai-sales-assistant-v1.mjs install-ai-sales-assistant-v2.mjs install-ai-sales-assistant-visible-v1.mjs) do (
  if exist "%%F" move /Y "%%F" "scripts\archive\" >nul
)
echo OK: Jednorazove instalacne skripty su v scripts\archive.

echo.
echo [6/8] Odstranenie stareho lokalneho backup priecinka v projekte...
if exist "_local_backup" rmdir /s /q "_local_backup"

echo.
echo [7/8] Kontrola hlavneho priecinka...
echo V koreni by mali ostat najma: src, public, scripts, migration, docs,
echo package.json, package-lock.json, astro.config.mjs, tsconfig.json,
echo .env, .env.production.example, .gitignore, README.md a CLEAN_PROJECT_V2.bat.
echo.
dir /b

echo.
echo [8/8] Git stav...
git status --short
if errorlevel 1 (
  echo CHYBA: Git kontrola zlyhala.
) else (
  echo.
  echo DOKONCENE.
  echo Presun dokumentacie vytvori zmeny v Gite. To je ocakavane.
  echo Po kontrole pouzi: git add .
  echo potom: git commit -m "Clean project structure"
  echo a nakoniec: git push
)

echo.
pause
endlocal
