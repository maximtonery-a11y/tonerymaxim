# Dostupnosť v potvrdení a vlastné TM e-mailové šablóny

Verzia Woo pluginu 6.1.2 prepája každú vlastnú šablónu so skutočným stavom
objednávky s rovnakým názvom. Prepnutie do stavu uloží tento stav do Woo a zaradí
príslušný e-mail do existujúcej Astro fronty. Všetky už vytvorené šablóny sa
automaticky sprístupnia ako stavy; identifikátory ani texty sa nemenia.
Samostatný formulár na odoslanie šablóny bez zmeny stavu bol odstránený.

Stavy sú registrované cez WordPress a `wc_order_statuses`, teda sú dostupné aj
vo Woo editore, filtroch, plnom TM editore a REST API. Odoslanie nadväzuje na
`woocommerce_order_status_changed`, nie len na jedno tlačidlo v TM administrácii.
Rýchle zmeny stavov sa uchovajú vo fronte a neprepíšu predchádzajúcu čakajúcu
správu. Po potvrdení odoslania cez Woo REST sa uvoľní ďalšia správa.

Stačí aktualizovať Woo plugin. Astro integrácia z commitu `d9523b2` už vie
odosielať požiadavky týchto stavov; nový Astro redeploy nie je potrebný.
Registráciu, skutočnú zmenu stavu, tvorbu a úpravu šablón, nadväzujúce e-maily,
frontu a oprávnenia overuje `php scripts/tm-email-template-options.test.php`.

Potvrdenie novej objednávky vytvára Astro v `src/lib/mail.ts`. Woo plugin
Customer Administration spravuje texty správ pri zmene stavu objednávky.
Odosielanie zostáva v Astro cez existujúce SMTP nastavenie ToneryMAXIM.sk.

## Dostupnosť pri objednaní

- Bezpečné overenie košíka načíta aj živý `stock_status` a `stock_quantity`.
- Pre každý riadok uloží dostupné a doobjednávané množstvo pred vytvorením Woo objednávky.
- Snapshot sa zachová v podpísanej fronte, `tm_order_snapshot` a meta údajoch položky
  `tm_availability` / `tm_availability_text`.
- Zákaznícke potvrdenie aj kópia prevádzke zobrazujú dostupnosť pod SKU v HTML aj texte.
- Pri doobjednaní sa uvádza existujúca lehota 3–10 pracovných dní a spoločné odoslanie
  po skompletizovaní. Staré objednávky bez snapshotu dostanú text „Dostupnosť vám potvrdíme“.

## Vlastné šablóny

Woo plugin `ToneryMaxim – Customer Administration` 6.1.2 poskytuje:

- TM zákazníci → E-mailové šablóny → Pridať novú šablónu: názov, predmet a text.
- Úpravu vlastných aj pôvodných šablón a názvov vlastných stavov pri zachovaní ID.
- TM zákazníci → TM objednávky → Detail → Stav a e-mail.
- Skutočný stav objednávky podľa vybranej šablóny, vrátane následného e-mailu.
- Zobrazenie čakajúcej/odoslanej správy a prípadnej chyby.

Astro fronta sleduje objednávky podľa poslednej úpravy, aby zachytila požiadavku aj
pri staršej objednávke. Správa má UUID, claim a marker odoslania; opakovaný scan ju
znova neposiela. Požiadavka uchová vybraný text, aj keď sa šablóna neskôr upraví.
Názvy ani texty šablón sa neposielajú z Woo `wp_mail()`.

Podporovaná premenná je `{order_number}`. V texte fungujú nové riadky a `**tučné
zvýraznenie**`; vložené HTML sa escapuje.

## Nasadenie a overenie

1. Nasadiť Astro commit do Coolify.
2. Aktualizovať existujúci Woo plugin súborom z
   `wordpress-plugin/tonerymaxim-customer-administration/tonerymaxim-customer-administration.php`.
   Nainštalované nastavenia a šablóny sa nevymazávajú.
3. Vytvoriť šablónu vo Woo a overiť nový stav v detaile, zozname a Woo editore.

Cielené offline testy (Node.js 24):

```sh
node --experimental-vm-modules --experimental-strip-types --test scripts/order-email-availability.test.ts
```

Testy používajú skutočné serverové moduly s izolovanými Woo/SMTP adaptérmi.
Nevytvárajú objednávky a neodosielajú reálne e-maily.
