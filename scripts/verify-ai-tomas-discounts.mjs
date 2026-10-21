// With no arguments verifies the local production build. --base-url runs the
// same 24 advisory requests against a deployment; no orders are submitted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { request as httpRequest } from 'node:http';

const baseArg = process.argv.indexOf('--base-url');
const base = baseArg >= 0 ? new URL(process.argv[baseArg + 1]).origin : 'http://127.0.0.1:43821';
const local = baseArg < 0;
const outputArg = process.argv.indexOf('--output');
const output = outputArg >= 0 ? process.argv[outputArg + 1] : 'docs/verification/ai-tomas-discounts-2026-10-21.json';
const cases = [
  ['Ako uplatním zľavu za registráciu?', 'registracia-zlava'],
  ['kde mi ta zľava príde zatiaľ neprišla', 'registracia-zlava', true],
  ['a kde to najdem na mobile?', 'registracia-zlava', true],
  ['musim ju zotriet?', 'registracia-zlava', true],
  ['ani v e-maile ju nemam', 'registracia-zlava', true],
  ['Kde nájdem 7 % zľavu?', 'odmena-7-percent'],
  ['a ako ju zadam bez registracie?', 'odmena-7-percent', true],
  ['Kde vidím svoje body a ako ich použijem?', 'vernost-body'],
  ['a kde to mam zapnut na mobile?', 'vernost-body', true],
  ['Kam zadám kupón?', 'kupony-uplatnenie'],
  ['Ako použiť zľavový kód MAXIM123456?', 'kupony-uplatnenie'],
  ['Dostal som marketingový kupón na 20 %, kde ho zadám?', 'kupony-uplatnenie'],
  ['Ako uplatním 10 % zľavu na kompatibilné tonery?', 'mnozstevne-zlavy-tonery'],
  ['Kde sa zobrazuje 25 % zľava?', 'mnozstevne-zlavy-tonery'],
  ['Je množstevná zľava aj na originály?', 'mnozstevne-zlavy-tonery'],
  ['Ako sa ráta množstevná zľava pri sade tonerov?', 'mnozstevne-zlavy-tonery'],
  ['Ako uplatním 5 % zľavu pri 3 kalendároch?', 'kalendare-mnozstvo-zlavy'],
  ['Kde uvidím 15 % zľavu?', 'kalendare-mnozstvo-zlavy'],
  ['Môžem kombinovať 5 a 7 percent?', 'zlavy-kombinovanie'],
  ['Môžem použiť množstevnú zľavu, kupón a body súčasne?', 'zlavy-kombinovanie'],
  ['Kde sa uplatní papierová vernostná odmena?', 'vernost-papier'],
  ['Kde je zľava za newsletter?', 'newsletter-zlava'],
  ['Ako sa zobrazí akciová cena v košíku?', 'akciove-ceny'],
  ['kde mi ta zľava príde zatiaľ neprišla', 'zlava-upresnenie'],
];
const report = { generatedAt: new Date().toISOString(), base, scope: local ? 'local production build, real HTTP and middleware' : 'live deployment, advisory questions only', cases: [], passed: false };
let server, state = {}, serverOutput = '';
// Use a direct socket for the spawned local server: an environment HTTP proxy
// must never turn a local check into requests to the production storefront.
function request(path, options = {}) {
  if (!local) return fetch(path, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
  return new Promise((resolve, reject) => {
    const req = httpRequest(path, { method: options.method || 'GET', headers: options.headers || {} }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('HTTP timeout')));
    req.end(options.body);
  });
}
try {
  if (local) {
    await readFile('dist/server/entry.mjs');
    server = spawn(process.execPath, ['dist/server/entry.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '43821', TM_DISABLE_BACKGROUND_WORKERS: '1', TM_DISABLE_INDEXNOW: '1', OPENAI_ASSISTANT_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-6000); });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error(`Server stopped: ${serverOutput}`);
      // Astro versions return either 404 or 405 for an unsupported GET.
      try { const probe = await request(`${base}/api/ai-tomas`); ready = probe.status < 500; await probe.body?.cancel(); } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, serverOutput);
  }
  for (const [question, expectedFaq, follow] of cases) {
    if (!follow) state = {};
    const started = performance.now();
    const response = await request(`${base}/api/ai-tomas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: local ? 'https://www.tonerymaxim.sk' : base }, body: JSON.stringify({ message: question, page: '/ucet', state }) });
    const body = await response.json();
    const result = { question, expectedFaq, followUp: !!follow, httpStatus: response.status, ms: Math.round(performance.now() - started), response: body, passed: false };
    report.cases.push(result);
    // Respect the production limiter; do not retry or change IP/path on 429.
    if (response.status === 429) throw new Error(`Rate limited; Retry-After=${response.headers.get('retry-after')}`);
    assert.equal(response.status, 200, question);
    assert.equal(body.ok, true, question);
    assert.equal(body.advisor?.faq, expectedFaq, question);
    assert.equal(body.advisor?.unanswered, false, question);
    assert.equal(body.commerce, null, question);
    assert.equal(body.action, null, question);
    assert.deepEqual(body.state.cart, [], question);
    assert.ok(body.advisor.sources.some(link => link.url === '/kosik'), question);
    result.passed = true;
    state = body.state;
  }
  report.passed = true;
} catch (error) {
  report.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  server?.kill('SIGTERM');
  if (local) await mkdir('docs/verification', { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ base, cases: report.cases.length, passed: report.passed, error: report.error, output }));
}
