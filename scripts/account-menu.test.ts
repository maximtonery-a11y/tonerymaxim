import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

async function menuFixture() {
  const control = (group: string) => ({ dataset: { accountDrawerOpen: group }, attrs: {} as Record<string, string>, callbacks: {} as Record<string, Function>, focused: false,
    addEventListener(name: string, fn: Function) { this.callbacks[name] = fn; },
    setAttribute(name: string, value: string) { this.attrs[name] = value; }, focus() { this.focused = true; } });
  const triggers = [control('benefits'), control('more')];
  const groups = ['benefits', 'more'].map(group => ({ dataset: { accountDrawerGroup: group }, hidden: true }));
  const title = { textContent: '' };
  const listeners: Record<string, Function> = {};
  const drawer = { open: false,
    querySelectorAll: () => groups, querySelector: () => title,
    addEventListener(name: string, fn: Function) { listeners[name] = fn; },
    showModal() { this.open = true; }, close() { this.open = false; listeners.close?.(); },
    getBoundingClientRect: () => ({ left: 0, top: 200, right: 375, bottom: 812 }),
  };
  const html = { style: { overflow: 'auto' } };
  const media = { matches: false, onChange: () => {}, addEventListener(_name: string, fn: () => void) { this.onChange = fn; } };
  const forbidden = () => { throw new Error('Navigation must not use persistence or HTTP'); };
  const window = { matchMedia: () => media };
  Object.defineProperty(window, 'localStorage', { get: forbidden });
  const source = stripTypeScriptTypes(await readFile(new URL('../src/scripts/account-menu.ts', import.meta.url), 'utf8'));
  vm.runInNewContext(source, { document: { querySelector: () => drawer, querySelectorAll: () => triggers, documentElement: html }, window, fetch: forbidden, localStorage: new Proxy({}, { get: forbidden }) });
  return { triggers, groups, title, drawer, html, media, listeners };
}

test('mobile menu switches groups without accessing customer storage or HTTP', async () => {
  const f = await menuFixture();
  f.triggers[1].callbacks.click();
  assert.equal(f.drawer.open, true);
  assert.equal(f.title.textContent, 'Ďalšie časti účtu');
  assert.deepEqual(f.groups.map(group => group.hidden), [true, false]);
  assert.equal(f.triggers[1].attrs['aria-expanded'], 'true');
  f.triggers[0].callbacks.click();
  assert.deepEqual(f.groups.map(group => group.hidden), [false, true]);
  assert.equal(f.title.textContent, 'Moje výhody');
});

test('closing the drawer restores scrolling, button state and keyboard focus', async () => {
  const f = await menuFixture();
  f.triggers[1].callbacks.click();
  assert.equal(f.html.style.overflow, 'hidden');
  f.drawer.close();
  assert.equal(f.html.style.overflow, 'auto');
  assert.equal(f.triggers[1].attrs['aria-expanded'], 'false');
  assert.equal(f.triggers[1].focused, true);
});

test('return to desktop closes the mobile dialog without losing its existing scroll state', async () => {
  const f = await menuFixture();
  f.triggers[0].callbacks.click();
  f.media.matches = true;
  f.media.onChange();
  assert.equal(f.drawer.open, false);
  assert.equal(f.html.style.overflow, 'auto');
});
