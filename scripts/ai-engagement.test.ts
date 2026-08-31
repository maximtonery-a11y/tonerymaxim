import test from 'node:test';
import assert from 'node:assert/strict';
import { quickPromptsForPath } from '../src/lib/ai-quick-prompts.ts';
import { readFile } from 'node:fs/promises';
import { isOrderStatusQuestion, publicOrderStatus } from '../src/lib/ai-order-status.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';

test('rýchle otázky sa menia podľa typu stránky', () => {
  const product = quickPromptsForPath('/produkt/canon-cl-586');
  const printer = quickPromptsForPath('/tlaciarne/canon/pixma-ts7650i');
  const checkout = quickPromptsForPath('/pokladna');
  const calendars = quickPromptsForPath('/kalendare/');
  const orders = quickPromptsForPath('/ucet/objednavky');
  assert.ok(product.some(x => /pasuje/i.test(x.label)));
  assert.ok(printer.some(x => /správny toner/i.test(x.label)));
  assert.ok(checkout.some(x => /platby/i.test(x.label)));
  assert.ok(calendars.some(x => /diáre/i.test(x.label)));
  assert.ok(orders.some(x => /stav objednávky/i.test(x.label)));
  for (const prompts of [product, printer, checkout, calendars, orders]) {
    assert.ok(prompts.length >= 3 && prompts.length <= 4);
    assert.ok(prompts.every(x => x.label.length <= 32 && x.question.length <= 140));
  }
});

test('mobilný AI panel zostáva fullscreen, posuvný a ovládateľný dotykom', async () => {
  const css = await readFile(new URL('../src/styles/ai-sales-assistant.css', import.meta.url), 'utf8');
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /width:100vw!important/);
  assert.match(css, /height:var\(--tm-ai-visual-height,100dvh\)!important/);
  assert.match(css, /overflow-y:auto!important/);
  assert.match(css, /-webkit-overflow-scrolling:touch/);
  assert.match(css, /height:46px!important/);
  assert.match(css, /\.tm-ai-nudge\{position:fixed/);
});

test('zmena témy produkt → objednávka nikdy nepoužije starý produktový kontext', () => {
  const state = { ...emptyCommerceState(), lastProductQuery:'Canon CL586', currentProductId:44105, pendingQuestion:'product_type' as const };
  for (const question of ['Kde je moja objednávka 51664?', 'Aký je stav objednávky?', 'Kde nájdem tracking zásielky?']) {
    const route = routeCommerceMessage(question, state);
    assert.equal(route.productQuery, null, question);
    assert.equal(route.needsProducts, false, question);
  }
});

test('zmena témy objednávka → produkt a toner → kalendár zostáva oddelená', () => {
  const product = routeCommerceMessage('Hľadám Canon CL586', emptyCommerceState());
  assert.equal(product.needsProducts, true);
  assert.match(String(product.productQuery), /CL586/i);
  const calendar = routeCommerceMessage('A teraz stolový kalendár Slovensko', { ...emptyCommerceState(), lastProductQuery:'Canon CL586' });
  assert.equal(calendar.needsProducts, true);
  assert.match(String(calendar.productQuery), /kalendár.*Slovensko/i);
  assert.doesNotMatch(String(calendar.productQuery), /CL586/i);
});

test('objednávkový endpoint má limity tela, pokusov a bezpečné odpovede', async () => {
  const endpoint = await readFile(new URL('../src/pages/api/ai-order-status.ts', import.meta.url), 'utf8');
  assert.match(endpoint, /content-length/);
  assert.match(endpoint, /> 4096/);
  assert.match(endpoint, /Cache-Control':'no-store, private/);
  assert.match(endpoint, /X-Content-Type-Options':'nosniff/);
  assert.match(endpoint, /catch \{/);
  assert.doesNotMatch(endpoint, /console\.(?:log|error).*email|JSON\.stringify\(body\)/);
});

test('verejný stav čistí tracking a nikdy nevracia osobné údaje', () => {
  const result = publicOrderStatus({ number:'12345<script>', status:'processing', billing:{email:'a@b.sk',address_1:'Tajná 1'}, meta_data:[{key:'tracking_number',value:'<img src=x>DPD/123'}] });
  assert.equal(result.number, '12345script');
  assert.equal(result.tracking, 'imgsrcxDPD/123');
  assert.deepEqual(Object.keys(result).sort(), ['date','number','shipping','status','statusLabel','tracking'].sort());
});

test('stav objednávky zverejní iba potrebné read-only údaje', async () => {
  const publicOrder = publicOrderStatus({ id:51664, number:'51664', status:'processing', date_created:'2026-08-31T10:00:00', billing:{email:'tajne@example.sk',phone:'0900'}, line_items:[{name:'Toner'}], shipping_lines:[{method_title:'DPD kuriér'}], meta_data:[{key:'tracking_number',value:'DPD-123'}] });
  assert.deepEqual(publicOrder, { number:'51664', status:'processing', statusLabel:'Spracováva sa', date:'2026-08-31T10:00:00', shipping:'DPD kuriér', tracking:'DPD-123' });
  assert.equal('billing' in publicOrder, false);
  assert.equal('line_items' in publicOrder, false);
  for (const q of ['Kde je moja objednávka?', 'Stav objednávky 51664', 'Kde nájdem tracking zásielky?']) assert.equal(isOrderStatusQuestion(q), true, q);
  const endpoint = await readFile(new URL('../src/pages/api/ai-order-status.ts', import.meta.url), 'utf8');
  assert.match(endpoint, /export const GET/);
  assert.doesNotMatch(endpoint, /export const (PUT|PATCH|DELETE)/);
  assert.doesNotMatch(endpoint, /updateWoo|createWoo|method:\s*['"](?:POST|PUT|PATCH|DELETE)/);
});

test('neprihlásený zákazník musí overiť tri údaje a odpoveď neodhaľuje existenciu objednávky', async () => {
  const endpoint = await readFile(new URL('../src/pages/api/ai-order-status.ts', import.meta.url), 'utf8');
  const client = await readFile(new URL('../src/scripts/ai-sales-assistant.js', import.meta.url), 'utf8');
  assert.match(endpoint, /orderNumber/);
  assert.match(endpoint, /billing\?\.email/);
  assert.match(endpoint, /billing\?\.postcode/);
  assert.match(endpoint, /current\.count > 5/);
  assert.match(endpoint, /MAX_BUCKETS = 2000/);
  assert.ok((endpoint.match(/error:genericFailure/g) || []).length >= 2);
  assert.doesNotMatch(endpoint, /return json\(\{[^}]*billing|return json\(\{[^}]*email/);
  assert.match(client, /data-ai-order-verify/);
  assert.match(client, /name="orderNumber"/);
  assert.match(client, /name="email"/);
  assert.match(client, /name="postcode"/);
});

test('aktívna bublina je nenásilná a sama neotvára AI panel', async () => {
  const [component, script] = await Promise.all([
    readFile(new URL('../src/components/FloatingAdvisor.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/scripts/ai-sales-assistant.js', import.meta.url), 'utf8'),
  ]);
  assert.match(component, /data-ai-nudge/);
  assert.match(component, /data-ai-nudge-close/);
  assert.match(script, /setTimeout\(\(\)=>\{if\(panel\.hidden/);
  assert.match(script, /sessionStorage\.setItem\(NUDGE_KEY,'dismissed'\)/);
  assert.doesNotMatch(script, /setTimeout\([^)]*openPanel/);
});
