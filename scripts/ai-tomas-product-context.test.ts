import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';

process.env.OPENAI_ASSISTANT_ENABLED = '0';
const g = globalThis as any;
let generation = 0;
const hpPrinters = ['HP Color LaserJet Pro 4202dn', 'HP Color LaserJet Pro 4202dw', 'HP Color LaserJet Pro MFP 4302dw'];
function product(id: number, name: string, slug: string, printers: string[], extra: any = {}) {
  return { id, name, slug, sku: `SKU-${id}`, price: 116.34, stock_status: 'instock', stock_quantity: 5,
    product_type_key: 'compatible', compatible_printers: printers, ...extra };
}
function catalog() {
  return [
    product(220, 'HP 220A CMYK kompatibilná sada tonerov (4 ks)', 'hp-220a-cmyk-kompatibilna-sada-tonerov-nefunguje-v-hp', hpPrinters),
    product(226, 'HP CF226A čierny kompatibilný toner', 'hp-cf226a-cierny-kompatibilny-toner', ['HP LaserJet Pro M402dn', 'HP LaserJet Pro MFP M426fdw']),
    product(2421, 'Brother TN-2421 čierny kompatibilný toner', 'brother-tn-2421-cierny-kompatibilny-toner', ['Brother DCP-L2512D', 'Brother HL-L2352DW']),
    product(104, 'Epson 104 CMYK kompatibilná sada', 'epson-104-cmyk-sada', ['Epson EcoTank L3250']),
    product(55, 'Canon CRG-055 žltý originálny toner', 'canon-crg-055-zlty-originalny-toner', [], { product_type_key: 'original', stock_status: 'outofstock', stock_quantity: 0 }),
  ];
}
function install(products = catalog()) {
  g.__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, runtime_compact: true, generated_at: `context-${++generation}`, total: products.length, products };
  delete g.__TM_PUBLIC_PRODUCTS_CACHE__;
  delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
}
beforeEach(() => install());
const hpPage = '/produkt/hp-220a-cmyk-kompatibilna-sada-tonerov-nefunguje-v-hp';
const question = 'Do ktorých tlačiarní pasuje tento produkt?';
async function ask(message = question, page = hpPage, state: any = emptyCommerceState('product-context')) {
  const response = await POST({ request: new Request('http://localhost/api/ai-tomas', {
    method: 'POST', body: JSON.stringify({ message, page, state }),
  }) } as any);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}
const text = (result: any) => result.advisor.answer.join(' ');

test('product quick prompt identifies the exact HP 220A pack and lists its complete catalogue compatibility', async () => {
  const result = await ask();
  assert.match(text(result), /Myslíte.*HP 220A CMYK/);
  assert.match(text(result), /Ak nie.*presné označenie/i);
  for (const printer of hpPrinters) assert.ok(text(result).includes(printer), printer);
  assert.doesNotMatch(text(result), /Rozumiem\.|nenašiel bezpečnú zhodu|TN-2421/);
  assert.equal(result.state.currentProductId, '220');
  assert.equal(result.action, null);
  assert.deepEqual(result.state.cart, []);
  assert.ok(result.advisor.sources.some((source: any) => source.url === hpPage));
});

test('the current page wins over an earlier product, type, colour and pending purchase', async () => {
  const state = { ...emptyCommerceState(), currentProductId: '2421', selectedProductId: '2421', lastProductQuery: 'Brother TN-2421', currentColor: 'black', currentType: 'original', pendingQuestion: 'quantity', cart: [{ id: 'keep', sku: 'KEEP', quantity: 2 }] };
  const hp = await ask(question, hpPage, state);
  assert.match(text(hp), /HP 220A CMYK/);
  assert.doesNotMatch(text(hp), /Brother/);
  const epson = await ask(question, '/produkt/epson-104-cmyk-sada', hp.state);
  assert.match(text(epson), /Epson EcoTank L3250/);
  assert.doesNotMatch(text(epson), /HP 220A|Brother/);
  assert.deepEqual(epson.state.cart, state.cart);
  assert.equal(epson.action, null);
  assert.equal(epson.state.pendingQuestion, null);
});

test('an explicit different toner takes precedence over the page and never mixes printer lists', async () => {
  const result = await ask('Do ktorých tlačiarní pasuje HP CF226A?');
  assert.match(text(result), /CF226A/);
  assert.match(text(result), /M402dn/);
  assert.doesNotMatch(text(result), /4202|4302|220A/);
});

test('follow-up compatibility uses the exact product selected during search away from a detail page', async () => {
  const first = await ask('HP CF226A kompatibilný toner', '/');
  const result = await ask(question, '/', first.state);
  assert.match(text(result), /CF226A/);
  assert.match(text(result), /M426fdw/);
});

test('no context asks for a toner code instead of an empty acknowledgement', async () => {
  const result = await ask(question, '/');
  assert.match(text(result), /presné označenie.*(?:toner|produkt)|otvorte.*produkt/i);
  assert.doesNotMatch(text(result), /Rozumiem\.|pasuje do.*HP/i);
  assert.equal(result.action?.kind, 'CLARIFY_PRODUCT');
});

test('a missing detail page never falls back to a stale conversational selection', async () => {
  const result = await ask(question, '/produkt/neexistujuci-toner', { ...emptyCommerceState(), currentProductId: '2421', lastProductQuery: 'Brother TN-2421' });
  assert.match(text(result), /presné označenie/i);
  assert.doesNotMatch(text(result), /HL-L2352|pasuje.*Brother/);
});

test('missing compatibility data is reported without borrowing another product family', async () => {
  const result = await ask(question, '/produkt/canon-crg-055-zlty-originalny-toner');
  assert.match(text(result), /Canon CRG-055/);
  assert.match(text(result), /(?:chýba|nemám).*zoznam|zoznam.*chýba/i);
  assert.doesNotMatch(text(result), /4202|M402|L3250/);
});

test('page resolution accepts query strings, encoded slugs and historical aliases', async () => {
  for (const page of [hpPage + '/?utm_source=test#popis', hpPage.replace('hp-220a', '%68p-220a'), 'https://www.tonerymaxim.sk' + hpPage]) {
    assert.match(text(await ask(question, page)), /HP 220A/);
  }
  const old = await ask(question, '/produkt/brother-tn-2421-kompatibilny-toner');
  assert.match(text(old), /HL-L2352DW/);
});

test('stock quick prompt uses the current detail and unknown stock is never invented', async () => {
  assert.match(text(await ask('Je tento produkt skladom?')), /Skladom 5 ks/i);
  install([product(220, 'HP 220A CMYK kompatibilná sada tonerov', hpPage.split('/').at(-1)!, hpPrinters, { stock_quantity: null })]);
  const result = await ask('Je tento produkt skladom?');
  assert.match(text(result), /skladom/i);
  assert.doesNotMatch(text(result), /\b(?:0|5|null) ks\b/);
});

test('compatibility for a named printer differentiates an assigned model from an unconfirmed one', async () => {
  const fits = await ask('Pasuje tento produkt do HP Color LaserJet Pro MFP 4302dw?');
  assert.match(text(fits), /4302dw.*(?:uveden|priraden)|(?:uveden|priraden).*4302dw/i);
  const other = await ask('Pasuje tento produkt do HP Color LaserJet Pro MFP 4302dwe?');
  assert.match(text(other), /nemám.*potvrden|nie je.*uveden/i);
  assert.doesNotMatch(text(other), /Áno.*pasuje/i);
});

test('customer firmware question remains complete and includes catalogue facts, uncertainty and return/claim guidance', async () => {
  const message = 'Dobrý deň, mám záujem o zakúpenie vašej kompatibilnej sady tonerov HP 220A CMYK (4 ks) za 116,34 € s DPH. Údaje tlačiarne: Model: HP Color LaserJet Pro MFP 4302dw Produktové číslo: 4RA83A Sériové číslo: THBGTDH0FS SKU: 4302dw EMEA Verzia firmvéru: 6.28.3.30-202606111700 V nastaveniach tlačiarne mám vypnuté Cartridge Protection aj Authorized HP Cartridge Policy. Aktiváciu HP+ sa mi nepodarilo definitívne overiť. Prosím o potvrdenie, či vaša kompatibilná sada tonerov bude fungovať s uvedeným modelom a verziou firmvéru. Zároveň prosím o informáciu, či môžem tonery vrátiť alebo reklamovať, ak ich tlačiareň nerozpozná.';
  assert.ok(message.length > 500);
  const result = await ask(message);
  const answer = text(result);
  assert.match(answer, /HP 220A/);
  assert.match(answer, /4302dw/);
  assert.match(answer, /firmvér|firmvéru/);
  assert.match(answer, /HP\+/);
  assert.match(answer, /(?:nemôžem|neviem|nemám).*potvrdiť|(?:nemôžem|neviem).*zaručiť/i);
  assert.match(answer, /vráten|odstúpen/i);
  assert.match(answer, /reklam/i);
  assert.doesNotMatch(answer, /nenašiel bezpečnú zhodu/);
  assert.equal(result.state.history.at(-2).content, message);
  assert.equal(result.action?.kind, 'OPEN_HANDOFF');
  assert.deepEqual(result.state.cart, []);
});

test('service and general comparison questions keep their existing answers on a product detail', async () => {
  const shipping = await ask('Koľko stojí doprava?');
  assert.match(text(shipping), /3,90 €|2,90 €/);
  assert.doesNotMatch(text(shipping), /Myslíte|4202/);
  const comparison = await ask('Aký je rozdiel medzi originálnym a kompatibilným tonerom?');
  assert.doesNotMatch(text(comparison), /Myslíte.*220A/);
});

test('a catalogue refresh updates compatibility without persisting a copied printer list in the session', async () => {
  const first = await ask();
  install([product(220, 'HP 220A CMYK kompatibilná sada tonerov', hpPage.split('/').at(-1)!, ['HP Color LaserJet Pro 4202dw'])]);
  const result = await ask(question, hpPage, first.state);
  assert.match(text(result), /4202dw/);
  assert.doesNotMatch(text(result), /4302dw|4202dn/);
});

test('a request for a toner for a different printer remains a search, including on another product detail', async () => {
  const state = { ...emptyCommerceState(), currentProductId: '2421', lastProductQuery: 'Brother TN-2421' };
  const result = await ask('Ktorý toner je vhodný pre tlačiareň HP LaserJet Pro M402dn?', hpPage, state);
  assert.doesNotMatch(text(result), /Myslíte.*220A|Myslíte.*2421/);
  assert.ok(result.commerce.products.some((product: any) => product.id === 226));
  assert.ok(result.commerce.products.every((product: any) => product.id !== 220));
});

test('an unknown explicitly named toner never borrows the open product compatibility', async () => {
  const result = await ask('Do ktorých tlačiarní pasuje HP CF9999X?');
  assert.equal(result.action.kind, 'CLARIFY_PRODUCT');
  assert.doesNotMatch(text(result), /4202|4302|220A/);
});

test('ambiguous variants ask for a precise product instead of combining unrelated printer lists', async () => {
  install([
    product(1, 'HP CF226A čierny kompatibilný toner', 'cf226a-compatible', ['HP LaserJet Pro M402dn']),
    product(2, 'HP CF226A čierny originálny toner', 'cf226a-original', ['HP LaserJet Pro M426fdw'], { product_type_key: 'original' }),
  ]);
  const result = await ask('Do ktorých tlačiarní pasuje HP CF226A?', '/');
  assert.match(text(result), /Ktorý konkrétny produkt/);
  assert.doesNotMatch(text(result), /M402dn|M426fdw/);
  assert.equal(result.action.kind, 'CLARIFY_PRODUCT');
});

test('product restrictions from the real HP 220A title are included in the compatibility answer', async () => {
  install([product(52658, 'HP 220A / W2200-1-2-3A CMYK – kompatibilná sada nefunguje v HP+ (4 ks)', hpPage.split('/').at(-1)!, hpPrinters, { sku: 'SET-HP-220A-KOM-CIP' })]);
  const result = await ask();
  assert.match(text(result), /Upozornenie.*nefunguje v HP\+/);
  assert.match(text(result), /aktivovaná v HP\+/);
});

test('an explicit subsequent purchase keeps the exact product identified by the compatibility answer', async () => {
  const first = await ask();
  const result = await ask('Pridaj 2 ks do košíka.', hpPage, first.state);
  assert.equal(result.action.kind, 'ADD_TO_CART');
  assert.equal(result.action.product.id, 220);
  assert.equal(result.action.quantity, 2);
  assert.deepEqual(result.state.cart.map((item: any) => [item.id, item.quantity]), [['220', 2]]);
});

test('a later turn keeps the full original customer message in normalized history', async () => {
  const original = 'Do ktorých tlačiarní pasuje tento produkt? ' + 'Prosím o informáciu. '.repeat(30);
  const first = await ask(original);
  const result = await ask('Koľko stojí doprava?', hpPage, first.state);
  assert.equal(result.state.history[0].content, original.trim());
});

test('real Woo detail attributes do not add manufacturer, series or a duplicate joined list as printers', async () => {
  install([product(220, 'HP 220A CMYK kompatibilná sada', hpPage.split('/').at(-1)!, hpPrinters, { attributes: [
    { name: 'Výrobca tlačiarne', options: ['HP'] },
    { name: 'Séria tlačiarne', options: ['HP Color LaserJet Pro'] },
    { name: 'Model tlačiarne', options: hpPrinters, values: hpPrinters, value: hpPrinters.join(', ') },
  ] })]);
  const result = await ask();
  assert.deepEqual(result.advisor.answer.filter((line: string) => line.startsWith('• ')), hpPrinters.map(printer => `• ${printer}`));
});

test('model attribute fallback splits and deduplicates model values without mixing other attributes', async () => {
  install([product(220, 'HP 220A CMYK kompatibilná sada', hpPage.split('/').at(-1)!, [], { attributes: [
    { name: 'Výrobca tlačiarne', options: ['HP'] },
    { name: 'Séria tlačiarne', options: ['HP LaserJet 400'] },
    { name: 'Model tlačiarne', options: hpPrinters, value: hpPrinters.join(', ') },
  ] })]);
  const result = await ask();
  assert.deepEqual(result.advisor.answer.filter((line: string) => line.startsWith('• ')), hpPrinters.map(printer => `• ${printer}`));
});
