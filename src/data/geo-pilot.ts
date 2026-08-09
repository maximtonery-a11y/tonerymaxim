export type GeoPilotProfile = {
  key: string;
  aliases?: string[];
  productKind: string;
  selection: string;
  caution: string;
  adviceLinks: Array<{ href: string; label: string }>;
};

const normalize = (value: unknown) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

/**
 * Pilotná sada 20 často vyhľadávaných modelových rodín.
 * Aliasy pokrývajú rozdielne zápisy MFP/Pro/Xpress bez vytvárania nových URL.
 */
export const printerGeoPilot: GeoPilotProfile[] = [
  { key: "HP LaserJet P1102", aliases: ["hp laserjet p1102", "hp laserjet pro p1102", "hp laserjet p1102w"], productKind: "čierny toner", selection: "Pri rade P1102 sa najčastejšie porovnáva kazeta HP 85A (CE285A) a jej kompatibilné alebo renovované alternatívy.", caution: "Nezamieňajte CE285A s podobne vyzerajúcimi kazetami pre inú generáciu LaserJet.", adviceLinks: [{ href: "/poradna/ako-vybrat-toner-podla-modelu-tlaciarne", label: "Výber podľa modelu" }, { href: "/poradna/kompatibilny-alebo-originalny-toner", label: "Originál alebo kompatibilný" }] },
  { key: "HP LaserJet Pro M110", aliases: ["hp laserjet m110", "hp laserjet m110w", "hp laserjet m110we"], productKind: "čierny toner", selection: "Modelová rada M110 používa spotrebný materiál radu HP 142A; konkrétnu regionálnu verziu vždy potvrďte podľa kazety a detailu produktu.", caution: "Koncovka e pri zariadeniach HP môže súvisieť so službou HP+ a podmienkami používania kaziet.", adviceLinks: [{ href: "/poradna/ako-najst-toner-podla-oem-kodu", label: "Kontrola OEM kódu" }, { href: "/poradna/najcastejsie-chyby-pri-vybere-naplne", label: "Chyby pri výbere" }] },
  { key: "HP LaserJet M140", aliases: ["hp laserjet m140", "hp laserjet m140w", "hp laserjet m140we", "hp laserjet mfp m140"], productKind: "čierny toner", selection: "Pri multifunkčnej rade M140 overujte toner HP 142A podľa celého názvu modelu a označenia pôvodnej kazety.", caution: "Model tlačiarne a kazeta musia patriť do rovnakého regiónu a produktovej generácie.", adviceLinks: [{ href: "/poradna/ako-najst-toner-podla-oem-kodu", label: "Ako nájsť OEM" }] },
  { key: "HP LaserJet Pro M404", aliases: ["hp laserjet pro m404", "hp laserjet pro m404dn", "hp laserjet pro m404dw", "hp laserjet m404"], productKind: "čierny toner", selection: "Rada M404 používa kazety HP 59A/59X; vysokokapacitný variant vyberte iba vtedy, ak ho uvádza kompatibilita konkrétneho modelu.", caution: "Rozdiel medzi štandardnou a vysokou kapacitou ovplyvňuje cenu za stranu aj podporu zariadenia.", adviceLinks: [{ href: "/poradna/co-znamena-vytaznost-tonera", label: "Výťažnosť tonera" }] },
  { key: "HP LaserJet Pro M428", aliases: ["hp laserjet pro m428", "hp laserjet pro mfp m428", "hp laserjet pro mfp m428fdw", "hp laserjet m428"], productKind: "čierny toner", selection: "Pre rad M428 sa porovnávajú kazety HP 59A/59X. Pred objednaním overte kapacitu a celý model zariadenia.", caution: "Toner a zobrazovací valec alebo servisný diel nie sú automaticky rovnaký produkt.", adviceLinks: [{ href: "/poradna/toner-alebo-opticky-valec", label: "Toner alebo valec" }] },
  { key: "Brother DCP-L2532DW", aliases: ["brother dcp l2532dw", "brother dcp-l2532dw"], productKind: "čierny toner a samostatný valec", selection: "Pre DCP-L2532DW overujte toner TN-2421/TN-2411 a samostatný optický valec DR-2401 podľa požadovanej kapacity.", caution: "TN označuje toner, DR označuje optický valec; tieto diely sa nemenia vždy súčasne.", adviceLinks: [{ href: "/poradna/toner-alebo-opticky-valec", label: "Rozdiel toner a valec" }] },
  { key: "Brother HL-L2352DW", aliases: ["brother hl l2352dw", "brother hl-l2352dw"], productKind: "čierny toner a samostatný valec", selection: "Model HL-L2352DW používa tonerovú rodinu TN-2411/TN-2421 a valec DR-2401.", caution: "Pri hlásení Drum nekupujte automaticky toner; skontrolujte stav oboch spotrebných dielov.", adviceLinks: [{ href: "/poradna/toner-alebo-opticky-valec", label: "Kedy meniť valec" }] },
  { key: "Brother MFC-L2712DW", aliases: ["brother mfc l2712dw", "brother mfc-l2712dw"], productKind: "čierny toner a samostatný valec", selection: "Pre MFC-L2712DW sa bežne vyberá TN-2411 alebo vysokokapacitný TN-2421; valec DR-2401 je samostatný diel.", caution: "Pri výbere vyššej kapacity porovnajte výťažnosť a reálny objem mesačnej tlače.", adviceLinks: [{ href: "/poradna/co-znamena-vytaznost-tonera", label: "Ako porovnať výťažnosť" }] },
  { key: "Brother DCP-L2622DW", aliases: ["brother dcp l2622dw", "brother dcp-l2622dw"], productKind: "čierny toner a samostatný valec", selection: "Novšia rada DCP-L2622DW používa tonerovú rodinu TN-2510/TN-2510XL; kompatibilitu potvrďte podľa detailu produktu.", caution: "Nezamieňajte TN-2510 so staršou rodinou TN-2421 iba podľa podobnosti tlačiarne.", adviceLinks: [{ href: "/poradna/najcastejsie-chyby-pri-vybere-naplne", label: "Najčastejšie chyby" }] },
  { key: "Canon i-SENSYS MF3010", aliases: ["canon i sensys mf3010", "canon mf3010"], productKind: "čierna tonerová kazeta", selection: "Pre Canon MF3010 sa overuje kazeta Canon 725 (CRG-725), ktorá obsahuje toner aj obrazový valec v jednej zostave.", caution: "Označenie 725 porovnajte s celým modelom; podobné kazety Canon nemusia byť mechanicky zameniteľné.", adviceLinks: [{ href: "/poradna/ako-najst-toner-podla-oem-kodu", label: "Výber podľa OEM" }] },
  { key: "Canon i-SENSYS LBP6030", aliases: ["canon i sensys lbp6030", "canon lbp6030", "canon lbp6030b", "canon lbp6030w"], productKind: "čierna tonerová kazeta", selection: "Modelová rodina LBP6030 používa kazetu Canon 725 (CRG-725). Variant zariadenia skontrolujte v zozname kompatibility.", caution: "Fotografia kazety nestačí; rozhodujú OEM údaje a presný model tlačiarne.", adviceLinks: [{ href: "/poradna/najcastejsie-chyby-pri-vybere-naplne", label: "Kontrola pred nákupom" }] },
  { key: "Canon i-SENSYS MF655Cdw", aliases: ["canon i sensys mf655cdw", "canon mf655cdw"], productKind: "farebné tonerové kazety", selection: "Pre MF655Cdw overujte rodinu Canon 067/067H samostatne pre Black, Cyan, Magenta a Yellow.", caution: "Koncovka H označuje vyššiu kapacitu; farby ani kapacity nie sú navzájom zameniteľné.", adviceLinks: [{ href: "/poradna/co-znamena-vytaznost-tonera", label: "Kapacita a výťažnosť" }] },
  { key: "Epson EcoTank L3250", aliases: ["epson ecotank l3250", "epson l3250"], productKind: "atrament vo fľašiach", selection: "EcoTank L3250 používa atramentové fľaše určené pre túto regionálnu modelovú radu; vyberajte samostatne čiernu a farebné náplne.", caution: "Tento model nepoužíva klasickú tonerovú kazetu. Nesprávny typ atramentu môže ovplyvniť tlačovú hlavu.", adviceLinks: [{ href: "/poradna/ako-vybrat-toner-podla-modelu-tlaciarne", label: "Výber podľa zariadenia" }] },
  { key: "Epson EcoTank L3150", aliases: ["epson ecotank l3150", "epson l3150"], productKind: "atrament vo fľašiach", selection: "Pri L3150 overte číslo atramentovej fľaše a farbu podľa pôvodného balenia alebo návodu zariadenia.", caution: "Podobný vzhľad fľaše nepotvrdzuje správny atrament ani regionálnu kompatibilitu.", adviceLinks: [{ href: "/poradna/ako-najst-toner-podla-oem-kodu", label: "Ako overiť označenie" }] },
  { key: "Epson WorkForce WF-2930DWF", aliases: ["epson workforce wf 2930dwf", "epson wf 2930dwf", "epson wf-2930dwf"], productKind: "atramentové kazety", selection: "Pre WF-2930DWF sa overuje rodina Epson 604/604XL a konkrétna farba kazety.", caution: "Štandardná a XL kapacita sa líšia množstvom atramentu; vždy potvrďte presný model a regionálne označenie.", adviceLinks: [{ href: "/poradna/co-znamena-vytaznost-tonera", label: "Ako porovnať kapacitu" }] },
  { key: "Samsung Xpress M2026", aliases: ["samsung xpress m2026", "samsung sl m2026", "samsung m2026", "samsung m2026w"], productKind: "čierna tonerová kazeta", selection: "Pre Samsung Xpress M2026 overujte kazetu MLT-D111S alebo zodpovedajúcu kapacitnú verziu podľa regiónu.", caution: "Rady Samsung SL-M a Samsung M musia zodpovedať presnému modelu a čipu kazety.", adviceLinks: [{ href: "/poradna/ako-najst-toner-podla-oem-kodu", label: "Kontrola OEM kódu" }] },
  { key: "Samsung Xpress M2070", aliases: ["samsung xpress m2070", "samsung sl m2070", "samsung m2070", "samsung m2070w", "samsung m2070fw"], productKind: "čierna tonerová kazeta", selection: "Modelová rada M2070 používa toner MLT-D111S; presnú verziu zariadenia a kazety potvrďte v detaile produktu.", caution: "Valec je súčasťou kazety, ale ďalšie servisné diely tlačiarne sú samostatné.", adviceLinks: [{ href: "/poradna/toner-alebo-opticky-valec", label: "Toner a obrazový valec" }] },
  { key: "Kyocera ECOSYS M2040dn", aliases: ["kyocera ecosys m2040dn", "kyocera m2040dn"], productKind: "čierny toner", selection: "Pre ECOSYS M2040dn overujte toner TK-1170 a jeho deklarovanú výťažnosť.", caution: "Tonerová nádoba nie je totožná s vývojkou ani optickou jednotkou zariadenia.", adviceLinks: [{ href: "/poradna/toner-alebo-opticky-valec", label: "Rozlíšenie spotrebných dielov" }] },
  { key: "OKI C301", aliases: ["oki c301", "oki c301dn"], productKind: "farebné tonery a samostatné valce", selection: "OKI C301 používa samostatné tonery a obrazové valce pre jednotlivé farby. Každú farbu a typ dielu vyberajte osobitne.", caution: "Toner a image drum majú rozdielne označenia aj životnosť; pri pásoch najskôr diagnostikujte príčinu.", adviceLinks: [{ href: "/poradna/tlaciaren-tlaci-pasy-alebo-bledo", label: "Diagnostika pásov" }, { href: "/poradna/toner-alebo-opticky-valec", label: "Toner alebo valec" }] },
  { key: "Xerox B225", aliases: ["xerox b225", "xerox b225v", "xerox b225dni"], productKind: "čierny toner a zobrazovacia jednotka", selection: "Pri Xerox B225 porovnajte štandardnú alebo vysokokapacitnú kazetu podľa presného OEM označenia uvedeného pri produkte.", caution: "Kapacita toneru a životnosť zobrazovacej jednotky sú samostatné údaje.", adviceLinks: [{ href: "/poradna/co-znamena-vytaznost-tonera", label: "Výťažnosť a cena za stranu" }] },
];

export const oemGeoPilot: GeoPilotProfile[] = [
  ["CE285A", "čierny toner HP 85A", "Porovnajte originálnu, kompatibilnú a renovovanú verziu s rovnakým úplným kódom.", "Nezamieňajte ho s CF283A alebo inou podobne vyzerajúcou kazetou."],
  ["CF283A", "čierny toner HP 83A", "Vyberte typ produktu a skontrolujte tlačiareň v zozname kompatibility.", "Variant A a prípadné regionálne verzie porovnajte znak po znaku."],
  ["CF217A", "čierny toner HP 17A", "Overte toner 17A a pri potrebe valca samostatnú zobrazovaciu jednotku.", "Toner CF217A a valec CF219A nie sú rovnaký diel."],
  ["CF259A", "čierny toner HP 59A", "Porovnajte štandardnú 59A a podporovanú vysokokapacitnú verziu.", "Nie každý model podporuje každú kapacitnú verziu."],
  ["W1106A", "čierny toner HP 106A", "Skontrolujte presný model zariadenia a čip kompatibilnej kazety.", "Aktualizácia firmvéru môže pri niektorých alternatívach ovplyvniť rozpoznanie."],
  ["W1420A", "čierny toner HP 142A", "Potvrďte celý model tlačiarne vrátane prípadnej koncovky e.", "Podmienky zariadení HP+ môžu ovplyvniť použitie alternatívnych kaziet."],
  ["TN2421", "vysokokapacitný čierny toner Brother", "Porovnajte ho so štandardnou kapacitou a overte model tlačiarne.", "TN-2421 nie je optický valec DR-2401."],
  ["TN2510", "čierny toner Brother", "Overte štandardnú alebo XL verziu podľa konkrétneho zariadenia.", "Nezamieňajte ho so staršou rodinou TN-2421."],
  ["TN1030", "čierny toner Brother", "Skontrolujte podporované modely a samostatný valec príslušnej rady.", "Toner a valec majú odlišné označenia aj interval výmeny."],
  ["CRG725", "čierna kazeta Canon 725", "Porovnajte Canon 725 podľa úplného modelu tlačiarne.", "Podobný tvar inej kazety Canon nepotvrdzuje kompatibilitu."],
  ["CRG737", "čierna kazeta Canon 737", "Vyberte originálny alebo vhodný alternatívny produkt s presným označením 737.", "Kód tlačiarne a kód kazety nie sú to isté."],
  ["CRG054", "farebná tonerová rodina Canon 054", "Vyberte samostatne Black, Cyan, Magenta alebo Yellow a požadovanú kapacitu.", "Farby ani štandardná a H kapacita nie sú vzájomne zameniteľné."],
  ["CRG067", "farebná tonerová rodina Canon 067", "Skontrolujte farbu, štandardnú alebo H kapacitu a model tlačiarne.", "Samotný základ 067 nestačí na výber konkrétnej kazety."],
  ["CRG069", "farebná tonerová rodina Canon 069", "Porovnajte označenie farby a kapacity pri každom produkte.", "Objednávajte podľa technických údajov, nie iba podľa fotografie obalu."],
  ["C13T10H64010", "multipack Epson 604XL", "Overte počet kaziet, farby a podporu modelu tlačiarne.", "Jednotlivé 604/604XL kazety a multipack majú rozdielne objednávacie kódy."],
  ["PG545", "čierna atramentová kazeta Canon PG-545", "Porovnajte štandardnú a XL kapacitu a presný model PIXMA.", "PG-545 je čierna kazeta; farebná kazeta má samostatné označenie CL-546."],
  ["CL546", "farebná atramentová kazeta Canon CL-546", "Skontrolujte štandardnú alebo XL kapacitu a zoznam tlačiarní.", "Farebná CL-546 nenahrádza čiernu PG-545."],
  ["MLTD111S", "čierny toner Samsung MLT-D111S", "Overte presný model Samsung Xpress/SL-M a kompatibilný čip.", "Podobná séria Samsung nemusí používať rovnakú kazetu."],
  ["TK1170", "čierny toner Kyocera TK-1170", "Porovnajte výťažnosť, typ produktu a presné zariadenie ECOSYS.", "Toner nie je vývojka ani optická jednotka."],
  ["DR2401", "optický valec Brother DR-2401", "Kupujte ho pri dosiahnutí životnosti valca, nie automaticky pri minutí tonera.", "DR-2401 je valec; TN-2411/TN-2421 sú tonerové kazety."],
].map(([key, productKind, selection, caution]) => ({
  key,
  productKind,
  selection,
  caution,
  adviceLinks: [
    { href: "/poradna/ako-najst-toner-podla-oem-kodu", label: "Ako overiť OEM kód" },
    { href: "/poradna/najcastejsie-chyby-pri-vybere-naplne", label: "Kontrola pred nákupom" },
  ],
}));

export function findPrinterGeoPilot(name: unknown): GeoPilotProfile | undefined {
  const value = normalize(name);
  return printerGeoPilot.find((profile) => (profile.aliases || [profile.key]).some((alias) => {
    const candidate = normalize(alias);
    return value === candidate || value.includes(candidate);
  }));
}

export function findOemGeoPilot(code: unknown): GeoPilotProfile | undefined {
  const value = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return oemGeoPilot.find((profile) => profile.key === value);
}

export function pilotFaq(subject: string, profile: GeoPilotProfile) {
  return [
    { question: `Ako správne vybrať ${subject}?`, answer: `${profile.selection} Pred objednaním potvrďte presný model zariadenia v detaile konkrétneho produktu.` },
    { question: `Na čo si dať pozor pri ${subject}?`, answer: profile.caution },
    { question: `Je pre ${subject} vhodná kompatibilná alternatíva?`, answer: "Áno, ak má presné OEM označenie, je určená pre váš celý model tlačiarne a predajca jasne uvádza typ, kapacitu a podmienky záruky." },
  ];
}
