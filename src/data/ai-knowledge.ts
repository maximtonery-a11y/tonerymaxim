export type AiKnowledgeItem = {
  id: string;
  intent: string;
  title: string;
  triggers: string[];
  answer: string[];
  priority?: number;
};

export const AI_CONTACT_FALLBACK = [
  'Mrzí ma, ale momentálne vám neviem správne pomôcť s vaším problémom.',
  'Kontaktujte nás počas pracovných dní od 9:00 do 15:00 na telefónnom čísle +421 917 859 206 alebo e-mailom na info@tonerymaxim.sk. Radi vám poradíme.',
];

export const aiKnowledge: AiKnowledgeItem[] = [
  {
    id: 'expedicia-kedy-posleme', intent: 'order', title: 'Kedy odošleme objednávku', priority: 120,
    triggers: ['kedy mi poslete objednavku', 'kedy odoslete objednavku', 'kedy bude odoslana objednavka', 'kedy posielate balik', 'kedy expedujete', 'objednavka odoslanie', 'odoslanie objednavky', 'kedy mi pride objednavka', 'kedy mi pride balik', 'dorucenie objednavky', 'ako rychlo dorucujete', 'rychlost dorucenia'],
    answer: [
      'Tovar označený „Skladom“ objednaný v pracovný deň do 15:00 spravidla expedujeme v ten istý pracovný deň. Po 15:00, cez víkend alebo sviatok ho spravidla expedujeme najbližší pracovný deň. Pri platbe prevodom začína príprava po pripísaní úhrady.',
      'Doručenie kuriérom alebo do výdajného miesta býva spravidla 1–2 pracovné dni od odoslania zásielky.',
      'Ak potrebujete overiť konkrétnu objednávku, AI Tomáš k jej stavu nemá prístup. Použite tracking od dopravcu alebo nás kontaktujte na info@tonerymaxim.sk; číslo objednávky neposielajte do AI chatu.',
    ],
  },
  {
    id: 'doprava-ceny', intent: 'shipping', title: 'Cena dopravy', priority: 120,
    triggers: ['kolko stoji doprava', 'cena dopravy', 'postovne', 'dopravne', 'kolko stoji kurier', 'doprava zadarmo', 'od kolko je doprava zdarma', 'doprava cena', 'doprava', 'doprava pri', 'objednavka doprava', 'nakup doprava', 'mam nakup presne 29 eur', 'kosik po zlave', 'dobierka sa rata do 29', 'balik na adresu'],
    answer: [
      'Doprava kuriérom GLS alebo DPD stojí 3,90 € s DPH.',
      'GLS Balíkomat / ParcelShop stojí 2,90 € s DPH. DPD Pickup alebo DPD Pickup Box stojí 2,90 € s DPH.',
      'Doprava je zdarma, ak hodnota tovaru s DPH po všetkých zľavách dosiahne aspoň 29 €. Doplatok za dobierku sa do tejto hranice nepočíta.',
    ],
  },
  {
    id: 'doprava-dopravcovia', intent: 'shipping', title: 'Dopravcovia', priority: 110,
    triggers: ['aku dopravu pouzivate', 'cim posielate', 'cim posielate balik', 'cim posielate baliky', 'aky kurier', 'dopravcovia', 'gls', 'dpd', 'balikomat', 'parcelshop', 'pickup', 'dpd box', 'box', 'do boxu', 'balik do boxu', 'vyzdajne miesto', 'kurier', 'poslete domov', 'poslat domov', 'dorucit domov'],
    answer: [
      'Používame dopravu cez GLS a DPD.',
      'Vybrať si môžete kuriéra na adresu, GLS Balíkomat / ParcelShop alebo DPD Pickup / DPD Pickup Box podľa dostupnosti v pokladni.',
      'Presnú cenu a dostupné možnosti uvidíte vždy v košíku a v pokladni pred odoslaním objednávky.',
    ],
  },
  {
    id: 'platba-moznosti', intent: 'payment', title: 'Možnosti platby', priority: 100,
    triggers: ['ako mozem zaplatit', 'chcem platit', 'chcem platit dobierkou', 'moznosti platby', 'platba', 'kartou', 'gopay', 'dobierka', 'prevodom', 'bankovy prevod', 'kolko stoji prevod', 'faktura'],
    answer: [
      'Objednávku môžete zaplatiť online cez GoPay, dobierkou alebo bankovým prevodom podľa možností v pokladni.',
      'Platba online GoPay je bez poplatku. Bankový prevod vopred je bez poplatku. Dobierka je 1,20 € s DPH.',
      'Pre školy, obce, mestá, štátne organizácie a firmy môže byť dostupná aj platba prevodom.',
    ],
  },
  {
    id: 'faktura-firma', intent: 'payment', title: 'Faktúra a firemný nákup', priority: 90,
    triggers: ['faktura', 'fakturu', 'na firmu', 'ico', 'dic', 'ic dph', 'platca dph', 'som platca dph', 'firma', 'organizacia', 'skola', 'obec', 'mesto'],
    answer: [
      'Pri objednávke môžete zadať fakturačné údaje firmy alebo organizácie.',
      'Ak nakupujete ako firma, škola, obec, mesto alebo organizácia, vyplňte IČO, DIČ alebo IČ DPH v pokladni.',
      'Ak potrebujete pomoc s fakturáciou, napíšte nám na info@tonerymaxim.sk.',
    ],
  },
  {
    id: 'reklamacia-postup', intent: 'claim', title: 'Ako postupovať pri reklamácii', priority: 120,
    triggers: ['reklamacia', 'reklamovat', 'reklamujem', 'ako reklamujem', 'chcem reklamovat', 'toner nefunguje', 'chybny toner', 'pokazeny toner', 'nepasuje toner', 'toner nepasuje', 'nesedi toner', 'prisiel zly toner', 'zly toner', 'vymena toneru', 'vratenie tovaru', 'rozbita krabica', 'toner bol poskodeny', 'balik prisiel poskodeny', 'tovar prisiel poskodeny', 'toner netlaci', 'poslali ste mi iny toner', 'kupil som nespravny toner'],
    answer: [
      'Ak toner nepasuje, nefunguje alebo prišiel nesprávny produkt, nepoužívajte ho nasilu a odložte ho do pôvodného obalu.',
      'Napíšte nám na info@tonerymaxim.sk číslo objednávky, názov produktu, model tlačiarne a krátky popis problému. Pomôže aj fotografia toneru, štítku tlačiarne alebo chybového hlásenia.',
      'Tovar neposielajte na dobierku. Reklamácie vybavujeme podľa reklamačných podmienok, najneskôr v zákonnej lehote.',
    ],
  },
  {
    id: 'vratenie-tovaru', intent: 'claim', title: 'Vrátenie alebo výmena tovaru', priority: 95,
    triggers: ['chcem vratit', 'vratenie tovaru', 'odstupenie', 'vymenit toner', 'vymena tovaru', 'objednal som zly', 'zle som objednal', 'kupil som nespravny toner', 'nespravny toner', 'do kolkych dni mozem vratit', 'odstupit od zmluvy', 'vratim to do 14 dni', 'reklamaciu na dobierku', 'kto plati postovne pri vrateni', 'priamy naklad na vratenie'],
    answer: [
      'Ak ste objednali nesprávny toner alebo náplň, najskôr nás kontaktujte na info@tonerymaxim.sk.',
      'Do správy uveďte číslo objednávky, model tlačiarne a produkt, ktorý ste objednali. Pomôžeme overiť správnu náhradu alebo ďalší postup.',
      'Spotrebiteľ môže pri nákupe na diaľku bez uvedenia dôvodu odstúpiť do 14 dní od prevzatia tovaru; tovar potom odošle najneskôr do 14 dní od odstúpenia. Priamy náklad na vrátenie znáša spotrebiteľ, ak sme sa nedohodli inak.',
      'Tovar neposielajte na dobierku a dobre ho zabaľte, aby sa pri preprave nepoškodil.',
    ],
  },
  {
    id: 'vyber-toneru', intent: 'support', title: 'Ako nájsť správny toner', priority: 85,
    triggers: ['ako najdem spravny toner', 'kde najdem oznacenie tonera', 'aky toner potrebujem', 'spravny toner', 'neviem toner', 'co zadat do vyhladavania', 'najst toner', 'model tlaciarne'],
    answer: [
      'Najistejšie je zadať presný model tlačiarne alebo označenie toneru. Príklady: CF283A, CE285A, TN-2421, CRG-054, W1420A alebo Brother DCP-L2532DW.',
      'Model býva uvedený na prednej, zadnej alebo spodnej strane tlačiarne. Nájdete ho aj v počítači v časti Tlačiarne a skenery.',
      'Ak si nie ste istý, napíšte značku a model tlačiarne. Pomôžem vám nájsť správny produkt.',
    ],
  },
  {
    id: 'kompatibilny-original-renovovany', intent: 'compatibility', title: 'Kompatibilný, originálny a renovovaný toner', priority: 100,
    triggers: ['kompatibilny original', 'kompatibilny vs original', 'rozdiel kompatibilny original', 'renovovany toner', 'originalny toner', 'alternativny toner', 'original alebo kompatibilny', 'kompatibilny alebo renovovany', 'co znamena renovovany', 'co je repasovany toner', 'co je alternativa', 'lacnejsi ako original', 'je original lepsi', 'kvalitny kompatibilny'],
    answer: [
      'Originálny toner vyrába výrobca tlačiarne, napríklad HP, Canon alebo Brother. Je najdrahší, ale je to originálna voľba výrobcu.',
      'Kompatibilný toner vyrába iný výrobca pre rovnaký model tlačiarne. Pri bežnej domácej a kancelárskej tlači má zvyčajne najlepší pomer cena/výkon.',
      'Renovovaný toner je repasovaná originálna kazeta, ktorá bola vyčistená, skontrolovaná a znovu naplnená. Je ekologickejšou alternatívou.',
    ],
  },
  {
    id: 'zaruka-kompatibilny', intent: 'compatibility', title: 'Kompatibilný toner a záruka tlačiarne', priority: 70,
    triggers: ['poskodi kompatibilny toner tlaciaren', 'zaruka tlaciarne kompatibilny toner', 'pridem o zaruku', 'pokazi tlaciaren', 'neoriginalny toner zaruka'],
    answer: [
      'Kvalitný kompatibilný toner určený pre správny model tlačiarne by tlačiareň poškodiť nemal.',
      'Dôležité je použiť presne správny typ kazety a pri probléme netlačiť nasilu. Ak si nie ste istý kompatibilitou, napíšte model tlačiarne a toneru.',
    ],
  },
  {
    id: 'tlaci-pasy', intent: 'diagnostic', title: 'Tlačiareň tlačí pásy alebo čiary', priority: 110,
    triggers: ['tlaci pasy', 'pasy na papieri', 'ciary na papieri', 'smuhy', 'flaky', 'bodky na papieri', 'cierne bodky', 'biele pasy', 'cierne strany', 'prazdne strany', 'zle tlaci', 'spinava tlac', 'machule'],
    answer: [
      'Pásy alebo čiary na papieri najčastejšie spôsobuje toner, optický valec, znečistené kontakty alebo fixačná jednotka.',
      'Ak sa pás opakuje pravidelne na rovnakom mieste, často ide o optický valec alebo poškodený toner. Ak sa problém objavil hneď po výmene toneru, najskôr skontrolujte toner.',
      'Napíšte presný model tlačiarne a označenie toneru. Podľa toho viem poradiť, či hľadať toner, optický valec alebo inú časť.',
    ],
  },
  {
    id: 'bledy-vytlacok', intent: 'diagnostic', title: 'Bledá alebo slabá tlač', priority: 90,
    triggers: ['bledy vytlacok', 'bleda tlac', 'tlac je bleda', 'slabo tlaci', 'bledy toner', 'svetla tlac', 'slaba tlac', 'farba je slaba', 'neuplna tlac', 'vynechava tlac'],
    answer: [
      'Bledá tlač môže znamenať dochádzajúci toner, zle rozložený tonerový prášok, úsporný režim tlače alebo problém s valcom.',
      'Skúste toner vybrať a jemne ho pretrepať vodorovne zo strany na stranu. Skontrolujte aj nastavenie kvality tlače v ovládači.',
      'Ak sa kvalita nezlepší, napíšte model tlačiarne a nájdem správny toner alebo valec.',
    ],
  },
  {
    id: 'sype-toner', intent: 'diagnostic', title: 'Sype sa toner', priority: 100,
    triggers: ['sype sa toner', 'toner sa sype', 'vysypal sa toner', 'prasi toner', 'tonerovy prasok', 'rozsypany toner'],
    answer: [
      'Toner, ktorý sa sype, ďalej nepoužívajte. Opatrne ho vyberte a vložte do sáčku alebo pôvodného obalu.',
      'Nevysávajte tonerový prášok bežným vysávačom. Môže ísť o poškodenú kazetu, tesnenie alebo nesprávne vložený toner.',
      'Ak je toner nový, kontaktujte nás kvôli reklamácii alebo výmene.',
    ],
  },
  {
    id: 'tlaciaren-nepozna-toner', intent: 'diagnostic', title: 'Tlačiareň nerozpozná toner', priority: 90,
    triggers: ['tlaciaren nepozna toner', 'nerozpozna toner', 'chyba kazety', 'replace toner', 'no toner', 'toner error', 'cartridge error', 'po vymene tonera netlaci', 'chip', 'cip', 'firmware', 'toner s cipom', 'bez cipu'],
    answer: [
      'Skontrolujte, či sú odstránené všetky ochranné pásky a krytky a či je toner správne zacvaknutý.',
      'Pri niektorých modeloch môže problém súvisieť s čipom alebo aktualizáciou firmvéru tlačiarne.',
      'Napíšte presný model tlačiarne a označenie toneru. Overím, či potrebujete verziu s čipom alebo inú náplň.',
    ],
  },
  {
    id: 'toner-atrament', intent: 'support', title: 'Toner alebo atramentová náplň', priority: 70,
    triggers: ['toner alebo atrament', 'laser atrament', 'atramentova napln', 'napln do tlaciarne', 'cartridge', 'inkjet'],
    answer: [
      'Laserové tlačiarne používajú toner. Atramentové tlačiarne používajú atramentové náplne.',
      'Ak neviete, aký typ máte, napíšte model tlačiarne. Podľa modelu vyberiem správnu náplň.',
    ],
  },
  {
    id: 'kontakt', intent: 'contact', title: 'Kontakt na ToneryMaxim', priority: 100,
    triggers: ['kontakt', 'telefon', 'mail', 'email', 'pracovna doba', 'kedy vam mozem volat', 'cislo', 'pracujete v sobotu', 'volam vecer', 'otvorene v sobotu'],
    answer: [
      'Kontaktovať nás môžete počas pracovných dní od 9:00 do 15:00.',
      'Telefón: +421 917 859 206. E-mail: info@tonerymaxim.sk.',
    ],
  },
  {
    id: 'ucet-heslo', intent: 'account', title: 'Účet a zabudnuté heslo', priority: 85,
    triggers: ['zabudol som heslo', 'zabudnute heslo', 'obnovit heslo', 'obnovim heslo', 'neviem sa prihlasit', 'ucet', 'registracia', 'prihlasenie', 'obnova hesla', 'chcem sa zaregistrovat'],
    answer: [
      'Ak ste zabudli heslo, použite stránku Zabudnuté heslo a zadajte e-mail použitý pri registrácii.',
      'Ak e-mail nepríde, skontrolujte spam alebo nás kontaktujte na info@tonerymaxim.sk.',
    ],
  },
  {
    id: 'registracia-zlava', intent: 'loyalty', title: 'Registrácia a uvítacia zľava', priority: 115,
    triggers: ['5 % zlavu', '5% zlavu', 'musim mat ucet', 'co dostanem za registraciu', 'co mam z registracie', 'registraciu', 'zlava za registraciu', 'zlava po registracii', 'vyhody registracie', 'aka je vyhoda registracie', 'kolko plati 5 percent zlava', 'kombinovat 5 a 7 percent', 'nakup bez registracie', 'musim sa registrovat', 'bez registracie'],
    answer: [
      'Nakúpiť môžete aj bez registrácie.',
      'Po vytvorení nového zákazníckeho účtu získate uvítaciu zľavu 5 % na prvý nákup. Zľava platí 1 mesiac od registrácie.',
      'Registrovaný zákazník má navyše prístup k vernostným bodom, odmenám a histórii účtu.',
    ],
  },
  {
    id: 'vernost-body', intent: 'loyalty', title: 'Vernostné body', priority: 120,
    triggers: ['vernostne body', 'vernostny program', 'kolko bodov', 'body za nakup', '1 bod', '100 bodov', 'hodnota bodov'],
    answer: [
      'Za každé minuté 1 € z dokončenej objednávky získate 1 vernostný bod.',
      '100 bodov má hodnotu 1 € zľavy. Stav bodov vidíte po prihlásení vo svojom účte.',
      'Vernostné body sú samostatné od 7 % odmeny na ďalší nákup.',
    ],
  },
  {
    id: 'odmena-7-percent', intent: 'loyalty', title: '7 % odmena na ďalší nákup', priority: 120,
    triggers: ['7 % odmena', '7% odmena', 'ako pouzijem 7 percent', 'nakup 7 %', 'nakupe 7 %', 'dostanem 7 %', '7 % zlavu', '7% zlavu', 'odmena na dalsi nakup', 'zlava na dalsi nakup'],
    answer: [
      'Za každú dokončenú objednávku získate 7 % zľavu na ďalší nákup kompatibilných tonerov.',
      'Táto odmena sa eviduje samostatne od vernostných bodov.',
      'Pri registrovanom zákazníkovi sa odmena používa cez účet; neregistrovaný zákazník dostane kupón podľa informácií po dokončení objednávky.',
    ],
  },
  {
    id: 'citlive-udaje-chat', intent: 'legal', title: 'Citlivé údaje v AI chate', priority: 140,
    triggers: ['cislo karty', 'platobna karta', 'cvv', 'cvc', 'pin karty', 'heslo do banky', 'mam ti napisat heslo', 'mozem ti poslat kartu'],
    answer: [
      'Do AI chatu neposielajte citlivé alebo zbytočné osobné údaje, najmä číslo platobnej karty, CVC/CVV, PIN, heslá, rodné číslo ani prihlasovacie údaje do banky.',
      'Pri bežnom poradenstve sem neposielajte ani celú adresu, IBAN či číslo objednávky. Ak je na vybavenie prípadu potrebná identifikácia, použite radšej zákaznícky účet, e-mail info@tonerymaxim.sk alebo telefón +421 917 859 206.',
      'ToneryMAXIM tieto citlivé platobné údaje nepotrebuje a číslo platobnej karty ani CVC neuchováva.',
    ],
  },
  {
    id: 'objednavka-konkretny-stav', intent: 'order', title: 'Stav konkrétnej objednávky', priority: 135,
    triggers: ['kde je moja objednavka', 'kde je balik', 'mam tracking', 'stav mojej objednavky', 'sledovat objednavku', 'tracking objednavky', 'cislo objednavky'],
    answer: [
      'AI Tomáš nemá prístup k stavu konkrétnej objednávky ani k zákazníckym údajom.',
      'Stav zásielky skontrolujte cez informácie o odoslaní a tracking od dopravcu. Ak potrebujete pomoc, kontaktujte nás na info@tonerymaxim.sk alebo +421 917 859 206.',
      'Do AI chatu neposielajte osobné údaje ani celé údaje o platbe.',
    ],
  },
  {
    id: 'ceska-republika', intent: 'shipping', title: 'Doručenie do Českej republiky', priority: 150,
    triggers: ['ceska republika', 'do ceska', 'do cr', 'brno', 'ostrava', 'ostravy', 'brna', 'praha', 'prahy', 'cesko', 'cz'],
    answer: [
      'Áno, tovar vieme poslať aj do Českej republiky, ale iba klasickým kuriérom na adresu.',
      'Cena kuriérskej dopravy do ČR je rovnaká ako pri odoslaní na Slovensku: GLS alebo DPD kuriér 3,90 € s DPH. Doprava je zdarma pri hodnote tovaru s DPH po všetkých zľavách od 29 €; doplatok za dobierku sa do tejto hranice nepočíta.',
      'GLS ParcelShop / Balíkomat ani DPD Pickup / Pickup Box pre Českú republiku neponúkame, pretože tieto možnosti máme v pokladni nastavené iba pre Slovensko.',
    ],
  },
  {
    id: 'ochrana-udajov', intent: 'legal', title: 'Ochrana osobných údajov', priority: 70,
    triggers: ['gdpr', 'ochrana osobnych udajov', 'osobne udaje', 'cookies', 'sukromie'],
    answer: [
      'Osobné údaje spracúvame len v rozsahu potrebnom na vybavenie objednávky, registrácie, komunikácie alebo zákonných povinností.',
      'Podrobnosti nájdete na stránkach Ochrana osobných údajov a Cookies v pätičke webu.',
    ],
  },

  {
    id: 'obchodne-podmienky', intent: 'legal', title: 'Obchodné podmienky', priority: 130,
    triggers: ['obchodne podmienky', 'vop', 'op eshopu', 'podmienky nakupu', 'kedy vznika zmluva', 'kupna zmluva', 'cena pri objednavke'],
    answer: [
      'Všeobecné obchodné podmienky nájdete na stránke Obchodné podmienky v pätičke webu.',
      'Pred odoslaním objednávky môžete skontrolovať a opraviť tovar, množstvo, kontaktné a adresné údaje, dopravu, platbu, zľavy aj konečnú cenu. Registrácia nie je podmienkou nákupu.',
      'Pre konkrétnu právnu otázku je rozhodujúce úplné aktuálne znenie obchodných podmienok na webe; AI Tomáš ho nenahrádza právnym výkladom.',
    ],
  },
  {
    id: 'storno-objednavky', intent: 'order', title: 'Storno objednávky', priority: 125,
    triggers: ['storno objednavky', 'stornovat objednavku', 'stornovat', 'zrusit objednavku', 'zrus mi objednavku', 'chcem zrusit objednavku', 'zmena objednavky pred expediciou'],
    answer: [
      'O storno objednávky môžete požiadať pred jej expedíciou. AI Tomáš objednávku sám nezruší ani nezmení.',
      'Kontaktujte nás čo najskôr na info@tonerymaxim.sk alebo +421 917 859 206. Ak už bola zásielka odovzdaná dopravcovi, postupuje sa podľa pravidiel pre odstúpenie od zmluvy alebo vrátenie tovaru.',
    ],
  },
  {
    id: 'ucet-funkcie', intent: 'account', title: 'Čo nájdete v zákazníckom účte', priority: 115,
    triggers: ['co je v ucte', 'co najdem v ucte', 'zakaznicky ucet', 'historia objednavok', 'moje objednavky', 'moje faktury', 'ulozene adresy', 'ulozene tlaciarne', 'ulozene produkty', 'opakovat nakup'],
    answer: [
      'Po prihlásení máte na jednom mieste objednávky a stav nákupov, fakturačné a dodacie adresy, osobné údaje, zmenu hesla, vernostné body a odmeny.',
      'Môžete si uložiť tlačiarne a obľúbené produkty pre rýchlejší ďalší nákup. Reklamáciu môžete vytvoriť priamo z konkrétnej objednávky.',
    ],
  },
  {
    id: 'ucet-profil-heslo', intent: 'account', title: 'Profil, adresy a heslo', priority: 110,
    triggers: ['zmenit heslo', 'zmena hesla', 'zmenit adresu v ucte', 'zmenit fakturacnu adresu', 'zmenit dodaciu adresu', 'upravit profil', 'zmenit telefon', 'zmenit osobne udaje'],
    answer: [
      'Po prihlásení môžete v zákazníckom účte spravovať osobné údaje, telefón, fakturačnú a dodaciu adresu a zmeniť heslo.',
      'Uložené adresy sa dajú pri ďalšej objednávke vybrať v pokladni. AI Tomáš tieto údaje sám nemení.',
    ],
  },
  {
    id: 'registracia-co-uklada', intent: 'account', title: 'Registrácia a uložené údaje', priority: 105,
    triggers: ['preco sa registrovat', 'naco registracia', 'vyhody uctu', 'ulozit tlaciaren', 'ulozit toner', 'ulozit produkt'],
    answer: [
      'Registrácia nie je povinná. Účet zjednodušuje opakovaný nákup a uchováva prehľad objednávok, adresy, uložené tlačiarne a produkty, body a odmeny.',
      'Po novej registrácii získate uvítaciu zľavu 5 % na prvý nákup podľa aktuálnych podmienok uvedených na webe.',
    ],
  },
  {
    id: 'predavajuci-firma', intent: 'legal', title: 'Prevádzkovateľ e-shopu', priority: 120,
    triggers: ['kto prevadzkuje eshop', 'kto je predavajuci', 'ico firmy', 'dic firmy', 'ic dph firmy', 'sidlo firmy', 'adresa firmy', 'roman babcan', 'inkarus'],
    answer: [
      'Prevádzkovateľom a predávajúcim je Roman Babčan INkarus, Tajov 265, 976 34 Tajov, IČO 37 328 344, DIČ 1020059920, IČ DPH SK1020059920.',
      'Kontakt: info@tonerymaxim.sk, +421 917 859 206, pracovné dni 9:00–15:00.',
    ],
  },
  {
    id: 'reklamacia-lehoty', intent: 'claim', title: 'Reklamačné lehoty a práva', priority: 115,
    triggers: ['ako dlho reklamacia', 'lehota reklamacie', '30 dni reklamacia', 'dva roky vada', 'zaruka dva roky', 'doklad k reklamacii', 'kto plati reklamaciu'],
    answer: [
      'Pri spotrebiteľskom nákupe zodpovedáme za vadu, ktorú mal tovar pri dodaní a ktorá sa prejaví do dvoch rokov od dodania. Vadu oznámte bez zbytočného odkladu, podľa reklamačných podmienok.',
      'Pri reklamácii dostanete potvrdenie s primeranou lehotou na odstránenie vady; tá spravidla nepresiahne 30 dní, ak dlhšiu dobu neodôvodňuje objektívny dôvod.',
      'Presný postup a úplné podmienky sú na stránke Reklamácie. Pri podnikateľskom nákupe sa pravidlá môžu líšiť.',
    ],
  },
  {
    id: 'odstupenie-vratenie-penazi', intent: 'claim', title: 'Odstúpenie a vrátenie peňazí', priority: 120,
    triggers: ['kedy vratite peniaze', 'vratenie penazi', '14 dni peniaze', 'odstupenie peniaze', 'vratite dopravu'],
    answer: [
      'Spotrebiteľ môže pri nákupe na diaľku bez uvedenia dôvodu odstúpiť do 14 dní od prevzatia tovaru. Tovar potom odošle najneskôr do 14 dní od odstúpenia.',
      'Prijaté platby vrátane ceny najlacnejšieho bežného dodania vraciame podľa podmienok do 14 dní od oznámenia; vrátenie môžeme zadržať do prijatia tovaru alebo preukázania jeho odoslania.',
      'Priamy náklad na vrátenie tovaru znáša spotrebiteľ. Úplné pravidlá a formulár sú na stránke Odstúpenie od zmluvy.',
    ],
  },
  {
    id: 'cookies-nastavenie', intent: 'legal', title: 'Cookies a súhlas', priority: 105,
    triggers: ['ako vypnem cookies', 'odmietnut cookies', 'nastavenie cookies', 'analyticke cookies', 'marketingove cookies', 'musim prijat cookies'],
    answer: [
      'Nevyhnutné úložiská používame na fungovanie košíka, účtu, bezpečnosti a objednávky. Analytické a marketingové technológie sa aktivujú až po súhlase.',
      'Odmietnutie voliteľných cookies neobmedzí nákup. Súhlas môžete neskôr zmeniť cez Nastavenia cookies v pätičke alebo v prehliadači.',
    ],
  },
  {
    id: 'gdpr-prava', intent: 'legal', title: 'Vaše práva k osobným údajom', priority: 105,
    triggers: ['vymazat osobne udaje', 'vymazat ucet gdpr', 'pravo na vymaz', 'pravo na pristup', 'prenosnost udajov', 'namietka gdpr', 'odvolat suhlas'],
    answer: [
      'Podľa podmienok GDPR môžete požiadať o prístup, opravu, výmaz, obmedzenie spracúvania alebo prenosnosť údajov, namietať proti príslušnému spracúvaniu a odvolať súhlas.',
      'Žiadosť pošlite na info@tonerymaxim.sk. Podrobnosti sú na stránke Ochrana osobných údajov.',
    ],
  },
  {
    id: 'recyklacia-tonerov', intent: 'support', title: 'Prázdne tonery a recyklácia', priority: 90,
    triggers: ['co so starym tonerom', 'prazdny toner', 'recyklacia tonera', 'recyklovat toner', 'spatny odber tonerov'],
    answer: [
      'Prázdnu tonerovú kazetu nevhadzujte automaticky do bežného komunálneho odpadu. Vložte ju do ochranného obalu alebo pôvodnej krabice, aby sa nevysypali zvyšky toneru.',
      'Využiť môžete pravidlá spätného odberu, zberný dvor alebo oprávneného spracovateľa podľa miestnych možností. Ak potrebujete postup pre konkrétny prípad, kontaktujte nás.',
    ],
  },

  {
    id: 'ai-tomas-identita', intent: 'support', title: 'Kto je AI Tomáš', priority: 180,
    triggers: ['ako sa volas', 'ako sa volaš', 'kto si', 'si umela inteligencia', 'si ai', 'si robot', 'co si zac', 'si clovek'],
    answer: [
      'Volám sa AI Tomáš a som virtuálny AI poradca e-shopu ToneryMAXIM.',
      'Áno, som systém umelej inteligencie, nie človek. Pomáham s výberom tonerov a náplní, kompatibilitou, produktmi, dopravou, platbou, reklamáciami, zákazníckym účtom a základným technickým poradenstvom o tlači.',
      'Ak potrebujete človeka, napíšte mi napríklad „chcem komunikovať s človekom“ a ponúknem možnosť odovzdať otázku pracovníkovi ToneryMAXIM.'
    ],
  },
  {
    id: 'predaj-tlaciarni', intent: 'support', title: 'Predaj tlačiarní', priority: 175,
    triggers: ['predavate tlaciarne', 'mate tlaciarne', 'kupim u vas tlaciaren', 'da sa u vas kupit tlaciaren', 'ponukate tlaciarne'],
    answer: [
      'Samotné tlačiarne nepredávame. ToneryMAXIM sa špecializuje na spotrebný materiál do tlačiarní.',
      'Ak už tlačiareň máte, napíšte jej presný model zo štítku a pomôžem vám nájsť vhodný toner, atrament alebo ďalší spotrebný materiál z našej ponuky.'
    ],
  },

  {
    id: 'typy-tlaciarni-prehlad', intent: 'support', title: 'Laserová, atramentová a tanková tlačiareň', priority: 125,
    triggers: ['aka je tankova tlaciaren', 'co je tankova tlaciaren', 'tankova tlaciaren', 'laserova alebo atramentova', 'laser alebo tank', 'atrament alebo tank', 'typy tlaciarni', 'aky typ tlaciarne'],
    answer: [
      'Laserová tlačiareň používa tonerový prášok. Je veľmi vhodná na častú kancelársku tlač, najmä textu; čiernobiele laserové modely bývajú rýchle a majú nízke prevádzkové náklady.',
      'Klasická atramentová tlačiareň používa atramentové kazety. Vie veľmi dobre tlačiť farby a fotografie, ale pri lacných modeloch s malými kazetami môže byť cena jednej strany vyššia.',
      'Tanková atramentová tlačiareň nemá malé jednorazové kazety ako bežná atramentová tlačiareň. Atrament sa dolieva z fľaštičiek do zásobníkov. Obstarávacia cena tlačiarne býva vyššia, ale pri väčšom objeme tlače má tankový systém spravidla veľmi nízku cenu za stranu.',
      'Najvhodnejší typ závisí od toho, koľko strán mesačne tlačíte, či potrebujete farbu/fotografie a aké sú ceny spotrebného materiálu pre konkrétny model.',
    ],
  },
  {
    id: 'naklady-na-stranu-typ-tlaciarne', intent: 'support', title: 'Ktorý typ tlačiarne má najlacnejšiu tlač', priority: 130,
    triggers: ['pri akom type je najlacnejsia tlac', 'najlacnejsia tlac laser tank atrament', 'co tlaci najlacnejsie', 'najlacnejsia cena za stranu', 'laser tank atrament cena za stranu', 'ktora tlaciaren ma najlacnejsiu prevadzku', 'najlacnejsia prevadzka tlaciarne'],
    answer: [
      'Pri vysokom objeme tlače má zvyčajne najnižšie náklady na jednu stranu tanková atramentová tlačiareň, pretože atrament sa dopĺňa z veľkoobjemových fľaštičiek.',
      'Pri prevažne čiernobielej kancelárskej tlači je veľmi výhodná aj čiernobiela laserová tlačiareň, najmä s vysokokapacitným tonerom. Výhodou je rýchlosť, odolnosť výtlačku a menšie riziko zasychania pri nepravidelnej tlači.',
      'Klasická lacná atramentová tlačiareň s malými kazetami má často najvyššiu cenu za stranu. Neplatí to však pre každý model, preto treba porovnávať cenu náplne a jej deklarovanú výťažnosť.',
      'Ak mi napíšete približný počet strán mesačne, či tlačíte čiernobielo alebo farebne a čo najčastejšie tlačíte, poradím vhodnejší typ tlačiarne.',
    ],
  },
  {
    id: 'cena-za-stranu-vypocet', intent: 'support', title: 'Ako vypočítať cenu jednej vytlačenej strany', priority: 130,
    triggers: ['cena za jednu stranu', 'cena za stranu', 'naklad na stranu', 'kolko stoji jedna strana', 'prepocet na stranu', 'pomer cena strana', 'cena toneru na stranu'],
    answer: [
      'Orientačná cena spotrebného materiálu na jednu stranu sa vypočíta ako cena náplne delená deklarovanou výťažnosťou. Napríklad toner za 20 € s výťažnosťou 2 000 strán vychádza približne na 0,01 € za stranu, teda 1 cent.',
      'Výťažnosť tonerov sa zvyčajne udáva podľa normovanej metodiky pri približne 5 % pokrytí strany. Reálna cena preto závisí od toho, čo tlačíte; plné grafiky spotrebujú výrazne viac.',
      'Pri farebnej laserovej tlači treba počítať so spotrebou štyroch farieb CMYK a podľa tlačiarne aj s ďalšími spotrebnými dielmi, napríklad valcom, pásom alebo fixačnou jednotkou.',
      'Ak mi zadáte presný model tlačiarne alebo označenie toneru, môžem porovnať vhodné náplne podľa ceny, kapacity a orientačnej ceny za stranu, ak sú tieto údaje v katalógu dostupné.',
    ],
  },
  {
    id: 'najlacnejsi-toner-bez-modelu', intent: 'support', title: 'Najlacnejší toner závisí od modelu tlačiarne', priority: 135,
    triggers: ['odporuc mi najlacnejsi toner do ciernbielej tlaciarne', 'odporuc najlacnejsi toner do ciernobielej tlaciarne', 'najlacnejsi toner do ciernobielej', 'najlacnejsi toner do farebnej', 'najlacnejsi toner pre farebnu tlaciaren', 'aky je najlacnejsi toner'],
    answer: [
      'Najlacnejší toner sa nedá bezpečne vybrať iba podľa toho, či je tlačiareň čiernobiela alebo farebná. Toner musí byť kompatibilný s presným modelom tlačiarne.',
      'Napíšte značku a presný model tlačiarne zo štítku, napríklad Brother HL-L2352DW alebo HP LaserJet M110w. Potom môžem z kompatibilných možností porovnať cenu, typ náplne a kapacitu.',
      'Pri rozhodovaní nepozerajte iba na cenu kazety. Toner za 25 € s kapacitou 3 000 strán môže byť výhodnejší než toner za 15 € s kapacitou 1 000 strán.',
    ],
  },
  {
    id: 'najlepsi-pomer-toner', intent: 'support', title: 'Najlepší pomer ceny a počtu strán', priority: 135,
    triggers: ['ktore tonery maju najlepsi pomer', 'najlepsi pomer cena strana', 'najvyhodnejsi toner na stranu', 'toner najlepsi cena vykon', 'najlacnejsi toner na jednu stranu', 'najlepsia cena za stranu toner'],
    answer: [
      'Najlepší pomer sa má porovnávať iba medzi tonermi kompatibilnými s tou istou tlačiarňou. Rozhodujúca nie je len cena kazety, ale najmä jej deklarovaná kapacita.',
      'Porovnanie robíme orientačne ako cena toneru ÷ deklarovaný počet strán. Vysokokapacitné XL/HC tonery preto často vychádzajú lacnejšie na jednu stranu, aj keď samotná kazeta stojí viac.',
      'Pri kompatibilnom, originálnom a renovovanom toneri treba okrem ceny za stranu zohľadniť aj kvalitu, požadovaný typ použitia a spoľahlivosť. Ak mi napíšete presný model tlačiarne, porovnám iba produkty, ktoré sú preň určené.',
    ],
  },
  {
    id: 'vyber-tlaciarne-podla-pouzitia', intent: 'support', title: 'Ako vybrať ekonomickú tlačiareň', priority: 120,
    triggers: ['aku tlaciaren kupit', 'odporuc tlaciaren', 'najlacnejsia tlaciaren na prevadzku', 'tlaciaren na vela tlace', 'tlaciaren na malo tlace', 'tlaciaren domov', 'tlaciaren do kancelarie'],
    answer: [
      'Ak tlačíte hlavne veľa čiernobieleho textu, zvyčajne dáva zmysel čiernobiela laserová tlačiareň s dostupným vysokokapacitným tonerom.',
      'Ak tlačíte veľa farebných strán a chcete nízke náklady na atrament, veľmi zaujímavá je tanková atramentová tlačiareň. Na fotografie je atramentová technológia spravidla vhodnejšia než laser.',
      'Ak tlačíte iba občas, treba myslieť aj na to, že atrament v tlačovej hlave môže pri dlhom nepoužívaní zasychať; laserová tlačiareň tento problém nemá.',
      'Pri kúpe preto porovnávajte nielen cenu tlačiarne, ale aj cenu a výťažnosť náplní, dostupnosť kompatibilných náplní a prípadné ďalšie spotrebné diely.',
    ],
  },
];

// Poznámka: znalostná databáza je jediný zdroj firemných faktov pre AI Tomáša.
// Ak sa obchodné podmienky zmenia, upravte najprv tento súbor a regression testy.
