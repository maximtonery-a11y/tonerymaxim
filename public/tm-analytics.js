(function () {
  'use strict';

  var PRIVATE_PATHS = ['/kosik', '/pokladna', '/platba-dokoncena', '/prihlasenie', '/registracia', '/zabudnute-heslo', '/reset-hesla', '/ucet'];
  var started = false;

  function aiSource() {
    var ref = String(document.referrer || '').toLowerCase();
    if (/chatgpt\.com|openai\.com/.test(ref)) return 'chatgpt';
    if (/perplexity\.ai/.test(ref)) return 'perplexity';
    if (/copilot\.microsoft\.com|bing\.com\/chat/.test(ref)) return 'copilot';
    if (/gemini\.google\.com|bard\.google\.com/.test(ref)) return 'gemini';
    if (/claude\.ai|anthropic\.com/.test(ref)) return 'claude';
    if (/you\.com/.test(ref)) return 'you';
    if (/phind\.com/.test(ref)) return 'phind';
    if (/mistral\.ai|chat\.mistral\.ai/.test(ref)) return 'mistral';
    if (/grok\.com|x\.ai/.test(ref)) return 'grok';
    return '';
  }

  function consent() {
    try {
      var value = JSON.parse(localStorage.getItem('tm_cookie_consent_v10') || 'null');
      return !!(value && value.analytics);
    } catch (_) { return false; }
  }

  function privatePage() {
    return PRIVATE_PATHS.some(function (path) {
      return location.pathname === path || location.pathname.indexOf(path + '/') === 0;
    });
  }

  function id(storage, key) {
    try {
      var value = storage.getItem(key);
      if (!value) {
        value = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
        storage.setItem(key, value);
      }
      return value;
    } catch (_) { return String(Date.now()) + Math.random().toString(16).slice(2); }
  }

  function send(type, extra) {
    if (!consent() || privatePage()) return;
    var payload = Object.assign({
      type: type,
      path: location.pathname,
      title: document.title,
      referrer: document.referrer ? new URL(document.referrer, location.origin).origin : '',
      language: navigator.language,
      viewport: innerWidth + 'x' + innerHeight,
      sessionId: id(sessionStorage, 'tm_analytics_session'),
      visitorId: id(localStorage, 'tm_analytics_visitor')
    }, extra || {});

    fetch('/api/analytics', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'X-TM-Analytics-Consent': '1'
      },
      body: JSON.stringify(payload)
    }).catch(function () {});
  }

  function start() {
    if (started || !consent() || privatePage()) return;
    started = true;
    var source = aiSource();
    send('pageview', source ? { meta: { ai_source: source } } : undefined);
    if (source && typeof window.gtag === 'function') {
      window.gtag('event', 'ai_referral_visit', {
        ai_source: source,
        page_path: location.pathname,
        transport_type: 'beacon'
      });
    }
    document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('a,button') : null;
      if (!target) return;
      send('click', { meta: { label: String(target.textContent || '').trim().slice(0, 100) } });
    }, { passive: true });
  }

  window.addEventListener('tm:cookies', function (event) {
    if (event.detail && event.detail.analytics) start();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
