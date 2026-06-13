/* ToneryMaxim device layout helper
   Cieľ: telefón zostane v mobilnom režime aj po otočení na šírku.
   Triedy:
   - tm-device-mobile
   - tm-device-mobile-landscape
   - tm-device-tablet
   - tm-device-desktop
*/

const DEVICE_CLASSES = [
  'tm-device-mobile',
  'tm-device-mobile-portrait',
  'tm-device-mobile-landscape',
  'tm-device-tablet',
  'tm-device-tablet-portrait',
  'tm-device-tablet-landscape',
  'tm-device-desktop',
];

function getDeviceState() {
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const height = window.innerHeight || document.documentElement.clientHeight || 0;
  const shortestSide = Math.min(width, height);
  const isLandscape = width > height;
  const isCoarsePointer = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const isFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Telefón: rozhoduje hlavne touch zariadenie + kratšia strana.
  // Preto iPhone/Android po otočení na šírku nespadne do desktopu.
  const isPhone = (isCoarsePointer && shortestSide <= 600) || (!isFinePointer && width < 760);
  const isTablet = !isPhone && ((isCoarsePointer && shortestSide > 600) || (width >= 760 && width < 1180));
  const isDesktop = !isPhone && !isTablet;

  if (isPhone) {
    return isLandscape ? 'mobile-landscape' : 'mobile-portrait';
  }

  if (isTablet) {
    return isLandscape ? 'tablet-landscape' : 'tablet-portrait';
  }

  return 'desktop';
}

function applyDeviceClasses() {
  const state = getDeviceState();
  const targets = [document.documentElement, document.body].filter(Boolean);

  for (const target of targets) {
    target.classList.remove(...DEVICE_CLASSES);

    if (state === 'mobile-portrait') {
      target.classList.add('tm-device-mobile', 'tm-device-mobile-portrait');
    } else if (state === 'mobile-landscape') {
      target.classList.add('tm-device-mobile', 'tm-device-mobile-landscape');
    } else if (state === 'tablet-portrait') {
      target.classList.add('tm-device-tablet', 'tm-device-tablet-portrait');
    } else if (state === 'tablet-landscape') {
      target.classList.add('tm-device-tablet', 'tm-device-tablet-landscape');
    } else {
      target.classList.add('tm-device-desktop');
    }
  }
}

let resizeTimer;
function scheduleDeviceUpdate() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(applyDeviceClasses, 80);
}

applyDeviceClasses();
window.addEventListener('resize', scheduleDeviceUpdate, { passive: true });
window.addEventListener('orientationchange', scheduleDeviceUpdate, { passive: true });

// Mobilný hamburger v headri.
document.addEventListener('click', (event) => {
  const toggle = event.target.closest?.('[data-mobile-menu-toggle]');
  const drawer = document.querySelector('[data-mobile-drawer]');

  if (toggle && drawer) {
    const isOpen = drawer.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    return;
  }

  if (drawer && drawer.classList.contains('is-open') && !event.target.closest?.('[data-mobile-drawer]')) {
    drawer.classList.remove('is-open');
    document.querySelector('[data-mobile-menu-toggle]')?.setAttribute('aria-expanded', 'false');
  }
});
