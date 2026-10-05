import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/scripts/smart-search.js', import.meta.url), 'utf8');
function harness() {
  let now = 0, next = 0;
  const timers = new Map(), requests = [], storage = new Map();
  const element = () => ({ dataset: {}, handlers: {}, attrs: {}, innerHTML: '', hidden: true,
    addEventListener(k, fn) { this.handlers[k] = fn; }, setAttribute(k, v) { this.attrs[k] = v; } });
  const input = element(), panel = element(), form = element();
  input.value = '';
  const wrapper = { querySelector: () => panel, contains: () => true };
  form.querySelector = () => input;
  form.closest = q => q === '.tm-smart-search-wrap' ? wrapper : null;
  form.matches = () => false;
  form.parentElement = wrapper;
  const timeout = (fn, delay) => { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; };
  const window = { requestIdleCallback() {}, location: {}, setTimeout: timeout };
  const document = { readyState: 'complete', querySelectorAll: () => [form], addEventListener() {} };
  vm.runInNewContext(source, { window, document, AbortController, Intl, Date, encodeURIComponent,
    setTimeout: timeout, clearTimeout: id => timers.delete(id),
    sessionStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: (url, opts) => new Promise((resolve, reject) => {
      const r = { url, signal: opts.signal, resolve, reject }; requests.push(r);
      opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }) });
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  async function advance(ms) {
    const end = now + ms;
    while (true) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].fn(); await flush();
    }
    now = end; await flush();
  }
  async function query(q) { input.value = q; input.handlers.input(); await advance(55); }
  async function answer(index, title) {
    requests[index].resolve({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, products: [{ title, url: '/produkt/test' }] }) });
    await flush();
  }
  return { input, panel, form, window, requests, advance, query, answer, flush };
}
test('response after 4 seconds still renders; slow state has mobile navigation', async () => {
  const h = harness(); await h.query('CF53'); await h.advance(4100);
  assert.equal(h.requests[0].signal.aborted, false);
  assert.match(h.panel.innerHTML, /href="\/produkty\?s=CF53"/);
  await h.answer(0, 'HP 205A sada'); assert.match(h.panel.innerHTML, /HP 205A sada/);
  await h.advance(30000); assert.match(h.panel.innerHTML, /HP 205A sada/);
});
test('new query cancels slow request and late response cannot replace current results', async () => {
  const h = harness(); await h.query('CF53'); await h.advance(4100); await h.query('TN2421');
  assert.equal(h.requests[0].signal.aborted, true);
  await h.answer(1, 'Brother TN2421'); await h.answer(0, 'OLD');
  assert.match(h.panel.innerHTML, /Brother/); assert.doesNotMatch(h.panel.innerHTML, /OLD/);
});
test('Escape hides panel and cancels pending request and slow UI', async () => {
  const h = harness(); await h.query('CF53'); h.input.handlers.keydown({ key: 'Escape' });
  await h.advance(40000); assert.equal(h.panel.hidden, true); assert.equal(h.requests[0].signal.aborted, true);
});
test('hard deadline terminates hung request and focus permits retry', async () => {
  const h = harness(); await h.query('CF53'); await h.advance(30000);
  assert.equal(h.requests[0].signal.aborted, true); assert.match(h.panel.innerHTML, /href="\/produkty\?s=CF53"/);
  h.input.handlers.focus(); await h.advance(55); assert.equal(h.requests.length, 2);
  await h.answer(1, 'Recovered'); assert.match(h.panel.innerHTML, /Recovered/);
});
test('transient network failure retries once and renders success', async () => {
  const h = harness(); await h.query('CF53'); h.requests[0].reject(new TypeError('network')); await h.flush();
  await h.advance(180); assert.equal(h.requests.length, 2); await h.answer(1, 'Recovered');
  assert.match(h.panel.innerHTML, /Recovered/);
});
test('fast response is not overwritten by slow notification', async () => {
  const h = harness(); await h.query('CF53'); await h.answer(0, 'Fast'); await h.advance(40000);
  assert.match(h.panel.innerHTML, /Fast/); assert.equal(h.requests.length, 1);
});
test('form submission navigates while request is pending', async () => {
  const h = harness(); await h.query('CF53'); let prevented = false;
  h.form.handlers.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.window.location.href, "/produkty?s=CF53"); assert.equal(h.requests[0].signal.aborted, true); assert.equal(h.panel.hidden, true);
});
