# Hľadanie fotoaparátom na úvodnej stránke a v poradni

Východiskom bol commit `52abc952ee7d1b937fa891e458f8194d32cc8b73` hlavnej vetvy. Na samostatnej mobilnej úvodnej stránke bol odkaz „Skenovať štítok“. Počítačová úvodná stránka nemala výzvu na hľadanie fotkou a adresa nového článku vracala 404.

## Zmena pre zákazníka

Mobilný blok pod hlavným vyhľadávaním otvorí existujúci skener cez `/hladat-fotkou#skenovat`. Na počítači tlačidlo otvorí výber metódy na `/hladat-fotkou`. Obrázok QR vedie na rovnaký skener v telefóne. Pri priamom vstupe z QR zákazník na stránke spustí kameru tlačidlom. Do oboch menu, poradne, kategórie výberu náplne a mapy stránok pribudol článok `/poradna/ako-najst-napln-fotoaparatom`. Návrhy vyhľadávania aj úplný výpis pri prázdnom výsledku ponúkajú hľadanie fotoaparátom. Vykreslenie bloku a odkazov zabezpečuje Astro na serveri. Rozpoznávanie používa existujúcu stránku skenera.

## Porovnanie pred a po zmene

Obe produkčné zostavenia používali ten istý miestny katalóg 7 750 položiek. SHA-256 vstupu je `2a1ad0bb1ca34679c1ff0e88f4ef96006f47baa7ccfc6b38745166d5faf7ba48`. Nákupné scenáre použili oddelené testovacie objednávky, odpovede WooCommerce a platobnú bránu GoPay.

| Kontrola | Pôvodná verzia | Upravená verzia |
| --- | ---: | ---: |
| `npm run check`, chyby / varovania / existujúce podnety | 0 / 0 / 22 | 0 / 0 / 22 |
| `npm test`, úspešné kontroly | 1 205 | 1 205 |
| `npm run build`, úspešné testy pred zostavením | 407 | 407 |
| `verify-predeploy-purchase.mjs`, splnené nákupné scenáre | 27 | 27 |
| `npm audit --omit=dev`, kritické / vysoké / stredné nálezy | 0 / 7 / 3 | 0 / 7 / 3 |
| Veľkosť HTML úvodnej stránky po gzip | 19 361 B | 19 918 B |
| Čas prijatia celého HTML, medián | 9,94 ms | 9,25 ms |
| Čas prijatia celého HTML, 95. percentil | 33,86 ms | 30,81 ms |

HTTP meranie striedalo poradie dvoch lokálnych zostavení, po zahriatí 31 požiadaviek na každú verziu. Hodnoty opisujú doručenie HTML na rovnakom stroji. Čas na reálnom mobilnom pripojení závisí aj od zariadenia a siete.

Zhodovali sa stavy odpovedí všetkých 27 nákupných scenárov aj konečné sumy. Dobierka s tromi sadami vyšla 204,24 €, štyri sady s GoPay 225,60 €, zmena z nedokončenej platby na dobierku 226,80 €, malá objednávka 16,29 € a prepočet zmenenej ceny 18,40 €. Počítadlá skutočných platieb, objednávok vo WooCommerce, e-mailov a ostatných externých požiadaviek boli v oboch behoch nulové.

## Vstupy a opakovanie kontrol

- Pri 320, 390, 760, 900, 1 280 a 1 440 px sa pod vyhľadávaním zobrazil jeden blok. Hlavné tlačidlo dosiahlo výšku aspoň 44 px. Kontrola prešla cez mobilné menu aj cez položku Poradňa na počítači a overila šírku stránky. Pri úvodnom načítaní bol počet požiadaviek na OCR alebo jeho modely nulový.
- QR má 322 B. Dekodér prečítal z výsledného PNG adresu `https://www.tonerymaxim.sk/hladat-fotkou#skenovat`. Mobil pri kontrolovaných šírkach obrázok nesťahoval.
- Ďalších 32 automatických kontrol prešlo s propagáciou zapnutou i vypnutou. Overili aj `?foto=1`, kanonickú adresu, štruktúrované dáta článku, mapu stránok, prázdny aj neprázdny katalóg, CSP a oprávnenia kamery na stránke skenera.
- Rozšírený scenár `scripts/verify-responsive-purchase.mjs` je súčasťou existujúceho workflow Release checks. Obsahuje prechody od bloku k článku a skeneru, mobilné menu, desktopové menu ovládané klávesnicou a vyhľadávanie s výsledkami aj bez nich.

Stav zlúčenia, výsledky testov prehliadačov a commit pripravený pre ručný Coolify redeploy sú v príslušnom pull requeste. Fyzická kamera a ostrá platba nie sú súčasťou tohto merania.
