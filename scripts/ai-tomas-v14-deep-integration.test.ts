import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { isOrderStatusQuestion } from '../src/lib/ai-order-question.ts';
import { isCartChangingAction } from '../src/lib/ai-cart-safety.ts';
import { searchCommerce } from '../src/lib/ai-commerce/engine.ts';

async function ask(message: string, state: any = emptyCommerceState(`v14-${Math.random()}`)) {
  const request = new Request('http://localhost/api/ai-tomas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, page: '/', state }),
  });
  const response = await POST({ request } as any);
  assert.equal(response.status, 200, message);
  return response.json() as Promise<any>;
}

const text = (result: any) => (result.advisor?.answer || []).join(' ');

test('prehliadač odlíši skutočný stav objednávky od doručenej, ale chýbajúcej zásielky', () => {
  for (const message of [
    'Aký je stav objednávky?',
    'Kde je moja objednávka 301007?',
    'Skontroluj mi prosím stav objednávky.',
    'Sleduj zásielku 301007.',
  ]) assert.equal(isOrderStatusQuestion(message), true, message);

  for (const message of [
    'Zásielka je v trackingu označená ako doručená, ale balík nemám. Čo mám urobiť?',
    'Kuriér označil balík za doručený, no zásielka mi neprišla.',
    'Tracking ukazuje odovzdané, ale balík som nenašiel.',
    'Kedy mi bude objednávka doručená?',
    'Chcem stornovať objednávku pred expedíciou.',
  ]) assert.equal(isOrderStatusQuestion(message), false, message);
});

test('produktový kontext sa neprenesie do samostatných servisných otázok', async () => {
  let state = (await ask('Canon PFI-102')).state;
  const cart = [{ id: 'keep', sku: 'KEEP', quantity: 3 }];
  state = { ...state, cart };

  const scenarios = [
    {
      question: 'Podávač papiera cvaká. Aké bezpečné kontroly papiera, zásobníka a vodiacich líšt mám spraviť?',
      faq: 'cvakanie-podavaca',
      contains: /odpojte od elektriny/i,
    },
    {
      question: 'Zásielka je v trackingu označená ako doručená, ale balík nemám. Čo mám urobiť?',
      faq: 'zasielka-oznacena-dorucena',
      contains: /GPS|záznamu o odovzdaní/i,
    },
    {
      question: 'Napíš všetky možnosti dopravy a platby vrátane ceny dobierky.',
      faq: 'doprava-a-platba',
      contains: /GoPay.*bankov.*prevod.*dobierk.*1,20|GoPay.*dobierk.*bankov.*prevod/i,
    },
    {
      question: 'Aký je rozdiel medzi tonerom a optickým valcom?',
      faq: 'toner-opticky-valec',
      contains: /optick.*valec/i,
    },
    {
      question: 'Papier sa krúti a toner sa rozmazáva na okraji. Čo mám robiť?',
      faq: 'krutenie-rozmazavanie',
      contains: /fixačn/i,
    },
  ];

  for (const scenario of scenarios) {
    const route = routeCommerceMessage(scenario.question, state);
    assert.equal(route.intents.includes('FOLLOW_UP'), false, scenario.question);
    assert.equal(route.productQuery, null, scenario.question);
    const result = await ask(scenario.question, state);
    assert.equal(result.advisor?.faq, scenario.faq, scenario.question);
    assert.match(text(result), scenario.contains, scenario.question);
    assert.equal(result.commerce, null, scenario.question);
    assert.deepEqual(result.state.cart, cart, scenario.question);
    assert.equal(isCartChangingAction(result.action?.kind), false, scenario.question);
    state = result.state;
  }
});

test('skutočné produktové pokračovanie stále zdedí predchádzajúci produkt', () => {
  const state = { ...emptyCommerceState('follow-up'), lastProductQuery: 'Canon PFI-102' };
  for (const message of ['A originálne?', 'Je skladom?', 'Koľko strán vytlačí?', 'Chcem ho kompatibilný.']) {
    const route = routeCommerceMessage(message, state);
    assert.equal(route.intents.includes('FOLLOW_UP'), true, message);
    assert.equal(route.productQuery, 'Canon PFI-102', message);
  }
});

test('súhrn dopravy a platby je úplný a bez produktov', async () => {
  for (const message of [
    'Napíš všetky možnosti dopravy a platby vrátane ceny dobierky.',
    'Aké máte spôsoby dopravy, ako môžem zaplatiť a koľko stojí dobierka?',
    'Chcem kompletný prehľad poštovného a platobných možností.',
  ]) {
    const result = await ask(message);
    assert.equal(result.advisor?.faq, 'doprava-a-platba', message);
    assert.match(text(result), /GLS/i, message);
    assert.match(text(result), /DPD/i, message);
    assert.match(text(result), /3,90 €/i, message);
    assert.match(text(result), /2,90 €/i, message);
    assert.match(text(result), /29 €/i, message);
    assert.match(text(result), /GoPay/i, message);
    assert.match(text(result), /bankov.*prevod/i, message);
    assert.match(text(result), /dobierk.*1,20 €/i, message);
    assert.equal(result.commerce, null, message);
    assert.deepEqual(result.state.cart, [], message);
  }
});

test('zákaz košíka vyhrá aj nad rozpracovaným nákupným dialógom', async () => {
  const initialCart = [{ id: 'keep-safe', sku: 'KEEP-SAFE', quantity: 2 }];
  let state = { ...emptyCommerceState('pending-safe'), cart: initialCart, lastProductQuery: 'Epson 604XL', pendingQuestion: 'quantity', currentType: 'compatible' };
  const result = await ask('Ukáž iba Epson 604XL CMYK sadu. Nič nepridávaj, košík sa nesmie zmeniť.', state);
  assert.deepEqual(result.state.cart, initialCart);
  assert.equal(result.state.pendingQuestion, null);
  assert.equal(isCartChangingAction(result.action?.kind), false);
  assert.doesNotMatch(text(result), /Pridal som|Vybral som.*pridal/i);
});

test('PFI kódy a odpadové nádoby zostanú v správnom sortimente', async () => {
  for (const code of ['Canon PFI-120', 'PFI-120', 'Canon PFI-102']) {
    const result = await ask(code);
    assert.notEqual(result.commerce?.source, 'calendar', code);
    assert.doesNotMatch(text(result), /nástenný|stolový|minidiár/i, code);
  }
  for (const [query, forbidden] of [
    ['Brother WT-223CL odpadová nádoba', /TN-24[37]/i],
    ['Xerox 008R13325 odpadová nádoba', /006R/i],
  ] as const) {
    const result = await ask(query);
    const products = result.commerce?.products || [];
    assert.ok(products.length > 0, query);
    assert.ok(products.every((product: any) => /odpad|nádob/i.test(product.name)), query);
    assert.equal(products.some((product: any) => forbidden.test(`${product.name} ${product.sku}`)), false, query);
  }
});

test('reálne sady sa nikdy neskladajú z jednotlivých farieb', async () => {
  for (const message of [
    'Ukáž jedinú kompatibilnú Epson 604XL CMYK sadu, nič nepridávaj.',
    'Canon PFI-120 kompletná sada, bez nákupnej akcie.',
    'Canon PFI-102 kompletná sada, nič nepridávaj do košíka.',
  ]) {
    const result = await ask(message);
    assert.deepEqual(result.state.cart, [], message);
    assert.equal(isCartChangingAction(result.action?.kind), false, message);
    assert.ok((result.commerce?.presentation?.sets || []).every((set: any) => set.packageKind === 'catalog' && set.products?.length === 1), message);
    if (result.commerce?.products?.length) assert.ok(result.commerce.products.every((product: any) => product.package_shape === 'set' || /sada|multipack|pack/i.test(product.name)), message);
  }
});

test('syntetické sady nevzniknú ani vo vnútornom commerce engine', async () => {
  for (const query of ['Canon PFI-102', 'Canon CRG-054', 'Epson 604XL']) {
    const result = await searchCommerce(query);
    assert.ok((result.presentation?.sets || []).every((set: any) => set.packageKind === 'catalog' && set.products?.length === 1), query);
  }
  const engine = await readFile(new URL('../src/lib/ai-commerce/engine.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(engine, /packageKind\s*:\s*['"]synthetic['"]/);
});

test('katalógová rodina zobrazí kompatibilnú, originálnu aj renovovanú reálnu sadu', async () => {
  const store = globalThis as any;
  const keys = [
    '__TM_PRODUCTS_FILE_CACHE__', '__TM_PUBLIC_PRODUCTS_CACHE__', '__TM_PRODUCTS_LOOKUP_INDEX__',
    '__TM_PRODUCTS_FILE_PATH__', '__TM_PRODUCTS_FILE_SIGNATURE__', '__TM_PRODUCTS_FILE_STAT_AT__',
  ];
  const previous = new Map(keys.map((key) => [key, store[key]]));
  const makeSet = (id: number, type: string, label: string) => ({
    id,
    sku: `SET-CAN-PFI120-${type.toUpperCase()}`,
    name: `Canon PFI-120 CMYK+MBK ${label} sada atramentových náplní`,
    slug: `canon-pfi-120-${type}-sada`,
    price: 100 + id,
    stock_status: 'instock',
    stock_quantity: 4,
    product_type_key: type,
    color: 'CMYK',
    capacity: '5 náplní',
    compatible_printers: ['Canon imagePROGRAF TM-200'],
    search_text: `canon pfi-120 cmyk mbk ${label} sada atramentových náplní`,
  });
  const singleColors = ['BK', 'C', 'M', 'Y', 'MBK'].map((color, index) => ({
    id: 100 + index,
    sku: `PFI-120${color}`,
    name: `Canon PFI-120${color} originálna atramentová náplň`,
    slug: `canon-pfi-120-${color.toLowerCase()}`,
    price: 20 + index,
    stock_status: 'instock',
    stock_quantity: 8,
    product_type_key: 'original',
    color,
    compatible_printers: ['Canon imagePROGRAF TM-200'],
    search_text: `canon pfi-120 ${color} originálna atramentová náplň`,
  }));

  try {
    store.__TM_PRODUCTS_FILE_CACHE__ = {
      ok: true,
      version: 4,
      generated_at: new Date().toISOString(),
      total: 8,
      products: [
        makeSet(1, 'compatible', 'kompatibilná'),
        makeSet(2, 'original', 'originálna'),
        makeSet(3, 'renovated', 'renovovaná'),
        ...singleColors,
      ],
    };
    delete store.__TM_PUBLIC_PRODUCTS_CACHE__;
    delete store.__TM_PRODUCTS_LOOKUP_INDEX__;
    delete store.__TM_PRODUCTS_FILE_PATH__;
    delete store.__TM_PRODUCTS_FILE_SIGNATURE__;
    delete store.__TM_PRODUCTS_FILE_STAT_AT__;
    store.__TM_AI_COMMERCE_SEARCH_CACHE__?.clear();

    const result = await searchCommerce('Canon PFI-120 kompletná CMYK sada');
    const sets = result.presentation?.sets || [];
    assert.deepEqual(new Set(sets.map((set: any) => set.type)), new Set(['compatible', 'original', 'renovated']));
    assert.equal(sets.length, 3);
    assert.ok(sets.every((set: any) => set.packageKind === 'catalog' && set.products.length === 1));
    assert.ok(sets.every((set: any) => /SET-CAN-PFI120/.test(set.products[0].sku)));
    assert.equal(sets.some((set: any) => set.products.some((product: any) => /^PFI-120(?:BK|C|M|Y|MBK)$/.test(product.sku))), false);
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete store[key];
      else store[key] = value;
    }
    store.__TM_AI_COMMERCE_SEARCH_CACHE__?.clear();
  }
});

test('servisná téma po produkte zostane bezpečná v širšej matici', async () => {
  const originalCart = [{ id: 'unchanged', sku: 'UNCHANGED', quantity: 2 }];
  let state = { ...(await ask('Canon PFI-102')).state, cart: originalCart };
  const questions = [
    'Tlačiareň robí pruhy cez vytlačenú stranu. Čo mám skontrolovať?',
    'Výtlačok je veľmi bledý aj po výmene tonera.',
    'Tlačiareň nerozpoznala novú kazetu.',
    'Papier sa krúti a toner sa na okraji rozmazáva.',
    'Podávač cvaká a neberie papier zo zásobníka.',
    'Aký je rozdiel medzi tonerom a optickým valcom?',
    'Ako reklamujem poškodený tovar?',
    'Chcem do 14 dní vrátiť nepoužitý toner.',
    'Koľko zaplatím za kuriéra?',
    'Ako môžem zaplatiť kartou?',
    'Napíš všetky možnosti dopravy a platby.',
    'Zásielka je označená ako doručená, ale balík nemám.',
  ];
  for (const question of questions) {
    const result = await ask(question, state);
    assert.equal(result.commerce, null, question);
    assert.deepEqual(result.state.cart, originalCart, question);
    assert.equal(isCartChangingAction(result.action?.kind), false, question);
    assert.ok(text(result).trim().length > 20, question);
    state = result.state;
  }
});

test('našeptávač a stránka tlačiarne používajú jednotnú politiku špeciálnych variantov', async () => {
  const smartSearch = await readFile(new URL('../src/pages/api/smart-search.ts', import.meta.url), 'utf8');
  const printerPage = await readFile(new URL('../src/pages/tlaciarne/[brand]/[model].astro', import.meta.url), 'utf8');
  assert.match(smartSearch, /explicitlyRequestsSpecialChipVariant/);
  assert.match(smartSearch, /isSpecialChipVariantProduct/);
  assert.match(printerPage, /filter\(\(product\) => !isSpecialChipVariantProduct\(product\)\)/);
  assert.doesNotMatch(await readFile(new URL('../src/scripts/ai-sales-assistant.js', import.meta.url), 'utf8'), /const typeLabel=type==='compatible'\?'Kompatibilná sada'/);
});

test('mobilný panel rešpektuje viditeľný viewport, klávesnicu a úzke obrazovky', async () => {
  const [script, css] = await Promise.all([
    readFile(new URL('../src/scripts/ai-sales-assistant.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/ai-sales-assistant.css', import.meta.url), 'utf8'),
  ]);

  assert.match(script, /window\.visualViewport\.height/);
  assert.match(script, /window\.visualViewport\.offsetTop/);
  assert.match(script, /window\.innerHeight\s*-\s*viewportHeight\s*>\s*150/);
  assert.match(script, /visualViewport\?\.addEventListener\('resize',\s*updateViewportState\)/);
  assert.match(script, /visualViewport\?\.addEventListener\('scroll',\s*updateViewportState\)/);

  assert.match(css, /height:var\(--tm-ai-visual-height,100dvh\)!important/);
  assert.match(css, /top:var\(--tm-ai-visual-top,0px\)!important/);
  assert.match(css, /\.tm-ai-assistant\.has-keyboard \.tm-ai-assistant__tools\{display:none!important\}/);
  assert.match(css, /\.tm-ai-assistant__form input\{font-size:16px!important\}/);
  assert.match(css, /\.tm-ai-single-grid\{grid-template-columns:1fr!important\}/);
  assert.match(css, /@media\(max-width:360px\)[\s\S]*?\.tm-ai-set-toners\{grid-template-columns:1fr!important\}/);
  assert.match(css, /\.tm-ai-assistant__messages,\.tm-ai-commerce\{[^}]*overflow-x:hidden!important/);
});
