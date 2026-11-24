// Kept as a small, dependency-free inline script so the menu works before other bundles load.
(() => {
  const drawer = /** @type {HTMLDialogElement|null} */ (document.querySelector('[data-account-drawer]'));
  const nav = document.querySelector('[data-account-mobile-nav]');
  const links = Array.from(document.querySelectorAll('[data-account-nav-link]'));
  let pendingHref = '';
  let pendingTimer = 0;
  const clearPending = () => {
    pendingHref = '';
    window.clearTimeout(pendingTimer);
    nav?.removeAttribute('aria-busy');
    links.forEach(link => { link.removeAttribute('data-navigation-pending'); link.removeAttribute('aria-disabled'); });
  };
  links.forEach(link => link.addEventListener('click', (event) => {
    const click = /** @type {MouseEvent} */ (event);
    if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
    const target = new URL(link.getAttribute('href') || '', window.location.href);
    if (target.href === pendingHref) {
      event.preventDefault();
      return;
    }
    if (target.href === window.location.href && !pendingHref) {
      event.preventDefault();
      if (drawer?.open) drawer.close();
      return;
    }
    clearPending();
    pendingHref = target.href;
    link.setAttribute('data-navigation-pending', '');
    link.setAttribute('aria-disabled', 'true');
    nav?.setAttribute('aria-busy', 'true');
    pendingTimer = window.setTimeout(clearPending, 15000);
  }));
  window.addEventListener('pageshow', clearPending);
  window.addEventListener('pagehide', clearPending);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') clearPending(); });
  if (!drawer) return;
  const triggers = Array.from(document.querySelectorAll('[data-account-drawer-open]'));
  let opener = /** @type {HTMLElement|null} */ (null);
  let previousOverflow = '';
  let scrollX = 0;
  let scrollY = 0;
  for (const control of triggers) {
    const button = /** @type {HTMLButtonElement} */ (control);
    button.addEventListener('click', () => {
      const group = button.dataset.accountDrawerOpen || 'more';
      drawer.querySelectorAll('[data-account-drawer-group]').forEach(section => {
        const element = /** @type {HTMLElement} */ (section);
        element.hidden = element.dataset.accountDrawerGroup !== group;
      });
      const title = drawer.querySelector('h2');
      if (title) title.textContent = group === 'benefits' ? 'Moje výhody' : 'Ďalšie časti účtu';
      opener = button;
      triggers.forEach(trigger => trigger.setAttribute('aria-expanded', String(trigger === button)));
      if (!drawer.open) {
        scrollX = window.scrollX;
        scrollY = window.scrollY;
        previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        drawer.showModal();
      }
    });
  }
  drawer.addEventListener('close', () => {
    document.documentElement.style.overflow = previousOverflow;
    triggers.forEach(button => button.setAttribute('aria-expanded', 'false'));
    opener?.focus({ preventScroll: true });
    // Native dialog focus restoration can scroll a long account page on mobile.
    if (window.scrollX !== scrollX || window.scrollY !== scrollY) window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
  });
  drawer.addEventListener('click', event => {
    if (event.target !== drawer) return;
    const bounds = drawer.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) drawer.close();
  });
  const desktop = window.matchMedia('(min-width: 1101px)');
  desktop.addEventListener('change', () => { if (desktop.matches && drawer.open) drawer.close(); });
})();
