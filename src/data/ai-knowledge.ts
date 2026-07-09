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
    triggers: ['kedy mi poslete objednavku', 'kedy odoslete objednavku', 'kedy bude odoslana objednavka', 'kedy posielate balik', 'kedy expedujete', 'objednavka odoslanie', 'odoslanie objednavky', 'kedy mi pride objednavka', 'kedy mi pride balik', 'dorucenie objednavky'],
    answer: [
      'Objednávky vybavujeme počas pracovných dní čo najrýchlejšie. Produkty skladom zvyčajne pripravujeme na odoslanie v pracovný deň po prijatí objednávky a platby, prípadne podľa zvoleného spôsobu platby.',
      'Doručenie kuriérom alebo do výdajného miesta býva spravidla 1–2 pracovné dni od odoslania zásielky.',
      'Ak potrebujete overiť konkrétnu objednávku, napíšte číslo objednávky alebo nás kontaktujte na info@tonerymaxim.sk.',
    ],
  },
  {
    id: 'doprava-ceny', intent: 'shipping', title: 'Cena dopravy', priority: 120,
    triggers: ['kolko stoji doprava', 'cena dopravy', 'postovne', 'dopravne', 'kolko stoji kurier', 'doprava zadarmo', 'od kolko je doprava zdarma', 'doprava cena'],
    answer: [
      'Doprava kuriérom GLS alebo DPD stojí 3,90 € s DPH.',
      'GLS Balíkomat / ParcelShop stojí 2,90 € s DPH. DPD Pickup alebo DPD Pickup Box stojí 2,90 € s DPH.',
      'Pri objednávke od 29 € s DPH je doprava zdarma.',
    ],
  },
  {
    id: 'doprava-dopravcovia', intent: 'shipping', title: 'Dopravcovia', priority: 110,
    triggers: ['aku dopravu pouzivate', 'aky kurier', 'dopravcovia', 'gls', 'dpd', 'balikomat', 'parcelshop', 'pickup', 'dpd box', 'vyzdajne miesto', 'kurier'],
    answer: [
      'Používame dopravu cez GLS a DPD.',
      'Vybrať si môžete kuriéra na adresu, GLS Balíkomat / ParcelShop alebo DPD Pickup / DPD Pickup Box podľa dostupnosti v pokladni.',
      'Presnú cenu a dostupné možnosti uvidíte vždy v košíku a v pokladni pred odoslaním objednávky.',
    ],
  },
  {
    id: 'platba-moznosti', intent: 'payment', title: 'Možnosti platby', priority: 100,
    triggers: ['ako mozem zaplatit', 'moznosti platby', 'platba', 'kartou', 'gopay', 'dobierka', 'prevodom', 'bankovy prevod', 'faktura'],
    answer: [
      'Objednávku môžete zaplatiť online cez GoPay, dobierkou alebo bankovým prevodom podľa možností v pokladni.',
      'Platba online GoPay je bez poplatku. Bankový prevod vopred je bez poplatku. Dobierka je 1,20 € s DPH.',
      'Pre školy, obce, mestá, štátne organizácie a firmy môže byť dostupná aj platba prevodom.',
    ],
  },
  {
    id: 'faktura-firma', intent: 'payment', title: 'Faktúra a firemný nákup', priority: 90,
    triggers: ['faktura', 'fakturu', 'na firmu', 'ico', 'dic', 'ic dph', 'firma', 'organizacia', 'skola', 'obec', 'mesto'],
    answer: [
      'Pri objednávke môžete zadať fakturačné údaje firmy alebo organizácie.',
      'Ak nakupujete ako firma, škola, obec, mesto alebo organizácia, vyplňte IČO, DIČ alebo IČ DPH v pokladni.',
      'Ak potrebujete pomoc s fakturáciou, napíšte nám na info@tonerymaxim.sk.',
    ],
  },
  {
    id: 'reklamacia-postup', intent: 'claim', title: 'Ako postupovať pri reklamácii', priority: 120,
    triggers: ['reklamacia', 'reklamovat', 'chcem reklamovat', 'toner nefunguje', 'chybny toner', 'pokazeny toner', 'nepasuje toner', 'toner nepasuje', 'nesedi toner', 'prisiel zly toner', 'zly toner', 'vymena toneru', 'vratenie tovaru'],
    answer: [
      'Ak toner nepasuje, nefunguje alebo prišiel nesprávny produkt, nepoužívajte ho nasilu a odložte ho do pôvodného obalu.',
      'Napíšte nám na info@tonerymaxim.sk číslo objednávky, názov produktu, model tlačiarne a krátky popis problému. Pomôže aj fotografia toneru, štítku tlačiarne alebo chybového hlásenia.',
      'Tovar neposielajte na dobierku. Reklamácie vybavujeme podľa reklamačných podmienok, najneskôr v zákonnej lehote.',
    ],
  },
  {
    id: 'vratenie-tovaru', intent: 'claim', title: 'Vrátenie alebo výmena tovaru', priority: 95,
    triggers: ['chcem vratit', 'vratenie tovaru', 'odstupenie', 'vymenit toner', 'vymena tovaru', 'objednal som zly', 'zle som objednal'],
    answer: [
      'Ak ste objednali nesprávny toner alebo náplň, najskôr nás kontaktujte na info@tonerymaxim.sk.',
      'Do správy uveďte číslo objednávky, model tlačiarne a produkt, ktorý ste objednali. Pomôžeme overiť správnu náhradu alebo ďalší postup.',
      'Tovar neposielajte na dobierku a dobre ho zabaľte, aby sa pri preprave nepoškodil.',
    ],
  },
  {
    id: 'vyber-toneru', intent: 'support', title: 'Ako nájsť správny toner', priority: 85,
    triggers: ['ako najdem spravny toner', 'aky toner potrebujem', 'spravny toner', 'neviem toner', 'co zadat do vyhladavania', 'najst toner', 'model tlaciarne'],
    answer: [
      'Najistejšie je zadať presný model tlačiarne alebo označenie toneru. Príklady: CF283A, CE285A, TN-2421, CRG-054, W1420A alebo Brother DCP-L2532DW.',
      'Model býva uvedený na prednej, zadnej alebo spodnej strane tlačiarne. Nájdete ho aj v počítači v časti Tlačiarne a skenery.',
      'Ak si nie ste istý, napíšte značku a model tlačiarne. Pomôžem vám nájsť správny produkt.',
    ],
  },
  {
    id: 'kompatibilny-original-renovovany', intent: 'compatibility', title: 'Kompatibilný, originálny a renovovaný toner', priority: 100,
    triggers: ['kompatibilny original', 'kompatibilny vs original', 'rozdiel kompatibilny original', 'renovovany toner', 'originalny toner', 'alternativny toner', 'original alebo kompatibilny', 'kompatibilny alebo renovovany'],
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
    triggers: ['tlaci pasy', 'pasy na papieri', 'ciary na papieri', 'smuhy', 'flaky', 'bodky na papieri', 'zle tlaci', 'spinava tlac', 'machule'],
    answer: [
      'Pásy alebo čiary na papieri najčastejšie spôsobuje toner, optický valec, znečistené kontakty alebo fixačná jednotka.',
      'Ak sa pás opakuje pravidelne na rovnakom mieste, často ide o optický valec alebo poškodený toner. Ak sa problém objavil hneď po výmene toneru, najskôr skontrolujte toner.',
      'Napíšte presný model tlačiarne a označenie toneru. Podľa toho viem poradiť, či hľadať toner, optický valec alebo inú časť.',
    ],
  },
  {
    id: 'bledy-vytlacok', intent: 'diagnostic', title: 'Bledá alebo slabá tlač', priority: 90,
    triggers: ['bledy vytlacok', 'slabo tlaci', 'bledy toner', 'svetla tlac', 'slaba tlac', 'neuplna tlac', 'vynechava tlac'],
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
    triggers: ['tlaciaren nepozna toner', 'nerozpozna toner', 'chyba kazety', 'replace toner', 'no toner', 'toner error', 'chip', 'cip', 'firmware', 'toner s cipom', 'bez cipu'],
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
    triggers: ['kontakt', 'telefon', 'mail', 'email', 'pracovna doba', 'kedy vam mozem volat', 'cislo'],
    answer: [
      'Kontaktovať nás môžete počas pracovných dní od 9:00 do 15:00.',
      'Telefón: +421 917 859 206. E-mail: info@tonerymaxim.sk.',
    ],
  },
  {
    id: 'ucet-heslo', intent: 'account', title: 'Účet a zabudnuté heslo', priority: 85,
    triggers: ['zabudol som heslo', 'zabudnute heslo', 'neviem sa prihlasit', 'ucet', 'registracia', 'prihlasenie', 'obnova hesla'],
    answer: [
      'Ak ste zabudli heslo, použite stránku Zabudnuté heslo a zadajte e-mail použitý pri registrácii.',
      'Ak e-mail nepríde, skontrolujte spam alebo nás kontaktujte na info@tonerymaxim.sk.',
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
];
