const drawer = document.querySelector<HTMLDialogElement>('[data-account-drawer]');
if (drawer) {
  const triggers = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-account-drawer-open]'));
  let opener: HTMLButtonElement | null = null;
  let previousOverflow = '';
  for (const button of triggers) {
    button.addEventListener('click', () => {
      const group = button.dataset.accountDrawerOpen || 'more';
      drawer.querySelectorAll<HTMLElement>('[data-account-drawer-group]').forEach((section) => {
        section.hidden = section.dataset.accountDrawerGroup !== group;
      });
      const title = drawer.querySelector('h2');
      if (title) title.textContent = group === 'benefits' ? 'Moje výhody' : 'Ďalšie časti účtu';
      opener = button;
      triggers.forEach((trigger) => trigger.setAttribute('aria-expanded', String(trigger === button)));
      if (!drawer.open) {
        previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        drawer.showModal();
      }
    });
  }
  drawer.addEventListener('close', () => {
    document.documentElement.style.overflow = previousOverflow;
    triggers.forEach((button) => button.setAttribute('aria-expanded', 'false'));
    opener?.focus();
  });
  drawer.addEventListener('click', (event) => {
    if (event.target !== drawer) return;
    const bounds = drawer.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) drawer.close();
  });
  const desktop = window.matchMedia('(min-width: 1101px)');
  desktop.addEventListener('change', () => { if (desktop.matches && drawer.open) drawer.close(); });
}
