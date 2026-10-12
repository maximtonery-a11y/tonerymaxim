# Celé adresy DPD Pickup a DPD Pickup Box v TM objednávkach

Oprava nad aktuálnou vetvou `main`, základ `d63f8d58650b2249ccffa22b6fe168f397c54539`.

## Príčina a výsledok

Aktuálna mapa DPD odovzdáva ulicu, mesto, PSČ a krajinu vo vnorenom objekte
`location.address`. Pôvodný parser čítal len vrchné polia. Serverová validácia
následne zahodila `raw_result`, takže vo Woo zostal názov a ID miesta bez adresy.

Spoločný parser teraz spracúva aktuálny DPD objekt, starší plochý formát aj
uložený `pickupPointResult`. Obnovuje aj neúplný výber v localStorage. Nové
objednávky ukladajú celú adresu do JSON metadát, samostatných polí používaných
TM administráciou, názvu dopravy a objednávkového snapshotu.

Polia boli porovnané so zdrojom `pickup_data()` v dodanom module
`tonerymaxim-customer-administration-v6.0.3`. Existujúci modul WordPressu
číta tieto polia; na túto opravu netreba meniť ani inštalovať WordPress plugin.

## Existujúce objednávky po redeploy

Jednorazová migrácia sa naplánuje po prvej bežnej návšteve e-shopu a začne
po 120 sekundách. Postupne číta strany po 25 objednávkach vytvorených od
1. júna 2026. Medzi stranami necháva päťsekundovú prestávku. Stav ukladá
do existujúceho zabezpečeného dátového adresára; po dokončení sa zastaví.
Rešpektuje `TM_DISABLE_BACKGROUND_WORKERS=1` a vyžaduje existujúce Woo prístupy.

Zápis sa týka iba TM objednávok s dopravou `dpd_pickup` alebo `dpd_box`,
slovenským ID miesta a neúplnou adresou. API DPD musí vrátiť rovnaké ID,
zodpovedajúci názov a úplnú slovenskú adresu. Existujúce neprázdne časti
musia zodpovedať odpovedi DPD. Pred zápisom sa objednávka opätovne načíta;
kompletná alebo medzičasom ručne opravená adresa sa neprepisuje.

Pri existujúcich objednávkach sa zapisuje výlučne `meta_data` adresy. To
doplní kartu „Doprava a výdajné miesto“. Historický názov dopravného riadku
sa neprepisuje: odoslanie `shipping_lines` by podľa Woo REST controlleru
spustilo prepočet daní a súm. Stav, platba, položky, dane, ceny, kupóny,
zákaznícke údaje a markery stavových e-mailov nie sú súčasťou zápisu.

Nedostupné alebo nejednoznačné miesto sa nezapisuje. Dočasná chyba zastaví
aktuálnu stranu a opakuje ju po minúte; už opravené adresy sa preskočia.

## Overenie

| Kontrola | Výsledok |
| --- | --- |
| `npm run test:dpd` | 36 testov prešlo |
| Porovnanie s pôvodným kódom | 10 kombinácií dopravy a platby; pôvodná DPD chyba reprodukovaná |
| GLS a kuriérske objednávky | Celé Woo payloady zhodné s pôvodnou verziou |
| Ostatné údaje v DPD objednávkach | Ceny, dane, zľavy, platby, položky a zákaznícke údaje zhodné |
| Migrácia existujúcich objednávok | Overené dve strany, odložený štart, uloženie stavu, ukončenie a zápis iba metadát |
| Pokladňa, GoPay, adresy, bezpečnosť | 48 existujúcich regresných testov prešlo |
| Vyhľadávanie | 41 testov prešlo |
| Woo katalóg s testovacím API | 2 testy prešli |
| Model presmerovaní | 7 testov prešlo; nejde o overenie živých URL |
| `npm run check` | 0 chýb, 0 warnings, 23 existujúcich hints |
| `npm run build` | Produkčný build úspešný |

`npm test` sa zastavil na dvoch testoch, ktoré vyžadujú produkčné Woo
prístupy a `.tm-cache/products.json`. Rovnaké dve chyby boli reprodukované
na pôvodnom commite. Samostatná SEO sada mala 61 úspešných testov a tri
zlyhania z dôvodu chýbajúceho produkčného katalógu. Celý produkčný katalóg,
živé platby a výsledný detail vo WordPresse preto nie sú týmto reportom
označené za overené.

DPD ID `SK20276` z nahláseného prípadu bolo načítané zo skutočného API DPD.
Vrátená adresa: `SVÄTOPLUKOVA 1A, 903 01 SENEC, SK`. Regresný test používa
tento verejný údaj a pôvodný chýbajúci formát adresy; reálna zákaznícka
objednávka nebola pri testovaní vytvorená ani upravená.

Po redeploy otvoriť e-shop, nechať migráciu prebehnúť a obnoviť detail
príslušnej DPD objednávky v TM administrácii. Nový DPD výber musí obsahovať
názov, ulicu s číslom, PSČ, mesto, krajinu a ID miesta.

Zdroje formátu a správania API:
- https://pickup.dpd.cz/integrace/
- https://api.dpd.cz/api/v1/pickup-points/SK20276
- https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/rest-api/Controllers/Version3/class-wc-rest-orders-controller.php
