// Critical feedback only: native links and details own navigation and opening.
(() => {
  const nav = document.querySelector('[data-account-mobile-nav]');
  const menu = /** @type {HTMLDetailsElement|null} */ (document.querySelector('[data-account-more]'));
  if (!nav || !menu) return;
  const links = Array.from(nav.querySelectorAll('[data-account-nav-link]'));
  const clearPending = () => {
    nav.removeAttribute('aria-busy');
    links.forEach(link => link.removeAttribute('data-navigation-pending'));
  };
  const close = (restoreFocus = false) => {
    menu.open = false;
    if (restoreFocus) menu.querySelector('summary')?.focus({ preventScroll: true });
  };
  links.forEach(link => link.addEventListener('click', (event) => {
    const click = /** @type {MouseEvent} */ (event);
    if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
    clearPending();
    link.setAttribute('data-navigation-pending', '');
    nav.setAttribute('aria-busy', 'true');
    // Never cancel, disable, queue or replace a native navigation.
  }));
  menu.querySelector('[data-account-more-close]')?.addEventListener('click', () => close(true));
  document.addEventListener('pointerdown', event => { if (menu.open && !menu.contains(event.target)) close(); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape') { close(true); clearPending(); } });
  window.addEventListener('pageshow', () => { clearPending(); close(); });
  window.addEventListener('pagehide', clearPending);
  window.matchMedia('(min-width: 1101px)').addEventListener('change', event => { if (event.matches) close(); });
})();
