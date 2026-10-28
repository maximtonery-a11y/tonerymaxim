# Dostupnosť v potvrdení a vlastné TM e-mailové šablóny

Verzia Woo pluginu 6.1.1 pridáva vlastné šablóny aj priamo do pôvodného výberu
„Stav a e-mail“ v detaile a zozname TM objednávok. Sú v skupine „Vlastné e-mailové
šablóny – bez zmeny stavu“ a ich výber zaradí správu do už existujúcej Astro fronty.
Skutočný stav objednávky zostáva zachovaný. Pre tento doplnok stačí aktualizovať
Woo plugin; Astro 6.1.0 integrácia z commitu `d9523b2` už poskytuje potrebnú frontu.

Správanie výberu, zachovanie stavu, blokovanie druhej čakajúcej správy a oprávnenia
overuje aj `php scripts/tm-email-template-options.test.php`.

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

Woo plugin `ToneryMaxim – Customer Administration` 6.1.0 pridáva:

- TM zákazníci → E-mailové šablóny → Pridať novú šablónu: názov, predmet a text.
- Úpravu vlastných aj pôvodných šablón, zachovanie uložených textov.
- TM zákazníci → TM objednávky → Detail → Odoslať správu zo šablóny.
- Samostatnú požiadavku na e-mail bez zmeny stavu objednávky. Kým čaká na odoslanie,
  tlačidlo neumožňuje zaradiť druhú správu do rovnakého miesta.
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
3. Vytvoriť šablónu vo Woo a overiť, že je vo výbere v detaile TM objednávky.

Cielené offline testy (Node.js 24):

```sh
node --experimental-vm-modules --experimental-strip-types --test scripts/order-email-availability.test.ts
```

Testy používajú skutočné serverové moduly s izolovanými Woo/SMTP adaptérmi.
Nevytvárajú objednávky a neodosielajú reálne e-maily.
