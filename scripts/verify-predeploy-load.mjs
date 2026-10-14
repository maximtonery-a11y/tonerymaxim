// Production-build test with a local Woo mock; never uses real credentials.
// node scripts/verify-predeploy-load.mjs --catalog /abs/products.json --output /abs/report.json [--root /abs/repo] [--generations 5]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const options = Object.fromEntries(process.argv.slice(2).reduce((rows, value, i, args) => value.startsWith('--') ? [...rows, [value.slice(2), args[i + 1]]] : rows, []));
assert.ok(options.catalog && options.output, '--catalog and --output are required');
const root = resolve(options.root || process.cwd());
const output = resolve(options.output);
const generations = Math.max(2, Math.min(10, Number(options.generations) || 5));
const source = JSON.parse(await readFile(resolve(options.catalog), 'utf8'));
const products = source.products;
assert.ok(products.length >= 7000, 'Use a full public catalog snapshot');
const original = new Map(products.map(p => [Number(p.id), p]));
assert.ok(original.has(52830), 'Canon CRG-045 set is required for generation checks');
const temp = await mkdtemp(join(tmpdir(), 'tm-predeploy-load-'));
const cacheRoot = join(temp, 'product-cache'); await mkdir(cacheRoot);
const cacheFile = join(cacheRoot, 'products.json');
const initialGeneration = '2026-10-14T00:00:00.000Z';
await writeFile(cacheFile, JSON.stringify({ ...source, generated_at: initialGeneration }));
const delay = ms => new Promise(r => setTimeout(r, ms));
const digest = data => createHash('sha256').update(data).digest('hex');
async function fileDigest(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
const summary = times => {
  const sorted = [...times].sort((a,b) => a-b);
  return { requests: sorted.length, medianMs: +(sorted[Math.floor(sorted.length / 2)] || 0).toFixed(1),
    p95Ms: +(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] || 0).toFixed(1), maxMs: +(sorted.at(-1) || 0).toFixed(1) };
};
let generation = 1, mode = 'normal', retryIssued = false;
const wooCalls = [], errors = [], samples = [], requestTimes = {}, cycles = [], diagnosticWarnings = [];
const clientContext = new AsyncLocalStorage();
let detailChecks = 0, blockedOutbound = 0, logs = '', stopped = false;
let completeReport;
const denseHtml = 'Úplný technický opis a vlastnosti výrobku zostávajú dostupné na detaile. '.repeat(300);
const denseAttribute = 'Pôvodná hodnota technického parametra výrobku. '.repeat(30);
function wooProduct(p, g) {
  const price = p.id === 52830 ? (Number(p.price) + g).toFixed(2) : p.price;
  return { id: p.id, sku: p.sku, name: p.name, slug: p.slug, price, regular_price: price, sale_price: '',
    stock_status: p.stock_status, stock_quantity: p.stock_quantity, description: `<p>TM_DETAIL_GEN_${g}_ID_${p.id}</p><p>${denseHtml}</p>`,
    short_description: `<p>${p.description || p.name}</p>`, categories: p.categories || [], images: [{ src: p.image }], meta_data: [],
    attributes: [{ id: 1, name: 'Kapacita', options: [p.capacity || ''] },
      { id: 2, name: 'Kompatibilné tlačiarne', options: p.compatible_printers || [] },
      { id: 3, name: 'Farba', options: [p.color || ''] },
      ...Array.from({ length: 8 }, (_, n) => ({ id: n + 4, name: `Technický parameter ${n}`, options: [`TM_ATTR_GEN_${g}_ID_${p.id}_${n} ${denseAttribute}`] }))] };
}
const woo = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname !== '/wp-json/wc/v3/products') { response.writeHead(404).end(); return; }
  assert.equal(request.headers.authorization, 'Basic ' + Buffer.from('ck_local:cs_local').toString('base64'));
  const page = Number(url.searchParams.get('page') || 1);
  wooCalls.push({ generation, mode, page });
  const headers = { 'content-type': 'application/json', 'x-wp-total': String(products.length), 'x-wp-totalpages': String(Math.ceil(products.length / 100)) };
  if (mode === 'retry' && page === 2 && !retryIssued) { retryIssued = true; response.writeHead(429, { ...headers, 'retry-after': '0' }).end('{}'); return; }
  if (mode === 'unauthorized' && page === 3) { response.writeHead(401, headers).end('{"code":"unauthorized-local-test"}'); return; }
  const body = mode === 'truncated' && page === 40 ? [] : products.slice((page - 1) * 100, page * 100).map(p => wooProduct(p, generation));
  response.writeHead(200, headers).end(JSON.stringify(body));
});
await new Promise(r => woo.listen(0, '127.0.0.1', r));
const wooOrigin = `http://127.0.0.1:${woo.address().port}`;
const shim = join(temp, 'probe.mjs');
await writeFile(shim, `import os from 'node:os';os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
const original=globalThis.fetch;globalThis.fetch=async(input,...args)=>{const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);if(url.origin!==${JSON.stringify(wooOrigin)}){console.log('PROBE_BLOCKED_OUTBOUND');throw new Error('Local predeploy test blocks external fetch');}return original(input,...args);};
let last=performance.now(),maxLagMs=0;setInterval(()=>{const now=performance.now();maxLagMs=Math.max(maxLagMs,now-last-100);last=now;const m=process.memoryUsage();console.log('PROBE_SAMPLE='+JSON.stringify({at:Date.now(),rssMb:Math.round(m.rss/1048576),heapMb:Math.round(m.heapUsed/1048576),externalMb:Math.round(m.external/1048576),peakRssMb:Math.round(process.resourceUsage().maxRSS/1024),maxLagMs:Math.round(maxLagMs)}));},100).unref();`);
const port = 4481, base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', shim, join(root, 'dist/server/entry.mjs')], { cwd: root,
  env: { PATH: process.env.PATH, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production',
    TM_PERSISTENT_DATA_DIR: temp, TM_CACHE_DIR: cacheRoot, TM_DISABLE_BACKGROUND_WORKERS: '1', TM_DISABLE_INDEXNOW: '1',
    WOO_URL: wooOrigin, WOO_CONSUMER_KEY: 'ck_local', WOO_CONSUMER_SECRET: 'cs_local', WOO_SYNC_PAGE_DELAY_MS: '120',
    WOO_SYNC_MIN_PRODUCTS: '7000', WOO_SYNC_EXPECTED_MIN_PRODUCTS: '7000', OPENAI_ASSISTANT_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
const exit = new Promise(r => child.once('exit', r));
async function request(path, method = 'GET', body, diagnostic = false) {
  const start = performance.now();
  const response = await fetch(base + path, { method, redirect: 'manual', headers: { Origin: base, 'X-Forwarded-For': clientContext.getStore() || '192.0.2.100', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(path.startsWith('/api/sync-products') ? 180000 : 15000) });
  const text = await response.text(), ms = performance.now() - start;
  assert.ok(response.status === 200 || (diagnostic && response.status === 503), `${path}: HTTP ${response.status}: ${text.slice(0,200)}`);
  const category = path.split('?')[0]; (requestTimes[category] ||= []).push(ms);
  return { text, ms, status: response.status, appTiming: response.headers.get('server-timing') };
}
async function json(path, method = 'GET', body) {
  const r = await request(path, method, body), data = JSON.parse(r.text); assert.equal(data.ok, true, path); return data;
}
function checkDetail(data) {
  const p = data.product; assert.ok(p); const expected = original.get(Number(p.id)); assert.ok(expected);
  assert.equal(p.sku, expected.sku); assert.equal(p.name, expected.name);
  if (data.cache_generated_at === initialGeneration) return;
  const marker = p.description_html?.match(/TM_DETAIL_GEN_(\d+)_ID_(\d+)/);
  assert.ok(marker, `Missing full detail for ${p.id}, generation ${data.cache_generated_at}`);
  assert.equal(Number(marker[2]), Number(p.id));
  // Empty source capacity/printer attributes are legitimately omitted by Woo
  // normalization. Every nonempty technical value must survive unchanged.
  assert.ok(p.description_html.includes(denseHtml), `Truncated HTML for ${p.id}`);
  for (let n = 0; n < 8; n++) {
    assert.equal(p.attributes.find(a => a.name === `Technický parameter ${n}`)?.options?.[0],
      `TM_ATTR_GEN_${marker[1]}_ID_${p.id}_${n} ${denseAttribute}`.trim(), `Lost or mixed attribute ${n} for ${p.id}`);
  }
  if (Number(p.id) === 52830) assert.equal(Number(p.price), Number(expected.price) + Number(marker[1]));
  detailChecks++;
}
async function diagnostics() {
  const response = await request('/api/storefront-check', 'GET', undefined, true);
  const data = JSON.parse(response.text), d = data.diagnostics;
  if (response.status === 503) {
    assert.ok(data.checks.memoryUsagePercent >= 90, 'Unexpected diagnostic 503');
    diagnosticWarnings.push({ at: data.timestamp, rssMb: data.checks.rssMb, cgroupCurrentMb: data.checks.cgroupCurrentMb, cgroupLimitMb: data.checks.cgroupLimitMb });
  } else assert.equal(data.ok, true);
  assert.ok(d.detailCacheEntries <= 100); assert.ok(d.productApiCacheEntries <= 100);
  if ('productApiCacheBytes' in d) assert.ok(d.productApiCacheBytes <= 8 * 1048576);
  if ('aiCommerceCacheJsonBytes' in d) assert.ok(d.aiCommerceCacheJsonBytes <= 8 * 1048576);
  if ('aiCommerceCacheEntries' in d) assert.ok(d.aiCommerceCacheEntries <= 500);
  assert.ok(d.printerApiIndexEntries <= 16);
  assert.ok(d.printerNegativeEntries === null || d.printerNegativeEntries <= 512);
  return data;
}
const queries = ['CF230X','TN1050','Canon CRG-045','Epson 102','HP M102w','Brother DCP-1610WE','Canon MF635Cx','Epson ET-2700','MLT-D101S','Xerox 106R03048','Lexmark 56F2X0E','Kyocera TK-3160','OKI 46508712'];
const detailIds = [52830,53282,...products.filter(p => Number(p.price) > 0).slice(0,350).map(p => p.id)];
let requestIndex = 0, lastAiAt = 0;
async function worker() {
  while (!stopped) {
    const n = requestIndex++, q = queries[n % queries.length];
    try {
      switch (n % 9) {
        case 0: assert.match((await request('/')).text, /Tonery/i); break;
        case 1: assert.ok((await json('/api/smart-search?q=' + encodeURIComponent(q))).products.length); break;
        case 2: await json('/api/products?search=' + encodeURIComponent(q) + '&per_page=100'); break;
        case 3: checkDetail(await json('/api/product?id=' + detailIds[n % detailIds.length])); break;
        case 4: assert.match((await request('/pokladna')).text, /data-checkout-form[^>]*\shidden(?:\s|>)/); break;
        case 5: await json('/api/printers?brand=' + (n % 2 ? 'hp' : `unknown-${n}`)); break;
        case 6: await json('/api/health'); break;
        case 7: await request('/tlaciarne/canon/canon-i-sensys-mf635cx'); break;
        case 8: {
          // Production protection allows 30 AI requests/10 minutes per client.
          // Keep it enabled and issue fewer than 3/minute from this local IP.
          if (Date.now() - lastAiAt < 21000) { await json('/api/health'); break; }
          lastAiAt = Date.now();
          const d = await json('/api/ai-tomas', 'POST', { message: 'Máte HP CF230X?', state: {}, page: '/' }); assert.ok(d.commerce.products.length); break;
        }
      }
    } catch (error) { errors.push({ n, message: error.message }); }
    // One bounded local client per worker; even a zero-cost response stays
    // below the existing 600/minute search protection for that visitor.
    await delay(100);
  }
}
const workers = [];
try {
  const bootStart = performance.now();
  for (let i = 0; i < 100 && !logs.includes('Server listening'); i++) { assert.equal(child.exitCode, null, logs); await delay(100); }
  assert.ok(logs.includes('Server listening'), logs);
  const listeningMs = Math.round(performance.now() - bootStart);
  const cold = {};
  for (const path of ['/api/health','/','/api/smart-search?q=CF230X','/api/products?search=Epson%20102','/api/printers?brand=hp','/pokladna']) cold[path] = (await request(path)).ms;
  const before = await diagnostics();
  for (let i = 0; i < 8; i++) workers.push(clientContext.run(`192.0.2.${i + 1}`, worker));
  await delay(1800);
  async function sync(kind, shouldRefresh = true, double = false) {
    mode = kind; retryIssued = false;
    const oldFile = await readFile(cacheFile), old = JSON.parse(oldFile);
    const oldDetails = !shouldRefresh && old.details_file ? await fileDigest(join(cacheRoot, old.details_file)) : null;
    const callStart = wooCalls.length, start = performance.now();
    const replies = await Promise.all(Array.from({ length: double ? 2 : 1 }, () => json('/api/sync-products?force=1')));
    const elapsedMs = Math.round(performance.now() - start);
    for (const reply of replies) { assert.equal(reply.refreshed, shouldRefresh, reply.warning); assert.equal(reply.total, products.length); }
    assert.equal(new Set(replies.map(r => r.generated_at)).size, 1, 'Concurrent syncs must share a generation');
    const file = await readFile(cacheFile), disk = JSON.parse(file);
    if (!shouldRefresh) {
      assert.equal(digest(file), digest(oldFile), 'A failed import replaced the complete catalog');
      assert.equal(await fileDigest(join(cacheRoot, old.details_file)), oldDetails, 'A failed import replaced the existing full details');
      assert.ok(replies[0].warning);
    } else {
      assert.notEqual(disk.generated_at, old.generated_at);
      assert.equal(disk.products.length, products.length);
      assert.equal(new Set(disk.products.map(p => p.id)).size, products.length);
      assert.equal(wooCalls.length - callStart, Math.ceil(products.length / 100) + (kind === 'retry' ? 1 : 0), 'Concurrent sync started duplicate Woo pagination');
    }
    const target = await json('/api/product?id=52830'); checkDetail(target);
    assert.equal(Number(target.product.price), Number(original.get(52830).price) + (shouldRefresh ? generation : generation - 1));
    assert.equal(target.cache_generated_at, disk.generated_at);
    const result = await json('/api/products?search=Canon%20CRG-045&per_page=100');
    assert.equal(result.cache_generated_at, disk.generated_at);
    assert.equal(Number(result.products.find(p => Number(p.id) === 52830).price), Number(target.product.price));
    const remaining = await readdir(cacheRoot); assert.equal(remaining.filter(f => f.endsWith('.tmp')).length, 0, 'Import left unpublished temporary files');
    assert.equal(remaining.filter(f => /^product-details-.*\.ndjson$/.test(f)).length, 1, 'Old detail generations accumulated');
    await delay(1800);
    const status = await diagnostics();
    const cycle = { generation, kind, refreshed: shouldRefresh, concurrentSyncCalls: double ? 2 : 1, elapsedMs, wooRequests: wooCalls.length - callStart,
      rssMb: status.checks.rssMb, heapMb: status.checks.heapMb, catalogGeneratedAt: disk.generated_at, detailsFileBytes: (await stat(join(cacheRoot, disk.details_file))).size,
      diagnostics: status.diagnostics };
    cycles.push(cycle); console.log('CYCLE ' + JSON.stringify(cycle));
  }
  for (generation = 1; generation <= generations; generation++) {
    await sync(generation === 2 ? 'retry' : 'normal', true, generation === 1);
    if (generation === 3) {
      generation++; await sync('truncated', false); await sync('unauthorized', false); generation--;
    }
  }
  stopped = true; await Promise.all(workers); await delay(2000);
  const after = await diagnostics();
  // Validate every detail record on disk without retaining the entire large file.
  const { createInterface } = await import('node:readline');
  const disk = JSON.parse(await readFile(cacheFile, 'utf8'));
  const completeDetailHash = createHash('sha256'); let completeDetails = 0;
  for await (const line of createInterface({ input: createReadStream(join(cacheRoot, disk.details_file)), crlfDelay: Infinity })) {
    const detail = JSON.parse(line), marker = detail.description_html.match(/TM_DETAIL_GEN_(\d+)_ID_(\d+)/);
    assert.ok(marker); assert.equal(Number(marker[1]), generations); assert.ok(original.has(Number(marker[2])));
    assert.ok(detail.description_html.includes(denseHtml));
    for (let n = 0; n < 8; n++) assert.equal(detail.attributes.find(a => a.name === `Technický parameter ${n}`)?.options?.[0], `TM_ATTR_GEN_${generations}_ID_${marker[2]}_${n} ${denseAttribute}`.trim());
    completeDetailHash.update(line + '\n'); completeDetails++;
  }
  assert.equal(completeDetails, products.length);
  for (const match of logs.matchAll(/PROBE_SAMPLE=(\{[^\n]+\})/g)) samples.push(JSON.parse(match[1]));
  blockedOutbound = [...logs.matchAll(/PROBE_BLOCKED_OUTBOUND/g)].length;
  const timings = Object.fromEntries(Object.entries(requestTimes).map(([path,times]) => [path,summary(times)]));
  const report = { ok: errors.length === 0, root, catalogProducts: products.length, forcedGc: false, workload: { concurrentWorkers: 8, simulatedLocalVisitors: 8, minimumVisitorDelayMs: 100, successfulImports: generations, failedImports: 2, retry429: true, duplicateSyncMerged: true, denseHtmlChars: denseHtml.length, denseAttributeChars: denseAttribute.length },
    listeningMs, cold, before, after, cycles, requests: Object.values(requestTimes).reduce((sum, rows) => sum + rows.length, 0), errors, timings,
    checkedHttpFullDetails: detailChecks, checkedDiskFullDetails: completeDetails, fullDetailsSha256: completeDetailHash.digest('hex'), diagnosticWarnings,
    peakRssMb: Math.max(...samples.map(s => s.peakRssMb)), maxEventLoopLagMs: Math.max(...samples.map(s => s.maxLagMs)), blockedOutbound, samples };
  completeReport = report;
  await mkdir(resolve(output, '..'), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2));
  console.log('RESULT ' + JSON.stringify({ ...report, before: report.before.checks, after: report.after.checks, cycles: cycles.map(({diagnostics,...c})=>c), samples: undefined }));
  assert.equal(errors.length, 0, JSON.stringify(errors.slice(0,5)));
  assert.ok(timings['/'].p95Ms < 2000, 'Homepage p95 exceeds 2 seconds locally');
  assert.ok(timings['/api/smart-search'].p95Ms < 2000, 'Search p95 exceeds 2 seconds locally');
  assert.ok(timings['/api/health'].maxMs < 2500, 'Healthcheck became unresponsive');
} catch (error) {
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify({ ...completeReport, ok: false, error: error.message, errors, cycles, logs: logs.slice(-4000) }, null, 2));
  throw error;
} finally {
  stopped = true; await Promise.allSettled(workers);
  child.kill('SIGTERM'); await exit;
  woo.closeAllConnections(); await new Promise(r => woo.close(r));
  await rm(temp, { recursive: true, force: true });
}
