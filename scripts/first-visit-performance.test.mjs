import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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

test('Google tag keeps consent defaults and waits for interaction or a bounded fallback', () => {
  assert.match(googleTagSource, /gtag\('consent', 'default'/);
  assert.match(googleTagSource, /window\.addEventListener\('tm:cookies'/);
  assert.match(googleTagSource, /window\.addEventListener\(eventName, start, \{ once: true, passive: true \}\)/);
  assert.match(googleTagSource, /window\.setTimeout\(start, 8000\)/);
  assert.match(googleTagSource, /window\.addEventListener\('load', armFallback, \{ once: true \}\)/);
  assert.match(googleTagSource, /window\.requestIdleCallback\(load, \{ timeout: 2000 \}\)/);
  assert.doesNotMatch(googleTagSource, /\n\s*load\(\);\s*\n\}\)\(\);\s*$/);
});

function executeGoogleTag() {
  const handlers = new Map();
  const timers = [];
  const idleCallbacks = [];
  const appended = [];
  const window = {
    dataLayer: [],
    addEventListener(name, callback) { handlers.set(name, callback); },
    removeEventListener(name, callback) {
      if (handlers.get(name) === callback) handlers.delete(name);
    },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
    requestIdleCallback(callback, options) { idleCallbacks.push({ callback, options }); },
    localStorage: { getItem() { return null; } },
  };
  const document = {
    currentScript: { dataset: { googleTagId: 'G-TEST123' } },
    readyState: 'loading',
    createElement() { return {}; },
    head: { appendChild(node) { appended.push(node); } },
  };
  vm.runInNewContext(googleTagSource, { window, document, JSON, Date, encodeURIComponent });
  return { handlers, timers, idleCallbacks, appended };
}

test('Google tag loads once after the first customer interaction', () => {
  const runtime = executeGoogleTag();
  assert.equal(runtime.appended.length, 0);
  assert.equal(typeof runtime.handlers.get('pointerdown'), 'function');

  runtime.handlers.get('pointerdown')();
  assert.equal(runtime.idleCallbacks.length, 1);
  runtime.idleCallbacks[0].callback();
  assert.equal(runtime.appended.length, 1);
  assert.equal(runtime.appended[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-TEST123');

  runtime.idleCallbacks[0].callback();
  assert.equal(runtime.appended.length, 1);
});

test('Google tag retains an eight-second fallback for passive visitors', () => {
  const runtime = executeGoogleTag();
  runtime.handlers.get('load')();
  assert.equal(runtime.timers.length, 1);
  assert.equal(runtime.timers[0].delay, 8000);
  assert.equal(runtime.appended.length, 0);

  runtime.timers[0].callback();
  runtime.idleCallbacks[0].callback();
  assert.equal(runtime.appended.length, 1);
});
