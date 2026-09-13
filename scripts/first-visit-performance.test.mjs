import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cookieSource = await readFile(
  new URL('../src/components/CookieConsent.astro', import.meta.url),
  'utf8',
);
const googleTagSource = await readFile(
  new URL('../public/tm-google-tags.js', import.meta.url),
  'utf8',
);

test('new visitors receive an open cookie panel in the initial HTML', () => {
  assert.match(
    cookieSource,
    /class="tm-cookie-consent tm-cookie-is-open"/,
  );
});

test('cookie consent initialises synchronously instead of waiting for DOMContentLoaded', () => {
  assert.match(cookieSource, /\/\/ All consent markup is already parsed[\s\S]*?\n\s*init\(\);/);
  assert.doesNotMatch(
    cookieSource,
    /document\.addEventListener\("DOMContentLoaded", init/,
  );
});

test('Google tag keeps consent defaults but loads outside the critical path', () => {
  assert.match(googleTagSource, /gtag\('consent', 'default'/);
  assert.match(googleTagSource, /window\.addEventListener\('tm:cookies'/);
  assert.match(googleTagSource, /window\.addEventListener\('load', start, \{ once: true \}\)/);
  assert.match(googleTagSource, /window\.requestIdleCallback\(load, \{ timeout: 2000 \}\)/);
  assert.doesNotMatch(googleTagSource, /\n\s*load\(\);\s*\n\}\)\(\);\s*$/);
});
