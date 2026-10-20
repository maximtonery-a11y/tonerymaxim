// Browser layout audit using the real product renderer and styles, with a public
// catalog snapshot. No WooCommerce writes or external requests are made.
// TM_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs TM_CHROMIUM_PATH=/path/to/chrome \
// node scripts/verify-product-detail-responsive.mjs --catalog /path/products.json --output /path/report.json
// Optional: --css /path/to/previous-product-detail.css to reproduce the regression.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const args = process.argv.slice(2);
const option = name => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : '';
assert.ok(option('catalog') && option('output'), 'Required: --catalog and --output');
const snapshot = JSON.parse(await readFile(resolve(option('catalog')), 'utf8'));
const products = option('limit') ? snapshot.products.slice(0, Number(option('limit'))) : snapshot.products;
assert.ok(Array.isArray(products) && products.length, 'Catalog is empty');
const cssPath = resolve(option('css') || 'src/styles/product-detail.css');
const [globalCss, detailCss, renderer] = await Promise.all([
  readFile('src/styles/global.css', 'utf8'),
  readFile(cssPath, 'utf8'),
  readFile('src/scripts/product-detail.js', 'utf8'),
]);

// Expose the unchanged rendering function only inside this isolated fixture.
// Related-product requests are exercised separately against the built app;
// this sweep tests every product's own content without thousands of requests.
const hook = '  document.addEventListener("DOMContentLoaded", () => {';
assert.ok(renderer.includes(hook));
const instrumented = renderer.replace(hook, '  window.__tmAuditRender = render;\n  if (!window.__tmLayoutAudit) ' + hook.trimStart())
  .replace('    hydrateSeriesColors(product);\n    hydrateExtraProducts(product);', '    // Offline layout sweep: related-product hydration is tested in the built app.');
assert.notEqual(instrumented, renderer);
const bundled = await build({
  stdin: { contents: instrumented, resolveDir: resolve('src/scripts'), sourcefile: 'product-detail.js', loader: 'js' },
  bundle: true, write: false, format: 'iife', platform: 'browser',
});
const html = `<!doctype html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globalCss}\n${detailCss}</style></head><body class="product-detail-body"><div class="page"><main class="product-detail-page" data-product-slug="audit"><div class="detail-wrap"><section data-product-root class="tm-detail"></section></div></main></div><script>window.__tmLayoutAudit=true</script><script>${bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
const server = createServer((request, response) => {
  if (request.url === '/') response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  else response.writeHead(204).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(process.env.TM_PLAYWRIGHT_MODULE || 'playwright');
let browser;
const results = [];

try {
  browser = await chromium.launch({
    ...(process.env.TM_CHROMIUM_PATH ? { executablePath: process.env.TM_CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'], headless: true,
  });
  const priority = [...products].sort((a, b) => String(b.capacity || b.yield || '').length - String(a.capacity || a.yield || '').length);
  const sample = [...new Map([
    ...priority.slice(0, 8),
    ...[...products].sort((a, b) => b.name.length - a.name.length).slice(0, 6),
    ...['compatible', 'original', 'renovated', 'product'].flatMap(type => products.filter(p => p.product_type_key === type).slice(0, 3)),
    ...products.filter(p => /604xl-cmyk|tn-2590|008r13325|crg-069|epson-104|w1420a/i.test(p.slug)).slice(0, 12),
  ].map(p => [p.id, p])).values()];
  const configurations = [
    { width: 360, mobile: true, items: products },
    { width: 393, mobile: true, items: products },
    ...[320, 375, 430, 768, 820, 880, 900, 1024, 1280, 1440, 1920].map(width => ({ width, mobile: width <= 880, items: sample })),
  ].filter(configuration => !option('widths') || option('widths').split(',').map(Number).includes(configuration.width));
  for (const { width, mobile, items } of configurations) {
    const context = await browser.newContext({ viewport: { width, height: 852 }, isMobile: mobile, hasTouch: mobile });
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const issues = [];
    for (let start = 0; start < items.length; start += 100) {
      const page = await context.newPage();
      await page.goto(origin, { waitUntil: 'load' });
      const batch = await page.evaluate(batch => batch.map(product => {
        window.__tmAuditRender(product);
        const root = document.querySelector('[data-product-root]');
        const targets = root.querySelectorAll('.detail-hero-card,.product-info,.product-info h1,.summary-subtitle,.badge-row,.compat-preview,.compat-preview button,.chips,.chip,.bulk-discount-strip,.purchase-decision,.purchase-panel,.info-grid,.params-card,.params-card dd,.description-card,.compat-navigation,.model-links a,.series-links a,.product-mobile-sticky-cart,.product-mobile-sticky-cart button');
        const overflow = [];
        for (const element of targets) {
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          if (rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1) {
            overflow.push({ element: element.className || element.tagName.toLowerCase(), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, text: element.textContent.trim().slice(0, 160) });
          }
        }
        if (root.querySelector('h1').textContent !== product.name) throw new Error(`Product title changed: ${product.id}`);
        return overflow.length ? { id: product.id, sku: product.sku, slug: product.slug, name: product.name, overflow } : null;
      }).filter(Boolean), items.slice(start, start + 100));
      issues.push(...batch);
      await page.close();
      if (items.length > 1000 && (start + 100) % 1000 === 0) console.log(`${width}px: ${start + 100}/${items.length}, affected ${issues.length}`);
    }
    await context.close();
    results.push({ width, mobile, tested: items.length, affected: issues.length, issues });
    console.log(JSON.stringify({ width, tested: items.length, affected: issues.length }));
  }
  const report = { generated_at: new Date().toISOString(), catalog_generated_at: snapshot.generated_at, catalog_total: products.length, css: cssPath, browser: browser.version(), ok: results.every(r => r.affected === 0), results };
  await writeFile(resolve(option('output')), JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
