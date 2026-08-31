import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProducts, getProductsCache } from '../src/lib/tm-products-cache.ts';
import { resolveCommerceProducts } from '../src/lib/ai-commerce/catalog.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { POST as aiTomasPost } from '../src/pages/api/ai-tomas.ts';

const cases = [
  'Canon CL586',
  'hľadám náplne Canon cl586',
  'CL-586 XL',
  'Canon PG585',
  'PG-585',
  'CLI-581',
  'PGI-580',
  'LC3219XL',
  'TN2421',
  'Brother DCP-L2532DW',
  'HP M110w',
];

test('AI používa rovnaké katalógové zhody ako vyhľadávanie', async () => {
  const cache = await getProductsCache();
  for (const query of cases) {
    const search = filterProducts(cache.products, { search: query });
    const route = routeCommerceMessage(query, emptyCommerceState());
    assert.equal(route.needsProducts, true, query);
    const ai = await resolveCommerceProducts(route.productQuery!);
    assert.ok(search.length > 0, `vyhľadávanie: ${query}`);
    assert.ok(ai.products.length > 0, `AI: ${query}`);
    const searchIds = new Set(search.map(product => String(product.id)));
    assert.ok(ai.products.every(product => searchIds.has(String(product.id))), `parita: ${query}`);
  }
});

test('Canon CL586 prejde celým endpointom a zobrazí správne produkty', async () => {
  const request = new Request('http://localhost/api/ai-tomas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hľadám náplne Canon cl586', page: '/' }),
  });
  const response = await aiTomasPost({ request } as any);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.ok(body.commerce?.products?.length >= 2);
  assert.ok(body.commerce.products.every((product: any) => /CL-586/i.test(product.name)));
  assert.doesNotMatch(body.advisor.answer.join(' '), /nenašiel.*zhodu|napíšte.*model tlačiarne/i);
});

test('servisné čísla a všeobecná tonerová otázka nespustia katalóg', () => {
  for (const query of ['kde je objednávka 123456', 'stav objednávky 300949', 'Máte tonery na sklade?']) {
    const route = routeCommerceMessage(query, emptyCommerceState());
    assert.equal(route.needsProducts, false, query);
    assert.equal(route.productQuery, null, query);
  }
});
