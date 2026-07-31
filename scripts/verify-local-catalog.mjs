#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

const host = '127.0.0.1';
const port = String(process.env.TM_LOCAL_VERIFY_PORT || '4323');
const baseUrl = `http://${host}:${port}`;
const timeoutAt = Date.now() + 15 * 60_000;
let server;

function npmProcess(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && existsSync(npmExecPath)) {
    return spawn(process.execPath, [npmExecPath, ...args], {
      stdio: 'inherit',
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
      windowsHide: false,
    });
  }
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawn(executable, args, {
    stdio: 'inherit',
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
    windowsHide: false,
  });
}

async function request(pathname, accept = 'application/json') {
  const response = await fetch(new URL(pathname, baseUrl), {
    headers: { accept, 'user-agent': 'ToneryMaxim-Local-Catalog-Check/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  return {
    response,
    text,
    json: accept.includes('json') ? JSON.parse(text) : null,
  };
}

async function waitForCatalog() {
  let last = 'server ešte neodpovedá';
  while (Date.now() < timeoutAt) {
    try {
      const products = await request('/api/products?per_page=1');
      const total = Number(products.json?.total || 0);
      last = `HTTP ${products.response.status}, produkty ${total}`;
      if (products.response.ok && products.json?.ok === true && total >= 100) return products;
      const apiError = String(products.json?.error?.message || products.json?.error || '').trim();
      if (
        apiError
        && /chýba WOO_|WOO_URL|CONSUMER_KEY|CONSUMER_SECRET|401|403|unauthorized|cannot_view|neplatná absolútna URL/i.test(apiError)
      ) {
        throw new Error(`WooCommerce konfigurácia alebo prístup nie je platný: ${apiError}`);
      }
    } catch (error) {
      last = error?.message || String(error);
      if (/WooCommerce konfigurácia alebo prístup nie je platný/i.test(last)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`Produktový katalóg sa nepripravil do 15 minút: ${last}`);
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function stopServer() {
  // Astro 7 môže dev server spustiť ako spravovaný proces a rodičovský npm
  // príkaz ukončiť. Najprv preto použijeme jeho vlastný príkaz stop.
  await new Promise((resolve) => {
    const stopper = npmProcess(['exec', '--', 'astro', 'dev', 'stop']);
    stopper.once('exit', resolve);
    stopper.once('error', resolve);
  }).catch(() => undefined);

  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
  } else {
    server.kill('SIGTERM');
  }
}

async function main() {
  console.log(`[1/7] Spúšťam lokálny e-shop: ${baseUrl}`);
  server = npmProcess(['run', 'dev', '--', '--host', host, '--port', port]);
  server.once('error', (error) => {
    console.error('Lokálny server sa nepodarilo spustiť:', error);
  });

  console.log('[2/7] Čakám na kompletný produktový katalóg z WooCommerce');
  const products = await waitForCatalog();
  const total = Number(products.json.total);
  const first = products.json.products?.[0];
  requireCondition(first?.slug, 'Produktové API nevrátilo použiteľný produkt.');
  console.log(`Katalóg: ${total} produktov.`);

  console.log('[3/7] Kontrolujem vyhľadávanie HP 652');
  const search = await request('/api/smart-search?q=HP%20652');
  const searchCount = Number(search.json?.products?.length || 0)
    + (search.json?.productGroups || []).reduce((sum, group) => sum + Number(group?.products?.length || 0), 0);
  requireCondition(search.response.ok && search.json?.ok && searchCount > 0, 'Vyhľadávanie HP 652 nevrátilo produkt.');

  console.log('[4/7] Kontrolujem modely tlačiarní a detail produktu');
  const printers = await request('/api/printers?brand=Brother&limit=5');
  requireCondition(printers.response.ok && printers.json?.ok && Number(printers.json?.total || 0) > 0, 'Z katalógu sa nenačítali tlačiarne Brother.');
  const detail = await request(`/produkt/${encodeURIComponent(first.slug)}`, 'text/html');
  requireCondition(detail.response.ok && detail.text.includes(String(first.name || '').slice(0, 20)), 'Detail produktu nefunguje.');

  console.log('[5/7] Kontrolujem Merchant feed');
  const merchant = await request('/merchant-feed.xml', 'application/xml');
  const merchantItems = Number(merchant.response.headers.get('x-merchant-feed-items') || 0);
  requireCondition(merchant.response.ok && merchantItems >= 50 && /<g:id>/i.test(merchant.text), `Merchant feed obsahuje iba ${merchantItems} produktov.`);

  console.log('[6/7] Kontrolujem sitemap a robots');
  const sitemap = await request('/sitemap.xml', 'application/xml');
  requireCondition(sitemap.response.ok && /<sitemapindex\b/i.test(sitemap.text), 'Sitemap index nefunguje.');
  const robots = await request('/robots.txt', 'text/plain');
  requireCondition(robots.response.ok && robots.text.includes('https://www.tonerymaxim.sk/sitemap.xml'), 'robots.txt neobsahuje produkčnú sitemapu.');

  console.log('[7/7] HOTOVO: lokálny katalóg, vyhľadávanie, detail, Merchant feed a SEO endpointy fungujú.');
}

main()
  .catch((error) => {
    console.error(`\nLOKÁLNA KONTROLA ZLYHALA: ${error?.stack || error}`);
    process.exitCode = 1;
  })
  .finally(stopServer);
