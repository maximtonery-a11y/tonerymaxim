# Online reklamácie: uloženie a doručovanie

Oprava je obmedzená na obe reklamačné API, ich formuláre a samostatnú frontu reklamácií. Nemení objednávky, ich stavy, ceny, zásoby, dopravu, platobné metódy, GoPay ani všeobecný odosielač e-mailov. Odstúpenie od zmluvy naďalej používa pôvodný postup.

## Spracovanie

1. Verejný formulár overí fakturačný e-mail, číslo objednávky (vrátane TM čísla) a jednoznačný produkt/SKU. Účet overuje vlastníctvo priamo na konkrétnej objednávke, nezávisle od prvých 50 zobrazených objednávok. Reklamovanie staršieho nákupu, ktorý nie je vo Woo, ponúkne kontaktovanie podpory; automatické párovanie sa nevymýšľa.
2. Nové podanie sa najskôr zašifrovane uloží do `TM_PERSISTENT_DATA_DIR/online-claims`. Prijatie používa stabilný identifikátor pokusu a kontrolný odtlačok údajov. Zámok chráni rovnaké podanie medzi požiadavkami aj procesmi.
3. Existujúce WordPress API `/tonerymaxim/v1/reklamacie` sa najskôr prehľadá podľa stabilného čísla prípadu. Tým sa obnoví aj podanie, pri ktorom sa stratila odpoveď na úspešný zápis. Nový zápis vyžaduje platné JSON, `ok: true`, zodpovedajúci obsah, kladné `wp_id` a spätné načítanie rovnakého prípadu.
4. Až po potvrdení uloženia sa odošle potvrdenie zákazníkovi a upozornenie na `info@tonerymaxim.sk`. Obe správy obsahujú rovnaké číslo prípadu a celý obsah podania. Kontaktné údaje a prípadný IBAN sa zachovajú aj v texte prípadu vo Woo. SMTP musí výslovne potvrdiť prijatie konkrétneho príjemcu.
5. Stav každého príjemcu sa ukladá osobitne. Existujúci časovač zákazníckej podpory spúšťa novú frontu samostatne, bez čakania a bez blokovania odstúpení. Neúspešný Woo zápis alebo e-mail sa zopakuje pri ďalšom behu. Už potvrdené e-maily sa pri bežnom opakovaní neposielajú znova.

API rozlišuje `wooSaved`, `emailSent`, `emailPending` a `adminEmailPending`. Formuláre zobrazujú odoslané potvrdenie iba po prijatí správy SMTP serverom. Uložené podanie čakajúce na Woo je viditeľné aj vo vlastnom zákazníckom účte. Starý otvorený formulár bez identifikátora podania dostane pokyn obnoviť stránku pred vytvorením prípadu.

## Overenie a hranica nasadenia

`npm run test:claims` vykonáva integračné testy skutočných serverových modulov so skutočným šifrovaným diskovým úložiskom. Woo a SMTP nahrádzajú izolované testovacie adaptéry, ktoré zakazujú kontaktovanie živých hostiteľov a zápis do objednávok. Pokrýva výpadky a chybné odpovede, spätné načítanie, stratenú odpoveď po zápise, súbežné a opakované podania, vlastníctvo, stav každého e-mailu, nezmenené údaje objednávok, odstúpenie a oddelenie od platobných kľúčov v prehliadači. Kontrola je zaradená do existujúceho predzostavovacieho guardu, ktorý spúšťa aj GitHub workflow.

**Pred nasadením je potrebné overiť kontrakt nasadeného pluginu ToneryMAXIM Reklamácie 1.1.3. Jeho zdroj v repozitári chýba.** Verejná reklamácia používa skutočné `customer_id: 0`, ak objednávka nemá zákaznícky účet. Musí sa overiť, že plugin taký záznam prijíma a vracia popísané identifikátory a polia. Test pokrýva aj odmietnutie hosťa: podanie zostane vo fronte, `wooSaved` je `false` a systém neodošle falošné potvrdenie. Tento test nepreukazuje, že nasadená verzia hosťa podporuje. Vetvu dovtedy nezlučovať do produkčnej `main`.

Overenie na skutočnej službe musí používať určené testovacie podanie a schránky. Izolované testy nepreukazujú skutočné doručenie e-mailov. Aktuálna zmena neposiela živé správy ani nevytvára produkčné reklamácie.

## Nasadenie a návrat

Pred nasadením musí byť existujúce `TM_PERSISTENT_DATA_DIR` na trvalom zväzku a dostupný existujúci `TM_PERSISTENCE_SECRET`/`AUTH_SECRET`. Nepridávajú sa závislosti, nové prístupy ani tajné premenné. Služba musí používať existujúci samostatný Node server a mať zapnuté bežné časovače podpory.

Návrat na predchádzajúci commit nemení Woo objednávky ani reklamácie. Adresár `online-claims` pri návrate nemažte: uchováva čakajúce podania a stav doručenia. Staršia verzia ho nespracuje; po opätovnom nasadení opravy môže fronta pokračovať. Staré súbory v `customer-care` sa hromadne nemigrujú ani nemenia.
