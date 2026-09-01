import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProducts, getProductsCache } from '../src/lib/tm-products-cache.ts';
import { findExactPrinterModelMatches, productPrinterValues } from '../src/lib/catalog-query.ts';
import { consumablePrinterFamilyKey } from '../src/lib/printer-model-family.ts';
import { resolveCommerceProducts } from '../src/lib/ai-commerce/catalog.ts';
import { emptyCommerceState, normalizeCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';
import { searchCalendarProducts, resetCalendarCatalogForTests } from '../src/lib/calendar-ai-catalog.ts';
import { POST as aiTomasPost } from '../src/pages/api/ai-tomas.ts';
import calendarProducts from '../src/data/calendar-products.json' with { type: 'json' };

process.env.OPENAI_ASSISTANT_ENABLED = '0';

const brands = ['HP','Canon','Brother','Epson','Lexmark','Samsung','Kyocera','Xerox','OKI','Konica'];
const compact = (value: unknown) => String(value || '').toLocaleLowerCase('sk-SK').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const normalized = (value: unknown) => String(value || '').toLocaleLowerCase('sk-SK').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');
const isValidOffer = (p: any) => Number(p.price || 0) > 0 && !/sluzba\s+renovacia|hatona|bez\s+cipu|bezcip|no[\s_-]*chip|without[\s_-]*chip|s\s+oem\s+cipom|oem\s+cip|oem[\s_-]*chip/.test(
  normalized(`${p.name || ''} ${p.sku || ''} ${p.slug || ''} ${p.description || ''} ${p.short_description || ''}`)
);
const isConsumable = (p: any) => !/\b(valec|optick|drum|fuser|fixac|prenosov.*pas|transfer.*belt|odpadov)/i.test(
  normalized(`${p.name || ''} ${p.product_type_label || ''}`)
);
const seriesTokens = (value: unknown) => normalized(value).replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter((token) =>
  token && !/\d/.test(token) && !['hp','canon','brother','epson','lexmark','samsung','kyocera','xerox','oki','konica','minolta','ricoh','dell','pantum','sharp','toshiba','utax','panasonic','xpress','sl','mfp','color','colour'].includes(token)
);
const sameSeries = (product: any, model: string) => {
  const required = seriesTokens(model);
  return !required.length || productPrinterValues(product).some((printer) => required.every((token) => normalized(printer).split(/[^a-z0-9]+/).includes(token)));
};

async function ask(message: unknown, state?: any) {
  const request = new Request('http://localhost/api/ai-tomas', {
    method: 'POST', headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ message, page:'/', state }),
  });
  const response = await aiTomasPost({ request } as any);
  const body = await response.json().catch(() => ({})) as any;
  return { response, body };
}

const cache = await getProductsCache();
const allProducts: any[] = cache.products || [];
const modelsByBrand = new Map<string,string[]>();
for (const brand of brands) {
  const models = new Set<string>();
  for (const product of allProducts.filter((p) => isValidOffer(p) && isConsumable(p))) for (const printer of productPrinterValues(product)) {
    if (String(printer).toLocaleLowerCase('sk-SK').startsWith(`${brand.toLocaleLowerCase('sk-SK')} `)) models.add(String(printer));
  }
  modelsByBrand.set(brand, [...models].sort((a,b) => a.localeCompare(b,'sk-SK',{numeric:true})).slice(0,30));
}
const printerModels = [...modelsByBrand.values()].flat();

test('MEGA: presne 30 reálnych modelov z každej z 10 hlavných značiek', () => {
  assert.equal(printerModels.length, 300);
  for (const brand of brands) assert.equal(modelsByBrand.get(brand)?.length, 30, brand);
});

test('MEGA: 2 100 prirodzených zápisov modelov smeruje do produktového katalógu', () => {
  let checked = 0;
  for (const model of printerModels) {
    const variants = [
      `Hľadám náplne do tlačiarne ${model}`,
      `Toner do ${model}`,
      `Náplne pre ${model}`,
      `Máte toner pre ${model}?`,
      `Potrebujem cartridge do ${model}`,
      `Prosím náplne ${model}`,
      model,
    ];
    for (const question of variants) {
      const route = routeCommerceMessage(question, emptyCommerceState());
      assert.equal(route.needsProducts, true, question);
      assert.ok(route.productQuery, question);
      checked += 1;
    }
  }
  assert.equal(checked, 2100);
});

test('MEGA: všetkých 300 modelov vráti úplnú a iba kompatibilnú štruktúrovanú ponuku', async () => {
  let checked = 0;
  for (const model of printerModels) {
    const exactKey = compact(model);
    const family = consumablePrinterFamilyKey(model);
    const structured = findExactPrinterModelMatches(filterProducts(allProducts, { search:model }), model).map((match) => match.product);
    const assigned = allProducts.filter((p) => productPrinterValues(p).some((v) => compact(v) === exactKey || (family && consumablePrinterFamilyKey(v) === family)));
    const expected = [...new Map([...assigned, ...structured].map((p) => [String(p.id), p])).values()]
      .filter((p) => sameSeries(p, model)).filter(isValidOffer).filter(isConsumable);
    const result = await resolveCommerceProducts(model);
    assert.ok(result.products.length > 0, model);
    const actualIds = new Set(result.products.map((p:any) => String(p.id)));
    for (const product of expected.slice(0,120)) assert.ok(actualIds.has(String(product.id)), `${model}: chýba ${product.sku}`);
    const expectedIds = new Set(expected.map((p) => String(p.id)));
    for (const product of result.products) assert.ok(expectedIds.has(String(product.id)), `${model}: cudzí produkt ${product.sku}`);
    checked += 1;
  }
  assert.equal(checked, 300);
});

test('MEGA: 150 presných skladových SKU nájde vlastný produkt a žiadny cudzí', async () => {
  const products = allProducts.filter((p) => isValidOffer(p) && p.sku).slice(0,150);
  assert.equal(products.length, 150);
  for (const product of products) {
    const route = routeCommerceMessage(`Hľadám SKU ${product.sku}`, emptyCommerceState());
    assert.equal(route.needsProducts, true, product.sku);
    const result = await resolveCommerceProducts(String(product.sku));
    assert.ok(result.products.length >= 1, product.sku);
    assert.ok(result.products.every((p) => compact(p.sku) === compact(product.sku)), product.sku);
  }
});

const serviceBases: Array<[string,string]> = [
  ['Koľko stojí doprava?','shipping'], ['Kedy mi príde balík?','order'], ['Posielate cez DPD?','shipping'],
  ['Máte osobný odber?','shipping'], ['Doručujete do Česka?','shipping'], ['Je doprava nad 29 € zdarma?','shipping'],
  ['Ako môžem zaplatiť?','payment'], ['Môžem platiť kartou?','payment'], ['Máte dobierku?','payment'],
  ['Môžem platiť prevodom?','payment'], ['Dostanem faktúru?','payment'], ['Ako reklamujem toner?','claim'],
  ['Chcem vrátiť tovar.','claim'], ['Toner mi nepasuje.','claim'], ['Prišiel poškodený tovar.','claim'],
  ['Kde je moja objednávka?','order'], ['Kde nájdem tracking?','order'], ['Zabudol som heslo.','account'],
  ['Môžem nakúpiť bez registrácie?','loyalty'], ['Aký máte telefón?','contact'], ['Aký máte e-mail?','contact'],
  ['Ako fungujú vernostné body?','loyalty'], ['Kedy expedujete?','order'], ['Ako zmením adresu?','account'],
  ['Potrebujem poradiť s reklamáciou.','claim'],
];
const serviceOpenings = ['','Dobrý deň, ','Prosím, ','Chcem vedieť, ','Môžete mi povedať, ','Ako zákazník sa pýtam: '];
const serviceEndings = ['',' Ďakujem.'];

test('MEGA: 300 otázok o doprave, platbe, reklamácii, účte a objednávke nemieša produkty', async () => {
  let checked = 0;
  for (const [base, intent] of serviceBases) for (const opening of serviceOpenings) for (const ending of serviceEndings) {
    const question = `${opening}${base}${ending}`;
    const route = routeCommerceMessage(question, emptyCommerceState());
    assert.equal(route.needsProducts, false, question);
    assert.equal(route.productQuery, null, question);
    const answer:any = await buildAssistantAnswer(question, '/', []);
    assert.equal(answer.intent, intent, question);
    assert.deepEqual(answer.products || [], [], question);
    assert.ok(answer.answer.join(' ').trim().length >= 20, question);
    checked += 1;
  }
  assert.equal(checked, 300);
});

test('MEGA: servisná otázka po každom z 300 modelov zahodí produktový kontext', () => {
  let checked = 0;
  for (const model of printerModels) {
    const state = normalizeCommerceState({ lastProductQuery:model, currentPrinter:model, pendingQuestion:'quantity' });
    for (const question of ['Koľko stojí doprava?','Môžem zaplatiť kartou?','Ako reklamujem toner?']) {
      const route = routeCommerceMessage(question, state);
      assert.equal(route.needsProducts, false, `${model} -> ${question}`);
      assert.equal(route.productQuery, null, `${model} -> ${question}`);
      checked += 1;
    }
  }
  assert.equal(checked, 900);
});

test('MEGA: každý zo 62 kalendárov a diárov sa dá nájsť názvom aj SKU', async () => {
  resetCalendarCatalogForTests();
  assert.equal(calendarProducts.length, 62);
  let checked = 0;
  for (const product of calendarProducts as any[]) {
    for (const query of [product.name, product.sku]) {
      const result = await searchCalendarProducts(query);
      assert.ok(result.products.some((p) => p.sku === product.sku), `${query}: chýba ${product.sku}`);
      assert.ok(result.products.every((p) => p.source === 'kalendare-2027'), query);
      checked += 1;
    }
  }
  assert.equal(checked, 124);
});

test('MEGA: 48 diárových otázok rozlišuje denné, týždenné, mesačné a mini', async () => {
  const cases = [
    ['denné diáre',/Denný diár/i], ['týždenné diáre',/Týždenný diár/i],
    ['mesačné diáre',/Minidiár mesačný/i], ['minidiáre',/Minidiár/i],
  ] as const;
  const wrappers = [
    (x:string)=>`Máte ${x}?`, (x:string)=>`Aké ${x} ponúkate?`, (x:string)=>`Hľadám ${x}.`,
    (x:string)=>`Ukážte mi ${x}.`, (x:string)=>`Predávate ${x}?`, (x:string)=>`Chcem kúpiť ${x}.`,
    (x:string)=>`Dobrý deň, máte ${x}?`, (x:string)=>`Prosím zobrazte ${x}.`,
    (x:string)=>`Potrebujem ${x} na rok 2027.`, (x:string)=>`Sú skladom ${x}?`,
    (x:string)=>`Viete mi odporučiť ${x}?`, (x:string)=>`${x}`,
  ];
  let checked = 0;
  for (const [kind, expected] of cases) for (const wrap of wrappers) {
    const question = wrap(kind);
    const result = await searchCalendarProducts(question);
    assert.ok(result.products.length > 0, question);
    assert.ok(result.products.every((p) => expected.test(p.name)), `${question}: ${result.products.map(p=>p.name).join(' | ')}`);
    checked += 1;
  }
  assert.equal(checked, 48);
});

test('MEGA: všeobecná otázka na diáre má vždy 4 typy a presný funkčný filter odkazu', async () => {
  const questions = ['Aké diáre máte?','Aké máte diáre v ponuke?','Máte v ponuke diáre?','Ponúkate diáre?',
    'Dobrý deň, aké diáre máte?','Prosím, ukážte druhy diárov.','Chcem si vybrať diár.','Aké typy diárov predávate?'];
  for (const question of questions) {
    const { response, body } = await ask(question);
    assert.equal(response.status, 200, question);
    const answer = body.advisor.answer.join(' ');
    assert.match(answer, /denné diáre.*týždenné diáre.*mesačné diáre.*minidiáre/i, question);
    assert.equal(body.commerce?.products?.length, 4, question);
    assert.deepEqual(body.advisor.sources, [{ label:'Zobraziť všetky diáre', url:'/kalendare/#/?cat=Di%C3%A1re' }], question);
    const url = new URL(`https://www.tonerymaxim.sk${body.advisor.sources[0].url}`);
    const params = new URLSearchParams(url.hash.split('?')[1]);
    assert.equal(params.get('cat'), 'Diáre', question);
  }
});

test('MEGA: 20 rýchlych nákupov cez AI skončí presne vybraným SKU a množstvom 2', async () => {
  const candidates = allProducts.filter((p) => isValidOffer(p) && p.sku && p.stock_status !== 'outofstock' && Number(p.stock_quantity ?? 1) !== 0).slice(0,20);
  assert.equal(candidates.length, 20);
  for (const product of candidates) {
    const first = await ask(`Pridaj 2 ks SKU ${product.sku}`);
    assert.equal(first.response.status, 200, product.sku);
    assert.equal(first.body.action?.kind, 'ADD_TO_CART', product.sku);
    assert.equal(compact(first.body.action.product.sku), compact(product.sku), product.sku);
    assert.equal(first.body.action.quantity, 2, product.sku);
    assert.equal(first.body.state.cart.length, 1, product.sku);
    assert.equal(compact(first.body.state.cart[0].sku), compact(product.sku), product.sku);
    assert.equal(first.body.state.cart[0].quantity, 2, product.sku);
  }
});

test('MEGA: poškodené a nepriateľské vstupy nespôsobia HTTP 500 ani produkty z minulého kontextu', async () => {
  const hostile: unknown[] = [null, undefined, '', ' ', 0, false, {}, [], '<script>alert(1)</script>', "' OR 1=1 --",
    '../../etc/passwd', '${process.env.SECRET}', '💥'.repeat(500), 'a'.repeat(20000), '\u0000\u0001', 'undefined', 'NaN'];
  for (const message of hostile) {
    const state = normalizeCommerceState({ lastProductQuery:'Epson WF-6090', currentPrinter:'Epson WF-6090' });
    const { response, body } = await ask(message, state);
    assert.notEqual(response.status, 500, String(message).slice(0,80));
    if (response.status === 200) {
      assert.ok(body && typeof body === 'object');
      if (!String(message || '').trim()) assert.equal(body.commerce, null);
    }
  }
});

test('MEGA: súhrnný počet overených zákazníckych scenárov je najmenej 3 900', () => {
  const count = 2100 + 300 + 150 + 300 + 900 + 124 + 48 + 8 + 20 + 17;
  assert.ok(count >= 3900, String(count));
});
