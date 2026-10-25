# HP LaserJet M1132: rozdelené názvy tlačiarne

Overenie: 25. 10. 2026. Zdrojová generácia živého katalógu: `2026-10-25T05:07:41.749Z`.

## Reprodukcia pred opravou

| Adresa na tonerymaxim.sk | Výsledok pri priamom HTTP overení |
| --- | --- |
| `/tlaciarne/hp/hp-laserjet-m1132` | HTTP 404; ide o odkaz z úvodnej stránky |
| `/tlaciarne/hp/hp-laserjet-pro-m1132` | HTTP 200, iba pôvodné dvojbalenie CE285AD, ID 38130 |
| `/tlaciarne/hp/hp-laserjet-pro-mfp-m1132` | HTTP 200, štyri ďalšie produkty |

Bežné produktové vyhľadávanie M1132 už správne našlo päť štandardných produktov. Problém bol v doslovnom indexe modelových stránok a návrhoch tlačiarní. Produkty CE285A/CE285X mali model `HP LaserJet Pro MFP M1132`; samostatný OEM CE285AD mal model `HP LaserJet Pro M1132`. Pôvodný názov bez Pro/MFP už nebol priradený žiadnemu produktu.

## Výsledné správanie

Pri HP LaserJet sa marketingové slová Pro/MFP a ich poradie nepoužívajú na rozdelenie tej istej úplnej modelovej identity. Číslo a všetky koncovky zostávajú súčasťou identity: M1132s nie je M1132 a M110we nie je M110w. Toto pravidlo nedopĺňa žiadnu novú fyzickú kompatibilitu do Woo.

Existujúce adresy zostávajú použiteľné. Každá z troch adries v tabuľke zobrazí všetkých päť štandardných položiek a návrhy tlačiarní spoja existujúce názvy do jednej položky. Úplný SEO index aj priame vyhľadanie jedného modelu vracajú rovnakú ponuku.

ID overených položiek: 37594, 43964, 38130, 38139, 38754. Obsahujú dva kompatibilné, dva originálne a jeden renovovaný produkt. Obe originálne SKU zostávajú samostatnými produktmi.

## Validácia

- Nová regresná sada reprodukovala päť zlyhaní pôvodnej implementácie; po oprave prechádza všetkých sedem testov.
- Kritický `scripts/release-guard.mjs`: 242/242 kontrol prešlo; nová sada je zaradená aj do tejto kontroly a do `test:performance`.
- `npm run check`: 531 súborov, 0 chýb, 0 upozornení, 25 existujúcich tipov.
- `npm run build`: úspešné produkčné zostavenie vrátane povinnej predbežnej kontroly.
- Produkčný HTTP test s dnešnými piatimi verejnými produktmi: všetky tri modelové adresy HTTP 200, všetkých päť produktových odkazov prítomných v HTML. Tri varianty dotazu na `/api/printers` vracajú jednu presnú skupinu s počtom 5.
- Overená je aj cesta, keď sa úplný SEO index zostaví pred otvorením modelovej stránky, a opakované použitie cache.

Doplnková integračná sada `ai-search-parity.test.ts` sa v samostatnom čistom checkout nedokončila pri piatich kontrolách závislých od úplného lokálneho katalógu/Woo prístupov. Tieto kontroly nie sú zahrnuté medzi úspešné kontroly a neboli obchádzané. Nejde o vykonaný import do Woo ani o overenie nasadenia na živom webe.
