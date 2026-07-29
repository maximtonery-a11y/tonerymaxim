CLEAN_PROJECT_V2.bat

Skript:
- odstrani cache, buildy, node_modules a lokalne prevadzkove data,
- vymaze stare migracne reporty a logy,
- presunie vyvojovu dokumentaciu z korena do docs\archive,
- presunie jednorazove instalacne .mjs skripty do scripts\archive,
- zalohuje .env mimo projektu do ..\tonerymaxim_local_backup,
- nikdy nemaze .git, src, public, package.json ani hlavny README.md.

Pouzitie:
1. Rozbal oba subory do C:\Users\roman\tonerymaxim
2. Spusti CLEAN_PROJECT_V2.bat dvojklikom.
3. Po dokonceni skontroluj vypis git status.
4. Presuny dokumentacie treba commitnut a pushnut.
