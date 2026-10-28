import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { captureOrderAvailability, orderAvailabilityText, orderAvailabilityNotice } from '../src/lib/order-availability.ts';
import { readOrderTemplateEmailRequest } from '../src/lib/order-email-template.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const at = '2026-10-28T10:00:00.000Z';
const stockItem = (quantity: number, stock: number | null, status = 'instock') => ({ qty: quantity, availability: captureOrderAvailability({ stock_status: status, stock_quantity: stock }, quantity, at) });

// Execute the real server modules with isolated Woo/SMTP/persistence adapters.
// The test process never contacts Woo or an SMTP server.
async function loadServer(path: string, mocks: Record<string, Record<string, any>>, extraExports = '') {
  const context = vm.createContext({
    console: { log() {}, error() {} }, URL, Date, Math, Map, Set, Buffer,
    setTimeout, clearTimeout, process: { ...process, env: { SMTP_HOST: 'smtp.test.invalid', SMTP_USER: 'test@tonerymaxim.sk', SMTP_PASS: 'fixture-only' } },
  });
  const modules = new Map<string, any>();
  async function moduleAt(filename: string): Promise<any> {
    if (modules.has(filename)) return modules.get(filename);
    const original = await readFile(filename, 'utf8');
    const source = stripTypeScriptTypes(original, { mode: 'strip' }) + (filename === resolve(root, path) ? extraExports : '');
    const mod = new vm.SourceTextModule(source, { context, identifier: filename, initializeImportMeta(meta) { Object.assign(meta, { env: {}, url: pathToFileURL(filename).href }); } });
    modules.set(filename, mod);
    await mod.link(async (specifier: string, parent: any) => {
      if (mocks[specifier]) {
        const exports = mocks[specifier];
        return new vm.SyntheticModule(Object.keys(exports), function() { for (const key of Object.keys(exports)) this.setExport(key, exports[key]); }, { context });
      }
      if (specifier.startsWith('node:')) {
        const exports = await import(specifier);
        return new vm.SyntheticModule(Object.keys(exports), function() { for (const key of Object.keys(exports)) this.setExport(key, exports[key]); }, { context });
      }
      const target = resolve(dirname(parent.identifier), specifier);
      return moduleAt(/\.ts$/.test(target) ? target : `${target}.ts`);
    });
    return mod;
  }
  const mod = await moduleAt(resolve(root, path));
  await mod.evaluate();
  return mod.namespace;
}

test('availability covers stock, order-only, partial stock and unlimited stock', () => {
  assert.equal(orderAvailabilityText(stockItem(2, 8)), 'Skladom');
  assert.equal(orderAvailabilityText(stockItem(3, null)), 'Skladom');
  assert.match(orderAvailabilityText(stockItem(2, 0)), /^Na objednávku.*3–10 pracovných dní$/);
  assert.match(orderAvailabilityText(stockItem(2, 9, 'outofstock')), /^Na objednávku/);
  assert.match(orderAvailabilityText(stockItem(2, null, 'onbackorder')), /^Na objednávku/);
  assert.equal(orderAvailabilityText(stockItem(3, 1)), '1 ks skladom · 2 ks na objednávku · predpokladané dodanie 3–10 pracovných dní');
});

test('missing, corrupt or changed-quantity snapshots never promise stock', () => {
  assert.equal(orderAvailabilityText({ qty: 2 }), 'Dostupnosť vám potvrdíme');
  assert.equal(orderAvailabilityText({ ...stockItem(1, 10), qty: 2 }), 'Dostupnosť vám potvrdíme');
  assert.equal(orderAvailabilityText({ qty: 1, availability: { ...stockItem(1, 1).availability, inStockQuantity: 8 } }), 'Dostupnosť vám potvrdíme');
  assert.equal(captureOrderAvailability({ stock_status: 'instock', stock_quantity: 'invalid' }, 1).status, 'unknown');
  assert.equal(captureOrderAvailability({}, 1).status, 'unknown');
  assert.equal(captureOrderAvailability({ stock_status: 'instock', stock_quantity: -1 }, 2).status, 'onorder');
});

test('mixed orders explicitly wait until all products are ready', () => {
  assert.match(orderAvailabilityNotice([stockItem(1, 2), stockItem(3, 1)]), /naraz po skompletizovaní/);
  assert.equal(orderAvailabilityNotice([stockItem(1, 2)]), '');
  assert.match(orderAvailabilityNotice([{ qty: 1 }]), /potvrdíme/);
});

test('checkout uses live Woo stock and ignores browser and stale cache stock', async () => {
  const cache = { id: 11, sku: 'SKU11', name: 'Toner', price: 10, stock_status: 'instock', stock_quantity: 99 };
  let stock = 1;
  const server = await loadServer('src/lib/secure-checkout-cart.ts', {
    './tm-products-cache': { getProductsCache: async () => ({ products: [cache] }), compactKey: (s: string) => s.toLowerCase() },
    './woo-client': { wooRequest: async (_path: string, options: any) => {
      assert.match(options.query._fields, /stock_status,stock_quantity/);
      return [{ id: 11, sku: 'SKU11', name: 'Toner', price: '10', status: 'publish', stock_status: stock > 0 ? 'instock' : 'outofstock', stock_quantity: stock }];
    } },
    './loyalty': { LOYALTY_PAPER_PRICE: 0.01, LOYALTY_PAPER_PRODUCT_SKU: 'PAPER', LOYALTY_PAPER_REWARD_SKU: 'REWARD' },
    './calendar-catalog': { CALENDAR_SOURCE: 'calendar', calendarDiscountRate: () => 0, calendarDiscountedUnitPrice: (v: number) => v, getCalendarProducts: async () => [], isBundledCalendarSku: () => false },
  });
  const raw = [{ id: 11, sku: 'SKU11', qty: 3, availability: stockItem(3, 99).availability }];
  const [item] = await server.normalizeSecureCheckoutCart(raw);
  assert.equal(item.availability.status, 'partial');
  assert.equal(item.availability.inStockQuantity, 1);
  assert.equal(item.availability.onOrderQuantity, 2);
  stock = 0;
  const [second] = await server.normalizeSecureCheckoutCart(raw);
  assert.equal(second.availability.status, 'onorder');
  assert.equal(item.availability.inStockQuantity, 1, 'previous order snapshot remains immutable');
});

test('confirmation HTML, plain text and admin copy include each item availability', async () => {
  const outgoing: any[] = [];
  const mail = await loadServer('src/lib/mail.ts', { nodemailer: { default: { createTransport: () => ({ sendMail: async (value: any) => { outgoing.push(value); return {}; } }) } } });
  const cart = [
    { name: 'Skladový toner', sku: 'A', price: 10, ...stockItem(1, 3) },
    { name: 'Objednávaný toner', sku: 'B', price: 20, ...stockItem(2, 0) },
    { name: '<script>produkt</script>', sku: 'C', price: 30, ...stockItem(3, 1) },
  ];
  const input = { to: 'customer@example.invalid', orderNumber: '301102', paymentTitle: 'Dobierka', shippingTitle: 'DPD', source: { cart, total: 140, originalSubtotal: 140, subtotal: 140, billing: { firstName: 'Test' } } };
  await mail.sendOrderConfirmationEmail(input);
  await mail.sendOrderAdminCopyEmail(input);
  assert.equal(outgoing.length, 2);
  for (const email of outgoing) {
    assert.match(email.from, /@tonerymaxim\.sk>/);
    for (const body of [email.text, email.html]) {
      assert.match(body, /Dostupnosť pri objednaní: Skladom/);
      assert.match(body, /Dostupnosť pri objednaní: Na objednávku/);
      assert.match(body, /1 ks skladom · 2 ks na objednávku/);
      assert.match(body, /3–10 pracovných dní/);
      assert.match(body, /naraz po skompletizovaní/);
    }
    assert.doesNotMatch(email.html, /<script>/);
    assert.match(email.html, /&lt;script&gt;/);
  }
  await mail.sendOrderConfirmationEmail({ ...input, source: { ...input.source, cart: [{ name: 'Starší produkt', sku: 'OLD', qty: 1, price: 10 }] } });
  assert.match(outgoing[2].text, /Dostupnosť vám potvrdíme/);
  assert.doesNotMatch(outgoing[2].html, /Dostupnosť pri objednaní: Skladom/);
});

test('Woo line metadata and the persisted order snapshot retain checkout availability', async () => {
  const nothing = () => undefined;
  const server = await loadServer('src/lib/checkout-order.ts', {
    './runtime-paths': { TM_CACHE_ROOT: '/tmp/test-cache' },
    './secure-persistence': { TM_DATA_ROOT: '/tmp/test-data', readSignedJson: nothing, writeSignedJson: nothing },
    './woo-client': { updateWooCustomer: nothing, wooRequest: nothing },
    './mail': { sendOrderAdminCopyEmail: nothing, sendOrderConfirmationEmail: nothing },
    './loyalty': { claimPaperReward: nothing, reserveLoyaltyDiscount: nothing },
    './coupons': { grantThankYouCoupon: nothing, markCouponUsed: nothing, thankYouCouponCode: nothing },
    './coupon-registry': { registerIssuedCoupon: nothing },
    './checkout-profiler': { CheckoutProfiler: class {} },
    './heureka-verified': { sendHeurekaVerifiedOrder: nothing },
    './order-idempotency': { withOrderIdempotency: nothing },
    './loyalty-rules': { canClaimPaperReward: nothing },
    './calendar-catalog': { CALENDAR_SOURCE: 'calendar', calendarDiscountRate: () => 0, calendarDiscountedUnitPrice: (v: number) => v },
    './checkout-customer-rules': { customerProfileUpdateFromOrder: nothing },
    './calendar-woo-line': { calendarWooLineReference: nothing },
    './dpd-pickup.ts': { normalizeDpdPickup: nothing },
  }, '\nexport { orderSnapshot, lineItems };');
  const item = { id: '11', product_id: 11, sku: 'SKU11', name: 'Toner', price: 10, ...stockItem(3, 1) };
  const source = { cart: [item], delivery: {}, shippingCode: 'dpd', total: 30 };
  const snapshot = server.orderSnapshot(source, 'Dobierka');
  assert.equal(snapshot.items[0].availability.status, 'partial');
  assert.equal(snapshot.items[0].availability.onOrderQuantity, 2);
  const [line] = await server.lineItems(source, 1);
  const meta = new Map(line.meta_data.map((entry: any) => [entry.key, entry.value]));
  assert.deepEqual(JSON.parse(String(meta.get('tm_availability'))), item.availability);
  assert.match(String(meta.get('tm_availability_text')), /1 ks skladom · 2 ks na objednávku/);
});

const request = { id: 'd49747ed-b93a-4bfc-9c50-d2f1a8995071', template_slug: 'tm-mail-a1b2c3d4', label: 'Čakáme na naskladnenie', subject: 'Objednávka {order_number}', message: '**Čakáme na tovar.**\nDáme vám vedieť.', created_at: at };

test('template requests reject malformed and incomplete data', () => {
  assert.equal(readOrderTemplateEmailRequest('bad JSON'), null);
  assert.equal(readOrderTemplateEmailRequest(JSON.stringify({ ...request, subject: '' })), null);
  assert.equal(readOrderTemplateEmailRequest(JSON.stringify({ ...request, id: 'unsafe' })), null);
  assert.equal(readOrderTemplateEmailRequest(JSON.stringify({ ...request, message: ['invalid'] })), null);
  assert.deepEqual(readOrderTemplateEmailRequest(JSON.stringify(request)), request);
});

async function queueFixture(options: { fail?: boolean; coloriq?: boolean; loseClaim?: boolean } = {}) {
  const meta = new Map<string, string>([
    ['source', options.coloriq ? 'coloriq' : 'tonerymaxim'], ['tm_order_number', '301102'],
    ['_tm_email_queue_observed_status', 'processing'], ['_tm_email_queue_last_sent_status', 'processing'],
    ['_tm_email_template_request', JSON.stringify(request)],
  ]);
  const sent: any[] = [];
  let fail = options.fail;
  const order = () => ({ id: 100, status: 'processing', date_modified: at, billing: { email: 'customer@example.invalid' }, line_items: [], meta_data: Array.from(meta, ([key, value]) => ({ key, value })) });
  const queue = await loadServer('src/lib/email-queue.ts', {
    './mail': { sendWooOrderStatusEmail: async (payload: any) => { if (fail) throw new Error('SMTP unavailable'); sent.push(payload); } },
    './woo-client': { wooRequest: async (path: string, input?: any) => {
      if (path === '/orders') { assert.equal(input.query.orderby, 'modified'); return [order()]; }
      if (input?.method === 'PUT') for (const entry of input.body.meta_data) meta.set(entry.key, entry.value);
      if (options.loseClaim && !input) meta.set('_tm_email_template_claim', 'other-worker');
      return order();
    } },
    './secure-persistence': { TM_DATA_ROOT: '/tmp/test-data', readSignedJson: async () => null, writeSignedJson: async () => undefined },
    './loyalty': { syncCustomerLoyaltyPoints: async () => undefined },
  });
  return { queue, meta, sent, recover: () => { fail = false; } };
}

test('manual template sends once and preserves order status and status-email markers', async () => {
  const { queue, meta, sent } = await queueFixture();
  await queue.runEmailQueueOnce();
  await queue.runEmailQueueOnce();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject_override, request.subject);
  assert.equal(sent[0].title_override, request.label);
  assert.equal(sent[0].from_status, sent[0].to_status);
  assert.equal(meta.get('_tm_email_template_sent_id'), request.id);
  assert.equal(meta.get('_tm_email_queue_observed_status'), 'processing');
  assert.equal(meta.get('_tm_email_queue_last_sent_status'), 'processing');
});

test('SMTP failure leaves the request pending and retry succeeds without a second message', async () => {
  const { queue, meta, sent, recover } = await queueFixture({ fail: true });
  await queue.runEmailQueueOnce();
  assert.equal(meta.has('_tm_email_template_sent_id'), false);
  assert.equal(meta.get('_tm_email_template_last_error'), 'SMTP unavailable');
  recover();
  await queue.runEmailQueueOnce();
  await queue.runEmailQueueOnce();
  assert.equal(sent.length, 1);
  assert.equal(meta.get('_tm_email_template_last_error'), '');
});

test('ColorIQ orders and requests claimed by another worker are not sent', async () => {
  for (const options of [{ coloriq: true }, { loseClaim: true }]) {
    const { queue, sent } = await queueFixture(options);
    await queue.runEmailQueueOnce();
    assert.equal(sent.length, 0);
  }
});

test('custom template rendering replaces order number, preserves new lines and escapes HTML', async () => {
  const outgoing: any[] = [];
  const mail = await loadServer('src/lib/mail.ts', { nodemailer: { default: { createTransport: () => ({ sendMail: async (value: any) => outgoing.push(value) }) } } });
  await mail.sendWooOrderStatusEmail({ event_id: 'fixture', order_id: 100, order_number: '301102', from_status: 'processing', to_status: 'processing', customer: { email: 'customer@example.invalid' }, title_override: request.label, subject_override: request.subject, message_override: request.message + '\n<img src=x onerror=bad()>' });
  assert.equal(outgoing[0].subject, 'Objednávka 301102');
  assert.match(outgoing[0].html, /<strong>Čakáme na tovar\.<\/strong><br>Dáme vám vedieť\./);
  assert.match(outgoing[0].html, /&lt;img/);
  assert.doesNotMatch(outgoing[0].html, /<img/);
  assert.match(outgoing[0].text, /Dáme vám vedieť/);
});
