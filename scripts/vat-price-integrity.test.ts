import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import ts from 'typescript';
import { checkoutGrossLines, discountedGrossLine, grossVatParts, grossVatTotals } from '../src/lib/checkout-vat.ts';

await mkdir('.tm-cache', { recursive: true });
const temporary = await mkdtemp(resolve('.tm-cache/vat-integrity-'));
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('VAT audit prohibits unmocked HTTP'); };
Object.assign(process.env, { WOO_URL: 'https://woo.example.invalid', WOO_CONSUMER_KEY: 'fixture', WOO_CONSUMER_SECRET: 'fixture',
  TM_PERSISTENT_DATA_DIR: temporary, TM_PERSISTENCE_SECRET: 'isolated-vat-integrity-test-secret-at-least-32-characters', CHECKOUT_PROFILER: '0' });
after(async () => { globalThis.fetch = previousFetch; await rm(temporary, { recursive: true, force: true }); });
const orderSource = await readFile('src/lib/checkout-order.ts', 'utf8');
const outfile = join(temporary, 'order.mjs');
await build({ stdin: { contents: orderSource + '\nexport { lineItems, shippingLine, feeLines, discountedLineTotal }; export { buildOrderConfirmationContent } from "./mail";',
  resolveDir: resolve('src/lib'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22',
  outfile, define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
const server = await import(pathToFileURL(outfile).href);
const accountFile = join(temporary, 'account.mjs');
await build({ stdin: { contents: "export * from './src/lib/account-orders.ts';export * from './src/lib/order-display.ts';export * from './src/lib/account-reorder-cart.ts';export * from './src/lib/secure-checkout-cart.ts';export { getWooPricingContext } from './src/lib/woo-pricing-contract.ts';",
  resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22',
  outfile: accountFile, define: { 'import.meta.env': '{}' }, logLevel: 'silent', plugins: [{ name: 'offline-catalog', setup(plugin) {
    plugin.onResolve({ filter: /\/tm-products-cache$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const compactKey=v=>String(v||" ").toUpperCase().replace(/[^A-Z0-9]/g, "");export async function getProductsCache(){return {products:globalThis.__vatCatalog||[]}}' }));
  } }] });
const account = await import(pathToFileURL(accountFile).href);
const c = (value: unknown) => Math.round(Number(value) * 100);
const centsOfText = (text: string) => Math.round(Number(text.replace(/[^\d,.-]/g, '').replace(',', '.')) * 100);

function clientFunctions(source: string, extraNames: string[] = []) {
  const names = new Set(['cartPricing', 'cleanQty', 'isCalendarCartItem', 'isCompatibleDiscountItem', 'quantityDiscountRate', 'quantityLineDiscount',
    ...extraNames]);
  const ast = ts.createSourceFile('client.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const extracted: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) extracted.push(node.getText(ast));
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['SHIPPING', 'PAYMENT'].includes(node.name.text)) extracted.push(`const ${node.getText(ast)};`);
    ts.forEachChild(node, visit);
  }
  visit(ast); return extracted.join('\n');
}
const clientSource = await readFile('src/scripts/checkout.js', 'utf8');
const cartSource = await readFile('src/scripts/cart.js', 'utf8');
const client = runInNewContext(clientFunctions(clientSource) + ';({cartPricing, quantityLineDiscount})', { URL, window: { location: { origin: 'https://shop.example.invalid' } } });
const cartClient = runInNewContext(clientFunctions(cartSource) + ';({cartPricing, quantityLineDiscount})', { URL, window: { location: { origin: 'https://shop.example.invalid' } } });

function checkoutHarness() {
  class Element {
    hidden = false; textContent = ''; innerHTML = ''; className = ''; value = ''; dataset = {}; children: Element[] = [];
    appendChild(child: Element) { this.children.push(child); }
  }
  const nodes = new Map<string, Element>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
  let cart: any[] = [];
  node('input[name="shipping"]:checked').value = 'dpd_courier'; node('input[name="payment"]:checked').value = 'cod';
  const scope: any = { document: { querySelector: node, querySelectorAll: () => [], createElement: () => new Element() },
    readCart: () => cart, URL, window: { location: { origin: 'https://shop.example.invalid' } }, discountedGrossLine, grossVatTotals,
    tmLoyalty: { ok: false, discountValue: 0 }, tmLoyaltyApply: false, couponDiscountForTotal: () => 0, loyaltyDiscountForTotal: () => 0,
    syncCouponBoxes() {}, orderFulfilmentText: () => 'Skladom' };
  const render = runInNewContext(clientFunctions(clientSource, ['renderCheckoutSummary', 'esc', 'stockText', 'money', 'getSelected', 'isOnlinePayment', 'updateShippingOptionPrices']) + ';renderCheckoutSummary', scope);
  return { node, scope, render, setCart(value: any[]) { cart = value; } };
}

test('live Woo orders retain their actual VAT and gross line amounts in the new account', () => {
  const fixtures = [
    { id: 54550, total: '14.17', total_tax: '2.66', net: 1151, line: ['7.37', '1.70', 907] },
    { id: 54549, total: '33.34', total_tax: '6.24', net: 2710, line: ['22.96', '5.28', 2824] },
    { id: 54548, total: '6.70', total_tax: '1.26', net: 544, line: ['2.11', '0.49', 260] },
    { id: 54546, total: '25.10', total_tax: '4.69', net: 2041, line: ['18.05', '4.15', 2220] },
    { id: 54545, total: '33.22', total_tax: '6.22', net: 2700, line: ['26.03', '5.99', 3202] },
    { id: 54542, total: '248.45', total_tax: '46.46', net: 20199, line: ['201.99', '46.46', 24845] },
  ];
  for (const row of fixtures) {
    const result = account.accountOrderTotals(row);
    assert.equal(c(result.net), row.net, `order ${row.id}`);
    assert.equal(c(result.net) + c(result.tax), c(row.total));
    assert.equal(c(account.orderLineGrossTotal({ total: row.line[0], total_tax: row.line[1] })), row.line[2]);
  }
});

test('new checkout keeps the agreed COD gross and sums VAT from the new gross-price contract', () => {
  const h = checkoutHarness(); h.setCart([{ id: '11', sku: 'DR2400', name: 'Brother DR-2400 kompatibilný valec', price: 15.69, qty: 2, product_type_key: 'compatible' }]); h.render();
  assert.equal(centsOfText(h.node('[data-summary-total]').textContent), 3334);
  assert.equal(centsOfText(h.node('[data-summary-vat]').textContent), 623);
  assert.equal(centsOfText(h.node('[data-summary-net]').textContent), 2711);
  h.node('input[name="payment"]:checked').value = 'gopay';
  h.setCart([1, 2].map(id => ({ id, sku: `T${id}`, price: 0.03, qty: 1, product_type_key: 'original' })));
  h.render();
  assert.equal(centsOfText(h.node('[data-summary-total]').textContent), 396);
  assert.equal(centsOfText(h.node('[data-summary-vat]').textContent), 75, 'two rounded item taxes plus shipping, not VAT guessed from the grand total');
  assert.equal(centsOfText(h.node('[data-summary-net]').textContent), 321);
});

test('four separate CMYK products have exactly the same discount before submission and on the server', () => {
  const cart = ['black', 'cyan', 'magenta', 'yellow'].map((color, index) => ({ id: String(index + 1), sku: `W203${index}A`, name: `Toner ${color}`, color, price: 10, qty: 1, product_type_key: 'compatible' }));
  const expected = cart.reduce((sum, item) => sum + account.discountedLine(item).final, 0);
  for (const implementation of [client, cartClient]) {
    const pricing = implementation.cartPricing(cart);
    assert.equal(c(pricing.subtotal - pricing.discount), c(expected), 'preview must not offer a discount missing from the order API');
  }
});

test('regular, sale and historical prices are not multiplied by VAT on repeat or server verification', async () => {
  for (const [index, price] of [9.66, 13.05, 104.66].entries()) {
    const id = 100 + index; const sku = `VAT-${id}`;
    (globalThis as any).__vatCatalog = [{ id, sku, name: 'Current compatible toner', price: price / 1.23, product_type_key: 'compatible' }];
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input)); assert.equal(url.hostname, 'woo.example.invalid'); assert.equal(init?.method, 'GET'); calls++;
      return Response.json([{ id, sku, name: 'Current toner', status: 'publish', price: price.toFixed(2), stock_status: 'instock', stock_quantity: 100, tax_status: 'taxable', tax_class: '' }]);
    };
    const plan = { items: [{ id: String(id), productId: String(id), sku, name: 'Current toner', price, qty: 4, product_type_key: 'compatible' }] };
    const merged = account.mergeAccountReorder([{ id: String(id), sku, price: 999, qty: 1 }], plan).cart;
    const secure = await account.normalizeSecureCheckoutCart(merged);
    assert.equal(secure[0].price, price); assert.equal(secure[0].qty, 5); assert.equal(calls, 1);
    assert.equal(c(account.discountedLine(secure[0]).final), c(server.discountedLineTotal(secure[0])));
  }
});

test('prices and discounts agree for every cent from 0.01 to 100.00, all supported types and boundary quantities', () => {
  let checked = 0;
  for (let priceCents = 1; priceCents <= 10_000; priceCents++) for (const qty of [1, 2, 3, 4, 21, 99]) for (const type of ['compatible', 'original', 'refurbished']) {
    const item = { id: '1', sku: 'NO-SERIES', name: 'Toner', price: priceCents / 100, qty, product_type_key: type };
    const expected = c(account.discountedLine(item).final);
    assert.equal(c(server.discountedLineTotal(item)), expected);
    assert.equal(c(discountedGrossLine(item)), expected);
    for (const implementation of [client, cartClient]) assert.equal(c(item.price * qty - implementation.quantityLineDiscount(item)), expected);
    checked++;
  }
  assert.equal(checked, 180_000);
});

// Optional integration with the actual Woo 11.2.1 PHP tax methods, outside WordPress.
// No HTTP or writes: source files must already exist in TM_WOO_REFERENCE_DIR.
// Tax-rate selection is isolated to the live SK Standard 23% rate; tax arithmetic is original Woo code.
const referenceDir = process.env.TM_WOO_REFERENCE_DIR;
const phpBin = process.env.TM_PHP_BIN || 'php';
function phpFunction(source: string, name: string) {
  const start = source.indexOf(`function ${name}(`); assert(start >= 0, name);
  const open = source.indexOf('{', start); let depth = 1, quote = '', comment = '';
  for (let i = open + 1; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (comment === '//') { if (ch === '\n') comment = ''; continue; }
    if (comment === '/*') { if (ch === '*' && next === '/') { comment = ''; i++; } continue; }
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '/' && (next === '/' || next === '*')) { comment = ch + next; i++; continue; }
    if (ch === '{') depth++; if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Unclosed PHP function ' + name);
}
let referencePHP = '';
if (referenceDir) {
  const core = await readFile(join(referenceDir, 'wc-core-functions.php'), 'utf8');
  const format = await readFile(join(referenceDir, 'wc-formatting-functions.php'), 'utf8');
  const fee = await readFile(join(referenceDir, 'class-wc-order-item-fee.php'), 'utf8');
  const taxes = await readFile(join(referenceDir, 'class-wc-tax.php'), 'utf8');
  for (const [source, expected] of [
    [core, 'ad84915ede86d353b789b9647e854986eaf22c2e3a2c4d036c0d0da3a2b22348'],
    [format, '5354ca23a354542795a4c87b6509353102e0cc6db38cd0255c1d3e5eda5d51db'],
    [taxes, 'de18a75a96ac9045a9e3e52d3ebc5a110bbdf470fe9615a33b3fe090d1617a39'],
    [fee, 'db1d61f672c1ee9a2a1f53e1bfb411451dc25a0659cb368a62b84d2561cf44bb'],
  ]) assert.equal(createHash('sha256').update(source).digest('hex'), expected, 'Woo reference must be the audited 11.2.1 source');
  const findRates = phpFunction(taxes, 'find_rates');
  const isolatedTaxes = taxes.replace(findRates, "function find_rates($args=array()){return array(1=>array('rate'=>'23.0000','compound'=>'no'));}");
  referencePHP = `
namespace Automattic\\WooCommerce\\Utilities { class NumberUtil { static function round($v,$p=0,$m=PHP_ROUND_HALF_UP){return round((float)$v,$p,$m);} static function array_sum($v){return array_sum($v);} } }
namespace Automattic\\WooCommerce\\Enums { class ProductTaxStatus { const TAXABLE='taxable'; } }
namespace {
use Automattic\\WooCommerce\\Utilities\\NumberUtil;
use Automattic\\WooCommerce\\Enums\\ProductTaxStatus;
define('ABSPATH','/isolated-reference/'); define('WC_TAX_ROUNDING_MODE','auto');
function get_option($key,$default=false){return array('woocommerce_prices_include_tax'=>'yes','woocommerce_tax_round_at_subtotal'=>'no')[$key]??$default;}
function wc_get_price_decimals(){return 2;} function wc_get_rounding_precision(){return 4;}
function apply_filters($name,$value,...$args){return $value;} function do_action(...$args){} function wc_tax_enabled(){return true;}
function wc_array_merge_recursive_numeric($a,$b){foreach($b as $key=>$value){$a[$key]=($a[$key]??0)+$value;}return $a;}
${phpFunction(core, 'wc_get_tax_rounding_mode')}
${phpFunction(format, 'wc_round_tax_total')}
${isolatedTaxes.replace(/^<\?php/, '').replace(/use Automattic\\WooCommerce\\Utilities\\NumberUtil;/, '')}
class ReferenceItem {
  public $raw; public $order; public $tax=0;
  function __construct($raw,$order){$this->raw=$raw;$this->order=$order;}
  function get_total(){return (float)$this->raw['total'];}
  function get_tax_status(){return $this->raw['tax_status']??'taxable';}
  function get_tax_class(){return '';}
  function get_order(){return $this->order;}
  function set_taxes($taxes){$this->tax=array_sum(array_map('wc_round_tax_total',$taxes['total']??array()));}
  function calculate_taxes($args=array()){$this->set_taxes(array('total'=>$this->get_tax_status()==='taxable'?WC_Tax::calc_tax($this->get_total(),WC_Tax::find_rates($args)):array()));}
}
class ReferenceFee extends ReferenceItem {
  ${phpFunction(fee, 'get_tax_class_costs')}
  ${phpFunction(fee, 'calculate_taxes')}
}
class ReferenceOrder {
  public $items=array(); function get_items_tax_classes(){return array('');} function get_items($types=array()){return $this->items;}
}
$input=json_decode(stream_get_contents(STDIN),true); $results=array();
foreach($input as $payload){$order=new ReferenceOrder();
  foreach(array('line_items','shipping_lines','fee_lines') as $group)foreach($payload[$group]??array() as $raw){$order->items[]=$group==='fee_lines'?new ReferenceFee($raw,$order):new ReferenceItem($raw,$order);}
  $net=0; $tax=0; $lines=array();
  foreach($order->items as $item){$item->calculate_taxes(array('country'=>'SK','state'=>'','postcode'=>'','city'=>''));$net+=$item->get_total();$tax+=$item->tax;$lines[]=array('net'=>$item->get_total(),'tax'=>$item->tax);}
  $results[]=array('net'=>round($net,2),'tax'=>round($tax,2),'total'=>round($net+$tax,2),'lines'=>$lines);
}
echo json_encode($results); }
`;
}
function wooReference(payloads: any[]) {
  return JSON.parse(execFileSync(phpBin, ['-n', '-r', referencePHP], { input: JSON.stringify(payloads), encoding: 'utf8', maxBuffer: 4_000_000, timeout: 20_000 }));
}
const integrationRoot = process.env.TM_WOO_INTEGRATION_ROOT;
function nativeWoo(cases: any[]) {
  const result = JSON.parse(execFileSync(phpBin, ['scripts/woo-vat-integration.php'], { input: JSON.stringify(cases), encoding: 'utf8',
    maxBuffer: 24_000_000, timeout: 120_000 }));
  assert.equal(result.woocommerce, '11.2.1');
  if (process.env.TM_VAT_EXPECT_PHP) assert.equal(result.php, process.env.TM_VAT_EXPECT_PHP);
  return result.results;
}
async function orderPayload(cart: any[], total: number, paymentPrice = 0, shippingPrice = 0, legacy = false) {
  const source = { cart, total, currency: 'EUR', paymentCode: paymentPrice ? 'cod' : 'gopay', paymentLabel: 'Dobierka', paymentPrice,
    shippingCode: 'dpd_courier', shippingLabel: 'DPD kuriér na adresu', shippingPrice, billing: {}, delivery: {}, contact: {} };
  const payload: any = { currency: 'EUR', status: 'pending', shipping: { country: 'SK' }, line_items: await server.lineItems(source, 1),
    shipping_lines: [server.shippingLine(source, 1)], fee_lines: server.feeLines(source, 1), meta_data: [
      { key: 'source', value: 'tonerymaxim' }, { key: 'tm_order_total_gross', value: total.toFixed(2) },
      ...(!legacy ? [{ key: 'tm_price_contract', value: 'gross-v1' }] : []),
    ] };
  // Recorded legacy order 54549 had a one-cent rounding fee; only the historical reference uses it.
  if (legacy) payload.fee_lines.push({ name: 'Zaokrúhlenie', total: '-0.01', tax_status: 'none', total_tax: '0.00' });
  return payload;
}
test('isolated Woo PHP tax engine reproduces the live discounted COD order 54549', { skip: !referenceDir }, async () => {
  const payload = await orderPayload([{ id: '11', sku: 'T11', name: 'Toner', price: 15.69, qty: 2, product_type_key: 'compatible' }], 33.34, 1.20, 3.90, true);
  const [actual] = wooReference([payload]); assert.equal(c(actual.total), 3334); assert.equal(c(actual.tax), 624); assert.equal(c(actual.net), 2710);
});
test('actual Woo REST keeps a 3.08 product plus 3.90 courier total', { skip: !integrationRoot }, async () => {
  const payload = await orderPayload([{ id: '11', sku: 'T11', name: 'Toner', price: 3.08, qty: 1, product_type_key: 'original' }], 6.98, 0, 3.90);
  const [actual] = nativeWoo([{ body: payload }]); assert.equal(actual.status, 201); assert.equal(c(actual.data.total), 698);
  assert.equal(c(actual.data.total_tax), 131);
});
test('actual Woo REST preserves 30 low-value lines without any rounding fee', { skip: !integrationRoot }, async () => {
  const cart = Array.from({ length: 30 }, (_, index) => ({ id: String(index + 1), sku: `T-${index}`, name: 'Toner', price: 1.20, qty: 1, product_type_key: 'original' }));
  const [actual] = nativeWoo([{ body: await orderPayload(cart, 36) }]); assert.equal(actual.status, 201); assert.equal(c(actual.data.total), 3600);
  assert.equal(c(actual.data.total_tax), 660); assert.equal(actual.data.fee_lines.length, 0);
});

test('VAT cents conserve every gross amount and remain symmetric for negative discounts', () => {
  for (let gross = 0; gross <= 100_000; gross++) {
    const parts = grossVatParts(gross / 100), negative = grossVatParts(-gross / 100);
    const expectedNet = Number((BigInt(gross) * 100n + 61n) / 123n);
    assert.equal(c(parts.net), expectedNet); assert.equal(c(parts.net) + c(parts.tax), gross);
    assert.equal(c(negative.net) + c(negative.tax), -gross || 0);
  }
});

test('Woo REST matches quantity tiers, mixed types, sets, calendars, coupons, loyalty and shipping thresholds', { skip: !integrationRoot }, async () => {
  const cases: any[] = [], expected: any[] = [];
  for (const price of [0.01, 0.03, 1.15, 1.20, 3.08, 9.66, 13.05, 104.66]) for (const qty of [1, 2, 3, 4, 21, 99]) {
    const type = qty % 2 ? 'compatible' : 'original';
    const cart = [{ id: '11', sku: 'SKU11', name: 'Toner', price, qty, product_type_key: type }];
    const goods = discountedGrossLine(cart[0]), coupon = Math.round(goods * .05 * 100) / 100;
    const loyalty = Math.min(0.20, Math.max(0, goods - coupon)), shipping = Math.round((goods - coupon - loyalty) * 100) >= 2900 ? 0 : 2.90;
    const source = { cart, shippingPrice: shipping, paymentLabel: 'Dobierka', paymentPrice: qty % 2 ? 1.20 : 0,
      coupon: { code: 'FIXTURE', label: 'Kupón', discount: coupon }, loyaltyDiscount: loyalty };
    const totals = grossVatTotals(checkoutGrossLines(source));
    const payload = await orderPayload(cart, totals.gross, source.paymentPrice, shipping);
    payload.fee_lines = server.feeLines(source, 1); payload.customer_id = qty % 2 ? 0 : 123;
    expected.push(totals); cases.push({ body: payload });
  }
  for (const qty of [1, 3, 21]) {
    const cart = [{ id: 'calendar:FIXTURE-CAL', sku: 'FIXTURE-CAL', name: 'Calendar', price: 2.50, qty, source: 'kalendare-2027', product_type_key: 'calendar' }];
    const shipping = discountedGrossLine(cart[0]) >= 29 ? 0 : 3.90;
    const totals = grossVatTotals(checkoutGrossLines({ cart, shippingPrice: shipping }));
    expected.push(totals); cases.push({ body: await orderPayload(cart, totals.gross, 0, shipping) });
  }
  const cmyk = [0, 1, 2, 3].map(index => ({ id: String(index + 10), sku: `W203${index}A`, name: 'CMYK toner', price: 10, qty: 1, product_type_key: 'compatible' }));
  expected.push(grossVatTotals(checkoutGrossLines({ cart: cmyk }))); cases.push({ body: await orderPayload(cmyk, 40) });
  const pack = [{ id: '20', sku: 'PACK', name: 'CMYK set', price: 75.20, qty: 3, product_type_key: 'compatible' }];
  expected.push(grossVatTotals(checkoutGrossLines({ cart: pack }))); cases.push({ body: await orderPayload(pack, 203.04) });
  const actual = nativeWoo(cases);
  for (const [index, row] of actual.entries()) {
    assert.equal(row.status, 201, JSON.stringify({ index, error: row.data }));
    assert.equal(c(row.data.total), c(expected[index].gross), `gross ${index}`);
    assert.equal(c(row.data.total_tax), c(expected[index].tax), `VAT ${index}`);
    assert.equal(c(row.data.total) - c(row.data.total_tax), c(expected[index].net));
    for (const line of row.data.line_items) {
      const gross = line.meta_data.find((m: any) => m.key === 'tm_gross_line_total').value;
      assert.equal(c(line.total) + c(line.total_tax), c(gross), `item gross ${index}`);
    }
    assert.equal(row.data.fee_lines.some((fee: any) => fee.name === 'Zaokrúhlenie'), false);
  }
  assert.equal(actual.length, 53);
});

test('Woo contract rejects wrong settings, mismatched totals and unsupported products without creating an order', { skip: !integrationRoot }, async () => {
  const base = await orderPayload([{ id: '11', sku: 'T11', name: 'Toner', price: 3.08, qty: 1, product_type_key: 'original' }], 6.98, 0, 3.90);
  const wrongTotal = structuredClone(base); wrongTotal.meta_data.find((m: any) => m.key === 'tm_order_total_gross').value = '6.99';
  const noSource = structuredClone(base); noSource.meta_data = noSource.meta_data.filter((m: any) => m.key !== 'source');
  const foreignCountry = structuredClone(base); foreignCountry.shipping.country = 'CZ';
  const cases = [{ body: wrongTotal }, { body: noSource }, { body: base, headers: {} }, { body: foreignCountry },
    { body: base, product_tax_class: 'zero-rate' }, { body: base, product_tax_status: 'none' },
    ...Object.entries({ woocommerce_prices_include_tax: 'no', woocommerce_tax_round_at_subtotal: 'yes', woocommerce_currency: 'USD',
      woocommerce_price_num_decimals: '3', woocommerce_calc_taxes: 'no' }).map(([key, value]) => ({ body: base, options: { [key]: value } }))];
  for (const row of nativeWoo(cases)) { assert.equal(row.status, 409, JSON.stringify(row.data)); assert.equal(row.created_orders, 0); }
  const access = nativeWoo(['anonymous', 'customer', 'admin'].map(user => ({ user, method: 'GET', path: '/wc/v3/tm-pricing-context' })));
  assert([401, 403].includes(access[0].status)); assert.equal(access[1].status, 403); assert.equal(access[2].status, 200);
});

test('native Woo orders and later admin edits retain their own tax behaviour', { skip: !integrationRoot }, async () => {
  const base = await orderPayload([{ id: '11', sku: 'T11', name: 'Toner', price: 3.08, qty: 1, product_type_key: 'original' }], 6.98, 0, 3.90);
  const legacy = structuredClone(base); legacy.meta_data = legacy.meta_data.filter((m: any) => m.key !== 'tm_price_contract');
  const [old, current] = nativeWoo([{ body: legacy }, { body: base }]);
  assert.equal(old.status, 201); assert.equal(old.data.total, '6.97', 'unmarked legacy order uses native Woo rules');
  assert.equal(current.status, 201); assert.equal(current.data.total, '6.98');
  const rows = nativeWoo([
    { method: 'PUT', path: `/wc/v3/orders/${current.data.id}`, headers: {}, body: { line_items: [{ id: current.data.line_items[0].id, total: '2.00' }] } },
    { method: 'PUT', path: `/wc/v3/orders/${old.data.id}`, body: { meta_data: [{ key: 'tm_price_contract', value: 'gross-v1' }] } },
  ]);
  assert.equal(rows[0].status, 200); assert.equal(rows[0].data.total, '6.36', 'admin intent is not overwritten by original gross metadata');
  assert.equal(rows[1].status, 409, 'a historical order cannot silently opt into a new price contract');
});

test('PHP and browser use the same one-round VAT split for 200001 positive and negative cent amounts', { skip: !integrationRoot }, () => {
  const digest = createHash('sha256');
  for (let gross = -100000; gross <= 100000; gross++) {
    const parts = grossVatParts(gross / 100); digest.update(`${gross}:${c(parts.net)}:${c(parts.tax)};`);
  }
  const [actual] = nativeWoo([{ operation: 'tax_grid', limit: 100000 }]);
  assert.equal(actual.data.count, 200001); assert.equal(actual.data.digest, digest.digest('hex'));
});

test('confirmation page and both email formats use the same VAT and calendar quantity prices', async () => {
  const cart = [{ id: 'calendar:C1', sku: 'C1', name: 'Kalendár', source: 'kalendare-2027', product_type_key: 'calendar', price: 2.50, qty: 3 }];
  const source = { cart, originalSubtotal: 7.50, subtotal: 7.14, quantityDiscount: .36, total: 11.04, shippingPrice: 3.90,
    shippingCode: 'dpd_courier', paymentCode: 'gopay', paymentPrice: 0, paymentLabel: 'GoPay', contact: {}, billing: {}, delivery: {} };
  const email = server.buildOrderConfirmationContent({ source, orderNumber: '301999', paymentTitle: 'GoPay', shippingTitle: 'DPD' });
  const compact = email.text.replace(/\s/g, '');
  assert.match(compact, /Kalendár×3:7,14€sDPH\/5,80€bezDPH/);
  assert.match(compact, /ZákladbezDPH:8,97€/); assert.match(compact, /DPH23%:2,07€/);
  assert.match(email.html.replace(/\s/g, ''), /8,97€/); assert.match(email.html.replace(/\s/g, ''), /2,07€/);
  const page = await readFile('src/pages/platba-dokoncena.astro', 'utf8');
  const script = page.slice(page.indexOf('<script>') + 8, page.indexOf('</script>', page.indexOf('<script>')));
  const ast = ts.createSourceFile('confirmation.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'calc'); assert(fn);
  const compiled = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calc = runInNewContext(compiled + ';calc', { directMethod: '', discountedGrossLine, grossVatTotals });
  const actual = calc({ cart, pricing: client.cartPricing(cart), shipping: { price: 3.90 }, payment: 'gopay' });
  assert.equal(c(actual.total), 1104); assert.equal(c(actual.net), 897); assert.equal(c(actual.vat), 207);
});

function nativeTransport(mangleTotal = false) {
  const orders = new Map<number, any>(); const requests: Array<{ method: string; path: string; body: any }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.hostname, 'woo.example.invalid');
    const method = init?.method || 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path: url.pathname, body });
    if (url.pathname.endsWith('/tm-pricing-context')) return Response.json(nativeWoo([{ method: 'GET', path: '/wc/v3/tm-pricing-context' }])[0].data);
    if (url.pathname.endsWith('/orders') && method === 'GET') return Response.json([...orders.values()]);
    const id = Number(url.pathname.split('/').pop());
    if (method === 'GET' && orders.has(id)) return Response.json(orders.get(id));
    assert(['POST', 'PUT'].includes(method), `unexpected ${method} ${url.pathname}`);
    const [result] = nativeWoo([{ method, path: url.pathname.replace('/wp-json', ''), body, headers: Object.fromEntries(new Headers(init?.headers)) }]);
    if (mangleTotal && method === 'POST' && result.status < 300) result.data.total = (Number(result.data.total) + .01).toFixed(2);
    if (result.status < 300) orders.set(result.data.id, result.data);
    return Response.json(result.data, { status: result.status });
  };
  return { orders, requests };
}
function paymentSource(orderNumber: string) {
  return { orderNumber, paymentId: `pay-${orderNumber}`, paymentState: 'CREATED', amountCents: 698, currency: 'EUR', customerId: 0,
    cart: [{ id: '11', sku: 'T11', name: 'Toner', price: 3.08, qty: 1, product_type_key: 'original' }],
    shippingCode: 'dpd_courier', shippingLabel: 'DPD kuriér', shippingPrice: 3.90, paymentCode: 'gopay', paymentLabel: 'GoPay', paymentPrice: 0,
    originalSubtotal: 3.08, subtotal: 3.08, total: 6.98, billing: { firstName: 'Fixture', lastName: 'Buyer', address: 'Fixture 1', city: 'Fixture', zip: '97401' },
    contact: { email: 'buyer@example.invalid', phone: '+421900123456' }, delivery: {}, createdAt: '2026-11-17T10:00:00.000Z' };
}
test('Astro creation, GoPay-to-COD and a late PAID callback preserve one Woo order and the agreed amounts', { skip: !integrationRoot }, async () => {
  const transport = nativeTransport(); const source = paymentSource('VAT-LIFECYCLE-1');
  const created = await server.createWooOrderFromCheckout(source, { sendConfirmationEmail: false }); assert.equal(created.created, true);
  const converted: any = { ...source, wooOrderId: created.orderId, wooOrderNumber: created.orderNumber, paymentState: 'CONVERTED_TO_OFFLINE',
    paymentCode: 'cod', paymentLabel: 'Dobierka', paymentPrice: 1.20, total: 8.18, amountCents: 818, originalGoPayTotal: 6.98, originalGoPayAmountCents: 698 };
  const changed = await server.updateWooOrderPayment(converted, created.orderId);
  assert.equal(changed.orderId, created.orderId); assert.equal(changed.paymentFeeLineIds.length, 1);
  assert.equal(transport.orders.get(created.orderId).total, '8.18'); assert.equal(transport.orders.get(created.orderId).total_tax, '1.53');
  converted.convertedPaymentFeeLineIds = changed.paymentFeeLineIds;
  await server.savePendingGoPayOrder(converted);
  const paid = await server.processPaidGoPayOrder({ id: source.paymentId, state: 'PAID', amount: 698, currency: 'EUR' });
  assert.equal(paid.orderId, created.orderId);
  const order = transport.orders.get(created.orderId);
  assert.equal(order.total, '6.98'); assert.equal(order.total_tax, '1.31'); assert.equal(order.payment_method, 'gopay');
  assert.equal(order.fee_lines[0].total, '0.00'); assert.equal(order.fee_lines[0].total_tax, '0.00');
  await server.processPaidGoPayOrder({ id: source.paymentId, state: 'PAID', amount: 698, currency: 'EUR' });
  assert.equal(transport.requests.filter(r => r.method === 'POST').length, 1, 'no duplicate order on payment callbacks');
  assert.equal(transport.orders.get(created.orderId).total, '6.98');
});

test('an unexpected Woo total stops creation benefits and a retry never creates a second order', { skip: !integrationRoot }, async () => {
  const transport = nativeTransport(true); const source = paymentSource('VAT-MISMATCH-1');
  await assert.rejects(server.createWooOrderFromCheckout(source, { sendConfirmationEmail: false }), /nesúhlasí overená suma/);
  await assert.rejects(server.createWooOrderFromCheckout(source, { sendConfirmationEmail: false }), /nesúhlasí overená suma/);
  assert.equal(transport.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal(transport.requests.filter(r => r.method === 'PUT').length, 0);
});

test('pricing readiness deduplicates reads and refuses missing tax, net-entered prices or another currency', async () => {
  const now = Date.now; let epoch = now(), reads = 0;
  const good = { contract: 'gross-v1', rate_id: 1, rate_percent: 23, prices_include_tax: true, tax_enabled: true,
    country: 'SK', currency: 'EUR', decimals: 2, round_at_subtotal: false, compound: false, shipping_taxable: true };
  let response: any = good;
  Date.now = () => epoch;
  globalThis.fetch = async input => { assert.equal(new URL(String(input)).pathname, '/wp-json/wc/v3/tm-pricing-context'); reads++; return Response.json(response); };
  try {
    await Promise.all([account.getWooPricingContext(), account.getWooPricingContext()]); assert.equal(reads, 1);
    for (const patch of [{ contract: 'unknown' }, { rate_id: 0 }, { rate_percent: 19 }, { prices_include_tax: false }, { tax_enabled: false },
      { currency: 'USD' }, { decimals: 3 }, { country: 'CZ' }, { compound: true }, { shipping_taxable: false }, { round_at_subtotal: true }]) {
      epoch += 61000; response = { ...good, ...patch };
      await assert.rejects(account.getWooPricingContext(), /overiť/);
    }
    response = good; await account.getWooPricingContext(); assert.equal(reads, 13, 'failures never poison the cache');
  } finally { Date.now = now; }
});
