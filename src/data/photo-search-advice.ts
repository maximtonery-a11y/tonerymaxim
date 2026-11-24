import type { AdviceArticle } from './advice.ts';
import { PHOTO_GUIDE_SLUG } from '../lib/photo-search-promo.ts';

export const photoSearchAdvice: AdviceArticle = {
  slug: PHOTO_GUIDE_SLUG,
  category: 'vyber-naplne',
  title: 'Ako nájsť správnu náplň fotoaparátom',
  description: 'Stojíte pri tlačiarni a neviete, ktorý toner alebo atrament kúpiť? Na ToneryMaxim môžete vyhľadať náplne podľa nápisu na tlačiarni alebo kódu na starej kazete.',
  answer: 'Namierte mobil na celý model tlačiarne alebo na označenie náplne. Po rozpoznaní vám priamo v našom obchode ukážeme ponuku pre prečítané označenie.',
  published: '2026-11-24',
  updated: '2026-11-24',
  readingMinutes: 2,
  topics: ['hľadanie fotoaparátom', 'model tlačiarne', 'označenie tonera', 'atramentová náplň', 'optický valec'],
  sections: [
    {
      heading: 'Kam namieriť fotoaparát?',
      paragraphs: [
        'Na tlačiarni hľadajte označenie modelu na prednom kryte alebo pri displeji. Napríklad na tlačiarni Brother je nad displejom vytlačené DCP-L3510CDW. Do záberu zahrňte celý nápis aj s poslednými písmenami.',
        'Ak máte v ruke toner, atramentovú náplň alebo optický valec, namierte na označenie výrobku na štítku. Pri valci DR-241CL-CMY je dôležitá aj koncovka CMY. Údaj S/N označuje sériové číslo konkrétneho kusu.',
      ],
    },
    {
      heading: 'Ako na to v mobile?',
      paragraphs: [],
      steps: [
        'Pod hlavným vyhľadávaním ťuknite na Spustiť fotoaparát. Pri prvom použití povoľte stránke prístup ku kamere.',
        'Namierte na označenie tak, aby bolo v rámčeku ostré a celé. Záber sa zachytí automaticky. Keď sa zobrazí potvrdenie, môžete telefón sklopiť.',
        'Pri tlačiarni sa otvorí ponuka pre rozpoznaný model. Pri kazete si môžete otvoriť detail nájdeného produktu a skontrolovať jeho farbu a výťažnosť.',
      ],
    },
    {
      heading: 'Čo ak sú na kazete dva kódy?',
      paragraphs: ['Na spoločnom štítku môže byť CF283X / CRG-737. Ak máte tlačiareň HP, vyberte HP a zobrazia sa tonery CF283X. Pre tlačiareň Canon vyberte Canon a uvidíte ponuku CRG-737.'],
    },
    {
      heading: 'Máte už fotku v počítači?',
      paragraphs: [
        'Otvorte Hľadať podľa fotky a vyberte obrázok uložený v počítači. Ak máte tlačiareň v inej miestnosti, načítajte QR kód z obrazovky mobilom. Otvorí sa stránka, na ktorej môžete spustiť fotoaparát.',
        'Ak je nápis neostrý alebo sa leskne, skúste bližší záber mierne zboku. Označenie môžete zadať aj ručne.',
      ],
    },
  ],
  faq: [
    { question: 'Kam sa odošle fotografia?', answer: 'Fotografia sa spracuje vo vašom zariadení. V katalógu sa vyhľadáva iba prečítané označenie.' },
    { question: 'Čo môžem urobiť bez prístupu ku kamere?', answer: 'Vyberte uloženú fotku alebo napíšte model tlačiarne či kód kazety do vyhľadávania.' },
  ],
  links: [{ href: '/tlaciarne', label: 'Vybrať podľa tlačiarne' }],
};
