(function () {
  'use strict';
  var script = document.currentScript;
  var id = String(script && script.dataset.gtmId || '').toUpperCase();
  var loaded = false;
  if (!/^GTM-[A-Z0-9]+$/.test(id)) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag('consent', 'default', {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500
  });

  function load() {
    if (loaded) return;
    loaded = true;
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    var tag = document.createElement('script');
    tag.async = true;
    tag.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(id);
    document.head.appendChild(tag);
  }

  function update(value) {
    value = value || {};
    gtag('consent', 'update', {
      analytics_storage: value.analytics ? 'granted' : 'denied',
      ad_storage: value.marketing ? 'granted' : 'denied',
      ad_user_data: value.marketing ? 'granted' : 'denied',
      ad_personalization: value.marketing ? 'granted' : 'denied'
    });
    if (value.analytics || value.marketing) load();
  }

  window.addEventListener('tm:cookies', function (event) { update(event.detail); });
  try { update(JSON.parse(localStorage.getItem('tm_cookie_consent_v10') || 'null')); } catch (_) {}
})();
