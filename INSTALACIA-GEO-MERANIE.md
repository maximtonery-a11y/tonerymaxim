# GEO meranie a prioritné stránky

## Nasadenie

Nahraďte alebo pridajte súbory z balíka pri zachovaní adresárovej štruktúry a spustite nový build. Úprava nemení databázu ani URL a nepridáva produktovým stránkam žiadne klientské volanie.

## Čo sa začne merať

- V internej analytike sa AI návštevy naďalej zobrazia ako `AI – ChatGPT`, `AI – Claude`, `AI – Perplexity` a podobne.
- Do GA4 sa pri priamom prekliku z rozpoznanej AI služby odošle udalosť `ai_referral_visit` a parameter `ai_source`.
- V GA4 vytvorte vlastnú dimenziu udalosti s názvom `AI zdroj` a parametrom `ai_source`, aby sa zdroje dali jednoducho porovnávať v reportoch.

Google AI odpovede nemusia odovzdať rozpoznateľný referrer. Také návštevy sa nedajú spoľahlivo oddeliť od bežného Google vyhľadávania a kód ich zámerne neoznačuje odhadom.

## Týždenné meranie odpovedí

1. Otázky berte bez úprav z `data/geo-ai-benchmark.json`.
2. Výsledok každej AI odpovede zapíšte do `data/geo-ai-results.csv`.
3. Spustite `npm run geo:score`.
4. Porovnávajte skóre po týždňoch, podiel zmienok, citácií a počet nesprávnych odporúčaní.

Hodnotenie: prvé odporúčanie 5 bodov, druhé 4, ďalšia zmienka 2, samotná citácia 1, bez zmienky 0 a nesprávny produkt -5.

## Prioritné stránky

Zoznam 20 tlačiarní a 20 OEM rodín je v `src/data/geo-priorities.ts`. Na týchto stránkach sa automaticky zobrazí faktografický blok s počtom produktov, skladom a upozornením na presnú kompatibilitu. Hodnoty sa počítajú z už načítaného katalógu, takže nevzniká ďalší dotaz ani spomalenie.
