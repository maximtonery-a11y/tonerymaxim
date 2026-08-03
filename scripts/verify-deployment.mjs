#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';

function parseArgs(argv) {
  const index = argv.indexOf('--base-url');
  const raw = index >= 0 ? argv[index + 1] : process.env.VERIFY_BASE_URL;
  if (!raw) throw new Error('Zadajte --base-url https://adresa');
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Vzdialené nasadenie sa musí overovať cez HTTPS.');
  const keyIndex = argv.indexOf('--admin-key');
  const adminKey = String(keyIndex >= 0 ? argv[keyIndex + 1] : process.env.TM_VERIFY_ADMIN_KEY || '').trim();
  if (adminKey.length < 24) throw new Error('Pre úplnú kontrolu nastavte TM_VERIFY_ADMIN_KEY na rovnakú hodnotu ako TM_ANALYTICS_ADMIN_KEY v Coolify.');
  return { baseUrl: url.origin, adminKey };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: options.method || 'GET',
    redirect: options.redirect || 'follow',
    headers: {
      accept: options.accept || '*/*',
      'user-agent': 'ToneryMaxim-Release-Check/1.0',
      ...(options.headers || {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeout || 30_000),
  });
  const body = await response.text();
  return { response, body };
}

async function waitForReadiness(baseUrl) {
  let last = 'bez odpovede';
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      const { response, body } = await request(baseUrl, '/api/readiness', { accept: 'application/json' });
      const data = JSON.parse(body);
      last = `HTTP ${response.status}, produkty ${Number(data?.products || 0)}`;
      if (response.ok && data?.ok === true && Number(data?.completeness_ratio || 0) >= 0.99 && data?.cache_fresh === true) return data;
    } catch (error) {
      last = error?.message || String(error);
    }
    if (attempt < 40) await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  throw new Error(`Aplikácia nie je pripravená: ${last}`);
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function productionHealthDiagnostic(response, data) {
  if (response.status === 401) {
    return 'HTTP 401: TM_VERIFY_ADMIN_KEY sa nezhoduje s TM_ANALYTICS_ADMIN_KEY nastaveným v Coolify.';
  }

  if (data?.error) return `HTTP ${response.status}: ${String(data.error)}`;

  const checks = Array.isArray(data?.checks) ? data.checks : [];
  const failed = checks.filter((check) => check?.ok !== true && check?.warning !== true);
  if (failed.length) {
    return failed
      .map((check) => `${String(check?.label || check?.id || 'Kontrola')}: ${String(check?.message || 'bez podrobností')}`)
      .join(' | ');
  }

  return `HTTP ${response.status}; server nevrátil podrobnosti o zlyhanej kontrole.`;
}

function runMigrationGate(baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      'scripts/migration-gate.mjs',
      '--base-url', baseUrl,
      '--concurrency', '12',
      '--timeout-ms', '30000',
    ], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Migration Gate bol ukončený signálom ${signal}.`));
      else if (code !== 0) reject(new Error(`Migration Gate našiel blokujúce URL (exit ${code}).`));
      else resolve();
    });
  });
}

async function main() {
  const { baseUrl, adminKey } = parseArgs(process.argv.slice(2));
  const host = new URL(baseUrl).hostname.toLowerCase();
  const staging = host === 'tonerymaxim.info' || host === 'www.tonerymaxim.info';
  const production = host === 'tonerymaxim.sk' || host === 'www.tonerymaxim.sk';
  requireCondition(staging || production, 'Overovať možno iba tonerymaxim.info alebo tonerymaxim.sk.');

  console.log(`[1/9] Liveness: ${baseUrl}`);
  const health = await request(baseUrl, '/api/health', { accept: 'application/json' });
  const healthJson = JSON.parse(health.body);
  requireCondition(health.response.ok && healthJson?.ok === true, `Liveness zlyhal: HTTP ${health.response.status}`);

  console.log('[2/9] Readiness a úplnosť produktovej cache');
  const readiness = await waitForReadiness(baseUrl);
  console.log(`Produktov pripravených: ${readiness.products}`);

  requireCondition(Number(readiness.products) >= Number(readiness.expected_products), `Cache má ${readiness.products} produktov, minimum je ${readiness.expected_products}.`);

  console.log('[3/9] Produkty a vyhľadávacie API');
  const products = await request(baseUrl, '/api/products?per_page=1', { accept: 'application/json' });
  const productsJson = JSON.parse(products.body);
  requireCondition(products.response.ok && productsJson?.ok === true && Number(productsJson?.total || 0) === Number(readiness.products), 'Produktové API nevrátilo rovnaký kompletný katalóg ako readiness.');

  console.log('[4/9] Serverová ochrana pokladne');
  const checkoutValidation = await request(baseUrl, '/api/order-create', {
    accept: 'application/json',
    method: 'POST',
    body: { cart: [], termsAccepted: false },
  });
  const checkoutValidationJson = JSON.parse(checkoutValidation.body);
  requireCondition(
    checkoutValidation.response.status === 400
      && checkoutValidationJson?.ok === false
      && Array.isArray(checkoutValidationJson?.validationErrors),
    'Objednávkové API nemá aktívnu serverovú validáciu.',
  );

  console.log('[5/9] WooCommerce, SMTP, GoPay a persistentné dáta');
  const productionHealth = await request(baseUrl, '/api/admin-production-health?deep=1', {
    accept: 'application/json',
    headers: { 'x-admin-key': adminKey },
    timeout: 60_000,
  });
  const productionHealthJson = JSON.parse(productionHealth.body);
  if (productionHealth.response.ok && Array.isArray(productionHealthJson?.checks)) {
    productionHealthJson.checks.forEach((check) => {
      const state = check?.ok === true ? 'OK' : check?.warning === true ? 'UPOZORNENIE' : 'CHYBA';
      console.log(`  - ${state}: ${String(check?.label || check?.id || 'Kontrola')} — ${String(check?.message || 'bez podrobností')}`);
    });
  }
  requireCondition(
    productionHealth.response.ok && productionHealthJson?.ok === true,
    `Hlboká produkčná kontrola zlyhala. ${productionHealthDiagnostic(productionHealth.response, productionHealthJson)}`,
  );

  console.log('[6/9] Robots a indexácia domény');
  const home = await request(baseUrl, '/', { accept: 'text/html' });
  const xRobots = String(home.response.headers.get('x-robots-tag') || '');
  if (staging) requireCondition(/noindex/i.test(xRobots), '.info musí mať X-Robots-Tag noindex.');
  if (production) requireCondition(!/noindex/i.test(xRobots), '.sk nesmie mať globálny noindex.');
  const robots = await request(baseUrl, '/robots.txt', { accept: 'text/plain' });
  requireCondition(robots.response.ok, `robots.txt vrátil HTTP ${robots.response.status}.`);
  if (production) requireCondition(robots.body.includes('https://www.tonerymaxim.sk/sitemap.xml'), 'Produkčný robots.txt neobsahuje sitemapu .sk.');
  if (staging) requireCondition(!/Sitemap:/i.test(robots.body), 'Testovacia .info nesmie propagovať sitemapu.');

  console.log('[7/9] Sitemap systém');
  const sitemap = await request(baseUrl, '/sitemap.xml', { accept: 'application/xml' });
  requireCondition(sitemap.response.ok && /<sitemapindex\b/i.test(sitemap.body), 'Sitemap index nie je platný alebo dostupný.');
  requireCondition(sitemap.body.includes('https://www.tonerymaxim.sk/'), 'Sitemap nepoužíva finálnu doménu .sk.');

  console.log('[8/9] Merchant a Google Ads feedy');
  const merchant = await request(baseUrl, '/merchant-feed.xml', { accept: 'application/xml', timeout: 60_000 });
  const merchantItems = Number(merchant.response.headers.get('x-merchant-feed-items') || 0);
  requireCondition(merchant.response.ok && merchantItems >= 50, `Merchant feed má iba ${merchantItems} položiek alebo vrátil chybu.`);
  requireCondition(/<g:availability>in_stock<\/g:availability>/i.test(merchant.body), 'Merchant feed neobsahuje skladové produkty.');
  requireCondition(!/tonerymaxim\.info/i.test(merchant.body), 'Merchant feed obsahuje testovaciu doménu .info.');
  const dsa = await request(baseUrl, '/api/dsa-page-feed.csv', { accept: 'text/csv', timeout: 60_000 });
  requireCondition(dsa.response.ok && dsa.body.includes('https://www.tonerymaxim.sk/produkt/'), 'DSA feed nie je dostupný alebo neobsahuje produktové URL.');

  console.log(`[9/9] Úplný HTTP Migration Gate všetkých starých URL`);
  await runMigrationGate(baseUrl);

  console.log('\nTECHNICKÉ NASADENIE JE OVERENÉ. Pred zmenou DNS ešte vytvorte jednu reálnu testovaciu objednávku na .info.');
}

main().catch((error) => {
  console.error(`\nNASADENIE NIE JE PRIPRAVENÉ: ${error?.stack || error}`);
  process.exitCode = 1;
});
