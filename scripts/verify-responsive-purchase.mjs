// Invoked by account-orders-render-smoke.mjs --responsive, against its disposable, local-only shop.
import assert from 'node:assert/strict';

const productPath = '/produkt/fixture-toner-';
const layouts = [
  [320, 640, true], [360, 800, true], [390, 844, true], [430, 932, true],
  [844, 390, true], [768, 1024, true], [1024, 768, true], [1280, 800, false], [1440, 900, false],
];
const cents = text => Math.round(Number(text.replace(/[^0-9,.-]/g, '').replace(',', '.')) * 100);
async function amount(page, selector, expected) {
  const node = page.locator(selector);
  await node.waitFor({ state: 'visible' });
  assert.equal(cents(await node.textContent()), expected, selector);
}
async function fits(locator) {
  const bad = await locator.evaluateAll(elements => elements.filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.width && (rect.left < -1 || rect.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1);
  }).map(el => ({ element: el.className || el.tagName, viewport: innerWidth,
    left: Math.round(el.getBoundingClientRect().left), right: Math.round(el.getBoundingClientRect().right),
    content: el.scrollWidth, box: el.clientWidth })));
  assert.deepEqual(bad, [], 'Elements must fit the viewport');
}
async function columns(page, count) {
  await page.waitForFunction(expected => {
    const grid = document.querySelector('.comparison-grid');
    return grid && getComputedStyle(grid).gridTemplateColumns.split(' ').length === expected;
  }, count);
}
async function checkLayout(page, origin, [width, height, touch]) {
  const phone = touch && Math.min(width, height) <= 600;
  for (const [id, count] of [[41, 0], [21, 1], [31, 2], [12, 3]]) {
    await page.goto(origin + productPath + id, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-add-main]').waitFor();
    if (id === 41) await page.locator('#tm-cookie-reject').click();
    await page.locator('[data-accessories-section] [data-related-id="91"]').waitFor();
    assert.equal(await page.locator('.comparison-card').count(), count);
    assert.equal(await page.locator('.jump-to-alternatives').count(), Number(count > 0));
    if (!count) continue;
    await columns(page, phone || width <= 820 ? 1 : Math.min(count, width <= 1100 ? 2 : 3));
    await fits(page.locator('.comparison-card, .comparison-action, .comparison-facts dd, .comparison-button'));
    if (id === 21) {
      assert.equal(await page.locator('a.comparison-button').getAttribute('href'), productPath + '22#compatible-printers');
      assert.equal(await page.locator('[data-alternative-cart]').count(), 0);
      await page.getByRole('link', { name: 'Overiť tlačiareň' }).click();
      await page.waitForFunction(() => {
        const target = document.querySelector('#compatible-printers h2');
        if (!target || location.hash !== '#compatible-printers') return false;
        const top = target.getBoundingClientRect().top;
        return top >= 0 && top < innerHeight;
      });
      assert.match(await page.locator('#compatible-printers').innerText(), /Brother DCP-L2512D/);
      await page.locator('[data-accessories-section] [data-related-id="91"]').waitFor();
    }
  }
  if (width === 390) {
    await page.setViewportSize({ width: height, height: width });
    await page.waitForSelector('html.tm-device-mobile-landscape');
    await columns(page, 1);
    await page.setViewportSize({ width, height });
    await page.waitForSelector('html.tm-device-mobile-portrait');
    await columns(page, 1);
  }
  await page.locator('.jump-to-alternatives').click();
  await page.waitForFunction(() => {
    const top = document.querySelector('#alternativy h2').getBoundingClientRect().top;
    const headerBottom = document.querySelector('.tm-trust-bar').getBoundingClientRect().bottom;
    return location.hash === '#alternativy' && top >= headerBottom - 1 && top < innerHeight
      && !document.querySelector('[data-mobile-sticky-cart]').classList.contains('is-visible');
  });
  if (phone) assert.equal(await page.locator('[data-ai-nudge]').isVisible(), false);
  const card = page.locator('[data-alternative-id="11"]');
  assert.match(await card.innerText(), /91,61/);
  assert.match(await page.locator('[data-alternative-id="14"]').innerText(), /Nižšia výťažnosť/);
  await card.locator('button').click();
  const drawer = page.locator('[data-add-cart-drawer]');
  await drawer.waitFor();
  assert.match(await drawer.locator('h2').innerText(), /TN-2421 čierny kompatibilný toner/);
  assert.match(await drawer.locator('[data-add-cart-summary]').innerText(), /15,95/);
  await amount(page, '.add-cart-pricebox strong', 1305);
  await drawer.locator('.add-cart-panel').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
  await fits(drawer.locator('.add-cart-panel,.add-cart-meta,.add-cart-actions a'));
  await drawer.getByRole('link', { name: 'Do košíka', exact: true }).click();
  const qty = page.locator('[data-cart-action="input"][data-sku="SKU-11"]');
  await qty.waitFor();
  assert.equal(await qty.inputValue(), '1');
  await page.locator('[data-cart-action="remove"][data-sku="SKU-11"]').click();
  await page.locator('[data-cart-empty]').waitFor();
  assert.equal(await page.locator('[data-cart-mobile-breakdown]').isVisible(), false);

  await page.goto(origin + '/__account_fixture_session');
  const order = page.locator('[data-account-order="701"]');
  assert.match(await order.innerText(), /30,00/);
  await order.locator('[data-reorder-start]').click();
  const plan = order.locator('[data-reorder-preview]');
  await plan.waitFor();
  assert.match(await plan.innerText(), /4 ks × 13,05/);
  assert.match(await plan.innerText(), /Vyradený toner/);
  await fits(plan.locator('li,button'));
  await plan.locator('[data-reorder-cancel]').click();
  assert.equal(await plan.isVisible(), false);
  assert.equal(await page.evaluate(() => window.ToneryMaximCart.readCart().length), 0);
  await order.locator('[data-reorder-start]').click();
  await plan.locator('[data-reorder-confirm]').click();
  await qty.waitFor();
  assert.equal(await qty.inputValue(), '4');
  const compact = await page.locator('[data-cart-mobile-breakdown]').isVisible();
  assert.equal(compact, width <= 767);
  if (compact) await page.locator('[data-cart-mobile-breakdown] summary').click();
  const cart = compact ? 'data-cart-breakdown-' : 'data-cart-';
  for (const [quantity, net, tax, gross] of [[4, 3183, 732, 3915], [2, 1910, 439, 2349]]) {
    if (quantity === 2) {
      const minus = page.locator('[data-cart-action="minus"][data-sku="SKU-11"]');
      await minus.click(); await minus.click();
    }
    assert.equal(await qty.inputValue(), String(quantity));
    await amount(page, '[' + cart + 'net]', net);
    await amount(page, '[' + cart + 'vat]', tax);
    await amount(page, '[' + cart + 'total]', gross);
  }
  await page.locator(compact ? '.cart-mobile-sticky-checkout' : '.checkout-button').click();
  await page.locator('[data-checkout-form]').waitFor();
  const next = page.locator('[data-checkout-next="delivery"]');
  if (await next.isVisible()) {
    await page.locator('#email').fill('test@example.invalid');
    await page.locator('#phone').fill('0900123456');
    await next.click();
  }
  const toggle = page.locator('[data-mobile-summary-toggle]');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  for (const [shipping, payment, net, tax, gross] of [
    ['dpd_courier', 'cod', 2325, 534, 2859],
    ['gls_courier', 'bank_prepaid', 2227, 512, 2739],
    ['dpd_pickup', 'gopay', 2146, 493, 2639],
  ]) {
    await page.locator('label:has(input[name="shipping"][value="' + shipping + '"])').click();
    await page.locator('label:has(input[name="payment"][value="' + payment + '"])').click();
    await amount(page, '[data-summary-total]', gross);
    await amount(page, '[data-summary-net]', net);
    await amount(page, '[data-summary-vat]', tax);
  }
  await fits(page.locator('.checkout-summary .summary-line'));
}
async function verifyEngine(origin, engine, configurations, options) {
  const browser = await engine.launch(options);
  try {
    for (const layout of configurations) {
      const [width, height, touch] = layout;
      const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const unexpected = [];
      page.on('pageerror', err => unexpected.push(err.message));
      const purchaseRoutes = ['/api/order-create', '/api/gopay-create'];
      await context.route(url => url.origin !== origin || purchaseRoutes.includes(url.pathname), route => {
        const url = new URL(route.request().url());
        if (url.origin === origin) unexpected.push(url.pathname);
        return route.abort();
      });
      try {
        await checkLayout(page, origin, layout);
        assert.deepEqual(unexpected, []);
        console.log(`${engine.name()} ${width}×${height} OK: alternatives, cart, reorder, VAT and checkout`);
      } catch (error) {
        throw new Error(`${width}×${height}, ${page.url()}: ${error.message}`, { cause: error });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}

export async function verifyResponsivePurchase(origin) {
  const { chromium, webkit } = await import(process.env.TM_PLAYWRIGHT_MODULE || 'playwright');
  await verifyEngine(origin, chromium, layouts, process.env.TM_CHROMIUM_PATH ? { executablePath: process.env.TM_CHROMIUM_PATH } : {});
  await verifyEngine(origin, webkit, layouts.filter(([width]) => [390, 844, 1280].includes(width)), {});
}
