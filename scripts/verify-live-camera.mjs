// Both engines feed a moving video track into the real local OCR and catalogue.
// Chromium also reads a labelled virtual camera using its native getUserMedia.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { verifyPhysicalLabels } from './verify-physical-labels.mjs';

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
  const resuming = history.state?.tmResumeCamera > Date.now();
  if (!resuming) sessionStorage.removeItem('testCameraScene');
  let mode = (resuming && sessionStorage.getItem('testCameraScene')) || 'feed';
  const fixture = window.labelCameraTest = { calls: [], tracks: [], captures: [],
    get mode() { return mode; },
    set mode(value) {
      mode = value;
      if (['feed', 'blank', 'lcd', 'two-rows'].includes(value)) sessionStorage.setItem('testCameraScene', value);
    },
    get text() { return sessionStorage.getItem('testCameraLabel') || 'Brother TN-2421'; },
    set text(value) { sessionStorage.setItem('testCameraLabel', value); },
  };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      if (new URL(url, location.href).pathname.endsWith('/label-worker.mjs')) {
        this.addEventListener('message', ({ data }) => {
          if (data.rows?.length) sessionStorage.setItem('testReadScene', 'yes');
          if (data.failed) sessionStorage.setItem('testSceneFailure', data.stage + '/' + data.reason);
        });
        this.addEventListener('error', error => sessionStorage.setItem('testSceneFailure', error.message || 'worker error'));
      }
    }
    postMessage(job, ...args) {
      if (fixture.holdOCR && job?.action === 'load') {
        fixture.releaseOCR = () => { fixture.holdOCR = false; super.postMessage(job, ...args); };
        return;
      }
      super.postMessage(job, ...args);
    }
  };
  const fetchResponse = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const response = await fetchResponse(input, options);
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (fixture.holdCatalog && url.pathname === '/api/smart-search' && url.searchParams.get('label') === '1') {
      await new Promise(resolve => {
        fixture.releaseCatalog = () => { fixture.holdCatalog = false; resolve(); };
      });
    }
    return response;
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
  async function makeCameraSource() {
    // A real camera still points at the same label after WebKit restarts its preview.
    const imageUrl = sessionStorage.getItem('testCameraImage');
    let image;
    if (imageUrl) {
      image = new Image();
      image.src = imageUrl;
      await image.decode();
    }
    const canvas = document.createElement('canvas');
    canvas.width = image?.naturalWidth || 960; canvas.height = image?.naturalHeight || 540;
    // Keep this video source rendered throughout each WebKit capture session.
    canvas.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;pointer-events:none';
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    function draw() {
      if (image) { ctx.drawImage(image, 0, 0); return; }
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 960, 540);
      if (fixture.mode === 'blank') return;
      ctx.fillStyle = 'black'; ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center';
      if (fixture.mode === 'lcd') {
        ctx.fillStyle = '#42454a'; ctx.fillRect(0, 0, 960, 540);
        ctx.fillStyle = '#bfc1c4'; ctx.font = '34px sans-serif'; ctx.fillText(fixture.text, 480, 245);
        ctx.fillStyle = '#a7a999'; ctx.fillRect(265, 265, 430, 110);
        ctx.fillStyle = '#4a4b44'; ctx.fillText('Hromad Kopírt', 480, 325);
      } else if (fixture.mode === 'two-rows') {
        ctx.fillText('HP LaserJet P1102', 480, 150);
        ctx.fillText('Brother TN-2421', 480, 382);
      } else ctx.fillText(fixture.text, 480, 286);
    }
    draw();
    const stream = canvas.captureStream(8), track = stream.getVideoTracks()[0];
    const timer = setInterval(() => { draw(); track.requestFrame?.(); }, 120);
    window.addEventListener('pagehide', () => { clearInterval(timer); track.stop(); canvas.remove(); }, { once: true });
    return { stream, refresh: () => { draw(); track.requestFrame?.(); } };
  }
  // The virtual device stays available while individual camera sessions are released.
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { async getUserMedia(constraints) {
    fixture.calls.push(constraints);
    if (fixture.mode === 'deny') throw new DOMException('test', 'NotAllowedError');
    if (fixture.mode === 'defer') await new Promise(resolve => { fixture.allow = resolve; });
    source ||= makeCameraSource();
    const camera = await source;
    camera.refresh();
    const session = camera.stream.clone();
    camera.refresh();
    const [track] = session.getVideoTracks();
    Object.defineProperty(track,'getCapabilities',{value:()=>({focusMode:['continuous']})});
    Object.defineProperty(track,'applyConstraints',{value:async options => { fixture.focus = options.advanced[0].focusMode; }});
    const capture = { started: performance.now() };
    fixture.captures.push(capture);
    const stopTrack = track.stop.bind(track);
    track.stop = () => { capture.ended ??= performance.now(); stopTrack(); };
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
  const worker = w => { if (/\/(?:worker\.min\.js|label-worker\.mjs)$/.test(w.url())) workers.push(w.url()); };
  page.context().on('request', request); page.on('worker', worker);
  try {
    const response = await page.goto(origin + '/hladat-fotkou');
    assert.match(response.headers()['permissions-policy'], /camera=\(self\), microphone=\(\)/);
    const engine = await page.request.get(origin + '/citanie-stitku/v8/label-worker.mjs');
    assert.ok(engine.ok());
    const policy = engine.headers()['content-security-policy'] || '';
    assert.match(policy, /(?:^|;\s*)connect-src 'self'(?:;|$)/);
    assert.equal(engine.headers()['cross-origin-resource-policy'], 'same-origin');
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
    const dimensions = await page.locator('#live-camera').evaluate(dialog => {
      const preview = dialog.querySelector('.viewfinder').getBoundingClientRect();
      return { modal:dialog.matches(':modal'), width:dialog.getBoundingClientRect().width/innerWidth,
        height:dialog.getBoundingClientRect().height/innerHeight, video:preview.height/innerHeight };
    });
    assert.ok(dimensions.modal && dimensions.width >= .98 && dimensions.height >= .98 && dimensions.video > .75, JSON.stringify(dimensions));
    const zoom=page.getByRole('button',{name:'Priblížiť obraz 2×'});
    await zoom.tap();
    assert.equal(await zoom.getAttribute('aria-pressed'),'true');
    await zoom.tap();
    await page.keyboard.press('Escape'); // The OS permission sheet can resolve after this.
    await stop.waitFor({state:'hidden'});
    await page.evaluate(() => window.labelCameraTest.allow());
    await page.waitForFunction(() => window.labelCameraTest.tracks[0]?.readyState === 'ended');
    assert.equal(await page.locator('video').evaluate(el => el.srcObject), null);
    assert.equal(workers.length, 0);

    // One tap on the mobile home link starts the scanner and brings up toner prices.
    await page.goto(origin + '/');
    await page.getByRole('link', { name: 'Skenovať štítok' }).click();
    await page.locator('[data-matches] a').first().waitFor({ timeout: 60_000 });
    assert.equal(await page.locator('[data-matches] a').count(), 3);
    assert.match(await status.innerText(), /Brother TN-2421/);
    assert.ok((await page.locator('[data-matches] a').allTextContents()).every(t => t.includes('s DPH')));
    assert.deepEqual(searches, ['Brother TN-2421']);
    assert.equal(await page.evaluate(() => window.labelCameraTest.tracks[0].readyState), 'ended');
    const constraints = await page.evaluate(() => window.labelCameraTest.calls[0]);
    assert.equal(await page.evaluate(() => window.labelCameraTest.focus), 'continuous');
    assert.equal(Math.max(constraints.video.width.ideal,constraints.video.height.ideal),1920);
    assert.equal(constraints.audio, false);
    assert.equal(constraints.video.facingMode.ideal, 'environment');

    // An indefinitely delayed first OCR job cannot hold the camera. Change the
    // live source after the track ends: the captured toner must still be found.
    await page.evaluate(() => { window.labelCameraTest.holdOCR = true; window.labelCameraTest.holdCatalog = true; window.labelCameraTest.text = 'Brother TN-2421'; });
    await start.click();
    const captured = status.filter({ hasText: 'Telefón môžete odložiť' });
    await captured.waitFor({ timeout: 10_000 });
    async function captureTime() {
      const result = await page.evaluate(() => {
        const fixture = window.labelCameraTest;
        const capture = fixture.captures.at(-1);
        return { ms: capture.ended - capture.started, state: fixture.tracks.at(-1).readyState,
          open: document.querySelector('#live-camera').open };
      });
      assert.equal(result.state, 'ended');
      assert.equal(result.open, false);
      assert.ok(result.ms > 0 && result.ms < 10_000, JSON.stringify(result));
      return Math.round(result.ms);
    }
    const steadyMs = await captureTime();
    await page.evaluate(() => { window.labelCameraTest.text = 'HP LaserJet P1102'; });
    await page.waitForFunction(() => typeof window.labelCameraTest.releaseOCR === 'function');
    await page.evaluate(() => window.labelCameraTest.releaseOCR());
    await page.waitForFunction(() => typeof window.labelCameraTest.releaseCatalog === 'function', undefined, { timeout: 35_000 });
    assert.equal(await captureTime(), steadyMs, 'catalogue waits with the track already stopped');
    await page.evaluate(() => window.labelCameraTest.releaseCatalog());
    await page.locator('[data-matches] a').first().waitFor({ timeout: 30_000 });
    assert.match(await status.innerText(), /Brother TN-2421/);

    await page.evaluate(() => { window.labelCameraTest.text = 'S/N: CE285A'; });
    await start.click();
    await status.filter({ hasText: 'nepodarilo bezpečne prečítať' }).waitFor({ timeout: 40_000 });
    assert.deepEqual(searches, ['Brother TN-2421', 'Brother TN-2421']);

    await page.evaluate(() => { window.labelCameraTest.text = 'Brother TN-9999'; });
    await start.click();
    await status.filter({ hasText: 'nenašli presnú ponuku' }).waitFor({ timeout: 40_000 });
    assert.equal(await page.locator('[data-matches] a').count(), 0);

    await page.evaluate(() => { window.labelCameraTest.mode = 'blank'; });
    await start.click();
    await captured.waitFor({ timeout: 10_000 });
    const blankMs = await captureTime();
    await page.getByRole('button', { name: 'Zrušiť čítanie' }).click();
    await page.evaluate(() => { window.labelCameraTest.mode = 'feed'; window.labelCameraTest.text = 'HP LaserJet P1102'; });
    await start.click();
    await page.waitForURL('**/tlaciarne/hp/*p1102', { timeout: 40_000 });
    assert.deepEqual(searches, ['Brother TN-2421', 'Brother TN-2421', 'Brother TN-9999', 'HP P1102']);
    await page.goto(origin + '/hladat-fotkou');
    await page.evaluate(() => { window.labelCameraTest.text = 'H-CF283X/CRG-737'; });
    await start.click();
    const hp = page.getByRole('button', { name: 'HP CF283X', exact: true });
    const canon = page.getByRole('button', { name: 'Canon CRG-737', exact: true });
    await hp.waitFor({ timeout: 35_000 });
    assert.ok(await canon.isVisible());
    await captureTime();
    await hp.click();
    await page.locator('[data-matches] a').first().waitFor();
    assert.ok((await page.locator('[data-matches] a').allTextContents()).every(t => t.includes('HP CF283X')));
    await page.getByRole('button', { name: 'Vybrať inú značku' }).click();
    await canon.click();
    await page.locator('[data-matches] a').first().waitFor();
    assert.ok((await page.locator('[data-matches] a').allTextContents()).every(t => t.includes('Canon CRG-737')));

    assert.equal(searches.filter(q => q === 'HP CF283X').length, 1, 'clicking either brand uses verified offers');
    assert.equal(searches.filter(q => q === 'Canon CRG-737').length, 1);

    await page.evaluate(() => { window.labelCameraTest.text = 'C530dn'; });
    await start.click();
    const oki = page.getByRole('link', { name: 'OKI C530dn', exact: true });
    await oki.waitFor({ timeout: 35_000 });
    assert.ok(await page.getByRole('link', { name: 'Lexmark C530DN', exact: true }).isVisible());
    await oki.click();
    await page.waitForURL('**/tlaciarne/oki/oki-c530dn');

    await page.goto(origin + '/hladat-fotkou');
    await page.evaluate(() => { window.labelCameraTest.mode = 'lcd'; window.labelCameraTest.text = 'DCP-L3510CDW'; });
    await start.click();
    await page.waitForURL('**/tlaciarne/brother/brother-dcp-l3510cdw', { timeout: 35_000 });
    await page.goto(origin + '/hladat-fotkou');
    await page.evaluate(() => { window.labelCameraTest.mode = 'two-rows'; });
    const previousSearches = searches.length;
    await start.click();
    await page.waitForFunction(() => document.querySelector('#live-camera video')?.videoHeight > 0);
    const pick = page.locator('.pick-row');
    const point = await pick.evaluate(button => {
      const video = document.querySelector('#live-camera video');
      const rect = button.getBoundingClientRect();
      const scale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
      return { x: rect.width / 2, y: rect.height / 2 + (362 - video.videoHeight / 2) * scale };
    });
    await pick.click({ position: point });
    await page.waitForFunction(() => parseFloat(document.querySelector('[data-live-guide][data-picked]')?.style.top) > 60);
    await page.locator('[data-matches] a').first().waitFor({ timeout: 35_000 });
    assert.deepEqual(searches.slice(previousSearches), ['Brother TN-2421'], 'tapping the lower row excludes the other orderable model');
    const sessions = workers.length;
    assert.deepEqual(uploads, []);
    console.log(`Camera released in ${steadyMs} ms with OCR held, ${blankMs} ms with no label; correct captured offers after moving away.`);

    await page.goto(origin + '/hladat-fotkou');
    await page.evaluate(() => sessionStorage.setItem('testStalledPreviews', '2'));
    await start.click();
    await status.filter({ hasText: 'Z fotoaparátu neprichádza obraz' }).waitFor({ timeout: 25_000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('testStalledPreviews')), '0');
    assert.equal(await page.evaluate(() => window.labelCameraTest.tracks[0].readyState), 'ended');
    assert.equal(await start.isVisible(), true);
    assert.equal(workers.length, sessions, 'a stalled preview never loads OCR');
    await verifyPhysicalLabels(page, origin, true);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('testReadScene')), 'yes',
      'the local scene recognizer read printed lettering in this browser');
    console.log('Live label video OK: single-tap start, toner prices, exact printer, private code, empty match, denial, cancel, bounded retry and device release');
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      status: document.querySelector('#label-status')?.textContent,
      mode: window.labelCameraTest?.mode, calls: window.labelCameraTest?.calls.length, tracks: window.labelCameraTest?.tracks.map(t => t.readyState),
      selectedRow: document.querySelector('[data-live-guide]')?.style.top,
      scene: sessionStorage.getItem('testCameraScene'),
      engine: sessionStorage.getItem('testSceneFailure'), offscreen: typeof OffscreenCanvas, nativeText: typeof TextDetector,
      video: document.querySelector('video')?.readyState, viewport: document.querySelector('video')?.getBoundingClientRect().toJSON(),
    })).catch(() => ({}));
    throw new Error('Camera test ' + JSON.stringify({ diagnostic, searches, workers: workers.length }) + ': ' + error.message, { cause: error });
  } finally { page.context().off('request', request); page.off('worker', worker); }
}


// Gecko on a phone-sized viewport exercises the same catalogue and canvas-backed camera.
export async function verifyFirefoxLabels(browserType, origin) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await context.route(url => url.origin !== origin, route => route.abort());
    const page = await context.newPage();
    await page.addInitScript(installVideoFixture);
    await verifyPhysicalLabels(page, origin, true);
    await verifyPhysicalLabels(page, origin, false);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('testReadScene')), 'yes',
      'the local scene recognizer read printed lettering in Firefox');
  } finally { await browser.close(); }
}
