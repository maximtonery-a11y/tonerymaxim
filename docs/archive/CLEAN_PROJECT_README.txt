TONERYMAXIM - CLEAN_PROJECT.bat

INSTALACIA
1. Rozbal ZIP.
2. Skopiruj CLEAN_PROJECT.bat do hlavneho priecinka projektu:
   C:\Users\roman\tonerymaxim
3. Subor musi byt vedla package.json.
4. Spusti ho dvojklikom.

CO SKRIPT ROBI
- zalohuje .env do _local_backup\.env.backup,
- odstrani node_modules, dist, .astro, .wrangler, .output,
- odstrani .tm-cache a lokalne .tm-data,
- vycisti migration\reports, ale zachova .gitkeep,
- odstrani npm/yarn/pnpm logy,
- skontroluje Git stav,
- volitelne spusti npm ci a npm run build.

CO SKRIPT NEROBI
- nemaze .git,
- nemaze .env,
- nemaze src, public, scripts ani zdrojovy kod,
- nerobi git commit ani git push,
- nemeni Coolify ani GitHub,
- nepresuva dokumentaciu, aby zbytocne nevytvaral desiatky Git zmien.

ODPORUCANIE
Pred spustenim zastav lokalny npm server. Ak je otvoreny npm run dev,
stlac v jeho CMD okne Ctrl+C.
