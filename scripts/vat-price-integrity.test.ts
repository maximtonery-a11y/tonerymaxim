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

await mkdir('.tm-cache', { recursive: true });
const temporary = await mkdtemp(resolve('.tm-cache/vat-integrity-'));
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('VAT audit prohibits unmocked HTTP'); };
Object.assign(process.env, { WOO_URL: 'https://woo.example.invalid', WOO_CONSUMER_KEY: 'fixture', WOO_CONSUMER_SECRET: 'fixture',
  TM_PERSISTENT_DATA_DIR: temporary, TM_PERSISTENCE_SECRET: 'isolated-vat-integrity-test-secret-at-least-32-characters', CHECKOUT_PROFILER: '0' });
after(async () => { globalThis.fetch = previousFetch; await rm(temporary, { recursive: true, force: true }); });
const orderSource = await readFile('src/lib/checkout-order.ts', 'utf8');
const outfile = join(temporary, 'order.mjs');
await build({ stdin: { contents: orderSource + '\nexport { lineItems, shippingLine, feeLines, roundingAdjustment, discountedLineTotal };',
  resolveDir: resolve('src/lib'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22',
  outfile, define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
const server = await import(pathToFileURL(outfile).href);
const accountFile = join(temporary, 'account.mjs');
await build({ stdin: { contents: "export * from './src/lib/account-orders.ts';export * from './src/lib/order-display.ts';export * from './src/lib/account-reorder-cart.ts';export * from './src/lib/secure-checkout-cart.ts';",
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
    'seriesPackDiscount', 'seriesBaseKey', 'seriesColorKey', 'normalizeSeriesText', 'seriesText', 'netFromGross', 'vatFromGross', ...extraNames]);
  const ast = ts.createSourceFile('client.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const extracted: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) extracted.push(node.getText(ast));
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['SHIPPING', 'PAYMENT', 'VAT_RATE'].includes(node.name.text)) extracted.push(`const ${node.getText(ast)};`);
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
    readCart: () => cart, URL, window: { location: { origin: 'https://shop.example.invalid' } },
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

test('the rendered checkout matches live order 54549 including per-line tax rounding', () => {
  const h = checkoutHarness(); h.setCart([{ id: '11', sku: 'DR2400', name: 'Brother DR-2400 kompatibilný valec', price: 15.69, qty: 2, product_type_key: 'compatible' }]); h.render();
  assert.equal(centsOfText(h.node('[data-summary-total]').textContent), 3334);
  assert.equal(centsOfText(h.node('[data-summary-vat]').textContent), 624);
  assert.equal(centsOfText(h.node('[data-summary-net]').textContent), 2710);
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
      return Response.json([{ id, sku, name: 'Current toner', status: 'publish', price: price.toFixed(2), stock_status: 'instock', stock_quantity: 100 }]);
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
async function orderPayload(cart: any[], total: number, paymentPrice = 0, shippingPrice = 0) {
  const source = { cart, total, currency: 'EUR', paymentCode: paymentPrice ? 'cod' : 'gopay', paymentLabel: 'Dobierka', paymentPrice,
    shippingCode: 'dpd_courier', shippingLabel: 'DPD kuriér na adresu', shippingPrice, billing: {}, delivery: {}, contact: {} };
  const payload = { line_items: await server.lineItems(source, 1), shipping_lines: [server.shippingLine(source, 1)], fee_lines: server.feeLines(source, 1) };
  const correction = server.roundingAdjustment(source);
  if (Math.abs(correction) >= 0.01) payload.fee_lines.push({ total: correction.toFixed(2), tax_status: 'none', total_tax: '0.00' });
  return payload;
}
test('isolated Woo PHP tax engine reproduces the live discounted COD order 54549', { skip: !referenceDir }, async () => {
  const payload = await orderPayload([{ id: '11', sku: 'T11', name: 'Toner', price: 15.69, qty: 2, product_type_key: 'compatible' }], 33.34, 1.20, 3.90);
  const [actual] = wooReference([payload]); assert.equal(c(actual.total), 3334); assert.equal(c(actual.tax), 624); assert.equal(c(actual.net), 2710);
});
test('Woo-inclusive half-cent tax rounding preserves a 3.08 product plus 3.90 courier total', { skip: !referenceDir }, async () => {
  const payload = await orderPayload([{ id: '11', sku: 'T11', name: 'Toner', price: 3.08, qty: 1, product_type_key: 'original' }], 6.98, 0, 3.90);
  const [actual] = wooReference([payload]); assert.equal(c(actual.total), 698);
});
test('30 distinct low-value lines retain the submitted gross total after Woo recalculates negative fees', { skip: !referenceDir }, async () => {
  const cart = Array.from({ length: 30 }, (_, index) => ({ id: String(index + 1), sku: `T-${index}`, name: 'Toner', price: 1.20, qty: 1, product_type_key: 'original' }));
  const [actual] = wooReference([await orderPayload(cart, 36)]); assert.equal(c(actual.total), 3600);
});
