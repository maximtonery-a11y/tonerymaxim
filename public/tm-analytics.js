(function () {
  if (window.__TM_ANALYTICS_V2__) return;
  window.__TM_ANALYTICS_V2__ = true;
  var endpoint = '/api/analytics', pageStartedAt = Date.now(), visibleStartedAt = document.visibilityState === 'visible' ? Date.now() : 0, activeMs = 0;
  var lastPath = location.pathname + location.search, sessionTimeout = 30 * 60 * 1000;
  function id(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12); }
  function read(storage, key) { try { return storage.getItem(key) || ''; } catch (_) { return ''; } }
  function write(storage, key, value) { try { storage.setItem(key, value); } catch (_) {} }
  var visitorId = read(localStorage, 'tm_analytics_visitor') || id('v'); write(localStorage, 'tm_analytics_visitor', visitorId);
  var sessionId = read(sessionStorage, 'tm_analytics_session'), lastActivity = Number(read(sessionStorage, 'tm_analytics_last') || 0);
  if (!sessionId || Date.now() - lastActivity > sessionTimeout) sessionId = id('s');
  write(sessionStorage, 'tm_analytics_session', sessionId); write(sessionStorage, 'tm_analytics_last', String(Date.now()));
  function device() { var w = innerWidth || 0; return w < 768 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop'; }
  function collectActive() { if (visibleStartedAt) { activeMs += Math.max(0, Date.now() - visibleStartedAt); visibleStartedAt = Date.now(); } }
  function send(type, extra) {
    try {
      collectActive(); write(sessionStorage, 'tm_analytics_last', String(Date.now()));
      var payload = Object.assign({ type:type, path:location.pathname || '/', url:location.href, title:document.title || '', referrer:document.referrer || '', viewport:(innerWidth||0)+'x'+(innerHeight||0), device:device(), language:navigator.language||'', sessionId:sessionId, visitorId:visitorId, activeMs:activeMs }, extra || {});
      activeMs = 0;
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) { navigator.sendBeacon(endpoint, new Blob([body], {type:'application/json'})); return; }
      fetch(endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body:body, keepalive:true, credentials:'same-origin'}).catch(function(){});
    } catch (_) {}
  }
  function pageview() { pageStartedAt = Date.now(); activeMs = 0; visibleStartedAt = document.visibilityState === 'visible' ? Date.now() : 0; lastPath = location.pathname + location.search; send('pageview'); }
  pageview();
  var heartbeat = setInterval(function(){ if (document.visibilityState === 'visible') send('heartbeat', {activeMs:30000}); }, 30000);
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'hidden') { collectActive(); visibleStartedAt = 0; send('page_duration', {durationMs:Date.now()-pageStartedAt}); }
    else visibleStartedAt = Date.now();
  });
  window.addEventListener('pagehide', function(){ clearInterval(heartbeat); send('page_duration', {durationMs:Date.now()-pageStartedAt}); });
  var push = history.pushState, replace = history.replaceState;
  function route(){ setTimeout(function(){ var p=location.pathname+location.search; if(p!==lastPath){ send('page_duration',{durationMs:Date.now()-pageStartedAt}); pageview(); } },50); }
  history.pushState=function(){ push.apply(history,arguments); route(); }; history.replaceState=function(){ replace.apply(history,arguments); route(); }; addEventListener('popstate',route);
  document.addEventListener('submit', function(e){ var f=e.target; if(!f||!f.querySelector)return; var i=f.querySelector('input[type="search"],input[name="search"],input[name="s"],input[name="q"]'); if(i&&i.value)send('search',{search:i.value}); }, true);
  document.addEventListener('click', function(e){ var t=e.target&&e.target.closest?e.target.closest('a,button,[role="button"]'):null;if(!t)return;var text=String(t.getAttribute('aria-label')||t.textContent||'').replace(/\s+/g,' ').trim().slice(0,180),href=t.getAttribute('href')||'';if(href.indexOf('/produkt/')>=0)send('product_click',{product:text,meta:{href:href}});if(/do košíka|pridať/i.test(text))send('add_to_cart',{product:text});if(href.indexOf('/pokladna')>=0)send('checkout_start');if(/objednať/i.test(text))send('order_submit'); },true);
})();
