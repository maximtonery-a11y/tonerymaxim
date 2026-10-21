# AI Tomáš: prirodzená komunikácia

Dátum: 21. 10. 2026. Východiskový commit: `a011f0e`.

Zákazník má dostať priamu, zrozumiteľnú odpoveď o našej ponuke a ďalšom kroku. Text nemá opisovať interné vyhľadávanie, katalógové dáta ani pravidlá pre AI.

| Situácia | Upravená komunikácia |
| --- | --- |
| Ponuka produktov | „V našej ponuke máme tieto produkty:“ |
| Súhrn ponuky v prehliadači | „Naša ponuka pre …“ a konkrétna dostupnosť produktov. |
| Viac možných produktov | „Ktorý z týchto produktov máte na mysli?“ |
| Chýbajúci produkt | Otázka na presné označenie alebo otvorenie detailu produktu. |
| Chýbajúca hotová sada | „Túto hotovú CMYK sadu momentálne nemáme v ponuke.“ |
| Chýbajúca odpoveď | Stručné priznanie neistoty a kontakt na pomoc, bez opakovania zoznamu všetkých schopností. |
| Individuálna zľava | „Individuálnu zľavu vám nemôžem schváliť.“ a kontakt pre firemný odber. |
| Pomoc človeka | Prirodzené odporúčanie kolegu a vysvetlenie, čo dostane po odoslaní formulára. |

Zmenené sú pevné odpovede servera a poradne, texty produktových ponúk, čakania a pomoci v prehliadači aj pokyny pre voľne tvorené odpovede. Pokyny určujú vykánie, priamu odpoveď na otázku, nadväzovanie na predmet rozhovoru a vynechanie úvodov ako „Overil som aktuálny katalóg“. Zachované je jasné označenie, že Tomáš je AI.

Pri už identifikovanom produkte nasledujúca otázka na cenu, sklad alebo výťažnosť neopakuje celé potvrdzovanie produktu. Zobrazuje názov produktu a príslušnú odpoveď. Pri novom alebo nejasnom produkte zostáva potvrdenie či spresnenie. Nevyriešená produktová otázka sa v súčasných reláciách obnovuje z uloženého stavu; jej pokračovanie už nezávisí od pôvodného znenia textu spresnenia. Staršie relácie podporujú pôvodné aj nové formulácie.

## Overenie

- `npm run check`: 0 chýb a 0 upozornení.
- Čistý `npm run build`: úspešný; 192/192 kritických kontrol vydania vrátane produktového kontextu, rozhovorov, košíka a dispečera prehliadača.
- 300 bežných otázok: správne smerovanie, podmienky a odkazy.
- 48/48 požiadaviek cez skutočné HTTP na produkčný build: 24 v kontextových rozhovoroch a 24 pre zľavy.
- Sedem existujúcich kontrol neznámych otázok a nepovolenej zľavy: správne odmietnutie bez vymyslených produktov alebo kupónu.
- Tri existujúce kontroly súhrnu ponuky a hotových sád: zachované odlíšenie objednateľnosti od skladu a samostatné zobrazenie farieb.

Kontroly používali lokálny produkčný build a izolované produktové dáta. Odpovede externého generatívneho modelu neboli volané; pre túto vetvu boli upravené pokyny. Verejný web vyžaduje nasadenie nového commitu. Neodoslala sa reálna objednávka, kontaktný formulár ani e-mail.
