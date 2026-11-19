// Test transport only. Imported exclusively by the disposable purchase fixture.
import { Server } from 'node:http';
import assert from 'node:assert/strict';

const payments = new Map();
const requests = [];
let sequence = 88000;
function json(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
function html(response, value) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(value);
}
function body(request) {
  return new Promise((resolve, reject) => {
    let text = '';
    request.on('data', chunk => text += chunk);
    request.on('end', () => { try { resolve(JSON.parse(text || '{}')); } catch (error) { reject(error); } });
  });
}
const emit = Server.prototype.emit;
Server.prototype.emit = function(name, ...args) {
  if (name !== 'request') return emit.call(this, name, ...args);
  const [request, response] = args;
  const url = new URL(request.url, 'http://' + request.headers.host);
  if (url.pathname === '/__purchase_mobile') {
    const width = Number(url.searchParams.get('width') || 390);
    const safe = [320, 390, 768, 1280].includes(width) ? width : 390;
    html(response, `<!doctype html><html lang="sk"><meta charset="utf-8"><title>Test nákupného procesu</title><style>body{font:16px Arial;background:#eef2f7;padding:14px}nav{display:flex;gap:14px;margin-bottom:12px}iframe{display:block;width:${safe}px;height:860px;border:1px solid #bbc9dc;background:#fff;border-radius:10px}</style><nav><a href="/__purchase_mobile?width=320">320 px</a><a href="/__purchase_mobile?width=390">390 px</a><a href="/__purchase_mobile?width=768">768 px</a><a href="/__purchase_mobile?width=1280">Desktop</a></nav><iframe title="Skúšobný nákup" src="/produkt/fixture-toner-12"></iframe></html>`);
    return true;
  }
  if (url.pathname === '/__purchase_metrics') {
    json(response, { requests, payments: [...payments.entries()], realOrders: 0, realPayments: 0, emails: 0 });
    return true;
  }
  if (url.pathname === '/__purchase_gateway') {
    const id = url.searchParams.get('id');
    html(response, `<!doctype html><html lang="sk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Skúšobná platba</title><style>body{font:18px Arial;padding:24px}a{display:block;padding:18px;margin:14px 0;background:#e7effb;border-radius:10px}</style><h1>Skúšobná brána GoPay</h1><p>Platba sa nestrhne. Používa sa zostavený obchod s náhradným platobným transportom.</p><a href="/__purchase_return?id=${id}&state=PAID">Simulovať úspešnú platbu</a><a href="/__purchase_return?id=${id}&state=CANCELED">Simulovať zrušenú platbu</a><a href="/__purchase_return?id=${id}&state=CREATED">Vrátiť sa bez zaplatenia</a></html>`);
    return true;
  }
  if (url.pathname === '/__purchase_return') {
    const payment = payments.get(url.searchParams.get('id'));
    if (payment) payment.state = url.searchParams.get('state');
    response.writeHead(302, { Location: '/platba-dokoncena?id=' + url.searchParams.get('id') }); response.end();
    return true;
  }
  if (url.pathname === '/api/gopay-warmup') { json(response, { ok: true }); return true; }
  if (url.pathname === '/api/gopay-status') {
    const payment = payments.get(url.searchParams.get('id'));
    json(response, payment ? { ok: true, state: payment.state, storedState: payment.storedState, preview: payment.preview,
      pending: { orderNumber: payment.orderNumber, paymentCode: payment.preview.payment }, payment: { order_number: payment.orderNumber } } : { ok: false }, payment ? 200 : 404);
    return true;
  }
  if (['/api/gopay-create', '/api/gopay-retry', '/api/gopay-change-payment', '/api/order-create'].includes(url.pathname)) {
    void body(request).then(data => {
      requests.push({ path: url.pathname, body: data });
      if (url.pathname === '/api/gopay-change-payment') {
        const payment = payments.get(String(data.paymentId));
        if (!payment) return json(response, { ok: false }, 404);
        payment.preview.payment = data.payment;
        payment.storedState = 'CONVERTED_TO_OFFLINE';
        return json(response, { ok: true, orderId: 999001, orderNumber: payment.orderNumber, payment: data.payment, preview: payment.preview });
      }
      if (url.pathname === '/api/gopay-retry') {
        const payment = payments.get(String(data.paymentId));
        if (!payment) return json(response, { ok: false }, 404);
        const id = String(++sequence); payments.set(id, { ...payment, state: 'CREATED' });
        return json(response, { ok: true, paymentId: id, orderNumber: payment.orderNumber, gwUrl: url.origin + '/__purchase_gateway?id=' + id });
      }
      assert.ok(data.cart?.length, 'Checkout must submit the selected products');
      assert.equal(data.termsAccepted, true);
      assert.ok(data.requestId);
      assert.ok(data.contact?.email && data.contact?.phone);
      if (['dpd_pickup', 'dpd_box', 'gls_pickup'].includes(data.shipping?.method)) {
        assert.ok(data.shipping.pickup?.pickup_id);
        assert.equal(data.shipping.pickup.carrier, data.shipping.method.startsWith('dpd') ? 'DPD' : 'GLS');
      }
      if (url.pathname === '/api/order-create') return json(response, { ok: true, orderId: 999002, orderNumber: '999002' });
      const existing = [...payments].find(([, value]) => value.preview.requestId === data.requestId);
      const id = existing?.[0] || String(++sequence);
      const orderNumber = existing?.[1].orderNumber || String(999001 + payments.size);
      payments.set(id, { orderNumber, preview: { ...data, orderNumber }, state: 'CREATED', storedState: 'CREATED' });
      json(response, { ok: true, paymentId: id, orderNumber, gwUrl: url.origin + '/__purchase_gateway?id=' + id });
    }).catch(error => json(response, { ok: false, error: error.message }, 400));
    return true;
  }
  return emit.call(this, name, ...args);
};
