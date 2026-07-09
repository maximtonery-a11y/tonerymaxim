export type FaqItem = {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
};

export const faqCategories = [
  { id: 'vyber-tonera', title: 'Výber toneru', icon: '⌕', desc: 'Ako nájsť správny toner alebo náplň.' },
  { id: 'kompatibilita', title: 'Kompatibilita', icon: '✓', desc: 'Originál, kompatibilný, renovovaný a rozdiely.' },
  { id: 'problemy-s-tlacou', title: 'Problémy s tlačou', icon: '!', desc: 'Pásy, fľaky, bledá tlač a chybové hlásenia.' },
  { id: 'objednavka', title: 'Objednávka a doručenie', icon: '▣', desc: 'Doprava, platba, faktúra a reklamácie.' },
];

export const faqItems: FaqItem[] = [
  {
    id: 'ako-najdem-spravny-toner',
    category: 'vyber-tonera',
    question: 'Ako nájdem správny toner do tlačiarne?',
    answer: 'Najistejšie je zadať presný model tlačiarne alebo označenie toneru do vyhľadávania. Napríklad HP LaserJet M110w, Brother DCP-L2532DW alebo CF283A. Ak model nepoznáte, pozrite štítok na prednej, zadnej alebo spodnej strane tlačiarne.',
    keywords: ['model tlačiarne', 'označenie toneru', 'správny toner', 'vyhľadanie toneru'],
  },
  {
    id: 'co-zadat-do-vyhladavania',
    category: 'vyber-tonera',
    question: 'Čo mám zadať do vyhľadávania?',
    answer: 'Zadajte model tlačiarne, označenie toneru alebo krátky kód náplne. Príklady: CF283A, CE285A, TN-2421, CRG-054, W1420A alebo HP M234dw. Vyhľadávanie následne zobrazí dostupné kompatibilné, originálne alebo renovované produkty.',
    keywords: ['CF283A', 'CE285A', 'TN-2421', 'CRG-054', 'W1420A', 'HP M234dw'],
  },
  {
    id: 'neviem-presny-model',
    category: 'vyber-tonera',
    question: 'Neviem presný model tlačiarne. Čo mám robiť?',
    answer: 'Skontrolujte názov na tlačiarni alebo v počítači v časti Tlačiarne a skenery. Pri HP, Brother, Canon a Epson býva model uvedený priamo na zariadení. Ak si nie ste istý, napíšte nám značku a približný model, pomôžeme vám nájsť správnu náplň.',
    keywords: ['neviem model', 'štítok tlačiarne', 'tlačiarne a skenery'],
  },
  {
    id: 'kompatibilny-vs-originalny',
    category: 'kompatibilita',
    question: 'Aký je rozdiel medzi kompatibilným a originálnym tonerom?',
    answer: 'Originálny toner vyrába výrobca tlačiarne, napríklad HP, Canon alebo Brother. Kompatibilný toner vyrába iný výrobca, ale je určený pre rovnaký model tlačiarne. Kompatibilný toner má zvyčajne najlepší pomer cena/výkon. Originálny toner odporúčame vtedy, keď chcete istotu originálnej kvality výrobcu.',
    keywords: ['kompatibilný toner', 'originálny toner', 'rozdiel', 'cena výkon'],
  },
  {
    id: 'co-je-renovovany-toner',
    category: 'kompatibilita',
    question: 'Čo je renovovaný toner?',
    answer: 'Renovovaný toner je repasovaná originálna kazeta, ktorá bola vyčistená, skontrolovaná a znovu naplnená. Je ekologickejšou alternatívou a často ponúka dobrú cenu. Pri výbere je dôležité, aby bol toner určený presne pre váš model tlačiarne.',
    keywords: ['renovovaný toner', 'repasovaný toner', 'eko toner'],
  },
  {
    id: 'poskodi-kompatibilny-toner-tlaciaren',
    category: 'kompatibilita',
    question: 'Môže kompatibilný toner poškodiť tlačiareň?',
    answer: 'Kvalitný kompatibilný toner určený pre správny model tlačiarne by tlačiareň poškodiť nemal. Dôležité je nepoužívať nesprávny typ kazety a pri probléme toner ďalej netlačiť nasilu. Ak si nie ste istý kompatibilitou, overíme ju pred objednávkou.',
    keywords: ['poškodí tlačiareň', 'kompatibilita', 'nesprávny toner'],
  },
  {
    id: 'tlaci-pasy',
    category: 'problemy-s-tlacou',
    question: 'Tlačiareň tlačí pásy. Čo môže byť príčina?',
    answer: 'Pásy pri tlači môžu spôsobovať toner, optický valec, špinavé kontakty, fixačná jednotka alebo mechanické znečistenie. Ak sa pás opakuje v pravidelnom intervale, často ide o valec alebo toner. Najskôr vyberte toner, jemne ho pretrepte, skontrolujte či sa nesype a očistite dostupné kontakty suchou handričkou.',
    keywords: ['tlačí pásy', 'pásy na papieri', 'šmuhy', 'valec', 'fixačná jednotka'],
  },
  {
    id: 'bledy-vytlacok',
    category: 'problemy-s-tlacou',
    question: 'Tlač je bledá alebo neúplná. Čo mám skontrolovať?',
    answer: 'Najčastejšie je toner takmer prázdny, zle rozložený prášok v kazete alebo je zapnutý úsporný režim tlače. Skúste toner vybrať, jemne pretrepať zo strany na stranu a znova vložiť. Ak sa kvalita nezlepší, toner bude pravdepodobne potrebné vymeniť.',
    keywords: ['bledá tlač', 'slabá tlač', 'prázdny toner'],
  },
  {
    id: 'toner-sa-sype',
    category: 'problemy-s-tlacou',
    question: 'Z toneru sa sype prášok. Dá sa to zastaviť?',
    answer: 'Ak sa z toneru sype prášok, toner ďalej nepoužívajte. Opatrne ho vložte do sáčku alebo pôvodného obalu, aby neznečistil tlačiareň. Sypanie môže znamenať poškodené tesnenie alebo kazetu. V takom prípade nás kontaktujte kvôli reklamácii alebo výmene.',
    keywords: ['sype toner', 'tonerový prášok', 'reklamácia toneru'],
  },
  {
    id: 'tlaciaren-nepozna-toner',
    category: 'problemy-s-tlacou',
    question: 'Tlačiareň nepozná toner alebo hlási chybu kazety.',
    answer: 'Skontrolujte, či ste odstránili ochranné pásky a krytky, toner správne zacvakli a či je určený pre váš presný model tlačiarne. Pri niektorých modeloch môže hlásenie súvisieť s čipom alebo aktualizáciou firmvéru tlačiarne.',
    keywords: ['nepozná toner', 'chyba kazety', 'čip', 'firmvér'],
  },
  {
    id: 'doprava',
    category: 'objednavka',
    question: 'Aké možnosti dopravy ponúkate?',
    answer: 'Ponúkame doručenie kuriérom GLS alebo DPD a doručenie do výdajných miest alebo boxov podľa dostupnosti. Presnú cenu dopravy uvidíte v košíku a v pokladni pred odoslaním objednávky.',
    keywords: ['doprava', 'GLS', 'DPD', 'box', 'pickup'],
  },
  {
    id: 'platba',
    category: 'objednavka',
    question: 'Ako môžem zaplatiť objednávku?',
    answer: 'Objednávku môžete zaplatiť kartou alebo online platbou cez GoPay, dobierkou alebo prevodom podľa možností zobrazených v pokladni. Firmám a organizáciám môže byť dostupná aj platba prevodom.',
    keywords: ['platba', 'GoPay', 'dobierka', 'prevod', 'faktúra'],
  },
  {
    id: 'reklamacia',
    category: 'objednavka',
    question: 'Ako postupovať pri reklamácii toneru?',
    answer: 'Toner prestaňte používať, odložte ho do obalu a kontaktujte nás s číslom objednávky, popisom problému a ideálne aj fotografiou výtlačku alebo chybového hlásenia. Pomôže nám to reklamáciu vybaviť rýchlejšie.',
    keywords: ['reklamácia', 'chybný toner', 'fotka výtlačku'],
  },
];
