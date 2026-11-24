import assert from 'node:assert/strict';
const routes = ['/ucet', '/ucet/objednavky', '/ucet/faktury', '/ucet/tlaciarne', '/ucet/upozornenia', '/ucet/produkty', '/ucet/reklamacie', '/ucet/vernost', '/ucet/odmeny', '/ucet/adresy', '/ucet/newsletter', '/ucet/profil'].sort();
export async function checkAccountNavigation(page, origin, [width, height, touch], sessionPath = '/__account_fixture_session') {
  await page.goto(origin + sessionPath);
  const rejectCookies = page.locator('#tm-cookie-reject');
  if (await rejectCookies.isVisible()) await rejectCookies.click();
  const nav = page.locator('[data-account-mobile-nav]');
  assert.equal(await nav.isVisible(), touch);
  const links = selector => page.locator(selector).evaluateAll(nodes => nodes.map(node => node.getAttribute('href')).sort());
  assert.deepEqual(await links('.account-nav a'), routes);
  assert.deepEqual(await links('[data-account-mobile-nav] a[data-account-nav-link]'), routes);
  assert.equal(await page.locator('[data-account-mobile-nav] [data-account-logout-form]').count(), 1);
  if (!touch) return;
  const position = await nav.boundingBox();
  assert.ok(Math.abs(position.y + position.height - height) <= 1);
  assert.equal(Math.round(position.height), 74);
  for (const inset of [24, 36, 0]) {
    await page.setViewportSize({ width, height: height + inset });
    await page.evaluate(inset => { document.documentElement.style.setProperty('--account-safe-max', '36px'); document.documentElement.style.setProperty('--account-safe-current', inset + 'px'); }, inset);
    const box = await nav.boundingBox();
    assert.equal(Math.round(box.height), 74);
    assert.equal(Math.round(box.y), Math.round(position.y), 'Changing browser safe inset cannot resize or shift controls');
  }
  await page.evaluate(() => { document.documentElement.style.removeProperty('--account-safe-max'); document.documentElement.style.removeProperty('--account-safe-current'); window.scrollTo(0, document.documentElement.scrollHeight); });
  const scroll = await page.evaluate(() => scrollY);
  assert.equal(Math.round((await nav.boundingBox()).y), Math.round(position.y));
  const menu = page.locator('[data-account-more]');
  await menu.locator('summary').click();
  assert.ok(await page.getByRole('link', { name: 'Upozornenia na toner', exact: true }).last().isVisible());
  const menuLinks = await menu.locator('a').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { height: r.height, left: r.left, right: r.right, viewport: innerWidth }; }));
  for (const box of menuLinks) assert.ok(box.height >= 48 && box.left >= 0 && box.right <= box.viewport);
  await page.keyboard.press('Escape');
  assert.equal(await menu.getAttribute('open'), null);
  assert.equal(await page.evaluate(() => scrollY), scroll);
  await menu.locator('summary').click();
  await page.getByRole('button', { name: 'Zavrieť menu účtu' }).click();
  assert.equal(await menu.getAttribute('open'), null);
  assert.equal(await page.evaluate(() => scrollY), scroll);
  const feedback = [];
  await page.exposeFunction('__accountFeedback', value => feedback.push(value));
  await page.evaluate(() => {
    const nav = document.querySelector('[data-account-mobile-nav]');
    nav.addEventListener('click', event => {
      const link = event.target.closest('a[data-account-nav-link]');
      if (link?.getAttribute('href') !== '/ucet/tlaciarne') return;
      void window.__accountFeedback({ pending: link.hasAttribute('data-navigation-pending'), disabled: link.getAttribute('aria-disabled'), prevented: event.defaultPrevented, ms: performance.now() - event.timeStamp,
        highlighted: [...nav.children].filter(child => !['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(child).backgroundColor)).map(child => child.textContent.trim()) }).catch(() => {});
    });
  });
  await nav.getByRole('link', { name: 'Tlačiarne', exact: true }).click();
  await page.waitForURL(origin + '/ucet/tlaciarne');
  await page.getByRole('heading', { level: 1, name: 'Moje tlačiarne', exact: true }).waitFor();
  assert.equal(feedback.length, 1); assert.equal(feedback[0].pending, true); assert.equal(feedback[0].disabled, null);
  assert.equal(feedback[0].prevented, false); assert.ok(feedback[0].ms < 100); assert.deepEqual(feedback[0].highlighted, ['Tlačiarne']);
  await nav.getByRole('link', { name: 'Reklamácie', exact: true }).click();
  await page.waitForURL(origin + '/ucet/reklamacie');
  assert.deepEqual(await nav.locator('[aria-current="page"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), ['/ucet/reklamacie']);
  await page.goBack();
  await page.getByRole('heading', { level: 1, name: 'Moje tlačiarne', exact: true }).waitFor();
  assert.equal(await page.locator('[data-navigation-pending]').count(), 0);
  console.log(`Account ${width}×${height}: all 12 routes, fixed controls, native menu, <100 ms feedback, exact Claims selection and Back OK`);
}
