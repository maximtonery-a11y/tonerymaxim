import test from 'node:test';
import assert from 'node:assert/strict';
import { getProductsCache } from '../src/lib/tm-products-cache.ts';
import { productPrinterValues } from '../src/lib/catalog-query.ts';
import { emptyCommerceState, normalizeCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { isOrderStatusQuestion } from '../src/lib/ai-order-question.ts';
import { isCalendarQuery } from '../src/lib/calendar-ai-catalog.ts';
import calendarProducts from '../src/data/calendar-products.json' with { type:'json' };

process.env.OPENAI_ASSISTANT_ENABLED = '0';

const normalize = (value: unknown) => String(value || '').toLocaleLowerCase('sk-SK').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const compact = (value: unknown) => normalize(value).replace(/\s+/g, '');
const excluded = (product: any) => /sluzba\s+renovacia|hatona|bez\s+cipu|bezcip|no[\s_-]*chip|without[\s_-]*chip|s\s+oem\s+cipom|oem\s+cip|oem[\s_-]*chip/.test(
  normalize(`${product.name || ''} ${product.sku || ''} ${product.slug || ''} ${product.description || ''}`)
);
const consumable = (product: any) => !/\b(valec|optick|drum|fuser|fixac|prenosov.*pas|transfer.*belt|odpadov)/.test(
  normalize(`${product.name || ''} ${product.product_type_label || ''}`)
);
const brands = ['HP','Canon','Brother','Epson','Lexmark','Samsung','Kyocera','Xerox','OKI','Konica'];
const cache = await getProductsCache();
const products: any[] = (cache.products || []).filter((product:any) => Number(product.price || 0) > 0 && !excluded(product));

const printerModels: string[] = [];
for (const brand of brands) {
  const models = new Set<string>();
  for (const product of products.filter(consumable)) for (const printer of productPrinterValues(product)) {
    if (normalize(printer).startsWith(`${normalize(brand)} `)) models.add(String(printer));
  }
  const selected = [...models].sort((a,b) => a.localeCompare(b,'sk-SK',{numeric:true})).slice(0,30);
  assert.equal(selected.length, 30, `značka ${brand} nemá 30 testovateľných modelov`);
  printerModels.push(...selected);
}

const skuProducts = [...new Map(products.filter((product) => product.sku).map((product) => [compact(product.sku), product])).values()].slice(0,150);
assert.equal(skuProducts.length, 150);
assert.equal(calendarProducts.length, 62);

type Scenario = { id:string; question:string; check:()=>void };
const scenarios: Scenario[] = [];
const add = (id:string, question:string, check:()=>void) => scenarios.push({ id, question, check });

const printerTemplates = [
  (m:string)=>`Hľadám náplne do tlačiarne ${m}`,
  (m:string)=>`Toner do ${m}`,
  (m:string)=>`Náplne pre ${m}`,
  (m:string)=>`Máte toner pre ${m}?`,
  (m:string)=>`Potrebujem cartridge do ${m}`,
  (m:string)=>`Prosím náplne ${m}`,
  (m:string)=>m,
  (m:string)=>`Nájdite mi kompatibilné náplne pre ${m}`,
  (m:string)=>`Aké originálne náplne máte pre ${m}?`,
  (m:string)=>`Ukážte ponuku pre tlačiareň ${m}`,
  (m:string)=>`Chcem kúpiť toner do ${m}`,
  (m:string)=>`Potrebujem čiernu náplň pre ${m}`,
  (m:string)=>`Čo pasuje do ${m}?`,
  (m:string)=>`Dobrý deň, používam ${m} a potrebujem náplň.`,
  (m:string)=>`Prosím o všetky dostupné možnosti pre ${m}.`,
];

for (const [modelIndex, model] of printerModels.entries()) for (const [templateIndex, template] of printerTemplates.entries()) {
  const question = template(model);
  add(`printer:${modelIndex}:${templateIndex}`, question, () => {
    const route = routeCommerceMessage(question, emptyCommerceState());
    assert.equal(route.needsProducts, true, question);
    assert.ok(route.productQuery, question);
    assert.ok(route.intents.some((intent) => ['PRINTER_SEARCH','PRODUCT_SEARCH','COMPATIBILITY','COLOR_TYPE_FILTER','BUY_INTENT'].includes(intent)), question);
  });
}

const skuTemplates = [
  (sku:string)=>`Hľadám SKU ${sku}`,
  (sku:string)=>`Máte ${sku}?`,
  (sku:string)=>`Potrebujem ${sku}`,
  (sku:string)=>`Ukážte produkt ${sku}`,
  (sku:string)=>`Koľko stojí ${sku}?`,
  (sku:string)=>`Je ${sku} skladom?`,
  (sku:string)=>`Chcem kúpiť ${sku}`,
  (sku:string)=>`Pridaj 2 ks SKU ${sku}`,
  (sku:string)=>`Prosím, nájdite presne ${sku}.`,
  (sku:string)=>`Overte dostupnosť produktu s kódom ${sku}.`,
];

for (const [productIndex, product] of skuProducts.entries()) for (const [templateIndex, template] of skuTemplates.entries()) {
  const question = template(String(product.sku));
  add(`sku:${productIndex}:${templateIndex}`, question, () => {
    const route = routeCommerceMessage(question, emptyCommerceState());
    assert.equal(route.needsProducts, true, question);
    assert.ok(route.productQuery, question);
    assert.ok(compact(route.productQuery).includes(compact(product.sku)), question);
  });
}

const calendarTemplates = [
  (sku:string)=>sku,
  (sku:string)=>`Hľadám ${sku}`,
  (sku:string)=>`Máte kalendár ${sku}?`,
  (sku:string)=>`Ukážte produkt ${sku}`,
  (sku:string)=>`Chcem ${sku}`,
  (sku:string)=>`Pridaj 2 ks ${sku}`,
  (sku:string)=>`Je ${sku} skladom?`,
  (sku:string)=>`Koľko stojí ${sku}?`,
  (sku:string)=>`Prosím nájdite presne SKU ${sku}`,
  (sku:string)=>`Potrebujem objednať kód ${sku}`,
];

for (const [productIndex, product] of (calendarProducts as any[]).entries()) for (const [templateIndex, template] of calendarTemplates.entries()) {
  const question = template(String(product.sku));
  add(`calendar:${productIndex}:${templateIndex}`, question, () => {
    assert.equal(isCalendarQuery(question), true, question);
    const route = routeCommerceMessage(question, emptyCommerceState());
    assert.equal(route.needsProducts, true, question);
    assert.equal(compact(route.productQuery), compact(product.sku), question);
  });
}

const transitions = [
  'Koľko stojí doprava?',
  'Môžem zaplatiť kartou?',
  'Ako môžem reklamovať toner?',
  'Teraz hľadám nástenný kalendár Tatry.',
  'Teraz potrebujem TN2421.',
];
for (const [modelIndex, model] of printerModels.entries()) for (const [transitionIndex, question] of transitions.entries()) {
  add(`transition:${modelIndex}:${transitionIndex}`, `${model} → ${question}`, () => {
    const state = normalizeCommerceState({ lastProductQuery:model, currentPrinter:model, pendingQuestion:'quantity' });
    const route = routeCommerceMessage(question, state);
    if (transitionIndex <= 2) {
      assert.equal(route.needsProducts, false, `${model} → ${question}`);
      assert.equal(route.productQuery, null, `${model} → ${question}`);
    } else {
      assert.equal(route.needsProducts, true, `${model} → ${question}`);
      assert.doesNotMatch(String(route.productQuery), new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
    }
  });
}

const serviceBases = [
  'Koľko stojí doprava?', 'Koľko trvá dodanie?', 'Posielate cez DPD?', 'Máte osobný odber?', 'Doručujete do Česka?',
  'Je doprava nad 29 € zdarma?', 'Ako môžem zaplatiť?', 'Môžem platiť kartou?', 'Máte dobierku?', 'Môžem platiť prevodom?',
  'Dostanem faktúru?', 'Ako reklamujem toner?', 'Chcem vrátiť tovar.', 'Toner mi nepasuje.', 'Prišiel poškodený tovar.',
  'Kde je moja objednávka?', 'Kde nájdem tracking?', 'Zabudol som heslo.', 'Môžem nakúpiť bez registrácie?', 'Aký máte telefón?',
  'Aký máte e-mail?', 'Ako fungujú vernostné body?', 'Kedy expedujete?', 'Ako zmením adresu?', 'Ako zruším objednávku?',
];
const serviceWrappers = [
  (q:string)=>q, (q:string)=>`Dobrý deň, ${q}`, (q:string)=>`Prosím, ${q}`, (q:string)=>`Potrebujem vedieť: ${q}`,
  (q:string)=>`Môžete mi povedať, ${q}`, (q:string)=>`Ako zákazník sa pýtam: ${q}`, (q:string)=>`${q} Ďakujem.`,
  (q:string)=>`${q} Prosím.`, (q:string)=>`${q} Potrebujem presnú informáciu.`, (q:string)=>`${q} Viete mi poradiť?`,
  (q:string)=>`Prosím o stručnú odpoveď: ${q}`, (q:string)=>`Chcem sa informovať: ${q}`, (q:string)=>`Mám otázku. ${q}`,
  (q:string)=>`Poraďte mi, prosím. ${q}`, (q:string)=>`Na vašom e-shope potrebujem vedieť: ${q}`, (q:string)=>`Pred nákupom sa chcem opýtať: ${q}`,
  (q:string)=>`Po objednávke potrebujem vedieť: ${q}`, (q:string)=>`Prosím o overenú informáciu. ${q}`, (q:string)=>`Odpovedzte spisovne: ${q}`,
  (q:string)=>`Pomôžte mi s touto otázkou: ${q}`,
];
for (const [baseIndex, base] of serviceBases.entries()) for (const [wrapperIndex, wrapper] of serviceWrappers.entries()) {
  const question = wrapper(base);
  add(`service:${baseIndex}:${wrapperIndex}`, question, () => {
    const route = routeCommerceMessage(question, emptyCommerceState());
    assert.equal(route.needsProducts, false, question);
    assert.equal(route.productQuery, null, question);
  });
}

const orderBases = [
  'Kde je moja objednávka?', 'V akom stave je moja objednávka?', 'Zisti stav objednávky.', 'Over stav objednávky.',
  'Skontroluj stav objednávky.', 'Bola objednávka odoslaná?', 'Chcem sledovať zásielku.', 'Kde je môj balík?',
  'Je objednávka vybavená?', 'Má už moja objednávka tracking?',
];
const orderWrappers = [
  (q:string)=>`Kontrola stavu objednávky: ${q}`, (q:string)=>`Bezpečné overenie objednávky: ${q}`,
  (q:string)=>`Potrebujem zistiť stav nákupu: ${q}`, (q:string)=>`Sledovanie mojej objednávky: ${q}`,
  (q:string)=>`Prosím otvorte overenie stavu. ${q}`, (q:string)=>`Chcem skontrolovať vybavenie nákupu. ${q}`,
  (q:string)=>`Otázka k aktuálnemu stavu objednávky: ${q}`, (q:string)=>`Prosím o bezpečné overenie zásielky. ${q}`,
];
for (const [baseIndex, base] of orderBases.entries()) for (const [wrapperIndex, wrapper] of orderWrappers.entries()) {
  const question = wrapper(base);
  add(`order:${baseIndex}:${wrapperIndex}`, question, () => assert.equal(isOrderStatusQuestion(question), true, question));
}

test('HARD 8700: matica má presne 8 700 jedinečných scenárov', () => {
  assert.equal(scenarios.length, 8700);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, 8700);
  const seen = new Set<string>();
  const duplicates:string[] = [];
  for (const scenario of scenarios) {
    const key=normalize(scenario.question);
    if(seen.has(key))duplicates.push(`${scenario.id}: ${scenario.question}`);
    seen.add(key);
  }
  assert.equal(seen.size, 8700, duplicates.join('\n'));
});

test('HARD 8700: každý scenár spĺňa svoju vecnú a bezpečnostnú podmienku', () => {
  for (const scenario of scenarios) {
    try { scenario.check(); }
    catch (error) { throw new Error(`[${scenario.id}] ${scenario.question}\n${error instanceof Error ? error.message : error}`, { cause:error }); }
  }
});
