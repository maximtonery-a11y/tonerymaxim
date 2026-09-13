(function () {
  'use strict';
  var script = document.currentScript;
  var id = String(script && (script.dataset.googleTagId || script.dataset.gtmId) || '').toUpperCase();
  var loaded = false;
  var scheduled = false;
  var fallbackTimer = 0;
  var interactionEvents = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
  if (!/^(G|GT|AW|GTM)-[A-Z0-9]+$/.test(id)) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  var gtag = window.gtag;
  gtag('consent', 'default', {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });

  function load() {
    if (loaded) return;
    loaded = true;
    var tag = document.createElement('script');
    tag.async = true;
    if (/^GTM-/.test(id)) {
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      tag.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(id);
    } else {
      tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
      gtag('js', new Date());
      gtag('config', id, { send_page_view: true });
    }
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
  }

  window.addEventListener('tm:cookies', function (event) { update(event.detail); });
  try { update(JSON.parse(localStorage.getItem('tm_cookie_consent_v10') || 'null')); } catch (_) {}

  // Do not let Google Tag extend the first-render/interactive window. Start it
  // on the customer's first interaction, or use a bounded fallback for a
  // visitor who only reads the page. Calls made before loading stay queued in
  // dataLayer and are replayed by gtag.js/GTM.
  function removeInteractionListeners() {
    interactionEvents.forEach(function (eventName) {
      window.removeEventListener(eventName, start);
    });
  }

  function start() {
    if (scheduled || loaded) return;
    scheduled = true;
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    removeInteractionListeners();

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(load, { timeout: 2000 });
    } else {
      window.setTimeout(load, 0);
    }
  }

  function armFallback() {
    fallbackTimer = window.setTimeout(start, 8000);
  }

  function scheduleLoad() {
    interactionEvents.forEach(function (eventName) {
      window.addEventListener(eventName, start, { once: true, passive: true });
    });

    if (document.readyState === 'complete') armFallback();
    else window.addEventListener('load', armFallback, { once: true });
  }

  scheduleLoad();
})();
