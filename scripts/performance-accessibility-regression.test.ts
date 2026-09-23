import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('middleware keeps background workers outside the cold storefront import path', async () => {
  const middleware = await read('src/middleware.ts');
  assert.doesNotMatch(middleware, /^import .*\.\/lib\/(?:toner-care|email-queue|firmware-info|nightly-price-worker)/m);
  for (const module of ['toner-care', 'email-queue', 'firmware-info', 'nightly-price-worker']) {
    assert.match(middleware, new RegExp(`import\\(['\"]\\./lib/${module}['\"]\\)`));
  }
  assert.match(middleware, /setTimeout\(async \(\) =>/);
});

test('product LCP image is preloaded and remains eager after client hydration', async () => {
  const page = await read('src/pages/produkt/[slug].astro');
  const detail = await read('src/scripts/product-detail.js');
  assert.match(page, /rel="preload" as="image" href=\{primaryImage\} fetchpriority="high"/);
  assert.match(page, /loading="eager" decoding="async" fetchpriority="high"/);
  assert.match(detail, /class="tm-product-fit-image" width="640" height="640" loading="eager" decoding="async" fetchpriority="high"/);
});

test('product controls expose names, labels and valid gallery semantics', async () => {
  const detail = await read('src/scripts/product-detail.js');
  assert.match(detail, /class="thumbs" role="group" aria-label="Galéria produktu"/);
  assert.match(detail, /aria-label="Zobraziť obrázok produktu \$\{index \+ 1\}"/);
  assert.match(detail, /<label for="tm-product-quantity">Množstvo<\/label>/);
  assert.match(detail, /id="tm-product-quantity"/);
  assert.match(detail, /data-qty-minus aria-label="Znížiť množstvo"/);
  assert.match(detail, /data-qty-plus aria-label="Zvýšiť množstvo"/);
});

test('smart search uses a connected combobox and listbox', async () => {
  const smartSearch = await read('src/scripts/smart-search.js');
  assert.match(smartSearch, /panel\.setAttribute\("role", "listbox"\)/);
  assert.match(smartSearch, /input\.setAttribute\("role", "combobox"\)/);
  assert.match(smartSearch, /input\.setAttribute\("aria-controls", panel\.id\)/);
});

test('printer pages contain one H1 while preserving the mobile heading as H2', async () => {
  for (const path of ['src/pages/tlaciarne.astro', 'src/pages/tlaciarne/[brand].astro']) {
    const source = await read(path);
    assert.equal((source.match(/<h1(?:\s|>)/g) || []).length, 1, path);
    assert.match(source, /<h2>(?:Značka tlačiarne|Najčastejšie hľadané tlačiarne)/);
  }
});

test('responsive WebP logos stay below 20 KiB', async () => {
  for (const path of ['src/assets/tonerymaxim-logo-420.webp', 'src/assets/tonerymaxim-logo-840.webp']) {
    const info = await stat(new URL(`../${path}`, import.meta.url));
    assert.ok(info.size < 20 * 1024, `${path}: ${info.size} B`);
  }
});

test('responsive logo markup keeps intrinsic ratio and high-density sources', async () => {
  const header = await read('src/components/Header.astro');
  const globalCss = await read('src/styles/global.css');
  const home = await read('src/pages/index.astro');

  assert.match(header, /srcset=\{`\$\{logo420\.src\} 420w, \$\{mobileLogo\.src\} 840w`\}/);
  assert.match(header, /width="1270" height="222"/);
  assert.match(globalCss, /\.site-logo\s*\{[^}]*height:\s*auto;[^}]*aspect-ratio:\s*1270\s*\/\s*222;[^}]*object-fit:\s*contain;/s);
  assert.match(home, /srcset=\{`\$\{logo420\.src\} 420w, \$\{mobileLogo\.src\} 840w`\}/);
});

test('homepage help image keeps source pixels and cannot be stretched', async () => {
  const home = await read('src/pages/index.astro');
  const homeCss = await read('src/styles/home-mobile.css');

  assert.match(home, /src=\{tmHelpVisual\.src\}/);
  assert.match(home, /width=\{tmHelpVisual\.width\} height=\{tmHelpVisual\.height\}/);
  assert.match(homeCss, /\.tm-mobile-help-card-image\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;/s);
  assert.match(homeCss, /\.tm-mobile-help-card-image\s*\{[^}]*max-height:\s*160px;[^}]*object-fit:\s*contain;/s);
});
