export type AdviceArticle = {
  slug: string;
  title: string;
  description: string;
  answer: string;
  published: string;
  updated: string;
  readingMinutes: number;
  topics: string[];
  sections: Array<{
    heading: string;
    paragraphs: string[];
    bullets?: string[];
    note?: string;
  }>;
  faq: Array<{ question: string; answer: string }>;
  links: Array<{ href: string; label: string }>;
};

const common = {
  published: "2026-08-09",
  updated: "2026-08-09",
};

export const adviceArticles: AdviceArticle[] = [
  {
    ...common,
    slug: "kompatibilny-alebo-originalny-toner",
    title: "Kompatibilný alebo originálny toner: ktorý vybrať?",
    description: "Praktické porovnanie originálnych, kompatibilných a renovovaných tonerov podľa ceny, spôsobu používania, výťažnosti a rizika nesprávneho výberu.",
    answer: "Originálny toner je najistejšia, ale spravidla drahšia voľba od výrobcu tlačiarne. Kvalitný kompatibilný toner môže výrazne znížiť cenu tlače, ak je presne určený pre daný model. Renovovaný toner využíva odborne obnovené telo kazety. Rozhodujte podľa presnej kompatibility, reálnej výťažnosti, záruky predajcu a významu tlačiarne pre vašu prevádzku.",
    readingMinutes: 6,
    topics: ["kompatibilný toner", "originálny toner", "renovovaný toner", "výber tonera"],
    sections: [
      {
        heading: "Čo znamenajú jednotlivé typy tonerov",
        paragraphs: [
          "Originálny toner vyrába alebo pod svojou značkou dodáva výrobca tlačiarne. Kompatibilný toner je nový výrobok iného výrobcu navrhnutý pre konkrétne tlačiarne. Renovovaný toner používa pôvodné telo kazety, ktoré bolo rozobraté, vyčistené, skontrolované a znovu naplnené.",
          "Samotné slovo kompatibilný nehovorí nič o kvalite konkrétnej kazety. Rozhodujúci je výrobca produktu, kontrola výroby, správny čip, zhodná mechanika a predajca, ktorý vie riešiť prípadnú nekompatibilitu.",
        ],
      },
      {
        heading: "Kedy sa oplatí originálny toner",
        paragraphs: ["Originál je rozumný pri zariadeniach v záruke, pri kritickej firemnej tlači, pri špeciálnych požiadavkách na farebnú zhodu alebo ak tlačiareň odmieta dostupné alternatívy."],
        bullets: ["Potrebujete maximálnu predvídateľnosť.", "Tlačiareň je kľúčová pre dennú prevádzku.", "Tlačíte materiály citlivé na presnú farebnosť.", "Výrobca zariadenia vyžaduje konkrétnu kazetu."],
      },
      {
        heading: "Kedy dáva zmysel kompatibilný alebo renovovaný toner",
        paragraphs: ["Pri bežnej kancelárskej tlači býva kvalitná alternatíva ekonomicky výhodná. Úsporu však porovnávajte cez cenu za vytlačenú stranu, nie iba cez cenu kazety. Veľmi lacný toner s nízkou náplňou alebo nestabilnou tlačou nemusí byť najlacnejší."],
        bullets: ["Overte celý model tlačiarne.", "Porovnajte OEM kód pôvodnej kazety.", "Skontrolujte deklarovanú výťažnosť a kapacitu.", "Vyberte predajcu s jasnou reklamáciou a pomocou s kompatibilitou."],
        note: "Aktualizácia firmvéru môže pri niektorých zariadeniach ovplyvniť rozpoznanie alternatívnej kazety. Pred aktualizáciou si overte odporúčania výrobcu kazety alebo predajcu.",
      },
    ],
    faq: [
      { question: "Poškodí kompatibilný toner tlačiareň?", answer: "Správne vyrobený toner určený pre konkrétny model by tlačiareň poškodiť nemal. Riziko rastie pri neznámom pôvode, nesprávnej kazete alebo mechanickej chybe produktu." },
      { question: "Je originálny toner vždy kvalitnejší?", answer: "Originál poskytuje najpredvídateľnejšiu zhodu s tlačiarňou. Kvalitná alternatíva však môže byť pre bežnú tlač plne postačujúca a ekonomicky výhodnejšia." },
      { question: "Ako porovnať cenu tonerov?", answer: "Porovnajte cenu s DPH, deklarovanú výťažnosť, pokrytie stránky, kapacitu a podmienky záruky. Samotná najnižšia cena kazety nestačí." },
    ],
    links: [{ href: "/kompatibilne-tonery", label: "Kompatibilné tonery" }, { href: "/originalne-tonery", label: "Originálne tonery" }, { href: "/renovovane-tonery", label: "Renovované tonery" }],
  },
  {
    ...common,
    slug: "ako-najst-toner-podla-oem-kodu",
    title: "Ako nájsť toner podľa OEM kódu",
    description: "Návod, kde nájsť OEM označenie kazety, ako ho správne prepísať a prečo je presnejšie než vyhľadávanie iba podľa značky tlačiarne.",
    answer: "OEM kód je označenie konkrétneho modelu kazety, napríklad CF283A, TN-2421 alebo CRG-054. Nájdete ho na pôvodnej kazete, obale alebo v dokumentácii tlačiarne. Zadajte celý kód do vyhľadávania bez dopĺňania všeobecných slov; následne overte, či detail produktu uvádza váš presný model tlačiarne.",
    readingMinutes: 5,
    topics: ["OEM kód", "označenie tonera", "vyhľadanie tonera", "kód kazety"],
    sections: [
      { heading: "Kde OEM kód hľadať", paragraphs: ["Najspoľahlivejším zdrojom je štítok na kazete, ktorú práve používate. Kód býva aj na krabici, v návode, v spotrebnom materiáli uvedenom v menu tlačiarne alebo na produktovej stránke výrobcu zariadenia."], bullets: ["Vyberte kazetu podľa návodu tlačiarne.", "Odpíšte písmená, čísla aj prípadnú koncovku XL, X, A alebo Y.", "Nezamieňajte výrobné číslo tlačiarne s označením kazety."] },
      { heading: "Prečo záleží na celom označení", paragraphs: ["Podobné kódy nemusia byť zameniteľné. Rozdiel v jednom písmene môže označovať inú kapacitu, farbu, región alebo generáciu čipu. Pri farebných sadách navyše skontrolujte koncovku farby: BK/K, C, M a Y."], note: "Ak stará kazeta nie je správna alebo bola vložená omylom, overujte zároveň presný model tlačiarne." },
      { heading: "Postup kontroly pred objednaním", paragraphs: ["Po vyhľadaní kódu otvorte detail produktu. Porovnajte OEM označenie, model tlačiarne, farbu, typ produktu a výťažnosť. Ak sa model nezhoduje úplne, neobjednávajte iba podľa podobnosti názvu."], bullets: ["OEM kód", "presný model zariadenia", "farba", "štandardná alebo vysoká kapacita", "toner, valec alebo iný komponent"] },
    ],
    faq: [
      { question: "Je SKU predajcu to isté ako OEM kód?", answer: "Nie vždy. SKU môže byť interné číslo obchodu. OEM kód označuje model spotrebného materiálu výrobcu a býva uvedený samostatne." },
      { question: "Môžem pri vyhľadávaní vynechať pomlčku?", answer: "Vyhľadávače často nájdu CF283A aj CF-283A, ale pri konečnej kontrole porovnajte celé označenie z produktu a kazety." },
      { question: "Čo ak na kazete vidím viac kódov?", answer: "Uprednostnite modelové označenie kazety a porovnajte ho s dokumentáciou tlačiarne. Sériové, výrobné a certifikačné čísla nemusia byť objednávacím kódom." },
    ],
    links: [{ href: "/produkty", label: "Vyhľadať OEM kód" }, { href: "/tlaciarne", label: "Vybrať podľa tlačiarne" }, { href: "/faq", label: "Najčastejšie otázky" }],
  },
  {
    ...common,
    slug: "toner-alebo-opticky-valec",
    title: "Toner alebo optický valec: aký je medzi nimi rozdiel?",
    description: "Vysvetlenie rozdielu medzi tonerovou kazetou a optickým valcom, typické príznaky opotrebovania a kontrola správneho dielu.",
    answer: "Tonerová kazeta obsahuje tonerový prášok, zatiaľ čo optický valec prenáša obraz na papier. V niektorých tlačiarňach sú spojené v jednej kazete, v iných sa menia samostatne. Hlásenie Replace Drum alebo Drum End preto nemusí znamenať, že treba kúpiť nový toner.",
    readingMinutes: 5,
    topics: ["optický valec", "toner", "drum", "tlačový valec"],
    sections: [
      { heading: "Úloha tonera a valca", paragraphs: ["Toner dodáva farbivo vo forme jemného prášku. Fotocitlivý valec vytvorí a prenesie obraz, ktorý sa následne zafixuje teplom. Spotreba oboch dielov sa preto počíta odlišne."], bullets: ["Toner sa mení po spotrebovaní náplne.", "Valec sa mení po dosiahnutí životnosti alebo zhoršení obrazu.", "Fixačná jednotka je ďalší samostatný komponent."] },
      { heading: "Ako zistiť, či je valec samostatný", paragraphs: ["Pozrite návod, menu spotrebného materiálu alebo konštrukciu kazety. Značky ako Brother často používajú samostatné označenie TN pre toner a DR pre valec, ale vždy rozhoduje konkrétny model."], note: "Nedotýkajte sa povrchu valca prstami a nevystavujte ho zbytočne silnému svetlu." },
      { heading: "Príznaky, ktoré treba rozlišovať", paragraphs: ["Slabá tlač môže znamenať dochádzajúci toner, ale opakujúce sa škvrny v pravidelných rozostupoch často súvisia s valcom. Šmuhy môžu spôsobiť aj znečistenie, papier, fixačná jednotka alebo poškodená kazeta."], bullets: ["Skontrolujte hlásenie tlačiarne.", "Vytlačte diagnostickú stranu.", "Zistite stav tonera aj životnosť valca.", "Nemeňte diel iba podľa jedného príznaku bez kontroly."] },
    ],
    faq: [
      { question: "Je optický valec súčasťou každého tonera?", answer: "Nie. Niektoré kazety ho obsahujú, iné tlačiarne majú valec ako samostatný spotrebný diel." },
      { question: "Mám pri hlásení Drum kúpiť toner?", answer: "Spravidla nie. Najskôr overte význam hlásenia v návode konkrétnej tlačiarne a označenie samostatného valca." },
      { question: "Ako dlho vydrží optický valec?", answer: "Životnosť závisí od modelu, počtu strán, veľkosti tlačových úloh a prevádzky. Použite údaj výrobcu pre konkrétny valec." },
    ],
    links: [{ href: "/produkty?category=opticke-valce", label: "Optické valce" }, { href: "/tonery", label: "Tonery" }, { href: "/tlaciarne", label: "Výber podľa tlačiarne" }],
  },
  {
    ...common,
    slug: "co-znamena-vytaznost-tonera",
    title: "Čo znamená výťažnosť tonera a koľko strán vytlačí?",
    description: "Ako čítať deklarovanú výťažnosť tonera, prečo reálny počet strán kolíše a ako správne porovnávať cenu tlače.",
    answer: "Výťažnosť je odhad počtu strán pri stanovenej testovacej metodike a pokrytí, často približne 5 % pri čiernobielej kancelárskej tlači. Nie je to záruka presného počtu strán. Reálny výsledok ovplyvňuje pokrytie, grafika, časté zapínanie, kalibrácie, režim tlače a veľkosť jednotlivých úloh.",
    readingMinutes: 5,
    topics: ["výťažnosť tonera", "počet strán", "5 percent pokrytie", "cena tlače"],
    sections: [
      { heading: "Deklarovaná a reálna výťažnosť", paragraphs: ["Údaj na obale umožňuje porovnať kazety testované podobným spôsobom. Strana s krátkym textom spotrebuje menej tonera než plná grafika, fotografia alebo veľké čierne plochy. Farebná tlač navyše spotrebúva viac kaziet naraz."], bullets: ["Pokrytie stránky", "režim kvality", "čistenie a kalibrácia", "teplota a vlhkosť", "malé verzus dlhé tlačové úlohy"] },
      { heading: "Ako porovnať cenu za stranu", paragraphs: ["Orientačnú cenu za stranu vypočítate ako cenu kazety vydelenú deklarovanou výťažnosťou. Porovnávajte kazety pre rovnakú tlačiareň a rovnakú metodiku. Pri farebnej tlači treba započítať spotrebu všetkých farieb."], note: "Do celkových nákladov patria aj valce, odpadové nádoby, fixačné jednotky, papier a servis." },
      { heading: "Štandardná alebo XL kapacita", paragraphs: ["Vysokokapacitná kazeta má zvyčajne vyššiu nákupnú cenu, ale nižšiu cenu za stranu. Zmysel dáva pri pravidelnej tlači a vtedy, ak ju konkrétny model tlačiarne podporuje."], bullets: ["Overte podporu XL kazety.", "Porovnajte cenu za stranu.", "Zohľadnite, ako rýchlo toner spotrebujete."] },
    ],
    faq: [
      { question: "Znamená 3 000 strán presne 3 000 výtlačkov?", answer: "Nie. Ide o porovnávací údaj pri testovacích podmienkach. Pri vysokom pokrytí môže byť reálny počet výrazne nižší." },
      { question: "Čo je päťpercentné pokrytie?", answer: "Je to približná plocha stránky pokrytá tonerom pri bežnom textovom dokumente. Plná grafika má podstatne vyššie pokrytie." },
      { question: "Je XL toner vždy lepší?", answer: "Nie vždy. Je vhodný pri vyššej spotrebe, ak ho tlačiareň podporuje. Pri minimálnej tlači môže byť dôležitejšia nižšia vstupná cena." },
    ],
    links: [{ href: "/tonery", label: "Porovnať tonery" }, { href: "/tlaciarne", label: "Vybrať podľa modelu" }, { href: "/produkty", label: "Aktuálny katalóg" }],
  },
  {
    ...common,
    slug: "tlaciaren-tlaci-pasy-alebo-bledo",
    title: "Tlačiareň tlačí pásy, fľaky alebo bledo: čo skontrolovať",
    description: "Bezpečný diagnostický postup pri bledej tlači, pásoch, škvrnách a opakujúcich sa chybách bez zbytočnej výmeny dielov.",
    answer: "Najskôr vytlačte diagnostickú stranu, skontrolujte hladinu tonera, nastavenie úsporného režimu a správne usadenie kazety. Opakujúce sa škvrny môžu súvisieť s valcom, súvislé pásy so znečistením alebo kazetou a rozmazávanie aj s fixačnou jednotkou či nevhodným papierom. Diel nevymieňajte iba podľa jedného príznaku.",
    readingMinutes: 7,
    topics: ["bledá tlač", "pásy na papieri", "fľaky", "diagnostika tlačiarne"],
    sections: [
      { heading: "Bezpečný postup od najjednoduchšieho", paragraphs: ["Pozrite hlásenia na displeji alebo v ovládači, vytlačte internú testovaciu stranu a skúste iný dokument. Tým oddelíte problém tlačiarne od aplikácie alebo ovládača."], bullets: ["Vypnite úsporný režim tonera na skúšku.", "Skontrolujte správny typ a orientáciu papiera.", "Vyberte a podľa návodu znovu vložte kazetu.", "Spustite čistenie alebo kalibráciu dostupnú v menu."] },
      { heading: "Čo môžu naznačovať jednotlivé chyby", paragraphs: ["Bledá tlač býva spojená s dochádzajúcim tonerom, úsporným režimom alebo prenosom obrazu. Pravidelne sa opakujúca bodka môže ukazovať na valec alebo valček. Rozmazaný toner, ktorý sa dá zotrieť, môže súvisieť s papierom alebo fixáciou."], note: "Ide o orientačné príznaky. Presná diagnostika závisí od konštrukcie konkrétneho modelu." },
      { heading: "Kedy prestať skúšať a objednať servis", paragraphs: ["Ak počujete mechanické zvuky, cítite zápach, toner sa vysypal do zariadenia, papier sa opakovane zasekáva alebo je poškodený valec či fixačná jednotka, tlačiareň ďalej nepoužívajte bez kontroly."], bullets: ["Nerozoberajte fixačnú jednotku – môže byť horúca.", "Nevysávajte toner bežným domácim vysávačom.", "Postupujte podľa bezpečnostných pokynov výrobcu."] },
    ],
    faq: [
      { question: "Pomôže potriasť tonerom?", answer: "Jemné rozloženie zvyšného prášku podľa návodu môže dočasne pomôcť, nejde však o opravu a kazetu nepretrepávajte prudko." },
      { question: "Pásy vždy znamenajú chybný valec?", answer: "Nie. Príčinou môže byť kazeta, nečistota, prenosový alebo fixačný diel aj papier. Dôležitý je tvar a opakovanie chyby." },
      { question: "Môžem toner z tlačiarne povysávať?", answer: "Nie bežným vysávačom. Jemný toner vyžaduje vhodný servisný postup a zariadenie; riaďte sa návodom alebo servisom." },
    ],
    links: [{ href: "/faq", label: "Riešenie ďalších problémov" }, { href: "/kontakt", label: "Požiadať o radu" }, { href: "/tlaciarne", label: "Náplne podľa tlačiarne" }],
  },
  {
    ...common,
    slug: "ako-skladovat-tonery-a-naplne",
    title: "Ako správne skladovať tonery a atramentové náplne",
    description: "Odporúčania pre skladovanie neotvorených aj rozbalených tonerov a atramentových kaziet, aby sa nepoškodili teplom, vlhkosťou alebo svetlom.",
    answer: "Tonery a náplne skladujte v pôvodnom uzavretom obale, v suchu, pri stabilnej izbovej teplote, mimo priameho slnka, radiátora a mrazu. Tonerovú kazetu nechávajte v polohe odporúčanej výrobcom. Po prenesení z chladu ju pred otvorením nechajte vyrovnať na izbovú teplotu, aby sa nezrazila vlhkosť.",
    readingMinutes: 4,
    topics: ["skladovanie tonera", "atramentová náplň", "životnosť kazety", "vlhkosť"],
    sections: [
      { heading: "Vhodné prostredie", paragraphs: ["Najväčším rizikom sú teplotné extrémy, prudké zmeny teploty, vlhkosť a silné svetlo. Presné povolené rozsahy sa líšia podľa produktu, preto má prednosť obal a dokumentácia výrobcu."], bullets: ["Suchá miestnosť so stabilnou teplotou.", "Pôvodný ochranný obal až do použitia.", "Mimo slnka, vykurovania a auta.", "Bez tlaku ťažkých predmetov na kazetu."] },
      { heading: "Tonerová kazeta", paragraphs: ["Tonerový prášok môže pri nevhodnom skladovaní zvlhnúť alebo sa nerovnomerne rozložiť. Kazetu neotvárajte vopred a nedotýkajte sa čipu, valca ani odkrytých pracovných častí."], note: "Ak bola kazeta skladovaná v chlade, otvorenie odložte, kým sa jej teplota bezpečne nevyrovná s miestnosťou." },
      { heading: "Atramentová náplň", paragraphs: ["Atramentové kazety chráňte pred vyschnutím a mrazom. Neodstraňujte ochranné prvky pred použitím. Rozbalenú kazetu vkladajte podľa návodu a nenechávajte ju dlhodobo mimo tlačiarne."], bullets: ["Kontrolujte dátum alebo odporúčanie na obale.", "Neuchovávajte kazetu pri okne.", "Pri úniku atramentu produkt nepoužívajte."] },
    ],
    faq: [
      { question: "Môžem toner skladovať v garáži?", answer: "Len ak je suchá a bez teplotných extrémov. Nevhodná je garáž s mrazom, prehrievaním alebo vysokou vlhkosťou." },
      { question: "Má toner dátum spotreby?", answer: "Niektorí výrobcovia uvádzajú dátum alebo odporúčanú dobu skladovania. Vždy sa riaďte označením konkrétneho balenia." },
      { question: "Môžem rozbalenú kazetu odložiť?", answer: "Je to rizikovejšie. Chráňte ju podľa návodu pred svetlom, prachom a poškodením a použite ju čo najskôr." },
    ],
    links: [{ href: "/produkty", label: "Aktuálny katalóg" }, { href: "/faq", label: "Najčastejšie otázky" }, { href: "/kontakt", label: "Kontaktovať podporu" }],
  },
  {
    ...common,
    slug: "ako-vybrat-toner-podla-modelu-tlaciarne",
    title: "Ako vybrať toner podľa presného modelu tlačiarne",
    description: "Krokový postup, ako nájsť celý názov tlačiarne, vybrať kompatibilné produkty a pred objednaním overiť OEM kód, farbu a kapacitu.",
    answer: "Nájdite celý model na prednom paneli, zadnom štítku alebo v nastavení zariadenia. Vyberte značku a presný model v katalógu tlačiarní. V zozname produktov potom porovnajte OEM kód starej kazety, farbu, typ spotrebného dielu a podporovanú kapacitu. Nestačí zhoda iba v číselnej časti názvu.",
    readingMinutes: 5,
    topics: ["model tlačiarne", "výber tonera", "kompatibilita", "náplň do tlačiarne"],
    sections: [
      { heading: "Kde nájsť presný model", paragraphs: ["Model býva na prednej strane, na výrobnom štítku vzadu alebo zospodu, v obrazovke nastavení, v ovládači počítača alebo na konfiguračnej stránke. Sériové číslo nie je model."], bullets: ["Značka", "celá modelová rada", "číslo", "všetky písmená a koncovky"] },
      { heading: "Prečo nestačí podobný názov", paragraphs: ["Tlačiarne s podobným číslom môžu patriť do inej generácie alebo regiónu a používať odlišnú kazetu. Koncovky DN, DW, MFP alebo ďalšie písmená môžu označovať variant zariadenia; kompatibilitu preto potvrdzuje konkrétny zoznam výrobku."], note: "Ak katalóg uvádza širšiu rodinu modelov, detail produktu musí stále obsahovať váš konkrétny model alebo zhodný OEM kód." },
      { heading: "Finálna kontrola produktu", paragraphs: ["Pred vložením do košíka porovnajte viac než názov tlačiarne. Skontrolujte, či kupujete toner, atrament, valec alebo inú súčiastku a či ide o požadovanú farbu a kapacitu."], bullets: ["presný model", "OEM kód", "farba", "kapacita", "typ produktu", "stav skladu a cena"] },
    ],
    faq: [
      { question: "Je sériové číslo vhodné na výber tonera?", answer: "Nie. Sériové číslo identifikuje konkrétny kus zariadenia. Na výber potrebujete model tlačiarne alebo OEM kód kazety." },
      { question: "Čo ak môj model nie je v zozname?", answer: "Neobjednávajte iba podľa podobnosti názvu. Pošlite podporе fotografiu štítku alebo presný model a označenie starej kazety." },
      { question: "Môže jedna tlačiareň používať viac kapacít?", answer: "Áno, niektoré modely podporujú štandardnú aj XL kapacitu. Podporu treba overiť pri konkrétnom produkte." },
    ],
    links: [{ href: "/tlaciarne", label: "Vybrať značku a model" }, { href: "/produkty", label: "Vyhľadať produkt" }, { href: "/kontakt", label: "Overiť kompatibilitu" }],
  },
  {
    ...common,
    slug: "renovovany-toner-vyhody-a-obmedzenia",
    title: "Renovovaný toner: výhody, obmedzenia a správny výber",
    description: "Čo je renovovaný toner, ako sa líši od nového kompatibilného výrobku a čo overiť pri kvalite, kompatibilite a výťažnosti.",
    answer: "Renovovaný toner je použitá originálna alebo vhodná kazeta, ktorá bola odborne rozobratá, vyčistená, skontrolovaná, opotrebované diely boli podľa potreby vymenené a kazeta bola znovu naplnená. Môže znížiť množstvo odpadu a cenu tlače, no kvalita závisí od procesu renovácie a výstupnej kontroly.",
    readingMinutes: 5,
    topics: ["renovovaný toner", "repasovaný toner", "ekologická tlač", "alternatívny toner"],
    sections: [
      { heading: "Renovovaný nie je to isté ako iba doplnený", paragraphs: ["Kvalitná renovácia zahŕňa kontrolu mechaniky, tesnení, valca, stierok, čipu a tlačový test podľa typu kazety. Jednoduché nasypanie prášku bez kontroly opotrebovania nemožno považovať za plnohodnotnú renováciu."], bullets: ["Rozobratie a čistenie", "kontrola opotrebovaných dielov", "vhodný tonerový prášok", "čip alebo reset podľa modelu", "výstupná kontrola"] },
      { heading: "Výhody", paragraphs: ["Opätovné použitie vhodného tela kazety šetrí materiál a môže priniesť nižšiu cenu. Renovované kazety sú zaujímavé najmä tam, kde existuje stabilný proces zberu a odborného spracovania."], bullets: ["Menej jednorazového odpadu.", "Možná úspora oproti originálu.", "Opätovné využitie kvalitného tela kazety."] },
      { heading: "Obmedzenia a kontrola pred nákupom", paragraphs: ["Nie každá kazeta je vhodná na opakovanú renováciu a nie pri každom modeli je dostupná spoľahlivá alternatíva. Overte presnú kompatibilitu, výťažnosť, pôvod produktu, záruku a spôsob riešenia chyby."], note: "Označenie renovovaný musí opisovať reálny stav produktu. Nezamieňajte ho s úplne novou kompatibilnou kazetou." },
    ],
    faq: [
      { question: "Je renovovaný toner použitý?", answer: "Jeho telo už bolo použité, ale pri riadnej renovácii je kazeta rozobratá, vyčistená, skontrolovaná a znovu pripravená na prevádzku." },
      { question: "Je renovovaný toner ekologickejší?", answer: "Opätovné použitie tela môže znížiť spotrebu nového materiálu. Celkový prínos závisí od dopravy, procesu renovácie a následného zhodnotenia kazety." },
      { question: "Ako spoznám kvalitnú renováciu?", answer: "Zaujímajte sa o dodávateľa, kontrolu dielov, tlačový test, deklarovanú výťažnosť, záruku a jasné označenie produktu." },
    ],
    links: [{ href: "/renovovane-tonery", label: "Renovované tonery" }, { href: "/spatny-odber-tonerov", label: "Spätný odber" }, { href: "/kompatibilne-tonery", label: "Kompatibilné tonery" }],
  },
  {
    ...common,
    slug: "recyklacia-a-spatny-odber-tonerov",
    title: "Recyklácia a spätný odber tonerov: správny postup",
    description: "Ako bezpečne odložiť prázdnu kazetu, zabrániť vysypaniu tonera a pripraviť ju na spätný odber alebo odborné zhodnotenie.",
    answer: "Prázdnu kazetu nevhadzujte automaticky do bežného komunálneho odpadu. Vložte ju do ochranného obalu alebo pôvodnej krabice, zabráňte vysypaniu zvyškov a využite pravidlá spätného odberu predajcu, zberný dvor alebo oprávneného spracovateľa podľa miestnych podmienok.",
    readingMinutes: 5,
    topics: ["recyklácia tonerov", "spätný odber", "prázdna kazeta", "tonerový odpad"],
    sections: [
      { heading: "Bezpečné uloženie prázdnej kazety", paragraphs: ["Aj prázdna kazeta môže obsahovať zvyškový toner. Nevysýpajte ju, nerozoberajte a nechránenú ju neprepravujte. Použite pôvodný plastový obal, uzatvárateľné vrecko alebo vhodnú krabicu."], bullets: ["Chráňte pred poškodením.", "Kazetu držte mimo dosahu detí.", "Pri úniku postupujte podľa bezpečnostných pokynov produktu.", "Jednotlivé typy oddeľte, ak to vyžaduje zberný systém."] },
      { heading: "Kam prázdny toner odovzdať", paragraphs: ["Možnosť závisí od typu kazety, množstva, obce a podmienok konkrétneho programu. Využiť možno spätný odber predajcu, zberný dvor alebo oprávnenú spoločnosť. Firmy musia rešpektovať aj svoje pravidlá evidencie odpadu."], note: "Pred odoslaním vždy skontrolujte aktuálne pravidlá zvozu, minimálne množstvo a akceptované typy kaziet." },
      { heading: "Prečo má zmysel odborné spracovanie", paragraphs: ["Vhodné telá možno renovovať a ostatné materiály odborne roztriediť alebo zhodnotiť. Správny zber zároveň zabraňuje úniku jemného prášku a nekontrolovanému miešaniu materiálov."], bullets: ["Opätovné použitie vhodných kaziet.", "Oddelenie plastov, kovov a ďalších častí.", "Bezpečnejšie nakladanie so zvyškami tonera."] },
    ],
    faq: [
      { question: "Patrí prázdny toner do plastov?", answer: "Nie ako bežný plastový obal. Kazeta obsahuje viac materiálov a zvyškový toner; využite určený zber alebo spätný odber." },
      { question: "Môžem poslať kazetu voľne v krabici?", answer: "Kazetu najskôr samostatne uzavrite alebo vložte do ochranného obalu, aby sa pri preprave nepoškodila a nevysypala." },
      { question: "Odoberá sa každý typ kazety?", answer: "Nie nevyhnutne. Programy môžu mať zoznam akceptovaných typov a minimálne množstvo. Overte aktuálne pravidlá pred odoslaním." },
    ],
    links: [{ href: "/spatny-odber-tonerov", label: "Pravidlá spätného odberu" }, { href: "/kontakt", label: "Overiť možnosť odberu" }, { href: "/renovovane-tonery", label: "Renovované tonery" }],
  },
  {
    ...common,
    slug: "najcastejsie-chyby-pri-vybere-naplne",
    title: "10 najčastejších chýb pri výbere tonera alebo náplne",
    description: "Kontrolný zoznam najčastejších omylov pri výbere tonerov, atramentov a valcov podľa modelu, OEM kódu, farby, kapacity a regiónu.",
    answer: "Najčastejšou chybou je nákup iba podľa značky alebo neúplného čísla tlačiarne. Pred objednaním treba porovnať celý model zariadenia, OEM kód starej kazety, typ spotrebného dielu, farbu a podporovanú kapacitu. Podobné názvy ešte neznamenajú vzájomnú zameniteľnosť.",
    readingMinutes: 6,
    topics: ["chybný toner", "výber náplne", "kompatibilita tlačiarne", "OEM kód"],
    sections: [
      { heading: "Chyby v identifikácii", paragraphs: ["Prvých päť omylov vzniká ešte pred porovnaním cien."], bullets: ["Výber iba podľa značky tlačiarne.", "Zámena modelu za sériové číslo.", "Ignorovanie písmen a koncoviek modelu.", "Odpísanie neúplného OEM kódu.", "Zámena čísla tonera s číslom optického valca."] },
      { heading: "Chyby pri porovnaní produktov", paragraphs: ["Aj pri správnom modeli možno objednať nesprávny variant alebo zle vyhodnotiť cenu."], bullets: ["Nesprávna farba pri farebnej tlačiarni.", "XL kazeta bez overenia podpory.", "Porovnanie ceny bez výťažnosti.", "Predpoklad, že kompatibilný a renovovaný znamená to isté.", "Nákup podľa fotografie namiesto technických údajov."] },
      { heading: "Kontrola za jednu minútu", paragraphs: ["Pred zaplatením si položte päť otázok: Sedí celý model? Sedí OEM kód? Kupujem správny typ dielu? Sedí farba a kapacita? Je môj model uvedený v detaile produktu? Ak jedna odpoveď chýba, požiadajte o overenie."], note: "Fotografia môže byť ilustračná alebo sa obal môže zmeniť. Rozhodujú identifikačné a kompatibilitné údaje produktu." },
    ],
    faq: [
      { question: "Stačí vybrať toner podľa fotografie?", answer: "Nie. Podobne vyzerajúce kazety môžu mať inú mechaniku alebo čip. Porovnajte model a OEM kód." },
      { question: "Je vyššie číslo tonera novšia kompatibilná verzia?", answer: "Nie automaticky. Čísla označujú konkrétne produktové rady a bez potvrdenia ich nemožno zamieňať." },
      { question: "Čo poslať podpore na overenie?", answer: "Celý model tlačiarne, fotografiu výrobného štítku a označenie pôvodnej kazety. Neposielajte sériové číslo, ak nie je potrebné." },
    ],
    links: [{ href: "/tlaciarne", label: "Výber podľa tlačiarne" }, { href: "/produkty", label: "Vyhľadať OEM alebo produkt" }, { href: "/kontakt", label: "Nechať si poradiť" }],
  },
];

export function findAdviceArticle(slug: unknown): AdviceArticle | undefined {
  const key = String(slug || "").trim().toLowerCase();
  return adviceArticles.find((article) => article.slug === key);
}
