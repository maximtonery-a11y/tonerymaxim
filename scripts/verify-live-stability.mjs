import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyLiveStability({ baseUrl = 'https://www.tonerymaxim.sk', fetchImpl = fetch } = {}) {
  const base = new URL(baseUrl), checks = [], warnings = [];
  const report = { observedAt: new Date().toISOString(), origin: base.origin, ok: false, checks, warnings };
  const require = (value, message) => { if (!value) throw new Error(message); };
  async function check(name, pathname, inspect, body) {
    const started = performance.now();
    try {
      const response = await fetchImpl(new URL(pathname, base), { method: body ? 'POST' : 'GET', redirect: 'manual',
        headers: { accept: '*/*', ...(body ? { 'content-type': 'application/json', origin: base.origin } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000), cache: 'no-store' });
      const text = await response.text();
      const result = await inspect(response.status, text);
      checks.push({ name, path: pathname, ok: true, status: response.status, ms: Math.round(performance.now() - started), serverTiming: response.headers.get('server-timing'), ...result });
      return result;
    } catch (error) {
      checks.push({ name, path: pathname, ok: false, ms: Math.round(performance.now() - started), error: error.message });
      return null;
    }
  }
  const json = text => JSON.parse(text);
  await check('Liveness', '/api/health', (status, text) => { require(status === 200 && json(text).ok, 'Liveness failed'); });
  await check('Home page', '/', status => require(status === 200, 'Home page unavailable'));
  // Health and the static home page deliberately do not initialise the catalogue.
  // Exercise a real catalogue request before inspecting its in-memory diagnostics.
  await check('OEM search', '/api/products?search=HP%20CF230X&per_page=12', (status, text) => {
    const d = json(text); require(status === 200 && d.ok && d.products?.length, 'OEM search is empty');
    require(d.products.some(p => /CF230X/i.test(p.name) && Number(p.price) > 0), 'Requested OEM missing or unpriced');
  });
  await check('Memory and catalogue', '/api/storefront-check', (status, text) => {
    const data = json(text), d = data.diagnostics, m = data.checks;
    require(status === 200 && data.ok && m && d, 'Memory diagnostics unavailable or above configured limit');
    require(d.catalogProducts > 0, 'Catalogue is empty');
    const ageHours = (Date.now() - Date.parse(d.catalogGeneratedAt)) / 3600000;
    require(Number.isFinite(ageHours) && ageHours >= -1 && ageHours <= 30, 'Catalogue older than 30 hours or invalid timestamp');
    require(d.productApiCacheEntries <= 100 && d.productApiCacheBytes <= d.productApiCacheByteLimit, 'Product API cache exceeded its budget');
    require(d.aiCommerceCacheEntries <= 500 && d.aiCommerceCacheJsonBytes <= d.aiCommerceCacheJsonByteLimit, 'AI cache exceeded its budget');
    if (!m.memoryLimitConfigured) warnings.push('Coolify memory limit is not configured');
    if (d.lastSync && ['failed', 'retained-old'].includes(d.lastSync.status)) warnings.push('Latest import retained the previous catalogue; review supplier/import error');
    return { memory: m, catalogProducts: d.catalogProducts, catalogGeneratedAt: d.catalogGeneratedAt, lastSync: d.lastSync };
  });
  await check('Prefix search and sets', '/api/smart-search?q=CF53', (status, text) => {
    const d = json(text); require(status === 200 && d.ok && d.products?.length, 'Autocomplete is empty');
    require(/sada/i.test(d.products[0].title), 'Available set is not prioritised');
  });
  await check('Printer variant alias', '/api/printers?brand=samsung&q=ML-2165W', (status, text) => {
    const d = json(text); require(status === 200 && d.ok && d.printers?.some(p => [p.title, ...(p.aliases || [])].some(name => /ML-2165W/i.test(name))), 'ML-2165W alias disappeared');
  });
  const pack = await check('Canonical pack and price', '/api/product?id=52830', (status, text) => {
    const d = json(text), p = d.product; require(status === 200 && d.ok && p?.id === 52830 && Number(p.price) > 0 && /CMYK/i.test(p.name), 'Canonical pack missing or invalid');
    return { unitPrice: Number(p.price) };
  });
  await check('Empty checkout', '/pokladna', (status, text) => {
    require(status === 200 && /<div[^>]*data-checkout-form[^>]*\shidden(?:\s|>)/.test(text), 'Empty checkout exposes its form');
  });
  for (const path of ['/api/order-create', '/api/gopay-create']) await check('Empty cart rejected', path,
    (status, text) => require(status === 400 && json(text).ok === false, 'Empty cart was not rejected'), { cart: [], termsAccepted: false });
  if (pack) await check('AI pack calculation', '/api/ai-tomas', (status, text) => {
    const d = json(text), answer = (d.advisor?.answer || []).join(' ');
    const total = (quantity, discount) => (Math.round(pack.unitPrice * quantity * discount * 100) / 100).toFixed(2).replace('.', ',');
    require(status === 200 && d.ok && d.commerce?.products?.length === 1 && d.commerce.products[0].id === 52830, 'AI selected a different product');
    require(answer.includes(total(3, .9)) && answer.includes(total(4, .75)), 'AI quantity discount is incorrect');
    require(!d.action && !d.state?.cart?.length, 'A price question mutated the cart');
  }, { message: 'Koľko stoja 3 ks a 4 ks kompatibilnej sady Canon CRG-045 CMYK po množstevnej zľave?', state: {}, page: '/' });
  await check('Not-found page', '/__tm_stability_missing_page__', status => require(status === 404, 'Missing URL is not a 404'));
  report.ok = checks.every(c => c.ok);
  report.finishedAt = new Date().toISOString();
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
  const baseUrl = option('--url', 'https://www.tonerymaxim.sk');
  const report = await verifyLiveStability({ baseUrl });
  const output = option('--output', 'artifacts/live-stability.json');
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2));
  for (const row of report.checks) console.log(`${row.ok ? 'OK' : 'FAIL'} ${row.name}: ${row.ms} ms${row.error ? ' — ' + row.error : ''}`);
  for (const warning of report.warnings) console.warn('WARNING: ' + warning);
  if (!report.ok) process.exitCode = 1;
}
