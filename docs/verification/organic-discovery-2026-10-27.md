# Organické vyhľadávanie: dostupnosť vo feede a zmenené adresy

Dátum kontroly: 27. 10. 2026. Východiskový commit: `0c050af66eb4fd4f743b4bf4f13ae5f32a5ac375`.

## Problém a výsledok opravy

WooCommerce môže uviesť `stock_status=instock` bez počtu kusov. Web taký
produkt správne zobrazuje ako skladom. Merchant a Heureka však pri `null` alebo
prázdnom poli vyhodnotili `Number(...)` ako nulu a produkt vylúčili. AI feed ho
označil ako vypredaný a neznámy počet premenil na nulu. Nečíselný počet mal
opačný problém: feed ho vedel vyhodnotiť ako dostupný, hoci web ho za skladový
nepovažoval.

Všetky tri exporty teraz používajú existujúce `isAvailableNow`, teda rovnaké
pravidlá ako web. AI export pri neznámom počte kusov ponechá hodnotu prázdnu.
Počet takýchto produktov v aktuálnom Woo katalógu nebol vyčíslený; chyba bola
preukázaná reprodukčnými testami.

Pri zmene slugu toho istého produktu IndexNow oznamoval iba novú URL.
Teraz oznámi aj pôvodnú URL, aby ju vyhľadávač mohol znova navštíviť a nájsť
existujúce presmerovanie. Samotné presmerovania sa nemenia. Oznámenie ani
HTTP 200 od IndexNow negarantujú indexáciu.

## Overenie

- 16 nových regresných testov: 6 reprodukovaných zlyhaní pred opravou,
  po oprave 16/16 úspešných.
- 68 cielených kontrol spolu: nová sada, SEO foundation, index cache,
  publication policy a conversion system; 68/68 úspešných.
- `npm run check`: 532 súborov, 0 chýb, 0 warnings, 25 existujúcich hints.
- `npm run build`: 242/242 prednasadzovacích testov a úspešný Astro build.
- IndexNow sa v testoch zachytáva lokálnym mockom. Build prebehol s vypnutým
  IndexNow, background workers a živou AI. Testy neodosielali produkčné
  indexačné požiadavky ani objednávky.
- `git diff --check`: bez chýb.

Úplné `npm run test:seo` malo už na východiskovom stave tri zlyhania
spôsobené chýbajúcou `.tm-cache/products.json`: jedna sada sa nedokázala
načítať a dva testy potrebovali reálny katalóg. Táto kontrola preto nie je
označená ako kompletná ani ako úspešná. Katalóg nebol nahradený vymyslenými
dátami.

## Verejná kontrola webu

Všetkých 12 skontrolovaných adries vrátilo HTTP 200:

- `/`, `/robots.txt`, `/sitemap.xml`, `/sitemap-pages.xml`,
- `/firemna-tlac`, `/poradna`,
- `/tlaciarne/brother/brother-dcp-l2532dw`,
- `/produkt/brother-dr-2401-cierny-kompatibilny-opticky-valec`,
- `/merchant-feed.xml`, `/ai-product-feed.xml`, `/heureka.xml`,
- existujúci verejný overovací súbor IndexNow.

Päť skontrolovaných HTML stránok malo jednu H1, produkčný canonical,
indexovateľné robots meta a syntakticky platné JSON-LD. Ide o vzorku,
nie dôkaz správnosti celého katalógu či oprávnenosti rich results.
Pri troch veľkých feedech sa čítalo iba prvých 700 kB; neprebehla úplná
validácia všetkých položiek. `noindex` na XML feede nie je chyba:
feed slúži na spracovanie príslušnou službou, nie ako výsledok webového hľadania.

## Ďalšie priority auditu

1. Overiť stav indexácie a konkrétne vylúčené URL v Search Console a Bing
   Webmaster Tools. K súkromným dátam týchto účtov táto kontrola nemala prístup.
2. Preveriť finálny názov produktu v Merchant XML. Pri kompatibilných
   kazetách musí zodpovedať pravidlám pre produkty tretích strán; finálny
   formatter dnes vracia značku tlačiarne na začiatok.
3. Preveriť stav renovovaných a iba znovu naplnených kaziet. Merchant XML
   aj Product JSON-LD dnes používajú nový stav paušálne. Google rozlišuje
   `new`, `refurbished` a `used` podľa skutočnej povahy produktu. Presné
   zaradenie, identifikátory a obrázky treba skontrolovať na reálnych produktoch.
4. Pri prioritných modeloch overiť kompatibilitu, región kazety, HP+,
   kapacitu, typ spotrebného materiálu a vnútorné odkazy.
5. Zmerať mobilné Core Web Vitals a serverové časy z relevantnej lokality.
   Čas jedného externého HTTP požiadavku nie je LCP ani mobilný benchmark.

Oficiálne podklady:

- https://developers.google.com/search/docs/appearance/ai-features
- https://developers.openai.com/api/docs/bots
- https://www.indexnow.org/documentation
- https://support.google.com/merchants/answer/7558050?hl=sk
- https://support.google.com/merchants/answer/6324469?hl=sk

## Nasadenie

Táto vetva je návrh na kontrolu; nebola zlúčená do main ani nasadená.
Pred zlúčením doplniť reálny lokálny katalóg a dokončiť `npm run test:seo`.
Po nasadení znovu skontrolovať tri exporty a bežný produktový detail.
Výsledok IndexNow skontrolovať po najbližšom riadnom produktovom synchrone;
nie je potrebné kvôli overeniu vyvolávať kompletný import.
