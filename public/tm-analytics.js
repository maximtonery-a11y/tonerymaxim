(function () {
  if (window.__TM_ANALYTICS_V1__) return;
  window.__TM_ANALYTICS_V1__ = true;

  var endpoint = '/api/analytics';
  var startedAt = Date.now();
  var lastPath = location.pathname + location.search;

  function device() {
    var width = window.innerWidth || 0;
    if (width < 768) return 'mobile';
    if (width < 1100) return 'tablet';
    return 'desktop';
  }

  function send(type, extra) {
    try {
      var payload = Object.assign({
        type: type,
        path: location.pathname || '/',
        url: location.href,
        title: document.title || '',
        referrer: document.referrer || '',
        viewport: (window.innerWidth || 0) + 'x' + (window.innerHeight || 0),
        device: device(),
        language: navigator.language || ''
      }, extra || {});

      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
        return;
      }

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        credentials: 'same-origin'
      }).catch(function () {});
    } catch (e) {}
  }

  function getText(element) {
    if (!element) return '';
    return String(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }

  function findProductName(element) {
    var card = element.closest('[data-product-card], .product-card, .catalog-product, .pd-main, article, li');
    if (!card) return getText(element);
    var title = card.querySelector('h1,h2,h3,.product-title,.catalog-title,[data-product-title]');
    return getText(title) || getText(element);
  }

  function trackPageview() {
    startedAt = Date.now();
    lastPath = location.pathname + location.search;
    send('pageview');
    if (location.pathname.indexOf('/pokladna') === 0) send('checkout_start');
    if (location.pathname.indexOf('/platba-dokoncena') === 0) send('payment_return');
  }

  trackPageview();

  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('a,button,[role="button"]') : null;
    if (!target) return;

    var href = target.getAttribute('href') || '';
    var label = getText(target);

    if (href.indexOf('/produkt/') !== -1 || target.closest('[data-product-card], .catalog-product, .product-card')) {
      send('product_click', { product: findProductName(target), meta: { href: href } });
    }

    if (href.indexOf('/kosik') !== -1) send('cart_open', { meta: { label: label } });
    if (href.indexOf('/pokladna') !== -1) send('checkout_start', { meta: { label: label } });

    var lower = label.toLowerCase();
    if (lower.indexOf('do košíka') !== -1 || lower.indexOf('pridať') !== -1 || target.hasAttribute('data-add-to-cart')) {
      send('add_to_cart', { product: findProductName(target) });
    }

    if (target.matches('[data-submit-order], [data-mobile-submit-order]') || lower.indexOf('objednať') !== -1) {
      send('order_submit');
    }
  }, true);

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.querySelector) return;
    var input = form.querySelector('input[type="search"], input[name="search"], input[name="s"], input[name="q"], input[placeholder*="Hľadať"], input[placeholder*="hľadať"]');
    if (input && input.value) send('search', { search: input.value });
  }, true);

  var pushState = history.pushState;
  var replaceState = history.replaceState;
  function onRouteChange() {
    setTimeout(function () {
      var current = location.pathname + location.search;
      if (current !== lastPath) trackPageview();
    }, 50);
  }
  history.pushState = function () { pushState.apply(history, arguments); onRouteChange(); };
  history.replaceState = function () { replaceState.apply(history, arguments); onRouteChange(); };
  window.addEventListener('popstate', onRouteChange);

  function sendDuration(type) {
    var duration = Date.now() - startedAt;
    if (duration > 1000) send(type, { durationMs: duration });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendDuration('page_duration');
  });
  window.addEventListener('pagehide', function () { sendDuration('page_duration'); });
})();
