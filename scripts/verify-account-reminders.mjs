// CI browser tests against toner-care-render-smoke's disposable customer only.
import assert from 'node:assert/strict';
import { checkAccountNavigation } from './verify-account-navigation.mjs';
export async function verifySavedTonerCare(origin) {
  const { chromium, firefox, webkit } = await import(process.env.TM_PLAYWRIGHT_MODULE || 'playwright');
  for (const engine of [chromium, firefox, webkit]) {
    const browser = await engine.launch({ ...(engine.name() === 'chromium' && process.env.TM_CHROMIUM_PATH ? { executablePath: process.env.TM_CHROMIUM_PATH } : {}) });
    try {
      for (const width of [320, 390, 768, 1280]) {
        const mobile = width <= 1100;
        const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: mobile,
          ...(engine.name() === 'firefox' ? {} : { isMobile: mobile }), reducedMotion: 'reduce' });
        await context.route(url => url.origin !== origin, route => route.abort());
        const page = await context.newPage(); page.setDefaultTimeout(8000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        try {
          await checkAccountNavigation(page, origin, [width, 844, mobile], '/__guard_fixture_session');
          if (mobile) {
            await page.locator('[data-account-more] > summary').click();
            await page.locator('[data-account-more]').getByRole('link', { name: 'Upozornenia na toner', exact: true }).click();
          } else await page.locator('.account-nav a[href="/ucet/upozornenia"]').click();
          await page.waitForURL(origin + '/ucet/upozornenia');
          const card = page.locator('[data-printer-title="Brother DCP-L3517CDW"]');
          const fields = card.locator('[data-toner-care-form]');
          assert.equal(await page.locator('[data-printer-title="HP LaserJet M110w"] [name="expected_months"]').inputValue(), '5', 'Keep every existing 1–24 month duration selectable');
          assert.ok(await fields.isVisible());
          await fields.locator('[name="expected_months"]').selectOption('6');
          await fields.locator('[name="preferred_type"]').selectOption('original');
          await fields.getByRole('button', { name: 'Uložiť plán', exact: true }).click();
          await fields.locator('[data-toner-care-message]').filter({ hasText: 'Plán výmeny bol uložený.' }).waitFor();
          await page.reload();
          assert.equal(await fields.locator('[name="expected_months"]').inputValue(), '6');
          assert.equal(await fields.locator('[name="preferred_type"]').inputValue(), 'original');
          await card.getByRole('button', { name: 'Vypnúť strážcu', exact: true }).click();
          await card.locator('[data-toner-care-action-message]').filter({ hasText: 'Tlačiareň a história zostali uložené.' }).waitFor();
          await page.reload();
          assert.equal(await fields.locator('[name="care_enabled"]').isChecked(), false);
          assert.ok(await card.locator('[data-toner-care-history]').getByText('Vypnutý ručne', { exact: false }).count());
          await fields.getByRole('button', { name: 'Toner som vymenil dnes', exact: true }).click();
          await fields.locator('[data-toner-care-message]').filter({ hasText: 'Plán výmeny bol uložený.' }).waitFor();
          await page.reload();
          assert.equal(await fields.locator('[name="care_enabled"]').isChecked(), true);
          assert.equal(await page.locator('[data-saved-printer-card]').count(), 2);
          const geometry = await fields.locator('input:not([type="hidden"]):not([type="checkbox"]), select, button').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, width: innerWidth }; }));
          for (const r of geometry) assert.ok(r.left >= -1 && r.right <= r.width + 1 && r.height >= 44);
          const state = await (await context.request.get(origin + '/__guard_fixture_customer')).json();
          assert.equal(state.customer.meta_data.find(item => item.key === 'tm_customer_preference_fixture').value, 'zachovať');
          assert.equal(state.customer.shipping.address_1, 'Testovacia 34');
          assert.deepEqual(errors, []);
          console.log(`${engine.name()} ${width}px: saved reminder edit/reload/disable/history/replacement, all account routes and customer data preserved`);
        } finally { await context.close(); }
      }
      // Progressive enhancement: the complete menu/editor and native save/off work without JS.
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
      await context.route(url => url.origin !== origin, route => route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      try {
        await page.goto(origin + '/__guard_fixture_session');
        await page.locator('[data-account-more] > summary').click();
        await page.locator('[data-account-more]').getByRole('link', { name: 'Upozornenia na toner', exact: true }).click();
        await page.waitForURL(origin + '/ucet/upozornenia');
        const card = page.locator('[data-printer-title="Brother DCP-L3517CDW"]');
        await card.locator('[name="expected_months"]').selectOption('3');
        await Promise.all([page.waitForEvent('domcontentloaded'), card.getByRole('button', { name: 'Uložiť plán', exact: true }).click()]);
        await page.waitForURL(origin + '/ucet/upozornenia?saved=1');
        await Promise.all([page.waitForEvent('domcontentloaded'), card.getByRole('button', { name: 'Vypnúť strážcu', exact: true }).click()]);
        await page.locator('[role="status"]').getByText('Nastavenie bolo uložené.', { exact: true }).waitFor();
        assert.equal(await card.locator('[name="care_enabled"]').isChecked(), false);
        await Promise.all([page.waitForEvent('domcontentloaded'), card.getByRole('button', { name: 'Toner som vymenil dnes', exact: true }).click()]);
        await page.waitForURL(origin + '/ucet/upozornenia?saved=1');
        assert.equal(await card.locator('[name="care_enabled"]').isChecked(), true);
        console.log(`${engine.name()} without JS: native full menu, save, disable and replacement OK`);
      } finally { await context.close(); }
    } finally { await browser.close(); }
  }
}
