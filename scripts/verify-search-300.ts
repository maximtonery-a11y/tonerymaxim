// GET-only regression runner. Local: TM_SEARCH_CATALOG=/path/catalog.json node --experimental-strip-types scripts/verify-search-300.ts
// Deployed: TM_SEARCH_BASE_URL=https://www.tonerymaxim.sk node --experimental-strip-types scripts/verify-search-300.ts
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
const manifest = JSON.parse(await readFile(new URL('./search-300-cases.json', import.meta.url), 'utf8'));
const base = process.env.TM_SEARCH_BASE_URL;
if (process.env.TM_SEARCH_SHARD) {
  const [part, count] = process.env.TM_SEARCH_SHARD.split('/').map(Number);
  manifest.cases = manifest.cases.filter((_: any, index: number) => index % count === part);
}
let productGet: any, smartGet: any;
if (!base) {
  if (!process.env.TM_SEARCH_CATALOG) throw new Error('Set TM_SEARCH_CATALOG or TM_SEARCH_BASE_URL');
  const cache = JSON.parse(await readFile(process.env.TM_SEARCH_CATALOG, 'utf8'));
  const { normalize } = await import('../src/lib/tm-products-cache.ts');
  for (const p of cache.products) p.search_text = normalize([p.name, p.sku, p.slug, p.product_type_label, p.color, p.capacity, p.warranty,
    ...(p.categories || []).map((c: any) => c.name), ...(p.compatible_printers || [])].filter(Boolean).join(' '));
  (globalThis as any).__TM_PRODUCTS_FILE_CACHE__ = cache;
  ({ GET: productGet } = await import('../src/pages/api/products.ts'));
  ({ GET: smartGet } = await import('../src/pages/api/smart-search.ts'));
}
async function get(path: string) {
  const url = new URL(path, base || 'http://localhost');
  const res = base ? await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'manual' })
    : await (path.startsWith('/api/smart-search') ? smartGet : productGet)({ url });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}${res.headers.get('location') ? ' -> ' + res.headers.get('location') : ''}`);
  const data = await res.json();
  if (!data.ok) throw new Error('ok:false');
  return data;
}
const rows: any[] = [];
let next = 0;
async function worker() {
  while (next < manifest.cases.length) {
    const item = manifest.cases[next++];
    const query = `${item.brand} ${item.oem}`;
    const row: any = { query, expectedId: item.expectedId, checks: [] };
    const started = performance.now();
    try {
      const product = await get(`/api/products?search=${encodeURIComponent(query)}&per_page=96`);
      row.total = product.total;
      row.checks.push({ kind: 'exact', ok: product.products.some((p: any) => p.id === item.expectedId) });
      if (!base) {
        const compact = item.oem.replace(/[^a-z0-9]/gi, '').toLowerCase();
        const unbranded = await get(`/api/products?search=${encodeURIComponent(compact)}&per_page=96`);
        row.checks.push({ kind: 'unbranded-lowercase', ok: unbranded.products.some((p: any) => p.id === item.expectedId) });
        const smart = await get(`/api/smart-search?q=${encodeURIComponent(query)}`);
        const ids = new Set(product.products.map((p: any) => String(p.id)));
        row.checks.push({ kind: 'autocomplete', ok: smart.products.length > 0 && smart.products.every((p: any) => ids.has(String(p.id))) });
        const prefix = compact.replace(/(\d)\d[a-z]*$/, '$1');
        if (prefix !== compact && prefix.length >= 4 && /[a-z]/.test(prefix) && /\d$/.test(prefix)) {
          const results = await get(`/api/products?search=${encodeURIComponent(`${item.brand} ${prefix}`)}&per_page=96`);
          row.checks.push({ kind: 'prefix', query: `${item.brand} ${prefix}`, ok: results.total > 0 });
        }
      }
      row.ok = row.checks.every((c: any) => c.ok);
    } catch (e) { row.ok = false; row.error = String(e); }
    row.ms = Math.round(performance.now() - started);
    rows.push(row);
    if (!row.ok) console.log('FAIL', JSON.stringify(row));
    if (rows.length % 25 === 0) console.log('PROGRESS', rows.length, '/', manifest.cases.length);
  }
}
await Promise.all(Array.from({ length: base ? 3 : 1 }, worker));
const summary = { mode: base || 'local API handlers against production catalog snapshot', selection: manifest.selection,
  catalogGeneratedAt: manifest.catalogGeneratedAt, cases: rows.length, passed: rows.filter(r => r.ok).length,
  checks: rows.reduce((n,r) => n + r.checks.length, 0), failed: rows.filter(r => !r.ok).length, rows };
await writeFile(process.env.TM_SEARCH_REPORT || '/tmp/tm-search-300-report.json', JSON.stringify(summary, null, 2));
console.log('RESULT', JSON.stringify({ cases: summary.cases, passed: summary.passed, checks: summary.checks, failed: summary.failed }));
if (summary.failed) process.exitCode = 1;
