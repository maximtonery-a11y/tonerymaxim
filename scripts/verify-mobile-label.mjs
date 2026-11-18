// The two release browsers run the real same-origin OCR worker against the local shop.
import assert from 'node:assert/strict';
import sharp from 'sharp';

async function labelFile(text) {
  const svg = `<svg width="1050" height="250" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="55" y="150" font-family="sans-serif" font-size="65" fill="black">${text}</text></svg>`;
  return { name: 'sticker.png', mimeType: 'image/png', buffer: await sharp(Buffer.from(svg)).png().toBuffer() };
}

export async function verifyMobileLabel(page, origin) {
  const requests = [];
  const record = request => requests.push({ method: request.method(), url: new URL(request.url()) });
  page.context().on('request', record);
  const lookup = () => requests.filter(({ url }) => url.pathname === '/api/smart-search').map(({ url }) => url.searchParams.get('q')).filter(q => q !== '__tm_warm__');
  try {
    await page.goto(origin + '/');
    assert.equal(await page.locator('a[href="/hladat-fotkou"]').count(), 0);
    await page.goto(origin + '/?foto=1');
    await page.getByRole('link', { name: 'Odfotiť štítok' }).click();
    const gallery = page.locator('[data-gallery]');
    await gallery.waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-camera]').getAttribute('capture'), 'environment');
    assert.equal(await gallery.getAttribute('capture'), null);
    assert.ok(!requests.some(({ url }) => url.pathname.includes('/citanie-stitku/')), 'OCR was loaded before photo selection');

    await gallery.setInputFiles(await labelFile('Brother TN-2421'));
    await page.locator('[data-matches] a').first().waitFor({ timeout: 60_000 });
    const offers = await page.locator('[data-matches] a').allTextContents();
    assert.equal(offers.length, 3, JSON.stringify(offers));
    assert.ok(offers.every(text => text.includes('TN-2421') && text.includes('s DPH')));
    assert.ok(offers.some(text => text.includes('13,05')));
    assert.deepEqual(lookup(), ['Brother TN-2421']);
    assert.ok(!requests.some(({ method }) => method !== 'GET'), 'the photo journey must be read-only');

    await gallery.setInputFiles(await labelFile('S/N: CE285A'));
    await page.waitForFunction(() => document.querySelector('#label-status')?.textContent.includes('nepodarilo prečítať'));
    assert.deepEqual(lookup(), ['Brother TN-2421'], 'serial must not become a lookup');
    await page.getByRole('button', { name: 'Vybrať riadok z fotky' }).click();
    await page.locator('[data-crop-image]').waitFor({ state: 'visible' });
    await page.locator('.crop-image').click();
    await page.waitForFunction(() => document.querySelector('#label-status')?.textContent.includes('nepodarilo prečítať'));
    assert.deepEqual(lookup(), ['Brother TN-2421']);

    await page.locator('#label-code').fill('Brother TN-24219');
    await page.locator('form.manual button').click();
    await page.waitForFunction(() => document.querySelector('#label-status')?.textContent.includes('Presnú zhodu'));
    assert.equal(await page.locator('[data-matches] a').count(), 0);

    await gallery.setInputFiles(await labelFile('HP LaserJet P1102'));
    await page.waitForURL('**/tlaciarne/hp/*p1102', { timeout: 60_000 });
    assert.match(await page.locator('h1').innerText(), /P1102/i);
    console.log('mobile label search OK: real local OCR, offers, exact model, crop, private label, lazy loading');
  } finally {
    page.context().off('request', record);
  }
}
