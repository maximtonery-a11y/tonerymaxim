// Kept as a small, dependency-free inline script so the menu works before other bundles load.
(() => {
  const drawer = /** @type {HTMLDialogElement|null} */ (document.querySelector('[data-account-drawer]'));
  const nav = document.querySelector('[data-account-mobile-nav]');
  const links = Array.from(document.querySelectorAll('[data-account-nav-link]'));
  const clearPending = () => {
    nav?.removeAttribute('aria-busy');
    links.forEach(link => link.removeAttribute('data-navigation-pending'));
  };
  links.forEach(link => link.addEventListener('click', (event) => {
    const click = /** @type {MouseEvent} */ (event);
    if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
    const target = new URL(link.getAttribute('href') || '', window.location.href);
    if (target.href === window.location.href) {
      event.preventDefault();
      return;
    }
    clearPending();
    link.setAttribute('data-navigation-pending', '');
    nav?.setAttribute('aria-busy', 'true');
  }));
  window.addEventListener('pageshow', clearPending);
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
