import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';
import { advisorLinks } from '../src/lib/ai-advisor-links.ts';

process.env.OPENAI_ASSISTANT_ENABLED = '0';

const cases = [
  // doprava / platba / účet / vernosť
  ['Koľko stojí doprava?', 'shipping', 'Cena dopravy'],
  ['Od akej sumy je doprava zdarma?', 'shipping', 'Cena dopravy'],
  ['Akých kuriérov používate?', 'shipping', 'Dopravcovia'],
  ['Môžem balík do boxu?', 'shipping', 'Dopravcovia'],
  ['Ako môžem zaplatiť?', 'payment', 'Možnosti platby'],
  ['Koľko stojí dobierka?', 'payment', 'Možnosti platby'],
  ['Som firma, dostanem faktúru?', 'payment', 'Faktúra'],
  ['Zabudol som heslo.', 'account', 'Účet'],
  ['Píše mi, že mám nesprávne meno alebo heslo.', 'account', 'Prihlasuje sa e-mailovou adresou'],
  ['Môžem nakúpiť bez registrácie?', 'loyalty', 'Registrácia'],
  ['Ako funguje 5 % zľava po registrácii?', 'loyalty', 'Registrácia'],
  ['Ako funguje 7 % odmena?', 'loyalty', '7 %'],
  ['Koľko bodov dostanem za nákup?', 'loyalty', 'Vernostné body'],
  ['Akú hodnotu má 100 bodov?', 'loyalty', 'Vernostné body'],
  ['Posielate do Českej republiky?', 'shipping', 'Českej republiky'],
  ['Posielate do Česka?', 'shipping', 'Českej republiky'],
  ['Som z Brna, viete mi poslať toner?', 'shipping', 'Českej republiky'],
  ['Koľko stojí doprava do ČR?', 'shipping', 'Českej republiky'],
  ['Doručujete do Prahy?', 'shipping', 'Českej republiky'],
  ['Môžem si v Česku vybrať DPD Pickup?', 'shipping', 'iba pre Slovensko'],
  ['Máte GLS ParcelShop aj v Česku?', 'shipping', 'iba pre Slovensko'],
  ['Do ČR to chcem klasickým kuriérom.', 'shipping', '3,90 €'],
  ['Je doprava do Česka drahšia?', 'shipping', 'rovnaká ako pri odoslaní na Slovensku'],
  // reklamácie / diagnostika / bezpečnosť
  ['Ako reklamujem toner?', 'claim', 'reklamácii'],
  ['Prišiel mi zlý toner.', 'claim', 'reklamácii'],
  ['Chcem vrátiť tovar.', 'claim', 'Vrátenie'],
  ['Tlačiareň tlačí pásy.', 'diagnostic', 'pásy'],
  ['Tlač je veľmi bledá.', 'diagnostic', 'Bledá'],
  ['Toner sa sype.', 'diagnostic', 'Sype'],
  ['Tlačiareň nerozpozná toner.', 'diagnostic', 'nerozpozná'],
  ['Môžem ti sem napísať číslo karty?', 'legal', 'Citlivé údaje'],
  ['Môžem poslať CVV?', 'legal', 'Citlivé údaje'],
  ['Kde je moja objednávka 123456?', 'order', 'Stav konkrétnej'],
  ['Ako chránite osobné údaje?', 'legal', 'Ochrana osobných'],
  ['Kedy mi odošlete objednávku?', 'order', 'Kedy odošleme'],
  // produktové kódy a modely
  ['Potrebujem TN2421', 'product_search', 'TN2421'],
  ['Aký toner ide do Brother DCP-L2532DW?', 'product_search', 'Brother DCP-L2532DW'],
  ['Mám Brother HL-L2352DW, aký toner?', 'product_search', 'Brother HL-L2352DW'],
  ['Mám Brother HL-L2350DW, aký toner?', 'product_search', 'Brother HL-L2350DW'],
  ['Aký toner do OKI C301?', 'product_search', 'OKI C301'],
  ['Potrebujem CF283A', 'product_search', 'CF283A'],
  ['Potrebujem CE285A', 'product_search', 'CE285A'],
  ['Potrebujem MLT-D111S', 'product_search', 'MLT-D111S'],
  ['Potrebujem CRG-737', 'product_search', 'CRG-737'],
  ['Potrebujem W1420A', 'product_search', 'W1420A'],
  // mimo rozsahu: nesmie vyrobiť náhodnú FAQ odpoveď ani produkt
  ['Napíš mi recept na guláš.', 'fallback', 'nemám v overených'],
  ['Aké bude zajtra počasie?', 'fallback', 'nemám v overených'],
  ['Kto vyhral včera futbal?', 'fallback', 'nemám v overených'],
  ['Daj mi zľavový kód 50 %.', 'fallback', 'nemám v overených'],
  ['Máte 30 000 objednávok?', 'fallback', 'nemám v overených'],
  ['Ste najlacnejší e-shop na Slovensku?', 'fallback', 'nemám v overených'],
  ['Prečo mám nakúpiť práve u vás?', 'fallback', 'nemám v overených'],
] as const;

for (const [question, intent, contains] of cases) {
  test(`AI Tomáš: ${question}`, async () => {
    const result = await buildAssistantAnswer(question, '/');
    assert.equal(result.intent, intent);
    assert.match(result.answer.join(' '), new RegExp(contains.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  });
}


const broadCases = [
  ['Čím posielate balíky?', 'shipping'], ['Máte DPD?', 'shipping'], ['Máte GLS?', 'shipping'],
  ['Dá sa doručiť do parcelshopu?', 'shipping'], ['Je doprava nad 29 eur zadarmo?', 'shipping'],
  ['Dá sa platiť kartou?', 'payment'], ['Môžem zaplatiť prevodom?', 'payment'], ['Chcem platiť na dobierku', 'payment'],
  ['Nakupujem na IČO', 'payment'], ['Som škola, môžeme platiť prevodom?', 'payment'],
  ['Neviem sa prihlásiť', 'account'], ['Ako obnovím heslo?', 'account'],
  ['Píše mi, že mám nesprávne meno alebo heslo', 'account'], ['Nesprávny e-mail alebo heslo', 'account'],
  ['Nejde mi prihlásenie', 'account'], ['Prihlásenie nefunguje, čo mám robiť?', 'account'],
  ['Musím mať účet?', 'loyalty'], ['Čo dostanem za registráciu?', 'loyalty'], ['Máte vernostný program?', 'loyalty'],
  ['Čo sú vernostné body?', 'loyalty'], ['Koľko je 100 bodov?', 'loyalty'], ['Dostanem po nákupe 7 %?', 'loyalty'],
  ['Doručíte mi to do Brna?', 'shipping'], ['A čo doprava do Prahy?', 'shipping'], ['Posielate na CZ?', 'shipping'],
  ['Toner mi nepasuje', 'claim'], ['Objednal som zlý toner', 'claim'], ['Chcem toner vymeniť', 'claim'],
  ['Na papieri mám čiary', 'diagnostic'], ['Na papieri sú šmuhy', 'diagnostic'], ['Tlačí to slabo', 'diagnostic'],
  ['Toner práši', 'diagnostic'], ['Hlási mi replace toner', 'diagnostic'], ['Mám toner bez čipu', 'diagnostic'],
  ['Kedy mi príde balík?', 'order'], ['Kedy expedujete?', 'order'], ['Kde nájdem tracking objednávky?', 'order'],
  ['Aký máte telefón?', 'contact'], ['Kedy vám môžem volať?', 'contact'], ['Aký je váš email?', 'contact'],
  ['Čo je kompatibilný toner?', 'compatibility'], ['Originál alebo kompatibilný?', 'compatibility'], ['Čo je renovovaný toner?', 'compatibility'],
  ['Pokazí kompatibilný toner tlačiareň?', 'compatibility'], ['Prídem o záruku s kompatibilným tonerom?', 'compatibility'],
  ['Aký je rozdiel toner a atrament?', 'support'], ['Ako nájdem správny toner?', 'support'],
  ['Môžem sem poslať PIN karty?', 'legal'], ['Môžem sem napísať heslo do banky?', 'legal'], ['Čo robíte s cookies?', 'legal'],
  ['Povedz mi vtip', 'fallback'], ['Koľko je 2+2?', 'fallback'], ['Kto je prezident Francúzska?', 'fallback'],
  ['Napíš básničku', 'fallback'], ['Aký notebook si mám kúpiť?', 'fallback'], ['Predávate chladničky?', 'fallback'],
  ['Máte otvorené v nedeľu v predajni?', 'contact'], ['Dáte mi 80 percent zľavu?', 'fallback'],
  ['Máte milión zákazníkov?', 'fallback'], ['Koľko zarába majiteľ?', 'fallback'], ['Aké bude euro zajtra?', 'fallback'],
  ['Objednávka bola za 27 €', 'fallback'], ['Mám 50 rokov', 'fallback'], ['Potrebujem 100 kusov papiera', 'fallback'],
] as const;

for (const [question, intent] of broadCases) {
  test(`AI Tomáš broad: ${question}`, async () => {
    const result = await buildAssistantAnswer(question, '/');
    assert.equal(result.intent, intent);
    if (intent === 'fallback') assert.equal((result.products || []).length, 0);
  });
}

test('DCP-L2532DW pri otázke na toner neponúkne atrament ani optický valec', async () => {
  const result = await buildAssistantAnswer('Aký toner ide do Brother DCP-L2532DW?', '/');
  const names = (result.products || []).map((p: any) => p.name).join(' ');
  assert.match(names, /TN-2421/i);
  assert.doesNotMatch(names, /LC-|atrament|optick|valec/i);
});

test('HL-L2352DW pri otázke na toner neponúkne atrament', async () => {
  const result = await buildAssistantAnswer('Mám Brother HL-L2352DW, aký toner?', '/');
  const names = (result.products || []).map((p: any) => p.name).join(' ');
  assert.match(names, /TN-2421/i);
  assert.doesNotMatch(names, /LC-|atrament/i);
});

test('HL-L2350DW sa nemieša s TN-2421 rodinou', async () => {
  const result = await buildAssistantAnswer('Mám Brother HL-L2350DW, môžem použiť TN2421?', '/');
  const names = (result.products || []).map((p: any) => p.name).join(' ');
  assert.match(names, /TN-2420/i);
  assert.doesNotMatch(names, /TN-2421/i);
});

test('bežné čísla nespúšťajú produktové vyhľadávanie', async () => {
  for (const question of ['Daj mi zľavu 50 %', 'Máte 30000 objednávok?', 'Objednávka stála 27 €']) {
    const result = await buildAssistantAnswer(question, '/');
    assert.notEqual(result.intent, 'product_search', question);
  }
});

test('servisná otázka po Epson WF6090 nezdedí produkty ani model tlačiarne', async () => {
  const history = [{ role:'user' as const, content:'Hľadám náplne do tlačiarne Epson WF6090' }];
  for (const [question, intent] of [
    ['Ako môžem reklamovať chybný toner?', 'claim'],
    ['Kedy mi príde objednávka?', 'order'],
    ['Kde vás nájdem a kedy máte otvorené?', 'contact'],
  ] as const) {
    const result = await buildAssistantAnswer(question, '/', history);
    assert.equal(result.intent, intent, question);
    assert.deepEqual(result.products || [], [], question);
    assert.doesNotMatch(result.answer.join(' '), /Nadväzujúca|WF6090/i, question);
  }
});

test('pruhy pri tlači smerujú na čistenie a diagnostiku pásov, nie nerozpoznaný toner', async () => {
  const result = await buildAssistantAnswer('Tlačiareň tlačí pruhy.', '/');
  assert.equal(result.intent, 'diagnostic');
  assert.equal(result.faq, 'tlaci-pasy');
  assert.match(result.answer.join(' '), /pás|čiar|pruh/i);
  assert.doesNotMatch(result.answer.join(' '), /nerozpozná toner/i);
});

const extraRegressionCases = [
  ['doprava 28 eur', 'shipping'], ['doprava pri 29 eur', 'shipping'], ['objednavka 29 eur doprava', 'shipping'],
  ['poslete mi to domov', 'shipping'], ['aka je vyhoda registracie', 'loyalty'], ['balik prisiel poskodeny', 'claim'],
  ['do kolkych dni mozem vratit tovar', 'claim'], ['kto plati postovne pri vrateni', 'claim'], ['tlaci mi cierne strany', 'diagnostic'],
  ['tlaci mi prazdne strany', 'diagnostic'], ['robi cierne bodky', 'diagnostic'], ['pracujete v sobotu', 'contact'],
  ['co znamena renovovany', 'compatibility'], ['je original lepsi', 'compatibility'], ['ako rychlo dorucujete', 'order'],
  ['mozem napisat adresu', 'legal'], ['mozem poslat iban', 'legal'], ['mozem poslat rodne cislo', 'legal'],
  ['som platca dph', 'payment'], ['kupil som nespravny toner', 'claim'], ['poslali ste mi iny toner', 'claim'],
] as const;
for (const [question, intent] of extraRegressionCases) {
  test(`AI Tomáš extra: ${question}`, async () => {
    const result = await buildAssistantAnswer(question, '/');
    assert.equal(result.intent, intent);
  });
}

test('OKI C301 pri otázke na toner neponúkne prenosový pás ani valec', async () => {
  const result = await buildAssistantAnswer('Aký toner do OKI C301?', '/');
  const names = (result.products || []).map((p: any) => p.name).join(' ');
  assert.match(names, /OKI C 301/i);
  assert.doesNotMatch(names, /prenosov.*pás|valec|drum|fuser/i);
});

test('kombinácia nekompatibilného OEM kódu a modelu upozorní na konflikt', async () => {
  const result = await buildAssistantAnswer('Mám Brother HL-L2350DW, môžem použiť TN2421?', '/');
  assert.match(result.answer.join(' '), /nie je.*kompatibil/i);
  const names = (result.products || []).map((p: any) => p.name).join(' ');
  assert.match(names, /TN-2420/i);
  assert.doesNotMatch(names, /TN-2421/i);
});


test('konflikt L2350DW vs TN2421 upozorní na kontrolu fyzického štítku a tonerovej kazety', async () => {
  const result = await buildAssistantAnswer('Mám Brother HL-L2350DW, môžem použiť TN2421?', '/');
  const answer = result.answer.join(' ');
  assert.match(answer, /štítku tlačiarne/i);
  assert.match(answer, /kazet/i);
  assert.match(answer, /HL-L2352DW/i);
  assert.match(answer, /počítač|Windows|ovládač/i);
});

test('servisné odpovede ponúkajú iba bezpečné interné odkazy', async () => {
  assert.deepEqual(advisorLinks({ intent: 'account', faq: 'ucet-heslo' }), [
    { label: 'Obnoviť heslo', url: '/zabudnute-heslo' },
    { label: 'Prejsť na prihlásenie', url: '/prihlasenie' },
  ]);
  assert.equal(advisorLinks({ intent: 'claim', faq: 'reklamacia-postup' })[0]?.url, '/reklamacia-online');
  assert.equal(advisorLinks({ intent: 'loyalty', faq: 'registracia-zlava' })[0]?.url, '/registracia');
  for (const link of advisorLinks({ intent: 'account', faq: 'ucet-heslo' })) {
    assert.match(link.url, /^\/[a-z0-9/_-]+$/);
    assert.doesNotMatch(link.url, /\.info|https?:/i);
  }
});
