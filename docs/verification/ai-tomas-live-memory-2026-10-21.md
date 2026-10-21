# AI Tomáš: živý audit pamäte a zapojenie jazykového modelu

Dátum: 21. 10. 2026. Východiskový commit: `59f55d6`.

Nadväzujúca oprava zliav ku konkrétnemu produktu a diagnostika zlyhaní OpenAI je opísaná v [AI Tomáš: produktové zľavy](ai-tomas-product-discounts.md).

## Výsledok živého testu

Na verejnom webe bolo vykonaných 14 anonymných poradenských požiadaviek v piatich rozhovoroch. Nový štýl odpovedí je nasadený. Obnova hesla s nadväzujúcou otázkou na spam a návrat k registračnej zľave po otázke na dopravu fungovali.

Spoločná cena produktu a dopravy po zmene témy zlyhala pri HP, Brotheri aj Canone. Tomáš našiel konkrétny produkt, odpovedal na dopravu alebo platbu, ale pri následnej otázke bez zopakovania označenia zobrazil iba cenník dopravy. Konkrétne výsledky a odpovede sú v sprievodnom JSON súbore.

| Produkt pri živom teste | Cena 1 ks | Tovar + výdajné miesto/box | Tovar + kuriér |
| --- | ---: | ---: | ---: |
| HP W1420A, SKU 13276 | 18,24 € | 21,14 € | 22,14 € |
| Brother TN-2421, SKU 15048 | 12,96 € | 15,86 € | 16,86 € |
| Canon CRG-055HY žltý, SKU 14023a | 35,46 € | 35,46 € | 35,46 € |

Ide o očakávané výpočty z cien nameraných pri teste, pre 1 ks na Slovensko, platbu vopred a bez ďalších zliav. Nie sú potvrdením budúcej ceny. Pri dobierke sa pripočítava 1,20 €; hranica dopravy zdarma je 29 € po zľavách.

## Implementácia

- Spoločná otázka na cenu tovaru a dopravy sa vráti k správnemu produktu aj po odbočke k doprave či platbe. Samotná otázka na cenník dopravy zostáva servisnou otázkou.
- Výpočet používa aktuálny produkt z e-shopu, existujúce množstevné zľavy a rovnaké možnosti dopravy a platby ako košík. Zahŕňa presné zaokrúhľovanie a hranicu dopravy zdarma až po množstevnej zľave. Kupóny a body sa bez overenia účtu nepredpokladajú; odpoveď tento rozsah uvádza.
- Ak chýba spôsob dopravy, odpoveď ukáže samostatné celkové sumy. Česká republika má iba kuriéra. Nejednoznačný produkt alebo počet kusov vyvolá spresnenie.
- Jazykový model sa používa pred rozhodovaním o súvislostiach rozhovoru. Vracia štruktúrovaný plán: nová téma, pokračovanie, návrat, odkaz na správu, predmet a prípadné množstvo. Model nemôže nastavovať ceny ani schvaľovať nákup.
- Výslovný dnešný OEM/SKU a otvorený detail pri slove „tento“ majú prednosť pred modelovým odkazom. Nákupné príkazy nejdú cez modelový plán; otázka na cenu nemení košík.
- Samostatný archív relácie zachováva kontext aj mimo pôvodných 20 ťahov. Uchováva najviac 512 ťahov a 180 000 znakov; nejde o neobmedzenú pamäť. Ukladá sa v relácii prehliadača a nezdieľa sa medzi zákazníkmi. Model dostáva celý tento uchovaný archív, nie iba poslednú otázku.
- Adresy e-mailu, telefóny, IBAN, čísla kariet a označené citlivé údaje sa pred odoslaním modelu redigujú. Volania používajú `store:false`; pamäť relácie spravuje e-shop. Pri chybe alebo časovom limite modelu zostáva lokálna poradenská vetva.

Použité rozhranie a schéma vychádzajú z oficiálnej dokumentácie [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state) a [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## Overenie a aktivácia

Čisté zostavenie úspešne prešlo 212/212 kritickými kontrolami. `npm run check` skončil bez chýb a upozornení. Zachovaných je 300/300 bežných otázok. Zostavené API prešlo 56 poradenskými požiadavkami cez HTTP: 8 pre cenu s dopravou, 24 pre zmeny kontextu a 24 pre zľavy. Deväť kontrol modelového zapojenia používa výhradne testovú odpoveď API.

Nové kontroly pokrývajú živý scenár, prirodzené formulácie bez OEM, množstvo, zľavu, dobierku, box, Česko, aktuálnu cenu po obnove dát, zmenu produktu, nejednoznačnosť a ochranu košíka. Modelová integrácia má samostatné kontroly s testovou odpoveďou API: odkaz na produkt mimo krátkej histórie, nová servisná téma, chybné modelové výstupy, redakcia údajov, výpadok a neprenášanie starých nákupných príkazov.

`scripts/verify-ai-tomas-delivery.mjs` teraz vykoná 16 poradenských požiadaviek cez skutočné HTTP na zostavený server s izolovanými produktmi, vrátane nadväzujúcich zliav a prípadu CF259X. Pre verejné nasadenie použite `--base-url https://www.tonerymaxim.sk --output /tmp/tm-delivery-live.json`; voľba `--require-model` navyše vyžaduje úspešné volanie a použitie modelového plánu. Skript používa aktuálnu vrátenú cenu produktu a nevytvára objednávky. Rešpektujte limit 30 požiadaviek za 10 minút; pri neúspešnej odpovedi sa skript zastaví.

Jazykový model vyžaduje serverové premenné v Coolify:

```dotenv
OPENAI_ASSISTANT_ENABLED=1
OPENAI_CONTEXT_ENABLED=1
OPENAI_API_KEY=<platný tajný API kľúč iba v Coolify>
```

Zostáva použitý nastavený `OPENAI_MODEL`; voliteľný `OPENAI_CONTEXT_MODEL` môže zvoliť samostatný model pre kontext. Kľúč nepatrí do GitHubu, premennej s prefixom `PUBLIC_` ani do chatu. Po úprave nastavení je potrebný redeploy.

Skutočné platené API nebolo pri implementácii volané: v pracovnom prostredí nie je kľúč. Testová odpoveď API overuje zapojenie, nie kvalitu živého modelu. Nastavenie a funkčnosť kľúča na produkčnom serveri sa bez prístupu do Coolify nepotvrdili. Po nasadení odpoveď uvádza `conversation.aiEnabled` a `conversation.engine`; `engine: model` pri nadväzujúcej otázke potvrdzuje úspešné použitie modelového plánu. Zapnutie príznakov samo osebe nepotvrdzuje platnosť kľúča ani dostupný kredit.
