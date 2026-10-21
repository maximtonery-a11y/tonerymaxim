# AI Tomáš: presné uplatňovanie zliav

Dátum: 21. 10. 2026. Východiskový commit: `eb853a6`.

## Problém a oprava

Na živom API bol zopakovaný rozhovor zákazníka na stránke `/ucet`:

1. „ako uplatním zľavu za registráciu“ — odpoveď uviedla iba základné pravidlá 5 % zľavy.
2. „kde mi ta zľava príde zatiaľ neprišla“ — odpoveď nemala spoľahlivé informácie a otvorila odovzdanie podpore.

Znalosti neobsahovali presný postup a nadväzujúca otázka stratila tému registračnej zľavy. Navyše sa podstatné meno „kupón“ niekedy vyhodnotilo ako sloveso „kúp“. Prehliadač mohol otázku „Kde nájdem 7 % zľavu za objednávku?“ poslať na zisťovanie stavu objednávky ešte pred kontaktovaním poradenskej vrstvy.

Oprava dopĺňa overené postupy, odkazy na príslušné časti účtu a súhrnu nákupu, zachovanie aktuálnej témy pri nadväzujúcich otázkach a správne smerovanie v prehliadači aj API. Neznámy typ zľavy vyvolá užitočné upresnenie s umiestnením odmien. Vydaný marketingový kód sa musí overiť v košíku; Tomáš nesľubuje jeho platnosť ani výšku zľavy.

## Pokryté pravidlá a umiestnenie

| Typ | Kde sa zobrazuje | Ako sa uplatní |
| --- | --- | --- |
| Registračná zľava 5 % | Môj účet → Moje odmeny → Zľava 5 % po registrácii; kód a dátum po „Zotrieť odmenu“ | Po prihlásení automatický výber použiteľného kupónu; odpočet „Kupónová zľava“. Jednorazová, celý sortiment tovaru, 30 dní. Netreba čakať na e-mail ani zotrieť odmenu na aktiváciu. |
| Odmena 7 % | Pri účte Moje odmeny → Aktívne kupóny; bez účtu blok Odmena na ďalší nákup po úspešnom dokončení objednávky | Prihlásenému automaticky pri ďalšom nákupe; hosť zadá vydaný kód cez „Máte zľavový kupón?“ → „Použiť“. Iba kompatibilné tonery, jednorazový kupón. |
| Vydaný marketingový kupón | Podľa kampane v e-maile alebo medzi aktívnymi kupónmi účtu | Vložiť presný kód do „Zadajte kód kupónu“ a kliknúť „Použiť“; overiť hlásenie a riadok „Kupónová zľava“. Percento, rozsah a platnosť potvrdí až validácia. |
| Množstevná zľava kompatibilných produktov | Cena položky a súhrn „Množstevná / sadová zľava“ v košíku aj pokladni | Rovnaké SKU: 2–3 ks −10 %, od 4 ks −25 %. Bez kupónu či registrácie. Farby a rôzne SKU sa nesčítavajú; pri hotovej sade sa počítajú balenia. Originály a renovované produkty tieto percentá nemajú. |
| Množstevná zľava kalendárov a diárov | Cena položky a „Množstevná / sadová zľava“ | Rovnaký produkt: 3–20 ks −5 %, od 21 ks −15 %. Automaticky, rôzne produkty sa nesčítavajú. |
| Peňažná zľava z bodov | Môj účet → Vernostný program; v súhrne „Vernostná zľava“ | Od 20 bodov = 0,20 €, 100 bodov = 1 €. Predvolene zapnutá; košík má „Použiť vernostnú zľavu v tejto objednávke“, pokladňa „Použiť zľavu“. Body pribúdajú po expedovaní alebo dokončení objednávky. |
| Papierová vernostná odmena | Moje odmeny → Odmeny za vernostné body; samostatná položka košíka | Dostupné nevyčerpané balenia sa pridávajú automaticky prihlásenému zákazníkovi za 0,01 €/balenie. Hranice 500/800/1000 bodov v cykle pridávajú 1/2/3 balenia. Čerpanie peňažných bodov postup nezníži. |
| Akciová cena | Aktuálna cena produktu a položky košíka | Prenesie sa ako cena tovaru; nevyžaduje ďalší kupón. Konkrétna cena sa musí overiť pri konkrétnom produkte. |
| Newsletter | Nastavenie odberu a konkrétna ponuka v e-maile | Samotný odber nevytvára pevnú zľavu. Vydaný kód sa uplatní a overí ako marketingový kupón. Registračných 5 % patrí k účtu. |
| Kombinovanie a doprava | Samostatné riadky množstevnej, kupónovej a vernostnej zľavy | Najprv množstevná zľava, potom jeden kupón, nakoniec body. 5 % + 7 % nie je 12 %. Z účtu sa vyberá najvyššia úspora v eurách, čo pri zmiešanom košíku nemusí byť 7 %. Hranica dopravy zdarma 29 € sa počíta po všetkých zľavách. |

V mobile sú odmeny pod „Menu účtu“, kupónové pole košíka pod položkami a pokladničný súhrn pod tlačidlom „Objednávka“. Na PC je súhrn nákupu vpravo. Odpovede obsahujú priame interné odkazy na odmeny, body a košík.

Pravidlá boli skontrolované oproti `src/lib/coupons.ts`, `src/pages/api/auth/register.ts`, `src/pages/ucet/odmeny.astro`, `src/pages/ucet/vernost.astro`, `src/components/AccountShell.astro`, `src/lib/loyalty.ts`, `src/lib/loyalty-rules.ts`, `src/lib/order-statuses.ts`, `src/lib/checkout-order.ts`, `src/pages/platba-dokoncena.astro`, `src/scripts/cart.js`, `src/scripts/checkout.js` a `src/lib/calendar-pricing.ts`.

## Overenie

- `npm run check`: 0 chýb, 0 upozornení.
- `npm run build` po odstránení predchádzajúceho generovaného buildu: úspešný. Súčasťou je 163 kritických kontrol vrátane novej sady pre zľavy.
- Cielená sada: 32 úspešných testov; zahŕňa 46 priamych otázok na typy zliav, viacťahové rozhovory a existujúcich 300 bežných otázok.
- Skutočný JavaScript dispečera prehliadača s testovým DOM: nadväzovanie registračnej zľavy, kupóny, body a odmeny po objednávke. Nejde o vizuálny test prehliadača.
- Zostavený produkčný server: 24/24 poradenských požiadaviek cez skutočné HTTP a middleware. Celé otázky, odpovede, odkazy, stavy a časy sú v sprievodnom JSON súbore. Žiadny košík sa nezmenil a nevznikla objednávka.
- Kontroly výslovného nákupu a cenovej ponuky so zľavou používajú izolovaný testovací katalóg. Pridanie zachová správne SKU a množstvo; otázka na cenu ponechá košík bezo zmeny.
- Zmeny témy, požiadavka na človeka, neznámy kupón a pokus vnútiť nové obchodné pravidlá majú samostatné kontroly.

HTTP kontrolu možno zopakovať po čistom zostavení cez `node scripts/verify-ai-tomas-discounts.mjs`. Pre živé nasadenie použite `--base-url https://www.tonerymaxim.sk --output /tmp/ai-tomas-discounts-live.json`; skript vykoná 24 otázok bez objednávok a pri obmedzení 429 sa zastaví. Dodržte limit 30 poradenských požiadaviek za 10 minút pre jednu IP.

Výsledky opravy sú overené na lokálnom produkčnom builde. Nasadenie na verejný web je samostatný krok; živá reprodukcia uvedená vyššie zachytáva stav pred opravou. Účet reálneho zákazníka sa neotváral a žiadna správa ani e-mail neboli odoslané.
