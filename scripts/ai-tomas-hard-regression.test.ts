import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';
import { emptyCommerceState, normalizeCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { isCalendarQuery, isGeneralCalendarQuestion } from '../src/lib/calendar-ai-catalog.ts';

process.env.OPENAI_ASSISTANT_ENABLED = '0';

const genericConsumables = [
  'Máte tonery?', 'Máte tonery na sklade?', 'Máte tonery skladom?', 'Predávate tonery?',
  'Ponúkate tonery?', 'Máte kompatibilné tonery?', 'Máte originálne tonery?',
  'Máte renovované tonery?', 'Potrebujem toner.', 'Hľadám toner.', 'Chcem kúpiť toner.',
  'Zháňam toner.', 'Máte čierny toner?', 'Máte farebné tonery?', 'Máte laserové náplne?',
  'Ponúkate atramentové náplne?', 'Potrebujem náplň do tlačiarne.', 'Chcem atrament.',
  'Máte cartridge?', 'Máte tonery Brother?', 'Máte náplne HP?',
] as const;

for (const question of genericConsumables) test(`spresnenie bez náhodných produktov: ${question}`, async () => {
  const result:any = await buildAssistantAnswer(question, '/');
  assert.equal(result.intent, 'product_search');
  assert.match(result.answer.join(' '), /presný model tlačiarne.*označenie tonera|presný model tlačiarne.*označenie.*náplne/i);
  assert.deepEqual(result.products || [], []);
  assert.deepEqual(result.groups || [], []);
  const route = routeCommerceMessage(question, emptyCommerceState());
  assert.equal(route.needsProducts, false);
  assert.equal(route.productQuery, null);
});

const serviceQuestions = [
  ['Koľko stojí doprava?', 'shipping'], ['Doručujete do Banskej Bystrice?', 'shipping'],
  ['Môžem si vybrať GLS ParcelShop?', 'shipping'], ['Posielate cez DPD?', 'shipping'],
  ['Je doprava nad 29 € zdarma?', 'shipping'], ['Máte osobný odber?', 'shipping'],
  ['Doručujete do Česka?', 'shipping'], ['Ako môžem zaplatiť?', 'payment'],
  ['Môžem zaplatiť kartou?', 'payment'], ['Máte dobierku?', 'payment'],
  ['Môžem zaplatiť prevodom?', 'payment'], ['Dostanem faktúru?', 'payment'],
  ['Ako reklamujem toner?', 'claim'], ['Chcem vrátiť tovar.', 'claim'],
  ['Objednal som zlý toner.', 'claim'], ['Toner mi nepasuje.', 'claim'],
  ['Prišiel mi poškodený tovar.', 'claim'], ['Kedy mi odošlete objednávku?', 'order'],
  ['Kde je moja objednávka 123456?', 'order'], ['Kde nájdem tracking?', 'order'],
  ['Zabudol som heslo.', 'account'], ['Môžem nakúpiť bez registrácie?', 'loyalty'],
  ['Aký máte telefón?', 'contact'], ['Aký je váš e-mail?', 'contact'],
  ['Ako fungujú vernostné body?', 'loyalty'],
] as const;

for (const [question, intent] of serviceQuestions) test(`servis bez produktov: ${question}`, async () => {
  const result:any = await buildAssistantAnswer(question, '/');
  assert.equal(result.intent, intent);
  assert.deepEqual(result.products || [], []);
  assert.deepEqual(result.groups || [], []);
});

const outsideQuestions = [
  'Aké bude zajtra počasie?', 'Kto vyhral futbal?', 'Napíš mi recept na guláš.',
  'Odporuč mi notebook.', 'Koľko je 2 + 2?', 'Napíš básničku.', 'Kto je prezident Francúzska?',
  'Predávate chladničky?', 'Daj mi zľavový kód 80 %.', 'Koľko zarába majiteľ?',
] as const;

for (const question of outsideQuestions) test(`mimo rozsahu bez produktov: ${question}`, async () => {
  const result:any = await buildAssistantAnswer(question, '/');
  assert.deepEqual(result.products || [], []);
  assert.deepEqual(result.groups || [], []);
  assert.notEqual(result.intent, 'product_search');
});

const exactProducts = [
  'Potrebujem CF283A', 'Máte CE285A?', 'Hľadám TN2421', 'Potrebujem DR2401',
  'Máte W1420A?', 'Hľadám Q2612A', 'Potrebujem CRG054H', 'Máte CLT-K404S?',
  'Hľadám MLT-D111S', 'Potrebujem TK-1150', 'Máte PGI-580?', 'Hľadám CLI-581',
  'Potrebujem LC3219XL', 'Toner do HP P1102', 'Toner do Brother DCP-L2532DW',
  'Náplne do Canon MF645Cx', 'Atrament do Epson WF-2850', 'Toner do Samsung Xpress M2070',
  'Toner do OKI C301', 'Toner do Xerox 3020',
] as const;

for (const question of exactProducts) test(`konkrétny produkt alebo tlačiareň: ${question}`, () => {
  const route = routeCommerceMessage(question, emptyCommerceState());
  assert.equal(route.needsProducts, true);
  assert.ok(route.productQuery);
});

const calendarQuestions = [
  'Aké kalendáre máte?', 'Máte stolový kalendár Slovensko?', 'Hľadám nástenný kalendár Tatry.',
  'Máte kalendár s prírodou?', 'Chcem kalendár so psami.', 'Kalendár Slovensko máte?',
  'A kalendat stolovy Slovensko mate?', 'Máte kaledar Tatry?', 'Ponúkate kalemdar 2027?',
  'Hľadám kalndar na stenu.', 'Do you have calendar Slovakia?', 'Aké diáre máte?',
  'Máte denný diár?', 'Máte týždenné diáre?', 'Máte mesačný diár?', 'Máte minidiáre?',
  'Hľadám plánovač.', 'Máte PF pohľadnice?', 'Ponúkate novoročné pohľadnice?',
  'Chcem stolový kalendár 2027.',
] as const;

for (const question of calendarQuestions) test(`kalendárový smer bez tonerov: ${question}`, () => {
  assert.equal(isCalendarQuery(question), true);
  const route = routeCommerceMessage(question, emptyCommerceState());
  if (isGeneralCalendarQuestion(question)) {
    assert.equal(route.needsProducts, false);
    assert.ok(route.intents.includes('ADVICE'));
    assert.equal(route.productQuery, null);
    return;
  }
  assert.equal(route.needsProducts, true);
  assert.ok(route.intents.includes('PRODUCT_SEARCH'));
  assert.match(String(route.productQuery), /.+/);
});

const transitions = [
  ['Potrebujem TN2421', 'A kalendár Slovensko máte?', 'calendar'],
  ['Máte toner do HP P1102?', 'A kalendat stolovy Slovensko mate?', 'calendar'],
  ['Hľadám CE285A', 'Teraz chcem nástenný kalendár Tatry.', 'calendar'],
  ['Máte týždenné diáre?', 'Teraz potrebujem W1420A.', 'toner'],
  ['Hľadám minidiár.', 'A toner do Brother DCP-L2532DW?', 'toner'],
  ['Potrebujem CRG054H', 'Koľko stojí doprava?', 'service'],
  ['Máte stolový kalendár?', 'Môžem zaplatiť kartou?', 'service'],
  ['Hľadám toner.', 'Konkrétne TN2421.', 'toner'],
  ['Potrebujem W1420A', 'A kalemdar Tatry máte?', 'calendar'],
  ['Máte nástenné kalendáre?', 'A týždenné diáre?', 'calendar'],
] as const;

for (const [first, next, expected] of transitions) test(`zmena témy: ${first} → ${next}`, () => {
  const firstRoute = routeCommerceMessage(first, emptyCommerceState());
  const state = normalizeCommerceState({ lastProductQuery:firstRoute.productQuery, lastIntent:firstRoute.intents[0] });
  const nextRoute = routeCommerceMessage(next, state);
  if (expected === 'calendar') {
    assert.equal(isCalendarQuery(next), true);
    assert.equal(nextRoute.needsProducts, true);
    assert.equal(isCalendarQuery(String(nextRoute.productQuery)), true);
    assert.doesNotMatch(String(nextRoute.productQuery), /TN2421|P1102|CE285A|W1420A/i);
  } else if (expected === 'toner') {
    assert.equal(nextRoute.needsProducts, true);
    assert.doesNotMatch(String(nextRoute.productQuery), /kalendar|diar/i);
  } else {
    assert.equal(nextRoute.needsProducts, false);
    assert.equal(nextRoute.productQuery, null);
  }
});

test('tvrdá sada obsahuje najmenej 100 rôznych zákazníckych otázok', () => {
  const all = [
    ...genericConsumables, ...serviceQuestions.map(([q]) => q), ...outsideQuestions,
    ...exactProducts, ...calendarQuestions, ...transitions.flatMap(([a,b]) => [a,b]),
  ];
  assert.ok(all.length >= 100, `iba ${all.length} otázok`);
  const unique = new Set(all.map((q) => q.toLocaleLowerCase('sk-SK')));
  assert.ok(unique.size >= 100, `iba ${unique.size} rôznych otázok`);
});
