(function () {
  var started = false;
  var consentKey = 'tm_cookie_consent_v10';

  function analyticsAllowed() {
    try {
      var consent = JSON.parse(window.localStorage.getItem(consentKey) || 'null');
      return !!(consent && consent.analytics);
    } catch (_) {
      return false;
    }
  }

  function startAnalytics() {
  if (started || window.__TM_ANALYTICS_V3__) return;
  started = true;
  window.__TM_ANALYTICS_V3__ = true;

  var endpoint = '/api/analytics';
  var pageStartedAt = Date.now();
  var visibleStartedAt = document.visibilityState === 'visible' ? Date.now() : 0;
  var activeMs = 0;
  var lastPath = location.pathname + location.search;
  var sessionTimeout = 30 * 60 * 1000;
  var sentScroll = {};

  function id(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12); }
  function read(storage, key) { try { return storage.getItem(key) || ''; } catch (_) { return ''; } }
  function write(storage, key, value) { try { storage.setItem(key, value); } catch (_) {} }
  function text(value, max) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
  function device() { var w = innerWidth || 0; return w < 768 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop'; }
  function collectActive() { if (visibleStartedAt) { activeMs += Math.max(0, Date.now() - visibleStartedAt); visibleStartedAt = Date.now(); } }
  function paramsMeta() {
    var q = new URLSearchParams(location.search);
    var refQuery = '';
    try {
      var ref = new URL(document.referrer || '');
      if (/google\./i.test(ref.hostname)) refQuery = ref.searchParams.get('q') || '';
    } catch (_) {}
    return {
      utm_source: q.get('utm_source') || '', utm_medium: q.get('utm_medium') || '', utm_campaign: q.get('utm_campaign') || '',
      utm_term: q.get('utm_term') || '', utm_content: q.get('utm_content') || '', gclid: q.get('gclid') || '',
      google_query: refQuery, returning: read(localStorage, 'tm_analytics_seen') ? '1' : '0'
    };
  }

  var visitorId = read(localStorage, 'tm_analytics_visitor') || id('v');
  write(localStorage, 'tm_analytics_visitor', visitorId);
  var sessionId = read(sessionStorage, 'tm_analytics_session');
  var lastActivity = Number(read(sessionStorage, 'tm_analytics_last') || 0);
  if (!sessionId || Date.now() - lastActivity > sessionTimeout) sessionId = id('s');
  write(sessionStorage, 'tm_analytics_session', sessionId);
  write(sessionStorage, 'tm_analytics_last', String(Date.now()));

  function send(type, extra) {
    try {
      collectActive();
      write(sessionStorage, 'tm_analytics_last', String(Date.now()));
      var payload = Object.assign({
        type: type, path: location.pathname || '/', url: location.href, title: document.title || '', referrer: document.referrer || '',
        viewport: (innerWidth || 0) + 'x' + (innerHeight || 0), device: device(), language: navigator.language || '',
        sessionId: sessionId, visitorId: visitorId, activeMs: activeMs
      }, extra || {});
      activeMs = 0;
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) { navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' })); return; }
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true, credentials: 'same-origin' }).catch(function () {});
    } catch (_) {}
  }

  function pageview() {
    pageStartedAt = Date.now(); activeMs = 0; sentScroll = {};
    visibleStartedAt = document.visibilityState === 'visible' ? Date.now() : 0;
    lastPath = location.pathname + location.search;
    send('pageview', { meta: paramsMeta() });
    write(localStorage, 'tm_analytics_seen', '1');
    if (location.pathname.indexOf('/platba-dokoncena') === 0) {
      var q = new URLSearchParams(location.search);
      send('order_complete', { value: Number((document.body.textContent.match(/([0-9]+[,.][0-9]{2})\s*€/i) || [])[1]?.replace(',', '.') || 0), meta: { order_number: q.get('order') || '', payment_id: q.get('id') || '', method: q.get('method') || '' } });
    }
  }

  pageview();
  var heartbeat = setInterval(function () { if (document.visibilityState === 'visible') send('heartbeat', { activeMs: 30000 }); }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { collectActive(); visibleStartedAt = 0; send('page_duration', { durationMs: Date.now() - pageStartedAt }); }
    else visibleStartedAt = Date.now();
  });
  window.addEventListener('pagehide', function () { clearInterval(heartbeat); send('page_duration', { durationMs: Date.now() - pageStartedAt }); });

  var push = history.pushState, replace = history.replaceState;
  function route() { setTimeout(function () { var p = location.pathname + location.search; if (p !== lastPath) { send('page_duration', { durationMs: Date.now() - pageStartedAt }); pageview(); } }, 50); }
  history.pushState = function () { push.apply(history, arguments); route(); };
  history.replaceState = function () { replace.apply(history, arguments); route(); };
  addEventListener('popstate', route);

  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f || !f.querySelector) return;
    var i = f.querySelector('input[type="search"],input[name="search"],input[name="s"],input[name="q"]');
    if (i && i.value) send('search', { search: text(i.value, 200) });
  }, true);

  document.addEventListener('change', function (e) {
    var input = e.target;
    if (!input || !input.matches) return;
    if (input.matches('input[name="shipping"]:checked')) send('shipping_select', { meta: { value: input.value, label: text(input.closest('label,.shipping-option')?.textContent, 180) } });
    if (input.matches('input[name="payment"]:checked')) send('payment_select', { meta: { value: input.value, label: text(input.closest('label,.payment-option')?.textContent, 180) } });
  }, true);

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('a,button,[role="button"]') : null;
    if (!t) return;
    var label = text(t.getAttribute('aria-label') || t.textContent || '', 180);
    var href = t.getAttribute('href') || '';
    send('click', { meta: { label: label, href: href } });
    if (href.indexOf('/produkt/') >= 0) send('product_click', { product: label, meta: { href: href } });
    if (/do košíka|pridať/i.test(label)) send('add_to_cart', { product: label });
    if (/odstrániť/i.test(label) && location.pathname.indexOf('/kosik') === 0) send('remove_from_cart', { product: label });
    if (href.indexOf('/pokladna') >= 0 || /pokračovať do pokladne/i.test(label)) send('checkout_start');
    if (/objednať s povinnosťou platby/i.test(label)) send('order_submit');
  }, true);

  addEventListener('scroll', function () {
    var max = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - innerHeight;
    if (max <= 0) return;
    var percent = Math.min(100, Math.round((scrollY / max) * 100));
    [25, 50, 75, 100].forEach(function (mark) { if (percent >= mark && !sentScroll[mark]) { sentScroll[mark] = true; send('scroll', { value: mark }); } });
  }, { passive: true });
  }

  if (analyticsAllowed()) startAnalytics();
  window.addEventListener('tm:cookies', function (event) {
    if (event && event.detail && event.detail.analytics) startAnalytics();
  });
})();
