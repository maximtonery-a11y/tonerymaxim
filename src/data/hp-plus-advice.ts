import type { AdviceArticle } from './advice.ts';
import { HP_TONER_HELP_SLUG } from '../lib/hp-toner-help.ts';

export const hpPlusAdviceArticle: AdviceArticle = {
  slug: HP_TONER_HELP_SLUG,
  category: 'cipy-firmware',
  title: 'HP+ a kompatibilné tonery: čo vypnúť a čo skontrolovať',
  description: 'Čo znamená HP+, ako nastaviť Cartridge Policy, ochranu kaziet a automatické aktualizácie firmvéru a prečo sa postup líši podľa modelu HP.',
  answer: 'Pred použitím kompatibilného tonera overte, či tlačiareň nemá aktivované HP+. Pri tlačiarni bez HP+ nastavte dostupné voľby Cartridge Policy a Cartridge Protection na Vypnuté a vypnite automatickú inštaláciu firmvéru. Aktivované HP+ však naďalej vyžaduje originálne kazety. Správny toner a jeho čip musia zároveň zodpovedať presnému modelu a aktuálnemu firmvéru tlačiarne.',
  published: '2026-10-19',
  updated: '2026-10-19',
  readingMinutes: 7,
  topics: ['HP+', 'kompatibilné tonery HP', 'Cartridge Policy', 'Cartridge Protection', 'kontrola originality', 'automatické aktualizácie firmvéru'],
  sections: [
    {
      heading: '1. Čo znamená HP+ a prečo rozhoduje o výbere tonera',
      paragraphs: [
        'HP+ je systém služieb vybraných tlačiarní HP spojený s účtom HP a internetovým pripojením. Po aktivácii platí požiadavka používať originálne atramentové alebo tonerové kazety HP počas životnosti tlačiarne.',
        'HP+ a Instant Ink sú dve odlišné veci. Instant Ink je predplatné dodávok náplní; jeho zrušením sa nezrušia podmienky aktivovaného HP+. Rovnako ich nezruší vypnutie Cartridge Policy alebo Cartridge Protection.',
      ],
      note: 'Ak má tlačiareň aktivované HP+, kompatibilný toner označený „nefunguje v HP+“ do nej nepoužite. Tento návod neslúži na vypnutie ani obídenie HP+.',
    },
    {
      heading: '2. Najskôr overte celý model a aktiváciu HP+',
      paragraphs: [
        'Model odpíšte zo štítku vrátane všetkých písmen. Napríklad M110w a M110we nie sú rovnaké označenia. Koncovka e pri podporovaných zariadeniach súvisí s ponukou HP+; možnosti aktivácie závisia od konkrétneho modelu. Ak si stavom nie ste istí, overte ho v účte HP alebo s podporou HP.',
        'Pri výbere sa riaďte celým modelom, OEM kódom pôvodnej kazety a obmedzeniami uvedenými pri konkrétnom toneri. Samotný podobný názov tlačiarne nestačí.',
      ],
    },
    {
      heading: '3. Prehľad nastavení pri tlačiarni bez HP+',
      paragraphs: ['Ak tlačiareň tieto nastavenia ponúka, pred vložením kompatibilného tonera ich skontrolujte:'],
      bullets: [
        'Cartridge Policy / Authorized HP Cartridge Policy – Vypnuté (Off). Táto politika môže povoľovať iba originálne kazety HP.',
        'Cartridge Protection / Ochrana kaziet – Vypnuté (Off). Zabránite priradeniu ďalších vložených kaziet iba k jednej tlačiarni.',
        'Automatická inštalácia firmvéru – Vypnutá. Ak je dostupná voľba Notify / Upozorniť, môžete ponechať upozornenia a o inštalácii rozhodovať manuálne.',
      ],
      note: 'Vypnutie týchto volieb samo osebe nezaručuje fungovanie každej kazety. Rozhoduje aj jej správny typ, čip a už nainštalovaný firmvér.',
    },
    {
      heading: '4. Cartridge Policy: obmedzenie na originálne kazety',
      paragraphs: [
        'Pri HP LaserJet Pro MFP 4301, 4302 a 4303 otvorte na displeji Menu → Settings (Nastavenia) → Supplies (Spotrebný materiál). Prepínač Authorized HP Cartridge Policy nastavte na vypnutý.',
        'Pri iných modeloch hľadajte Cartridge Policy v nastavení spotrebného materiálu, prípadne vo webovom rozhraní tlačiarne. Dostupnosť a názvy ponúk sa líšia. Ak voľbu nevidíte, postup z iného modelu nepoužívajte naslepo.',
      ],
    },
    {
      heading: '5. Cartridge Protection: ochrana kazety pred použitím inde',
      paragraphs: [
        'Ochrana kaziet viaže toner k určitej tlačiarni alebo skupine tlačiarní. Nie je totožná s kontrolou originality. Na podporovaných modeloch ju nájdete v nastaveniach spotrebného materiálu vedľa politiky kaziet; nastavte ju na Vypnuté ešte pred vložením novej kazety.',
        'Vypnutie ochrany pôsobí na ďalšie vložené kazety. Už chránenú kazetu tým neodomknete na použitie v inej tlačiarni.',
      ],
    },
    {
      heading: '6. Kde otvoriť nastavenia, keď tlačiareň nemá displej',
      paragraphs: [
        'Počítač alebo telefón pripojte do rovnakej siete ako tlačiareň. V aplikácii HP, predtým HP Smart, vyberte tlačiareň a otvorte Advanced Settings / Rozšírené nastavenia. Otvorí sa jej webové rozhranie EWS. Alternatívou je zadať IP adresu tlačiarne do adresného riadka prehliadača.',
        'Ak sa vyžaduje prihlásenie, použite oprávnenie správcu; pri nezmenenom predvolenom prístupe môže byť potrebný PIN zo štítku tlačiarne. Napríklad dokumentácia radu M109–M112 uvádza ponuku System → Administration. Neznamená to, že každý takýto model ponúka všetky prepínače politiky a ochrany kaziet.',
      ],
    },
    {
      heading: '7. Ako vypnúť automatickú inštaláciu firmvéru',
      paragraphs: [
        'Pri HP LaserJet Pro MFP 4301, 4302 a 4303 otvorte Menu → Settings → Printer Update → Allow Updates. Voľba Auto Update aktualizácie inštaluje automaticky; Notify iba upozorní a nechá vás rozhodnúť. Pri Do Not Check tlačiareň nové verzie sama nevyhľadáva. Pre manuálne rozhodovanie zvoľte Notify, prípadne vypnite automatickú inštaláciu podľa ponuky svojho modelu.',
        'V EWS iných modelov hľadajte Printer Update, Firmware Update alebo Administration. Pred inštaláciou novej verzie overte zhodu čipu používanej kazety. Pozor: pri niektorých modeloch tlačidlo Check Now / Skontrolovať teraz spustí aj inštaláciu nájdenej aktualizácie.',
        'Automatickú inštaláciu možno vypnúť len vtedy, keď to model a používané služby dovoľujú. Niektoré programy HP automatické aktualizácie vyžadujú. Vypnutím automatickej inštalácie sa už nainštalovaný firmvér nevráti na staršiu verziu.',
      ],
      note: 'Aktualizácie môžu obsahovať aj bezpečnostné opravy. Pri manuálnom režime ich pravidelne preverujte a pred inštaláciou overte čip. Prebiehajúcu aktualizáciu neprerušujte vypnutím tlačiarne.',
    },
    {
      heading: '8. Čo znamená kontrola originality a dynamické zabezpečenie',
      paragraphs: [
        'Pod kontrolou originality sa často myslí Cartridge Policy. Vypnutie tejto politiky však nevypína HP+ ani všetky ďalšie kontroly čipu. HP používa na niektorých zariadeniach aj dynamické zabezpečenie, ktoré môže odmietnuť kazetu s nepodporovaným čipom; nová verzia firmvéru môže zablokovať aj kazetu, ktorá predtým fungovala.',
        'Tieto funkcie preto nemožno zamieňať ani sľúbiť, že jediný prepínač vyrieši každý problém. Zároveň nemusí existovať samostatná voľba nazvaná „kontrola originality“. Nastavenia meniť môžete iba v rozsahu, ktorý vaša tlačiareň sprístupňuje.',
      ],
    },
    {
      heading: '9. Tlačiareň toner stále nerozpoznáva?',
      paragraphs: [
        'Overte úplné označenie tonera, odstránenie prepravných prvkov a správne vloženie kazety. Zapíšte presné chybové hlásenie a aktuálnu verziu firmvéru. Ak pôvodná kazeta funguje a nová nie, tieto údaje nám pomôžu rozlíšiť nesprávny variant, problém čipu alebo chybu kazety.',
        'Pošlite nám model tlačiarne, označenie tonera, verziu firmvéru a hlásenie. Podľa typu náplne preveríme dostupnosť vhodného čipu a ďalší postup. Nenahrávajte neoficiálny firmvér ani nevykonávajte náhodný továrenský reset.',
      ],
    },
  ],
  faq: [
    { question: 'Stačí vypnúť Cartridge Policy, aby toner fungoval v HP+?', answer: 'Nie. Aktivované HP+ má vlastnú požiadavku na originálne kazety HP. Vypnutie politiky alebo ochrany kaziet túto podmienku nemení.' },
    { question: 'Je ochrana kaziet to isté ako kontrola originality?', answer: 'Nie. Cartridge Policy obmedzuje typ povolených kaziet. Cartridge Protection viaže kazetu k určitej tlačiarni. Dynamické zabezpečenie je ďalšia kontrola čipu.' },
    { question: 'Musí mať každá tlačiareň všetky uvedené voľby?', answer: 'Nie. Ponuky závisia od modelu, firmvéru a používaných služieb. Ak prepínač chýba, neznamená to, že je pokazená tlačiareň alebo že treba použiť reset.' },
    { question: 'Zaručí vypnutie nastavení bezproblémovú tlač?', answer: 'Samotné nastavenia nie. Toner musí zodpovedať modelu tlačiarne a jeho čip aktuálnemu firmvéru. Pri neistote to overte pred objednaním.' },
  ],
  links: [
    { href: '/poradna/aktualizacia-firmveru-a-kompatibilny-toner', label: 'Firmvér a možnosti úpravy čipu' },
    { href: '/tlaciarne/hp', label: 'Náplne podľa modelu HP' },
    { href: '/kontakt', label: 'Pomoc s tonerom a nastavením' },
  ],
  sources: [
    { href: 'https://support.hp.com/ca-en/document/ish_5098782-5098911-16', label: 'HP: požiadavky aktivovaného HP+' },
    { href: 'https://www.hp.com/us-en/printers/hp-plus/faq.html', label: 'HP: HP+ a rozdiel oproti Instant Ink' },
    { href: 'https://support.hp.com/us-en/document/ish_7569532-7569576-16', label: 'HP: Cartridge Policy a Cartridge Protection pri MFP 4301–4303' },
    { href: 'https://support.hp.com/au-en/document/ish_7582388-7582482-16', label: 'HP: aktualizácie firmvéru pri MFP 4301–4303' },
    { href: 'https://support.hp.com/au-en/document/ish_4465046-4416901-16', label: 'HP: prístup k EWS a aktualizáciám radu M109–M112' },
    { href: 'https://support.hp.com/sk-en/document/ish_1776648-1643972-16', label: 'HP: firmvér a dynamické zabezpečenie' },
  ],
};
