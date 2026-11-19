# Stabilita a odozva spodného menu účtu — 19. 11. 2026

Východiskom je `9d4d974` z hlavnej vetvy vrátane opravy rýchlosti košíka a objednávok. Táto zmena sa týka navigácie účtu; zákaznícke dáta a nákupné API neupravuje.

## Oprava

- Malý samostatný skript menu je priamo v HTML a aktivuje ovládanie pri parsovaní. Už nečaká na stiahnutie a spustenie spoločného balíka účtu či poradcu.
- Lišta je mimo obsahového obalu stránky, má samostatnú vykresľovaciu vrstvu, pevnú výšku 74 px plus bezpečné spodné odsadenie a päť stabilných plôch vysokých 58 px. Zvýraznenie nemení rozmery písma ani tlačidiel.
- Tlačidlá používajú `touch-action: manipulation`, prijímajú dotyk na celej ploche vrátane ikon a textu a majú okamžitú odozvu stlačenia. Prepnutie na inú sekciu ukáže zvýraznenie, kým prebehne pôvodná navigácia prehliadača.
- Opakované ťuknutie na aktuálnu adresu neobnovuje stránku. Modifikované kliknutia zostávajú dostupné; návrat cez históriu odstráni staré zvýraznenie prebiehajúcej navigácie.
- Zatvorenie menu obnoví fokus pomocou `preventScroll` a zachová pôvodné miesto na stránke. Escape, kliknutie mimo okna a prechod na počítačové rozloženie ostávajú funkčné.
- Odstránilo sa automatické prednačítavanie štyroch účtových stránok naraz. Nové ovládanie menu samo nevykonáva HTTP požiadavky ani zápisy do zákazníckeho úložiska.

## Overenie

- Kontrola Astro: 600 súborov, 0 chýb, 0 varovaní, 22 existujúcich informatívnych hintov.
- `npm run test:toner-care`: 22/22 úspešných testov vrátane siedmich testov ovládania menu. Overujú aj zachovanie dát, okamžité nastavenie odozvy, opakovaný dotyk, modifikované kliknutie, návrat z histórie a obnovenie posunu stránky.
- Produkčné zostavenie prešlo. Povinný release guard: 415 testov, 406 úspešných, 9 preskočených, 0 zlyhaní.
- Skúška zostaveného strážcu a API s oddelenými údajmi zákazníka prešla. Náhľad zostaveného účtu spustil aj HTTP kontroly 61 skúšobných objednávok na štyroch stranách, faktúr, opakovaného nákupu a oprávnení.
- Interakcie v prehliadači nad skutočne zostaveným účtom: otvorenie oboch menu, zatvorenie tlačidlom aj Escape, posúvanie dlhej stránky, prechod Prehľad → Objednávky → Tlačiarne a späť, opakovaný výber aktuálnej sekcie.
- Pri posune stránky z 0 na 1 872 px zostala lišta pri výške okna 800 px na súradniciach 726–800 px. Otvorenie a zatvorenie menu zachovalo posun 1 872 px.
- Pri šírke 320 px a výške 640 px mala lišta výšku 74 px a spodnú hranu 640 px; všetkých päť plôch sa zmestilo a zachytávalo vstup. To isté platilo pri šírke 768 px a výške 900 px. Pri šírke 390 px boli overené aj body pri rohoch, ikone a texte všetkých piatich tlačidiel.
- Pri šírke 1 280 px sa spodná lišta skryla a zostalo pôvodné bočné menu.

Prehliadačová skúška používa oddelené údaje a rámce s rozmermi mobilu/tabletu. Nepredstiera skúšku na fyzickom Android telefóne ani meranie správania jeho adresového panela. Dĺžka serverového načítania obsahu inej sekcie sa touto opravou nezamieňa s okamžitou odozvou ovládania.
