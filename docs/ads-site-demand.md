# Súhrnný dopyt podľa produktov

Samostatný proces sa spúšťa príkazom `npm run worker:ads:demand` v samostatnej službe so zdieľaným úložiskom e-shopu, rovnakým kľúčom pre existujúce analytické záznamy a produkčným nastavením prostredia. Proces nemá oprávnenia v reklamných účtoch. Režim `--once` spracuje jeden stav. Webová aplikácia proces nespúšťa.

Proces každých päť sekúnd skontroluje zmenu uloženého katalógu a analytického súboru. Dostupnosť výsledku ovplyvňuje zápis udalosti na server a aktualizácia produktovej cache. Pri zmene katalógu porovná cenu a sklad všetkých kompatibilných produktov a renovovaných PFI. Prvé načítanie založí základ pre porovnanie. Zmeny vydrží reštart v súbore `ads-intelligence/offer-baseline.json`; prehľad zmien pokrýva poslednú hodinu. Cena chýbajúca v zdroji má hodnotu null.

Udalosti za poslednú hodinu sa párujú s kódmi položiek alebo modelmi tlačiarní. Záznam vyhľadávania alebo výsledková stránka predstavuje záujem o rodinu. Návšteva sa pre danú položku započíta raz; jedna rodina môže mať viac vyhovujúcich položiek. Pridanie aspoň štyroch rovnakých kusov vychádza z množstva v položke košíka. Počty pokrývajú zaznamenané návštevy so súhlasom v dostupnej časti interného logu. Objednávky, náklady a atribúciu reklamy treba zosúladiť s ich vlastnými zdrojmi.

Autorizovaný GET na `/api/admin/ads-site-demand` prijíma administrátorský kľúč v hlavičke `x-admin-key`. Súhrn obsahuje iba produktové údaje a počty. Pri nedostupnom logu môže vrátiť stav `partial` s údajmi o zmenách ponúk. Pri chýbajúcom alebo staršom než dvojminútovom výstupe vráti 503. Rozhodnutia pre platenú reklamu vyžadujú samostatné kontroly stránky, Merchant Centra, marže a schváleného rozsahu.

Súbor pre Merchant dopĺňa atribút `display_ads_id` pri overiteľne jedinečných SKU ponúk pre Shopping. Pred nasadením overte jedinečnosť aj voči prípadným ďalším zdrojom v danom Merchant účte. Po spracovaní treba overiť atribút na strane Merchant aj mieru spárovania v Google Ads.
