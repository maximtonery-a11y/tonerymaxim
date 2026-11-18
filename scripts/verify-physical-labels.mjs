import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

// The three masks contain only the printed model letters. The barcode is synthetic.
async function physicalLabel(name) {
  const width = 960,
    height = 540;
  const palette = {
    printer: ['#554b43', '#b5a99c', 590],
    drum: ['#171618', '#eee6df', 420],
    toner: ['#f1cd2e', '#544228', 570],
  };
  if (name === 'barcode') {
    let bars = '',
      left = 285;
    for (let n = 0; n < 59; n++) {
      const bar = 1 + ((n * 7) % 5);
      bars += `<rect x="${left}" y="205" width="${bar}" height="80"/>`;
      left += bar + 2 + (n % 3);
    }
    const mock = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#3b3937"/><rect x="250" y="145" width="470" height="204" rx="9" fill="#eee5d1"/><g fill="#181818">${bars}<text x="284" y="185" font-family="sans-serif" font-size="24">Brother</text><text x="285" y="324" font-family="sans-serif" font-size="23">ABFX47P15879234KT</text></g></svg>`;
    return sharp(Buffer.from(mock)).png().toBuffer();
  }
  const [background, ink, labelWidth] = palette[name];
  const toRgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const bg = toRgb(background),
    fg = toRgb(ink);
  const mask = await readFile(new URL('./fixtures/label-lettering/' + name + '.png', import.meta.url));
  const { data, info } = await sharp(mask)
    .greyscale()
    .resize({ width: labelWidth })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgb = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < data.length; i++) {
    for (let channel = 0; channel < 3; channel++)
      rgb[3 * i + channel] = Math.round(fg[channel] + ((bg[channel] - fg[channel]) * data[i]) / 255);
  }
  const lettering = await sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background } })
    .composite([{ input: lettering, gravity: 'center' }])
    .png()
    .toBuffer();
}

export async function verifyPhysicalLabels(page, origin, camera) {
  for (const name of ['printer', 'drum', 'toner', 'barcode']) {
    const image = await physicalLabel(name);
    await page.goto(origin + '/hladat-fotkou');
    const outbound = [];
    const record = req => {
      const url = new URL(req.url());
      if (url.searchParams.get('label') === '1') outbound.push(url.searchParams.get('q'));
    };
    page.on('request', record);
    try {
      if (camera) {
        await page.evaluate(
          async url => {
            const image = new Image();
            image.src = url;
            await image.decode();
            window.labelCameraTest.image = image;
          },
          'data:image/png;base64,' + image.toString('base64')
        );
        await page.getByRole('button', { name: 'Spustiť fotoaparát' }).click();
      } else {
        await page
          .locator('[data-gallery]')
          .setInputFiles({ name: 'label.png', mimeType: 'image/png', buffer: image });
      }
      if (name === 'printer') {
        await page.waitForURL('**/tlaciarne/brother/brother-dcp-9020cdw', { timeout: 45_000 });
        assert.deepEqual(outbound, ['Brother DCP-9020CDW']);
      } else if (name === 'barcode') {
        await page.locator('#label-status').filter({ hasText: 'Vidím čiarový kód' }).waitFor({ timeout: 30_000 });
        assert.deepEqual(outbound, []);
        if (camera) await page.getByRole('button', { name: 'Zastaviť skenovanie' }).click();
      } else {
        const offers = page.locator('[data-matches] a');
        await offers.first().waitFor({ timeout: 45_000 });
        const titles = await offers.allTextContents();
        assert.equal(titles.length, name === 'drum' ? 3 : 2, JSON.stringify(titles));
        assert.ok(titles.every(t => (name === 'drum' ? /DR-241CL CMY .*valec/ : /TN-245Y žltý .*toner/).test(t)));
        if (name === 'toner') assert.match(await page.locator('#label-status').innerText(), /Brother TN-245Y/);
        assert.equal(outbound.length, 1, JSON.stringify(outbound));
      }
    } catch (error) {
      const status = await page
        .locator('#label-status')
        .textContent({ timeout: 500 })
        .catch(() => '');
      throw new Error(
        `${camera ? 'Camera' : 'Gallery'} / ${name}: ${JSON.stringify({ status, outbound })}. ${error.message}`,
        { cause: error }
      );
    } finally {
      page.off('request', record);
    }
  }
  console.log(
    `Physical label lettering: printer, CMY-only drums, yellow-only toner, barcode guidance all passed (${camera ? 'live frames' : 'gallery'}).`
  );
}
