// Both engines feed a moving video track into the real local OCR and catalogue.
// Chromium also reads a labelled virtual camera using its native getUserMedia.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

export async function chromiumLabelCamera() {
  const directory = await mkdtemp(join(tmpdir(), 'tm-label-camera-'));
  try {
    const width = 960, height = 540;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="white"/><text x="480" y="286" text-anchor="middle" font-family="sans-serif" font-size="44">HP LaserJet P1102</text></svg>';
    const y = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer();
    const uv = Buffer.alloc(width * height / 2, 128);
    const frame = Buffer.concat([Buffer.from('FRAME\n'), y, uv]);
    const path = join(directory, 'printer.y4m');
    await writeFile(path, Buffer.concat([Buffer.from('YUV4MPEG2 W960 H540 F8:1 Ip A1:1 C420\n'), frame, frame, frame, frame]));
    return { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + path],
      close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

function installVideoFixture() {
  if (location.pathname !== '/hladat-fotkou' || window.labelCameraTest) return;
  const fixture = window.labelCameraTest = { mode: 'feed', calls: [], tracks: [],
    get text() { return sessionStorage.getItem('testCameraLabel') || 'Brother TN-2421'; },
    set text(value) { sessionStorage.setItem('testCameraLabel', value); },
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const remaining = Number(sessionStorage.getItem('testStalledPreviews'));
    if (remaining > 0 && this.matches('#live-camera video')) {
      sessionStorage.setItem('testStalledPreviews', String(remaining - 1));
      return new Promise(() => {});
    }
    return play.apply(this, args);
  };
  let source;
  function makeCameraSource() {
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 540;
    // Keep this video source rendered throughout each WebKit capture session.
    canvas.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;pointer-events:none';
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    function draw() {
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 960, 540);
      ctx.fillStyle = 'black'; ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(fixture.text, 480, 286);
    }
    draw();
    const stream = canvas.captureStream(8), track = stream.getVideoTracks()[0];
    const timer = setInterval(() => { draw(); track.requestFrame?.(); }, 120);
    window.addEventListener('pagehide', () => { clearInterval(timer); track.stop(); canvas.remove(); }, { once: true });
    return stream;
  }
  // The virtual device stays available while individual camera sessions are released.
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { async getUserMedia(constraints) {
    fixture.calls.push(constraints);
    if (fixture.mode === 'deny') throw new DOMException('test', 'NotAllowedError');
    if (fixture.mode === 'defer') await new Promise(resolve => { fixture.allow = resolve; });
    source ||= makeCameraSource();
    const session = source.clone();
    fixture.tracks.push(...session.getVideoTracks());
    return session;
  } } });
}

export async function verifyLiveCamera(page, origin, nativeCamera) {
  if (nativeCamera) {
    await page.goto(origin + '/hladat-fotkou');
    await page.getByRole('button', { name: 'Spustiť fotoaparát' }).click();
    await page.waitForURL('**/tlaciarne/hp/*p1102', { timeout: 60_000 });
    assert.match(await page.locator('h1').innerText(), /P1102/i);
    console.log('Native camera → HP LaserJet P1102 printer offers OK (no shutter or confirmation)');
  }
  await page.addInitScript(installVideoFixture);
  const searches = [], uploads = [], workers = [];
  const request = r => {
    const url = new URL(r.url());
    if (url.pathname === '/api/smart-search' && url.searchParams.get('label') === '1') searches.push(url.searchParams.get('q'));
    if (r.method() !== 'GET') uploads.push([r.method(), url.pathname]);
  };
  const worker = w => { if (w.url().endsWith('/worker.min.js')) workers.push(w.url()); };
  page.context().on('request', request); page.on('worker', worker);
  try {
    const response = await page.goto(origin + '/hladat-fotkou');
    assert.match(response.headers()['permissions-policy'], /camera=\(self\), microphone=\(\)/);
    const start = page.getByRole('button', { name: 'Spustiť fotoaparát' });
    const stop = page.getByRole('button', { name: 'Zastaviť skenovanie' });
    const status = page.locator('#label-status');
    await start.waitFor();
    assert.equal(await page.evaluate(() => window.labelCameraTest.calls.length), 0);
    assert.equal(workers.length, 0);
    await page.evaluate(() => { window.labelCameraTest.mode = 'deny'; });
    await start.click();
    await status.filter({ hasText: 'Prístup ku kamere je vypnutý' }).waitFor();
    assert.ok(await page.locator('[data-gallery]').isVisible());
    assert.equal(await page.evaluate(() => window.labelCameraTest.calls.length), 1, 'permission request reached the simulated camera');
    await page.evaluate(() => { window.labelCameraTest.mode = 'defer'; });
    await start.tap();
    await page.waitForFunction(() => typeof window.labelCameraTest.allow === 'function');
    await stop.tap(); // The OS permission sheet can resolve after this.
    await page.evaluate(() => window.labelCameraTest.allow());
    await page.waitForFunction(() => window.labelCameraTest.tracks[0]?.readyState === 'ended');
    assert.equal(await page.locator('video').evaluate(el => el.srcObject), null);
    assert.equal(workers.length, 0);

    // One tap on the pilot home link starts the scanner and brings up toner prices.
    await page.goto(origin + '/?foto=1');
    await page.getByRole('link', { name: 'Skenovať štítok' }).click();
    await page.locator('[data-matches] a').first().waitFor({ timeout: 60_000 });
    assert.equal(await page.locator('[data-matches] a').count(), 3);
    assert.match(await status.innerText(), /Brother TN-2421/);
    assert.ok((await page.locator('[data-matches] a').allTextContents()).every(t => t.includes('s DPH')));
    assert.deepEqual(searches, ['Brother TN-2421']);
    assert.equal(await page.evaluate(() => window.labelCameraTest.tracks[0].readyState), 'ended');
    const constraints = await page.evaluate(() => window.labelCameraTest.calls[0]);
    assert.equal(constraints.audio, false);
    assert.equal(constraints.video.facingMode.ideal, 'environment');

    // Keep scanning through a serial and an unstocked reference, then turn the
    // camera towards a printer. The session should use just one OCR worker.
    await page.evaluate(() => { window.labelCameraTest.text = 'S/N: CE285A'; });
    await start.click();
    await status.filter({ hasText: 'Priblížte sa' }).waitFor({ timeout: 60_000 });
    assert.deepEqual(searches, ['Brother TN-2421']);
    await page.evaluate(() => { window.labelCameraTest.text = 'Brother TN-9999'; });
    await status.filter({ hasText: 'nemáme presnú ponuku' }).waitFor({ timeout: 20_000 });
    await page.evaluate(() => { window.labelCameraTest.text = 'HP LaserJet P1102'; });
    await page.waitForURL('**/tlaciarne/hp/*p1102', { timeout: 30_000 });
    assert.deepEqual(searches, ['Brother TN-2421', 'Brother TN-9999', 'HP P1102']);
    assert.equal(workers.length, 2, 'one OCR worker per camera session');
    assert.deepEqual(uploads, []);

    await page.goto(origin + '/hladat-fotkou');
    await page.evaluate(() => sessionStorage.setItem('testStalledPreviews', '2'));
    await start.click();
    await status.filter({ hasText: 'Z fotoaparátu neprichádza obraz' }).waitFor({ timeout: 25_000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('testStalledPreviews')), '0');
    assert.equal(await page.evaluate(() => window.labelCameraTest.tracks[0].readyState), 'ended');
    assert.equal(await start.isVisible(), true);
    assert.equal(workers.length, 2, 'a stalled preview never loads OCR');
    console.log('Live label video OK: single-tap start, toner prices, exact printer, private code, empty match, denial, cancel, bounded retry and device release');
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      status: document.querySelector('#label-status')?.textContent,
      mode: window.labelCameraTest?.mode, calls: window.labelCameraTest?.calls.length, tracks: window.labelCameraTest?.tracks.map(t => t.readyState),
      video: document.querySelector('video')?.readyState, viewport: document.querySelector('video')?.getBoundingClientRect().toJSON(),
    })).catch(() => ({}));
    throw new Error('Camera test ' + JSON.stringify({ diagnostic, searches, workers: workers.length }) + ': ' + error.message, { cause: error });
  } finally { page.context().off('request', request); page.off('worker', worker); }
}
