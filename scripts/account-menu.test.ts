import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function menuFixture() {
  const control = (group: string) => ({ dataset: { accountDrawerOpen: group }, attrs: {} as Record<string, string>, callbacks: {} as Record<string, Function>, focused: false,
    focusOptions: undefined as undefined | { preventScroll: boolean },
    addEventListener(name: string, fn: Function) { this.callbacks[name] = fn; },
    setAttribute(name: string, value: string) { this.attrs[name] = value; },
    removeAttribute(name: string) { delete this.attrs[name]; },
    getAttribute(name: string) { return this.attrs[name] ?? null; },
    focus(options: { preventScroll: boolean }) { this.focused = true; this.focusOptions = options; } });
  const triggers = [control('benefits'), control('more')];
  const nav = control('nav');
  const links = ['/ucet', '/ucet/objednavky', '/ucet/tlaciarne'].map(href => { const link = control('link'); link.attrs.href = href; return link; });
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
  const windowListeners: Record<string, Function> = {};
  const window = { matchMedia: () => media, location: { href: 'https://shop.example/ucet/objednavky' }, scrollX: 0, scrollY: 640,
    addEventListener(name: string, fn: Function) { windowListeners[name] = fn; },
    scrollTo(options: { left: number; top: number; behavior: string }) { this.scrollX = options.left; this.scrollY = options.top; } };
  Object.defineProperty(window, 'localStorage', { get: forbidden });
  const source = await readFile(new URL('../src/scripts/account-menu.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { URL, document: { querySelector: (selector: string) => selector === '[data-account-drawer]' ? drawer : nav, querySelectorAll: (selector: string) => selector === '[data-account-nav-link]' ? links : triggers, documentElement: html }, window, fetch: forbidden, localStorage: new Proxy({}, { get: forbidden }) });
  return { triggers, groups, title, drawer, html, media, listeners, nav, links, window, windowListeners };
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
  assert.equal(f.triggers[1].focusOptions?.preventScroll, true);
});

const click = (extra = {}) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
  preventDefault() { this.defaultPrevented = true; }, ...extra });

test('navigation gives feedback synchronously while leaving native navigation intact', async () => {
  const f = await menuFixture();
  const event = click();
  f.links[2].callbacks.click(event);
  assert.equal(f.nav.attrs['aria-busy'], 'true');
  assert.equal(f.links[2].attrs['data-navigation-pending'], '');
  assert.equal(event.defaultPrevented, false);
});

test('tapping the current section does not reload it or start a request', async () => {
  const f = await menuFixture();
  const event = click();
  f.links[1].callbacks.click(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.nav.attrs['aria-busy'], undefined);
});

test('modified clicks retain browser behavior and back navigation clears pending feedback', async () => {
  const f = await menuFixture();
  f.links[0].callbacks.click(click({ ctrlKey: true }));
  assert.equal(f.nav.attrs['aria-busy'], undefined);
  f.links[0].callbacks.click(click());
  f.links[2].callbacks.click(click());
  assert.equal(f.links[0].attrs['data-navigation-pending'], undefined);
  f.windowListeners.pageshow();
  assert.equal(f.nav.attrs['aria-busy'], undefined);
  assert.equal(f.links[2].attrs['data-navigation-pending'], undefined);
});

test('closing after native focus scrolling restores the original account position', async () => {
  const f = await menuFixture();
  f.triggers[1].callbacks.click();
  f.window.scrollY = 0;
  f.drawer.close();
  assert.equal(f.window.scrollY, 640);
  assert.equal(f.html.style.overflow, 'auto');
});

test('return to desktop closes the mobile dialog without losing its existing scroll state', async () => {
  const f = await menuFixture();
  f.triggers[0].callbacks.click();
  f.media.matches = true;
  f.media.onChange();
  assert.equal(f.drawer.open, false);
  assert.equal(f.html.style.overflow, 'auto');
});
