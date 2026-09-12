@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

title ToneryMaxim - bezpecne nasadenie opravy rychlosti

if not exist "package.json" goto bad_folder
if not exist ".git" goto bad_folder
where git >nul 2>nul || goto missing_git
where node >nul 2>nul || goto missing_node
where npm >nul 2>nul || goto missing_node
git rev-parse --verify HEAD >nul 2>nul || goto bad_repository
git remote get-url origin 2>nul | findstr /i "github.com" >nul || goto bad_remote
git rev-parse --abbrev-ref --symbolic-full-name @{u} >nul 2>nul || goto missing_upstream

echo ============================================================
echo TONERYMAXIM - OPRAVA PRVEHO NACITANIA A STABILITY
echo ============================================================
echo.

echo [1/7] Overujem aktualnost lokalnej vetvy oproti GitHubu...
git fetch --prune origin || goto fetch_failed
set "TM_LOCAL_AHEAD="
set "TM_LOCAL_BEHIND="
for /f %%C in ('git rev-list --count @{u}..HEAD') do set "TM_LOCAL_AHEAD=%%C"
for /f %%C in ('git rev-list --count HEAD..@{u}') do set "TM_LOCAL_BEHIND=%%C"
if not "%TM_LOCAL_AHEAD%"=="0" goto local_ahead
if not "%TM_LOCAL_BEHIND%"=="0" goto local_behind

if not exist "node_modules" (
  echo [2/7] Instaluju sa presne zavislosti z package-lock.json...
  call npm ci || goto failed
) else (
  echo [2/7] Zavislosti su pripravene.
)

echo [3/7] Kontrolujem Astro a TypeScript...
call npm run check || goto failed

echo [4/7] Spustam 230 produkcnych regresnych testov...
call npm run test:production || goto failed

echo [5/7] Vytvaram produkcny build...
call npm run build || goto failed

echo [6/7] Kontrolujem Git a presny rozsah opravy...
git diff --check -- ^
  "src/components/Header.astro" ^
  "src/components/Footer.astro" ^
  "src/components/HeroSearch.astro" ^
  "src/assets/tlaciaren-optimized.webp" ^
  "src/pages/api/storefront-check.ts" ^
  "src/pages/prihlasenie.astro" ^
  "src/pages/registracia.astro" ^
  "src/pages/zabudnute-heslo.astro" ^
  "src/pages/reset-hesla.astro" ^
  "NASADIT_NA_GITHUB.bat" || goto failed

git status --porcelain -- ^
  "src/components/Header.astro" ^
  "src/components/Footer.astro" ^
  "src/components/HeroSearch.astro" ^
  "src/assets/tlaciaren-optimized.webp" ^
  "src/pages/api/storefront-check.ts" ^
  "src/pages/prihlasenie.astro" ^
  "src/pages/registracia.astro" ^
  "src/pages/zabudnute-heslo.astro" ^
  "src/pages/reset-hesla.astro" ^
  "NASADIT_NA_GITHUB.bat" | findstr . >nul || goto nothing

echo [7/7] Commitujem iba subory opravy a odosielam ich na GitHub...
git add -- ^
  "src/components/Header.astro" ^
  "src/components/Footer.astro" ^
  "src/components/HeroSearch.astro" ^
  "src/assets/tlaciaren-optimized.webp" ^
  "src/pages/api/storefront-check.ts" ^
  "src/pages/prihlasenie.astro" ^
  "src/pages/registracia.astro" ^
  "src/pages/zabudnute-heslo.astro" ^
  "src/pages/reset-hesla.astro" ^
  "NASADIT_NA_GITHUB.bat" || goto failed

git commit --only -m "fix: speed up cold page load and correct memory healthcheck" -- ^
  "src/components/Header.astro" ^
  "src/components/Footer.astro" ^
  "src/components/HeroSearch.astro" ^
  "src/assets/tlaciaren-optimized.webp" ^
  "src/pages/api/storefront-check.ts" ^
  "src/pages/prihlasenie.astro" ^
  "src/pages/registracia.astro" ^
  "src/pages/zabudnute-heslo.astro" ^
  "src/pages/reset-hesla.astro" ^
  "NASADIT_NA_GITHUB.bat" || goto failed

git push || goto push_failed

echo.
echo ============================================================
echo HOTOVO: Oprava presla kontrolou a bola odoslana na GitHub.
echo Ak ma Coolify automaticke nasadenie z GitHubu, nasadenie sa spusti samo.
echo Inak v Coolify stlacte iba tlacidlo Redeploy.
echo Po nasadeni musia adresy /api/health a /api/storefront-check vratit 200.
echo ============================================================
pause
exit /b 0

:bad_folder
echo.
echo CHYBA: BAT musi byt v koreni existujuceho Git projektu vedla package.json a .git.
echo Nerozbalujte ho do noveho prazdneho priecinka bez historie Git.
pause
exit /b 1

:missing_git
echo.
echo CHYBA: Git nie je nainstalovany alebo nie je dostupny v PATH.
pause
exit /b 1

:missing_node
echo.
echo CHYBA: Node.js alebo npm nie je nainstalovany alebo nie je dostupny v PATH.
pause
exit /b 1

:bad_repository
echo.
echo CHYBA: Priecinok nema platny Git commit. Skript nic nezmenil ani neodoslal.
pause
exit /b 1

:bad_remote
echo.
echo CHYBA: Git remote origin nie je GitHub. Skript odmietol odoslat subory na iny server.
pause
exit /b 1

:missing_upstream
echo.
echo CHYBA: Aktualna vetva nema nastavenu sledovanu GitHub vetvu.
echo Najskor nastavte upstream standardnym prvym pushom tejto vetvy.
pause
exit /b 1

:fetch_failed
echo.
echo CHYBA: Nepodarilo sa bezpecne overit aktualny stav GitHubu cez git fetch.
echo Skript nic necommitoval ani neodoslal.
pause
exit /b 1

:local_ahead
echo.
echo CHYBA: Lokalna vetva uz obsahuje neodoslane commity.
echo Skript ich z bezpecnostnych dovodov spolu s opravou neodosle.
pause
exit /b 1

:local_behind
echo.
echo CHYBA: GitHub obsahuje novsie commity ako lokalny projekt.
echo Najskor bezpecne aktualizujte lokalny projekt. Skript automaticky nerobi merge ani rebase.
pause
exit /b 1

:nothing
echo.
echo INFO: Tato oprava uz je v aktualnom Git commite. Nie je co odoslat.
pause
exit /b 0

:push_failed
echo.
echo CHYBA: Commit je vytvoreny lokalne, ale git push zlyhal.
echo Skontrolujte internet, prihlasenie do GitHubu a opravnenie k repozitaru.
echo Po oprave pristupu staci spustit prikaz: git push
pause
exit /b 1

:failed
echo.
echo CHYBA: Kontrola, test, build alebo commit zlyhal.
echo Na GitHub sa neposlala neotestovana oprava.
pause
exit /b 1
