// The two release browsers run the real same-origin OCR worker against the local shop.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { verifyPhysicalLabels } from './verify-physical-labels.mjs';

async function labelFile(text) {
  const svg = `<svg width="1050" height="250" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="55" y="150" font-family="sans-serif" font-size="65" fill="black">${text}</text></svg>`;
  return { name: 'sticker.png', mimeType: 'image/png', buffer: await sharp(Buffer.from(svg)).png().toBuffer() };
}

async function angledPrinterFile() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="480">
    <rect width="1200" height="480" fill="white"/>
    <g font-family="sans-serif" font-size="46">
      <text x="24" y="62">Brother TN-2421</text><text x="24" y="446">Canon PG-545</text>
      <g transform="translate(320 290) rotate(-15)">
        <rect x="-18" y="-56" width="544" height="82" fill="#2b3034"/>
        <text x="0" y="0" fill="white" textLength="500" lengthAdjust="spacingAndGlyphs">HP LaserJet P1102</text>
      </g>
    </g></svg>`;
  return { name: 'control-panel.png', mimeType: 'image/png', buffer: await sharp(Buffer.from(svg)).png().toBuffer() };
}

async function tapPhoto(page, x, y) {
  const photo = page.locator('[data-crop-image]');
  await photo.waitFor({ state: 'visible' });
  const bounds = await photo.boundingBox();
  await photo.click({ position: { x: bounds.width * x, y: bounds.height * y } });
}

export async function verifyMobileLabel(page, origin) {
  const requests = [];
  const record = request => requests.push({ method: request.method(), url: new URL(request.url()) });
  page.context().on('request', record);
  const lookup = () => requests.filter(({ url }) => url.pathname === '/api/smart-search').map(({ url }) => url.searchParams.get('q')).filter(q => q !== '__tm_warm__');
  try {
    await page.goto(origin + '/');
    assert.ok(await page.getByRole('link', { name: 'Skenovať štítok' }).isVisible());
    await page.goto(origin + '/hladat-fotkou');
    const gallery = page.locator('[data-gallery]');
    await gallery.waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: 'Spustiť fotoaparát' }).count(), 1);
    assert.equal(await gallery.getAttribute('capture'), null);
    assert.ok(!requests.some(({ url }) => url.pathname.includes('/citanie-stitku/')), 'OCR was loaded before photo selection');
    assert.ok(!requests.some(({ url }) => /\/(?:label-live-analysis|label-photo|label-search|label-reader)\.[\w-]+\.js$/.test(url.pathname)),
      'optical processing and catalogue matching load only when the scanner is used');

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
    await tapPhoto(page, .23, .49);
    await page.locator('[data-read-around]').click();
    await page.waitForFunction(() => document.querySelector('#label-status')?.textContent.includes('nepodarilo prečítať'));
    assert.deepEqual(lookup(), ['Brother TN-2421']);

    await page.getByRole('button', { name: 'Vybrať riadok z fotky' }).click();
    await tapPhoto(page, .208, .518);
    await tapPhoto(page, .448, .518);
    await page.waitForFunction(() => document.querySelector('#label-status')?.textContent.includes('nepodarilo prečítať'));
    assert.deepEqual(lookup(), ['Brother TN-2421'], 'even a tight strip cannot resurrect a serial');

    await page.locator('#label-code').fill('Brother TN-24219');
    await page.locator('form.manual button').click();
    await page.waitForFunction(() => document.querySelector('#label-status')?.textContent.includes('Presnú zhodu'));
    assert.equal(await page.locator('[data-matches] a').count(), 0);

    // A small bright name on a sloping dark control panel can be selected without a new photo.
    await gallery.setInputFiles(await angledPrinterFile());
    await page.getByRole('button', { name: 'Vybrať riadok z fotky' }).click();
    const zoom = page.getByRole('button', { name: 'Zväčšiť fotku' });
    await zoom.click();
    assert.equal(await page.getByRole('button', { name: 'Zmenšiť fotku' }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Zmenšiť fotku' }).click();
    await tapPhoto(page, .27, .56);
    await page.getByRole('button', { name: 'Označiť znova' }).click();
    await tapPhoto(page, .265, .565);
    const beforeConfirm = lookup().length;
    await tapPhoto(page, .665, .298);
    const confirm = page.getByRole('button', { name: 'HP P1102', exact: true });
    await confirm.waitFor({ state: 'visible', timeout: 60_000 });
    assert.equal(lookup().length, beforeConfirm, 'a chosen row must stay local until confirmed');
    await confirm.click();
    await page.waitForURL('**/tlaciarne/hp/*p1102', { timeout: 60_000 });
    await page.goto(origin + '/hladat-fotkou');
    await gallery.setInputFiles(await labelFile('HP LaserJet P1102'));
    await page.waitForURL('**/tlaciarne/hp/*p1102', { timeout: 60_000 });
    assert.match(await page.locator('h1').innerText(), /P1102/i);
    await verifyPhysicalLabels(page, origin, false);
    await page.goto(origin + '/hladat-fotkou');
    await page.locator('#label-code').fill('cierny toner do kancelarie');
    await page.locator('form.manual button').click();
    await page.waitForURL(url => url.pathname === '/produkty' && url.searchParams.get('s') === 'cierny toner do kancelarie');
    console.log('mobile label search OK: real local OCR, offers, exact model, crop, private label, lazy loading');
  } finally {
    page.context().off('request', record);
  }
}
