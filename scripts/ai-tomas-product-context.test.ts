import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { HP_TONER_HELP_PATH } from '../src/lib/hp-toner-help.ts';

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
  assert.ok(result.advisor.answer.includes('Tieto tonery sú určené pre tieto tlačiarne:'));
  assert.doesNotMatch(text(result), /katalóg/i);
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
  assert.match(text(fits), /určený aj pre tlačiareň HP Color LaserJet Pro MFP 4302dw/);
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
  assert.match(text(result), /nefunguje v tlačiarni s aktivovaným HP\+/);
  assert.match(text(result), /politiku kaziet.*ochranu kaziet.*aktualizácie firmvéru/);
  assert.equal(result.advisor.sources.filter((source: any) => source.url === HP_TONER_HELP_PATH).length, 1);
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

test('the exact comparison quick prompt explains all toner types instead of falling back', async () => {
  const result = await ask('Aký je rozdiel medzi originálnym a kompatibilným tonerom?');
  assert.equal(result.advisor.faq, 'kompatibilny-original-renovovany');
  assert.match(text(result), /Originálny toner vyrába výrobca tlačiarne/);
  assert.match(text(result), /Kompatibilný toner vyrába iný výrobca/);
  assert.match(text(result), /Renovovaný toner/);
  assert.equal(result.advisor.unanswered, false);
  assert.equal(result.action, null);
});

test('a general comparison after a product stays an explanation without repeating the old offer', async () => {
  const first = await ask();
  for (const question of ['Aký je rozdiel medzi originálnym a kompatibilným tonerom?', 'Je do tlačiarne lepší originálny alebo kompatibilný toner?', 'Originál alebo kompatibilný?', 'Aký je rozdiel medzi renovovaným a kompatibilným tonerom?']) {
    const result = await ask(question, hpPage, first.state);
    assert.equal(result.advisor.faq, 'kompatibilny-original-renovovany', question);
    assert.equal(result.commerce, null, question);
    assert.doesNotMatch(text(result), /Myslíte produkt|220A|Overil som aktuálny katalóg/, question);
  }
});

test('current web search results take precedence over a previously viewed HP product', async () => {
  const previous = (await ask()).state;
  const result = await ask(question, '/produkty?s=Brother%20TN-2421', previous);
  assert.match(text(result), /Brother TN-2421/);
  assert.match(text(result), /HL-L2352DW/);
  assert.doesNotMatch(text(result), /HP 220A|4302dw/);
  assert.equal(result.state.currentProductId, '2421');
});

test('multiple web search variants ask for a specific product and never use the stale HP selection', async () => {
  const previous = (await ask()).state;
  install([...catalog(), product(2422, 'Brother TN-2421 čierny originálny toner', 'tn-2421-original', ['Brother HL-L2352DW'], { product_type_key: 'original' })]);
  const result = await ask(question, '/produkty?s=Brother+TN-2421', previous);
  assert.equal(result.action.kind, 'CLARIFY_PRODUCT');
  assert.match(text(result), /Brother TN-2421 čierny kompatibilný toner/);
  assert.match(text(result), /Brother TN-2421 čierny originálny toner/);
  assert.doesNotMatch(text(result), /HP 220A|4302dw/);
});

test('an explicit product still wins over the web search and an empty search never borrows the old product', async () => {
  const previous = (await ask()).state;
  const explicit = await ask('Do ktorých tlačiarní pasuje HP CF226A?', '/produkty?s=Brother+TN-2421', previous);
  assert.match(text(explicit), /CF226A/);
  assert.doesNotMatch(text(explicit), /Brother/);
  const missing = await ask(question, '/produkty?s=NEEXISTUJUCI-TONER-999999', previous);
  assert.equal(missing.action.kind, 'CLARIFY_PRODUCT');
  assert.doesNotMatch(text(missing), /HP 220A|4302dw/);
});

test('web search filters select only the visible toner variant', async () => {
  install([...catalog(), product(2422, 'Brother TN-2421 čierny originálny toner', 'tn-2421-original', ['Brother HL-L2352DW'], { product_type_key: 'original' })]);
  const result = await ask(question, '/produkty?s=Brother+TN-2421&type=original');
  assert.equal(result.state.currentProductId, '2422');
  assert.match(text(result), /originálny toner/);
  assert.doesNotMatch(text(result), /kompatibilný toner/);
});

const w1420Page = '/produkt/hp-w1420a-no-142a-kompatibilny-toner';
function installW1420() {
  install([
    product(39951, 'HP W1420A (142A) čierny kompatibilný toner nefunguje v HP+', w1420Page.split('/').at(-1)!, ['HP LaserJet M110w', 'HP LaserJet MFP M140w'], { sku: '13276', capacity: '950 strán', color: 'Čierna' }),
    product(38209, 'HP W1420A (142A) čierny originálny toner', 'hp-w1420a-originalny-toner', ['HP LaserJet M110w', 'HP LaserJet M110we', 'HP LaserJet MFP M140w', 'HP LaserJet MFP M140we'], { sku: '051475', product_type_key: 'original', capacity: '950 strán' }),
  ]);
}

test('screenshot flow: search clarification → open detail → "tento" answers the original how-it-works question', async () => {
  installW1420();
  const cart = [{ id: 'keep', sku: 'KEEP', quantity: 1 }];
  const first = await ask('ako funguje tento toner?', '/produkty?s=HP+W1420A', { ...emptyCommerceState(), cart });
  assert.equal(first.action.kind, 'CLARIFY_PRODUCT');
  assert.equal(first.state.pendingProductQuestion, 'ako funguje tento toner?');
  const resumed = await ask('tento', w1420Page, JSON.parse(JSON.stringify(first.state)));
  assert.match(text(resumed), /Myslíte produkt HP W1420A.*kompatibilný/);
  assert.match(text(resumed), /prášok.*papier.*teplom/);
  assert.match(text(resumed), /iný výrobca/);
  assert.match(text(resumed), /950.*strán/);
  assert.match(text(resumed), /HP LaserJet M110w/);
  assert.match(text(resumed), /nefunguje v HP\+/);
  assert.doesNotMatch(text(resumed), /M110we|M140we|Na túto otázku nemám|Ktorý konkrétny produkt/);
  assert.equal(resumed.state.selectedProductId, '39951');
  assert.equal(resumed.state.pendingProductQuestion, null);
  assert.deepEqual(resumed.state.cart, cart);
  assert.equal(resumed.commerce, null);
  assert.equal(resumed.action, null);
  assert.equal(resumed.state.history.at(-2).content, 'tento');
});

test('legacy saved conversations recover the question from the immediate clarification', async () => {
  installW1420();
  const first = await ask('ako funguje tento toner?', '/produkty?s=HP+W1420A');
  delete first.state.pendingProductQuestion;
  const result = await ask('tento', w1420Page, first.state);
  assert.match(text(result), /prášok.*papier.*teplom/);
  assert.equal(result.action, null);
});

test('the opened original variant supplies its own printer list and manufacturer explanation', async () => {
  installW1420();
  const first = await ask('ako funguje tento toner?', '/produkty?s=HP+W1420A');
  const result = await ask('tento', '/produkt/hp-w1420a-originalny-toner', first.state);
  assert.equal(result.state.currentProductId, '38209');
  assert.match(text(result), /Originálny toner vyrába výrobca tlačiarne/);
  assert.match(text(result), /HP LaserJet M110we/);
  assert.doesNotMatch(text(result), /nefunguje v HP\+|Kompatibilný toner vyrába/);
});

test('a pending compatibility question remains compatibility after selecting the detail', async () => {
  installW1420();
  const first = await ask(question, '/produkty?s=HP+W1420A');
  const result = await ask('tento toner', w1420Page, first.state);
  assert.deepEqual(result.advisor.answer.filter((line: string) => line.startsWith('• ')), ['• HP LaserJet M110w', '• HP LaserJet MFP M140w']);
  assert.doesNotMatch(text(result), /prášok.*papier/);
  assert.equal(result.action, null);
});

test('a clarification can also be answered with the SKU or the visible compatible variant', async () => {
  installW1420();
  const first = await ask('ako funguje tento toner?', '/produkty?s=HP+W1420A');
  for (const message of ['SKU: 13276', 'ten kompatibilný', 'HP W1420A kompatibilný toner']) {
    const result = await ask(message, '/produkty?s=HP+W1420A', first.state);
    assert.equal(result.state.currentProductId, '39951', message);
    assert.match(text(result), /prášok.*papier.*teplom/, message);
    assert.equal(result.action, null, message);
  }
});

test('repeated deictic replies keep asking for the product until a real detail is opened', async () => {
  installW1420();
  const first = await ask('ako funguje tento toner?', '/produkty?s=HP+W1420A');
  const ambiguous = await ask('tento', '/produkty?s=HP+W1420A', first.state);
  assert.equal(ambiguous.action.kind, 'CLARIFY_PRODUCT');
  assert.equal(ambiguous.state.pendingProductQuestion, 'ako funguje tento toner?');
  const result = await ask('tento', w1420Page, ambiguous.state);
  assert.match(text(result), /prášok.*papier.*teplom/);
  assert.equal(result.action, null);
});

test('a new service topic clears the pending question and a later reference uses current product facts', async () => {
  installW1420();
  const first = await ask('Je tento produkt skladom?', '/produkty?s=HP+W1420A');
  const shipping = await ask('Koľko stojí doprava?', w1420Page, first.state);
  assert.equal(shipping.state.pendingProductQuestion, null);
  const result = await ask('tento', w1420Page, shipping.state);
  assert.match(text(result), /prášok.*papier.*teplom/);
  assert.doesNotMatch(text(result), /Skladom 5 ks/);
  assert.equal(result.action, null);
});

test('a deictic reference alone resolves the current detail and never guesses from the cart', async () => {
  installW1420();
  const direct = await ask('tento', w1420Page);
  assert.match(text(direct), /HP W1420A.*kompatibilný/);
  assert.equal(direct.action, null);
  const missing = await ask('tento', '/', { ...emptyCommerceState(), cart: [{ id: '39951', sku: '13276', quantity: 1 }] });
  assert.equal(missing.action.kind, 'CLARIFY_PRODUCT');
  assert.doesNotMatch(text(missing), /M110w|950/);
  const afterDetail = await ask('tento', w1420Page, missing.state);
  assert.match(text(afterDetail), /prášok.*papier.*teplom/);
});

test('how a delivery works remains a service answer on a product detail', async () => {
  const result = await ask('Ako funguje toto doručenie?');
  assert.doesNotMatch(text(result), /Myslíte produkt|prášok.*papier/);
  assert.equal(result.state.pendingProductQuestion, null);
});

test('short selections retain stock, yield and firmware questions rather than replacing them with an overview', async () => {
  installW1420();
  for (const [question, expected] of [
    ['Je tento produkt skladom?', /Skladom 5 ks/],
    ['Koľko strán vytlačí tento toner?', /950.*strán/],
    ['Bude tento toner fungovať s mojím firmvérom?', /nemám overené.*nemôžem potvrdiť/],
  ] as const) {
    const first = await ask(question, '/produkty?s=HP+W1420A');
    assert.equal(first.action.kind, 'CLARIFY_PRODUCT', question);
    const result = await ask('tento', w1420Page, first.state);
    assert.match(text(result), expected, question);
    assert.doesNotMatch(text(result), /prášok.*papier/);
    assert.deepEqual(result.state.cart, []);
  }
});
