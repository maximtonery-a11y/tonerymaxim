import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function menuFixture() {
  const control = () => ({ attrs: {} as Record<string, string>, callbacks: {} as Record<string, Function>, focused: false,
    focusOptions: undefined as undefined | { preventScroll: boolean },
    addEventListener(name: string, fn: Function) { this.callbacks[name] = fn; },
    setAttribute(name: string, value: string) { this.attrs[name] = value; },
    removeAttribute(name: string) { delete this.attrs[name]; },
    focus(options: { preventScroll: boolean }) { this.focused = true; this.focusOptions = options; } });
  const links = [control(), control(), control()];
  const summary = control(), closeButton = control();
  const nav = { ...control(), querySelectorAll: () => links };
  const menu = { open: true, contains: (target: unknown) => target === summary,
    querySelector: (selector: string) => selector === 'summary' ? summary : closeButton };
  const listeners: Record<string, Function> = {};
  const documentListeners: Record<string, Function> = {};
  const media = { onChange: (_event: { matches: boolean }) => {}, addEventListener(_name: string, fn: typeof this.onChange) { this.onChange = fn; } };
  const forbidden = () => { throw new Error('Menu must not use storage, HTTP, timers or scrolling'); };
  const window = { matchMedia: () => media, addEventListener(name: string, fn: Function) { listeners[name] = fn; },
    scrollTo: forbidden, setTimeout: forbidden };
  const source = await readFile(new URL('../src/scripts/account-menu.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { document: { querySelector: (s: string) => s === '[data-account-more]' ? menu : nav,
    addEventListener(name: string, fn: Function) { documentListeners[name] = fn; } }, window, fetch: forbidden,
    localStorage: new Proxy({}, { get: forbidden }) });
  return { links, nav, menu, summary, closeButton, listeners, documentListeners, media };
}
const click = (extra = {}) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
  preventDefault() { this.defaultPrevented = true; }, ...extra });

test('native links receive immediate feedback without disabling or cancelling navigation', async () => {
  const f = await menuFixture();
  for (let i = 0; i < 3; i++) {
    const event = click(); f.links[2].callbacks.click(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(f.links[2].attrs['aria-disabled'], undefined);
    assert.equal(f.links[2].attrs['data-navigation-pending'], '');
  }
  assert.equal(f.nav.attrs['aria-busy'], 'true');
});
test('a different destination replaces feedback and browser Back clears it', async () => {
  const f = await menuFixture();
  f.links[0].callbacks.click(click()); f.links[1].callbacks.click(click());
  assert.equal(f.links[0].attrs['data-navigation-pending'], undefined);
  f.listeners.pageshow();
  assert.equal(f.nav.attrs['aria-busy'], undefined);
  assert.equal(f.links[1].attrs['data-navigation-pending'], undefined);
  assert.equal(f.menu.open, false);
});
test('modified and already handled clicks retain their browser behavior', async () => {
  const f = await menuFixture();
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    const event = click(extra); f.links[0].callbacks.click(event);
    assert.equal(f.nav.attrs['aria-busy'], undefined);
  }
});
test('Escape and explicit close restore focus without locking or scrolling the page', async () => {
  const f = await menuFixture();
  f.closeButton.callbacks.click();
  assert.equal(f.menu.open, false); assert.equal(f.summary.focusOptions?.preventScroll, true);
  f.menu.open = true; f.listeners.keydown({ key: 'Escape' });
  assert.equal(f.menu.open, false);
});
test('outside interaction and returning to desktop close the native disclosure', async () => {
  const f = await menuFixture();
  f.documentListeners.pointerdown({ target: f.summary }); assert.equal(f.menu.open, true);
  f.documentListeners.pointerdown({ target: {} }); assert.equal(f.menu.open, false);
  f.menu.open = true; f.media.onChange({ matches: true }); assert.equal(f.menu.open, false);
});
