// Invoked by account-orders-render-smoke.mjs --responsive, against its disposable, local-only shop.
import assert from 'node:assert/strict';
import { verifyMobileLabel } from './verify-mobile-label.mjs';

const productPath = '/produkt/fixture-toner-';
const layouts = [
  [320, 640, true], [360, 800, true], [390, 844, true], [430, 932, true],
  [844, 390, true], [768, 1024, true], [1024, 768, true], [1280, 800, false], [1440, 900, false],
];
const cents = text => Math.round(Number(text.replace(/[^0-9,.-]/g, '').replace(',', '.')) * 100);
async function amount(page, selector, expected) {
  const node = page.locator(selector);
  await node.waitFor({ state: 'visible' });
  await page.waitForFunction(([selector, expected]) => {
    const text = document.querySelector(selector)?.textContent || "";
    return /\d/.test(text) && Math.round(Number(text.replace(/[^0-9,.-]/g, "").replace(",", ".")) * 100) === expected;
  }, [selector, expected]);
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

async function checkPrinterFit(page, origin) {
  const toggle = page.getByRole('button', { name: 'Overiť moju tlačiareň' });
  const panel = page.locator('[data-check-panel]');
  const field = panel.getByRole('searchbox', { name: 'Model tlačiarne' });
  const status = panel.getByRole('status');
  const catalog = panel.locator('[data-check-catalog]');
  const model = 'Brother DCP-L2512D';
  const lookups = [];
  const listen = request => {
    if (/^\/api\/(?:product|products|printers|search|suggest)(?:[/?]|$)/.test(new URL(request.url()).pathname)) lookups.push(request.url());
  };
  // The existing page may finish its accessory request just after first paint.
  await page.locator('[data-accessories-section] [data-related-id="91"]').waitFor();
  page.on('request', listen);
  try {
    assert.equal(await panel.isVisible(), false);
    await toggle.click();
    await field.fill('L2512');
    assert.equal(await status.getAttribute('data-state'), 'choose');
    await panel.getByRole('button', { name: model, exact: true }).click();
    assert.equal(await status.getAttribute('data-state'), 'listed');
    assert.equal(await page.locator('[data-check-summary]').innerText(), model);
    assert.equal(await catalog.isVisible(), false);
    await field.fill(model + 'W');
    await field.press('Enter');
    assert.equal(await status.getAttribute('data-state'), 'unknown');
    assert.equal(new URL(await catalog.getAttribute('href'), origin).searchParams.get('s'), model + 'W');
    assert.doesNotMatch(await page.locator('[data-check-heading]').innerText(), /Vybraná/);
    await fits(panel.locator('form, .printer-check-input, button, a, [role="status"]'));
    // An editable field scrolls its own long values, but its border must fit the form.
    assert.ok(await field.evaluate(el => {
      const rect = el.getBoundingClientRect(), form = el.form.getBoundingClientRect();
      return rect.left >= form.left - 1 && rect.right <= form.right + 1 && rect.height >= 44;
    }));
    await status.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.ok(await toggle.evaluate(el => el === document.activeElement));
    await page.locator('[data-check-from-models]').click();
    assert.ok(await field.evaluate(el => el === document.activeElement));
    await field.fill('');
    await field.press('Escape');
    await page.locator('.compat-preview [data-show-compatible]').click();
    await page.locator('[data-compat-modal]').getByRole('link', { name: model }).waitFor();
    await page.locator('[data-close-compatible]').click();
    assert.deepEqual(lookups, [], 'Product compatibility uses only this page’s data');
  } finally { page.off('request', listen); }
}

async function checkPrinterJourney(page, origin) {
  const model = 'Brother DCP-L2512D';
  await page.goto(origin + '/tlaciarne/brother/brother-dcp-l2512d');
  await page.locator('a[href="' + productPath + '22"]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-check-heading]')?.textContent.includes('Vybraná'));
  assert.equal(await page.locator('[data-check-summary]').innerText(), model);
  await page.locator('[data-accessories-section] [data-related-id="91"]').waitFor();
  await page.goto(origin + productPath + '22', { referer: 'https://other.example/tlaciarne/brother/brother-dcp-l2512d' });
  await page.locator('[data-check-toggle]').waitFor();
  assert.equal(await page.locator('[data-check-heading]').textContent(), 'Kompatibilné s');

  // Observe the existing analytics bridge without making any external requests.
  await page.evaluate(() => {
    window.fitTestEvents = [];
    window.tmTrackEcommerce = (event, data) => window.fitTestEvents.push({ event, ...data });
  });
  await page.locator('[data-check-toggle]').click();
  const field = page.getByRole('searchbox', { name: 'Model tlačiarne' });
  await field.fill(model);
  await field.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.fitTestEvents), []);
  await page.evaluate(() => { window.ToneryMaximCookies.get = () => ({ analytics: true }); });
  await field.press('Enter');
  await field.press('Enter');
  await field.fill('Brother HL-L2352DW');
  await field.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.fitTestEvents), ['listed', 'unknown'].map(fit_result => ({
    event: 'printer_fit_check', fit_result, item_id: 'SKU-22',
  })));
  await page.locator('[data-check-catalog]').click();
  await page.waitForURL(url => url.pathname === '/tlaciarne/brother/brother-hl-l2352dw' || url.pathname === '/produkty');
  assert.match(await page.locator('h1').first().innerText(), /HL-L2352DW/i);
  await page.goto(origin + productPath + '41');
}

async function checkDescription(page) {
  const details = page.locator('.pd-info-reading');
  const summary = details.locator('summary');
  const button = page.locator('.pd-info-pop');
  const copy = page.locator('.pd-info-copy');
  const dialog = page.getByRole('dialog', { name: 'Popis produktu' });
  const reads = [];
  const observe = request => {
    if (/^\/api\/(?:product|products|order-create|gopay-create)(?:\?|$)/.test(new URL(request.url()).pathname)) reads.push(request.url());
  };
  page.on('request', observe);
  try {
    assert.equal(await page.locator('.pd-info-facts').getByText('SKU-41', { exact: true }).isVisible(), true);
    assert.equal(await page.locator('.pd-info-codes').count(), 0);
    await fits(page.locator('.pd-info, .pd-info-facts dd, .pd-info-reading summary, .pd-info-pop'));
    await summary.click();
    assert.match(await details.innerText(), /Posledný odsek pôvodného popisu/);
    await button.click();
    assert.equal(await copy.count(), 1);
    assert.equal(await dialog.locator('.pd-info-copy li').innerText(), 'Jedna kazeta');
    await fits(dialog);
    await dialog.getByRole('button', { name: 'Zavrieť popis' }).press('Escape');
    await details.locator('.pd-info-copy').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.activeElement === document.querySelector('.pd-info-pop'));
    await summary.click();
    await button.click();
    await dialog.getByRole('button', { name: 'Zavrieť popis' }).click();
    await details.locator('.pd-info-copy').waitFor({ state: 'attached' });
    assert.equal(await details.evaluate(el => el.open), false);
    assert.deepEqual(reads, []);
  } finally { page.off('request', observe); }
}

async function checkDescriptionWithoutScript(browser, origin) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(origin + productPath + '41');
    assert.equal(await page.locator('.tm-product-loading').isVisible(), false);
    assert.equal(await page.locator('.pd-info-facts').getByText('SKU-41', { exact: true }).isVisible(), true);
    assert.equal(await page.locator('.pd-info-pop').isVisible(), false);
    await page.locator('.pd-info-reading summary').click();
    assert.equal(await page.getByText('Posledný odsek pôvodného popisu.', { exact: true }).isVisible(), true);
  } finally { await context.close(); }
}

async function checkLayout(page, origin, [width, height, touch]) {
  const phone = touch && Math.min(width, height) <= 600;
  for (const [id, count] of [[41, 0], [21, 1], [31, 2], [12, 3]]) {
    await page.goto(origin + productPath + id, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-add-main]').waitFor();
    if (id === 41) {
      await page.locator('#tm-cookie-reject').click();
      await checkPrinterFit(page, origin);
      if (width === 390) await checkPrinterJourney(page, origin);
    }
    await page.locator('[data-accessories-section] [data-related-id="91"]').waitFor();
    if (id === 41) await checkDescription(page);
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
  await drawer.getByText(/Do dopravy zdarma chýba 15,95/).waitFor();
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
  assert.equal(await order.getByRole('heading').innerText(), '#312345');
  assert.equal(await page.locator('[data-account-order="700"]').getByRole('heading').innerText(), 'Objednávka');
  if (width === 390 || width === 1280) {
    await order.getByRole('button', { name: 'Faktúry k objednávke' }).click();
    await page.getByRole('heading', { name: 'Faktúra INV-100' }).waitFor();
    assert.equal(page.url(), origin + '/ucet/faktury');
    assert.equal(await page.getByText('312345', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText('701', { exact: true }).count(), 0);
    await page.goto(origin + '/ucet/objednavky');
  }
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
async function checkDiscountJourney(page, origin, guest) {
  const coupon = { ok: true, code: "TEST7", percent: 7, scope: "compatible", discount: 2.14 };
  let points = 0;
  let lookups = 0;
  let valid = true;
  let unavailable = false;
  let releaseBenefits;
  const firstLookup = new Promise(resolve => { releaseBenefits = resolve; });
  const json = (route, body, status = 200) => route.fulfill({ status, json: body });
  await page.context().route("**/api/account/loyalty", async route => {
    lookups++;
    await firstLookup;
    if (unavailable) return json(route, {}, 503);
    return json(route, { ok: !guest, points, discountValue: points / 100 });
  });
  await page.context().route("**/api/coupon-active", route => { lookups++; return json(route, guest ? { ok: false } : coupon); });
  await page.context().route("**/api/coupon-validate", route => {
    assert.equal(route.request().postDataJSON().code, coupon.code);
    return json(route, valid ? coupon : { ok: false, code: coupon.code, reason: "Kupón už bol použitý." }, valid ? 200 : 400);
  });
  if (guest) await page.context().clearCookies();
  await page.evaluate(() => {
    sessionStorage.removeItem("tm_header_account_v1");
    for (const key of ["tm_cart_v1", "tm_coupon_v1", "tm_loyalty_apply"]) localStorage.removeItem(key);
  });
  const product = origin + productPath + "51";
  const drawer = page.locator("[data-add-cart-summary]");
  const buy = async qty => {
    if (page.url() !== product) await page.goto(product);
    await page.locator("[data-qty]").fill(String(qty));
    await page.locator("[data-add-main]").click();
    await drawer.waitFor();
  };
  const checkDrawer = async (tab = page) => {
    const summary = tab.locator("[data-add-cart-summary]");
    await summary.getByText(/Do dopravy zdarma chýba 0,63/).waitFor();
    for (const [label, price] of [["Tovar pred zľavami", 4068], ["Množstevná / sadová zľava", -1017], ["Kupónová zľava 7 %", -214], ["Spolu za tovar", 2837]]) {
      assert.equal(cents(await summary.locator("div").filter({ has: tab.getByText(label, { exact: true }) }).locator("strong").textContent()), price);
    }
    assert.equal(await summary.locator("p.is-free").count(), 0);
    await fits(summary.locator("div,p"));
  };
  await page.goto(product);
  await page.locator("[data-add-main]").waitFor();
  if (await page.locator("#tm-cookie-reject").isVisible()) await page.locator("#tm-cookie-reject").click();
  assert.equal(lookups, 0, "Browsing a product must not load cart benefits");
  await buy(4);
  await drawer.getByText("Overujeme zľavy…").waitFor();
  assert.equal(await drawer.locator("p.is-free").count(), 0);
  releaseBenefits();
  if (guest) {
    await drawer.getByText("Dopravu máte zdarma", { exact: true }).waitFor();
    assert.match(await drawer.innerText(), /30,51/);
  } else await checkDrawer();

  await page.getByRole("link", { name: "Do košíka", exact: true }).click();
  await page.locator('[data-cart-action="input"]').first().waitFor();
  const compact = await page.locator("[data-cart-mobile-breakdown]").isVisible();
  const total = compact ? "[data-cart-breakdown-total]" : "[data-cart-total]";
  let otherProductTab;
  if (guest) {
    await amount(page, total, 3051);
    otherProductTab = await page.context().newPage();
    await otherProductTab.goto(product);
    await otherProductTab.locator("[data-add-main]").waitFor();
    const form = page.locator("[data-cart-coupon-box]:visible");
    await form.locator("[data-coupon-toggle]").click();
    await form.locator("[data-coupon-input]").fill(coupon.code);
    await form.locator("[data-coupon-apply]").click();
  }
  await amount(page, total, 2837);
  if (compact) {
    await page.locator("[data-cart-mobile-breakdown] summary").click();
    const lines = page.locator("[data-cart-breakdown-discounts]");
    assert.match(await lines.innerText(), /Kupónová zľava 7 %\s*-2,14/);
    assert.match(await lines.innerText(), /sadová zľava\s*-10,17/);
  }
  if (guest) {
    await page.locator('[data-cart-action="minus"]').first().click();
    await amount(page, total, 2554);
    await otherProductTab.locator("[data-add-main]").click();
    await checkDrawer(otherProductTab);
    await otherProductTab.close();
  } else {
    points = 24;
    await page.reload();
    await amount(page, total, 2813);
    await page.locator("[data-loyalty-toggle]:visible").uncheck();
  }
  await amount(page, total, 2837);
  await page.locator(compact ? ".cart-mobile-sticky-checkout" : ".checkout-button").click();
  await page.locator("[data-checkout-form]").waitFor();
  const next = page.locator('[data-checkout-next="delivery"]');
  if (compact) {
    await next.waitFor();
    await page.locator("#email").fill("test@example.invalid");
    await page.locator("#phone").fill("0900123456");
    await next.click();
    await page.locator('[data-checkout-step="delivery"].is-active').waitFor();
  }
  const toggle = page.locator("[data-mobile-summary-toggle]");
  if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await page.locator('label:has(input[name="shipping"][value="dpd_pickup"])').click();
  await page.locator('label:has(input[name="payment"][value="gopay"])').click();
  await amount(page, "[data-summary-coupon]", -214);
  await amount(page, "[data-summary-shipping]", 290);
  await amount(page, "[data-summary-total]", 3127);
  if (guest) {
    valid = false;
    unavailable = true;
    await page.goto(origin + "/kosik");
    const status = page.locator("[data-cart-benefits-status]");
    await status.getByText("Zľavy sa nepodarilo overiť.").waitFor();
    assert.equal(await page.locator("[data-free-shipping-card].is-free").count(), 0);
    unavailable = false;
    await status.getByRole("button", { name: "Skúsiť znova" }).click();
    await amount(page, total, 3051);
    assert.match(await page.locator("[data-coupon-message]:visible").innerText(), /použitý/);
  }
}

async function checkSearchWarmup(page, origin, interruptFirst) {
  const warmUrl = origin + '/api/smart-search?q=__tm_warm__';
  if (interruptFirst) {
    // Hold the first warmup until the browser leaves the document, as on a slow connection.
    let heldRoute;
    await page.route(warmUrl, route => { heldRoute = route; });
    await Promise.all([page.waitForRequest(warmUrl, { timeout: 15000 }), page.goto(origin)]);
    await page.goto('about:blank');
    await page.unroute(warmUrl);
    await heldRoute.abort('aborted');
  }
  const [response] = await Promise.all([
    page.waitForResponse(res => res.url() === warmUrl && res.request().method() === 'GET', { timeout: 15000 }),
    page.goto(origin),
  ]);
  assert.equal(response.status(), 200);
  assert.equal((await response.json()).warmed, true);
  await page.waitForFunction(() => Number(sessionStorage.getItem('tm_smart_search_warmed_at_v1')) > 0);
  const found = await page.evaluate(async () => {
    const response = await fetch('/api/smart-search?q=TN-2421');
    const data = await response.json();
    return response.ok && data.ok && (data.products.length > 0 || data.productGroups.length > 0);
  });
  assert.equal(found, true, 'A real product query works after the search index is ready');
}

async function verifyEngine(origin, engine, configurations, options) {
  const browser = await engine.launch(options);
  try {
    await checkDescriptionWithoutScript(browser, origin);
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
        await checkSearchWarmup(page, origin, width === 390);
        if (width === 390) await verifyMobileLabel(page, origin);
        await checkLayout(page, origin, layout);
        if (width === 390 || width === 1280) await checkDiscountJourney(page, origin, width === 390);
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
