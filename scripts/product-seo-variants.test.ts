import assert from 'node:assert/strict';
import test from 'node:test';
import { mapProduct } from '../src/lib/tm-products-cache.ts';
import { buildProductSeo } from '../src/lib/catalog-seo-text.ts';
import { productJsonLd } from '../src/lib/seo.ts';

const printers = ['Canon i-SENSYS LBP722Cdw', 'Canon i-SENSYS LBP732Cdw', 'Canon i-SENSYS MF832Cdw', 'Canon i-SENSYS MF842Cdw'];
const fixture = (type: string, name = 'Canon CRG-064HM purpurový renovovaný toner Patent Free') => ({
  id: 41510, sku: '2186', name, slug: 'canon-crg-064h-renovovany-toner-4',
  price: 120.84, stock_status: 'instock', stock_quantity: 1,
  color: 'Purpurová', page_yield: '10400 strán', product_type_key: type,
  compatible_printers: printers, images: [],
});

test('renovated singles, HATONA and sets publish a refurbished Offer', () => {
  for (const name of [
    'Canon CRG-064HM purpurový renovovaný toner Patent Free',
    'Canon CRG-064HBK čierny renovovaný toner HATONA',
    'Canon CRG-064H CMYK renovovaná sada tonerov Patent Free (4 ks)',
    'Canon CRG-064 CMYK renovovaná sada tonerov HATONA (4 ks)',
    'Brother TN-325BK čierny renovovaný toner HATONA',
  ]) {
    const data = productJsonLd('https://www.tonerymaxim.sk', fixture('renovated', name));
    assert.equal((data.offers as any).itemCondition, 'https://schema.org/RefurbishedCondition', name);
    assert.equal((data.offers as any).price, '120.84');
    assert.equal((data.offers as any).availability, 'https://schema.org/InStock');
  }
});

test('original and newly made compatible products retain NewCondition', () => {
  for (const type of ['original', 'compatible', 'product']) {
    const data = productJsonLd('https://www.tonerymaxim.sk', fixture(type));
    assert.equal((data.offers as any).itemCondition, 'https://schema.org/NewCondition');
  }
});

test('a fallback snippet includes whole printer names rather than a cut series', () => {
  const description = buildProductSeo(fixture('renovated')).description;
  assert.ok(description.length <= 158, description);
  assert.match(description, /10400 strán/);
  assert.match(description, /Canon i-SENSYS LBP722Cdw/);
  assert.doesNotMatch(description, /Canon i-SENSYS\.$/);
});

test('a long CMYK capacity is included whole or omitted without a stranded colour label', () => {
  const product = { ...fixture('compatible'), name: 'Canon CRG-064H CMYK kompatibilná sada tonerov (4 ks)', color: 'CMYK',
    page_yield: 'Čierna: 13400 strán; Azúrová: 10400 strán; Purpurová: 10400 strán; Žltá: 10400 strán' };
  const description = buildProductSeo(product).description;
  assert.ok(description.length <= 158, description);
  assert.doesNotMatch(description, /(?:Čierna|Azúrová|Purpurová|Žltá|i-SENSYS)[.:]?$/u);
  if (description.includes('Žltá')) assert.match(description, /Žltá: 10400 strán/);
});

test('prepared Woo metadata survives mapping and is used in both snippet and JSON-LD', () => {
  const prepared = 'Canon CRG-064HBK čierny renovovaný toner Patent Free. 13 400 strán. S novým čipom. Záruka 24 mesiacov.';
  const mapped = mapProduct({ id: 41507, sku: '2183', name: 'Canon CRG-064HBK čierny renovovaný toner Patent Free',
    slug: 'canon-crg-064h-renovovany-toner', price: '125.61', images: [], attributes: [], categories: [],
    meta_data: [{ key: 'metadescription', value: `<p>${prepared}</p>` }] });
  assert.equal(buildProductSeo(mapped).description, prepared);
  assert.equal(productJsonLd('https://www.tonerymaxim.sk', mapped).description, prepared);
});

test('oversized metadata falls back to complete factual parts and HTML is removed', () => {
  const product = { ...fixture('renovated'), seo_description: '<script>unsafe()</script><p>'+ 'Dlhý text '.repeat(40) + '</p>' };
  const description = buildProductSeo(product).description;
  assert.ok(description.length <= 158);
  assert.doesNotMatch(description, /unsafe|<[^>]+>|Canon i-SENSYS\.$/);
});
