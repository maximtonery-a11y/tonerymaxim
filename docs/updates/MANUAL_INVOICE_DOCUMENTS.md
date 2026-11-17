# Ručné faktúry v zákazníckom účte

## Použitie

1. Vo Woo otvoriť **TM zákazníci → Faktúry**, vyhľadať objednávku podľa celého TM čísla, Woo ID alebo fakturačného e-mailu a zvoliť **Spravovať faktúry**. Rovnaký odkaz je aj v detaile TM objednávky a v štandardnom detaile Woo objednávky.
2. Vyplniť číslo, dátum vystavenia a typ dokladu. Priložiť existujúcu PDF faktúru (max. 8 MiB), voliteľne XML e-faktúru (max. 2 MiB), potom uložiť.
3. Registrovaný vlastník objednávky nájde doklad vo svojom účte v položke **Faktúry** aj cez odkaz pri objednávke. Pri hosťovskej objednávke zostáva dokument v administrácii; samotná zhoda e-mailu prístup neudelí.

Funkcia faktúry nevystavuje ani nečísluje. PDF a prípadné XML pochádzajú z účtovného programu. XML sa rozpoznáva podľa koreňa a menného priestoru UBL Invoice/CreditNote alebo CII; neprebieha úplná kontrola schémy, daňových náležitostí ani prenos cez Peppol.

Omylom priložený dokument možno **Skryť zákazníkovi** a neskôr znovu zobraziť. Oprava rovnakého čísla vyžaduje najskôr skryť pôvodnú verziu. Pôvodné súbory zostávajú v archíve; aktívna môže byť len jedna verzia rovnakého typu a čísla pri objednávke. Opakované uloženie totožných súborov nevytvorí druhú kópiu.

## Ochrana a rozsah

- Nahratie ani zmena viditeľnosti neukladá Woo objednávku, nemení jej stav, dopravu, platbu, sklad ani sumy a neposiela e-mail.
- Nahráva a spravuje iba používateľ s `manage_woocommerce`; zápisy vyžadujú POST a kontrolovaný nonce. Úložisko nie je verejná knižnica médií.
- Každé zákaznícke čítanie overuje podpísanú Astro session, vlastníka pri nahratí aj aktuálneho vlastníka Woo objednávky. Klientom dodané `customer_id` nikdy nenahradí session.
- Súbory sú šifrované AES-256-GCM. Názvy sú interné UUID, obsah je kontrolovaný podľa veľkosti a SHA-256, odpovede zakazujú cache a indexáciu. Woo REST je dostupný iba správcovi cez existujúcu serverovú autentifikáciu; zákazník nedostáva Woo prihlasovacie údaje ani verejnú adresu súboru.
- Samostatné stránkovanie faktúr po 20 dokladoch pokrýva aj staršie objednávky mimo existujúceho zoznamu posledných 50 objednávok.

## Nasadenie a záloha

Najskôr aktualizovať existujúci plugin **ToneryMaxim – Customer Administration** na 6.2.0 s oboma PHP súbormi, následne nasadiť Astro z tohto commitu. Staršia verzia Astro môže počas aktualizácie pluginu normálne fungovať.

Spoločne zálohovať databázu WordPress (vrátane privátnych záznamov `tm_invoice_document` a voľby `tm_invoice_storage_key_v1`) a priečinok `wp-content/uploads/tm-private-invoices`. Bez šifrovacieho kľúča z databázy sa súbory nedajú obnoviť. Kľúč nie je odvodený od WordPress salts a ich rotácia archív neznefunkční. Samotný ZIP pluginu faktúry ani kľúč neobsahuje.

Pri návrate na staršiu verziu najskôr vrátiť Astro a potom plugin. Návrat ani bežná aktualizácia pluginu nemaže archív alebo jeho kľúč; počas návratu zákaznícke sťahovanie nebude dostupné.

## Overenie

`npm run check`, `npm run test:invoices` a `npm run build` (vrátane kritických regresií košíka, pokladne, GoPay, objednávok, reklamácií a katalógu). PHP kontrola syntaxe oboch súborov pluginu, `php scripts/manual-invoices-plugin.test.php` a pôvodné testy e-mailových stavov. Testy používajú izolované údaje a nepíšu do produkčných objednávok ani neposielajú zákaznícke e-maily.
