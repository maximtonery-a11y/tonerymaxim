(function () {
  if (window.__TM_GOOGLE_TAGS__) return;

  var source = document.currentScript;
  var containerId = String(source && source.getAttribute('data-gtm-id') || '').trim().toUpperCase();
  if (!/^GTM-[A-Z0-9]+$/.test(containerId)) return;

  window.__TM_GOOGLE_TAGS__ = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500
  });

  var loaded = false;
  function loadContainer() {
    if (loaded) return;
    loaded = true;
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(containerId);
    document.head.appendChild(script);
  }

  function applyConsent(consent) {
    var analytics = !!(consent && consent.analytics);
    var marketing = !!(consent && consent.marketing);
    window.gtag('consent', 'update', {
      analytics_storage: analytics ? 'granted' : 'denied',
      ad_storage: marketing ? 'granted' : 'denied',
      ad_user_data: marketing ? 'granted' : 'denied',
      ad_personalization: marketing ? 'granted' : 'denied'
    });
    if (analytics || marketing) loadContainer();
  }

  try {
    applyConsent(JSON.parse(window.localStorage.getItem('tm_cookie_consent_v10') || 'null'));
  } catch (_) {}

  window.addEventListener('tm:cookies', function (event) {
    applyConsent(event && event.detail);
  });
})();
