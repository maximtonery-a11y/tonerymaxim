import assert from 'node:assert/strict';
import test from 'node:test';
import { productDescription, productSpecifications } from '../src/lib/product-information.ts';

test('complete authored sections stay in order and the teaser uses the first paragraph', () => {
  const html = '<h2>GI-490</h2><p>Atrament pre PIXMA. Ďalšia veta.</p><h3>Obsah</h3><ul><li>Čierna</li></ul><table><tbody><tr><td>6000</td></tr></tbody></table><p><a href="/tlaciarne/canon">Modely</a></p><p>Posledná odpoveď.</p>';
  const product = { description_html: html, short_description_html: '<p>Krátky popis.</p>' };
  const copy = productDescription(product);
  assert.equal(copy.html, html);
  assert.equal(copy.teaser, 'Atrament pre PIXMA.');
  assert.equal(copy.expandable, true);
  assert.equal(productDescription({ ...product, description_html: '<p>Nový popis.</p>' }).html, '<p>Nový popis.</p>');
});

test('plain, short, empty and older descriptions are readable without fabricating content', () => {
  assert.equal(productDescription({ description_html: '  ', short_description_html: '<p><strong>Originál</strong></p>' }).expandable, false);
  assert.equal(productDescription({ description_html: '<p></p>', description: 'Pôvodný text.' }).teaser, 'Pôvodný text.');
  assert.equal(productDescription({}).teaser, '');
  const plain = 'Pôvodný text. '.repeat(26) + 'A & B < C';
  const copy = productDescription({ description: plain });
  assert.equal(copy.expandable, true);
  assert.ok(copy.html.endsWith('A &amp; B &lt; C</p>'));
});

test('preserves safe formatting and local links while isolating supplier markup', () => {
  const html = '<h3 id="usage">Použitie</h3><p class="purchase-panel"><a href="#usage">Pokyny</a></p><form><input name="qty" /></form>';
  const copy = productDescription({ description_html: html });
  assert.ok(copy.html.includes('id="tm-copy-usage"'));
  assert.ok(copy.html.includes('href="#tm-copy-usage"'));
  assert.doesNotMatch(copy.html, /purchase-panel|<form|<input/);
});

test('per-colour yields retain explicit units, codes and each component quantity', () => {
  const p = { name: 'Canon GI-490 CMYK kompatibilná sada atramentových náplní (4 ks)', sku: 'SET-GI490', color: 'CMYK', product_type_key: 'compatible',
    attributes: [{ name: 'Typ produktu', value: 'atramentova-napln' }, { name: 'OEM', options: ['0663C001','GI-490BK','GI-490C','GI-490M','GI-490Y'] }],
    capacity: 'Čierna: 6000 strán; Azúrová: 7000 strán; Purpurová: 7000 strán; Žltá: 7000 strán' };
  const specs = productSpecifications(p);
  assert.equal(specs.facts.find(f => f.label === 'Obsah balenia')?.value, '4 atramentové náplne');
  assert.deepEqual(specs.yields.map(y => [y.pages.replace(/\s/g,''),y.code]), [['6000','GI-490BK'],['7000','GI-490C'],['7000','GI-490M'],['7000','GI-490Y']]);
  assert.deepEqual(specs.extraCodes, ['0663C001']);
  assert.equal(specs.facts.find(f => f.label === 'Kód produktu')?.value, 'SET-GI490');
  for (const capacity of ['Čierna: 100 ml; Žltá: 800 strán', 'Čierna: 400 strán; Čierna: 700 strán', '2 × 1600 strán']) {
    const other = productSpecifications({ ...p, capacity });
    assert.deepEqual(other.yields, []);
    assert.ok(other.facts.some(f => f.value === capacity));
  }
});

test('the shop SKU is a visible fact alongside the OEM, including for older catalogue entries', () => {
  const toner = { name: 'HP W1490A (149A) kompatibilný toner', color: 'Čierna', capacity: '2900 strán', warranty: '24 mesiacov', mpn: 'W1490A', sku: '13271',
    attributes: [{ name: 'Kód produktu', value: 'starý kód' }] };
  const { facts, extraCodes } = productSpecifications(toner);
  assert.deepEqual(facts.map(f => f.label), ['Typ náplne', 'Farba', 'Výťažnosť', 'Záruka', 'Kód výrobcu (OEM)', 'Kód produktu']);
  assert.deepEqual(facts.slice(-2).map(f => f.value), ['W1490A', '13271']);
  assert.deepEqual(extraCodes, []);
  const legacy = productSpecifications({ attributes: [{ name: 'SKU', value: '00123' }] });
  assert.deepEqual(legacy.facts.map(f => f.value), ['00123']);
  assert.deepEqual(productSpecifications({ sku: ' ' }).facts, []);
});

test('single toners and other products retain explicit facts, use legacy attributes and omit missing ones', () => {
  const facts = productSpecifications({ name:'HP CE285A čierny kompatibilný toner', color:'Čierna', capacity:'2000 strán', product_type_key:'compatible',
    attributes_all: [], attributes:[{ name:'Typ produktu', value:'toner' }, { name:'Čip', value:'Bez čipu' }, { name:'Povrch', value:'Matný' }] }).facts;
  assert.deepEqual(facts.map(f => f.label), ['Typ náplne','Farba','Výťažnosť','Čip','Povrch']);
  assert.equal(facts.find(f => f.label === 'Čip')?.value, 'Bez čipu');
  assert.equal(productSpecifications({ name:'Papier A4', attributes:[{ name:'Gramáž', options:['80 g/m²'] }] }).facts[0].value,'80 g/m²');
  assert.deepEqual(productSpecifications({ color:'Neuvedené' }).facts, []);
});
