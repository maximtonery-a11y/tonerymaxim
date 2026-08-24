(function () {
  'use strict';

  var CART_KEY = 'tm_cart_v1';
  var CURRENCY = 'EUR';

  function readJson(storage, key) {
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch (_) { return null; }
  }

  function item(raw, quantity) {
    raw = raw || {};
    return {
      item_id: String(raw.sku || raw.id || raw.slug || '').slice(0, 100),
      item_name: String(raw.name || 'Produkt').slice(0, 200),
      item_category: String(raw.product_type_label || raw.product_type_key || '').slice(0, 100),
      price: Number(raw.price || 0),
      quantity: Math.max(1, Number(quantity || raw.qty || 1))
    };
  }

  function items(rawItems) {
    return (Array.isArray(rawItems) ? rawItems : []).map(function (entry) {
      return item(entry, entry && entry.qty);
    }).filter(function (entry) { return entry.item_id && entry.price >= 0; });
  }

  function valueOf(list) {
    return Math.round(list.reduce(function (sum, entry) {
      return sum + Number(entry.price || 0) * Number(entry.quantity || 1);
    }, 0) * 100) / 100;
  }

  function emit(name, params) {
    params = Object.assign({ currency: CURRENCY }, params || {});
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, params);
      return;
    }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: name, ecommerce: params });
  }

  function emitOwn(name, params) {
    if (typeof window.tmTrackAnalytics !== 'function') return;
    var list = Array.isArray(params && params.items) ? params.items : [];
    var first = list[0] || {};
    var map = { add_to_cart: 'add_to_cart', remove_from_cart: 'remove_from_cart', begin_checkout: 'checkout_start', purchase: 'order_complete' };
    var type = map[name];
    if (!type) return;
    window.tmTrackAnalytics(type, {
      value: Number(params && params.value || 0),
      product: String(first.item_id || first.item_name || '').slice(0, 300),
      meta: { order_number: String(params && params.transaction_id || '').slice(0, 80), item_id: String(first.item_id || '').slice(0, 100), item_ids: list.slice(0,50).map(function(x){return String(x.item_id||'').slice(0,100)+':' + Math.max(1,Number(x.quantity||1))}).filter(Boolean).join('|').slice(0,500), item_count: String(list.length) }
    });
  }

  function viewItem() {
    if (!/^\/produkt\//.test(location.pathname)) return false;
    var node = document.getElementById('tm-product-initial-data');
    if (!node) return false;
    var raw = null;
    try { raw = JSON.parse(node.textContent || 'null'); } catch (_) { return false; }
    var product = item(raw, 1);
    if (!product.item_id) return false;

    // One view_item per product page in this tab. The load fallback below only
    // retries pages where the first DOM-ready attempt could not read product data.
    var key = 'tm_ga4_view_item_' + String(product.item_id).replace(/[^a-zA-Z0-9_-]/g, '');
    try {
      if (sessionStorage.getItem(key) === location.pathname) return true;
      sessionStorage.setItem(key, location.pathname);
    } catch (_) {}

    emit('view_item', {
      value: Math.round(product.price * 100) / 100,
      items: [product]
    });
    return true;
  }

  window.tmTrackEcommerce = function (name, params) {
    if (!name) return;
    emit(String(name), params || {}); emitOwn(String(name), params || {});
  };

  window.tmTrackCartAdd = function (raw, quantity) {
    var product = item(raw, quantity);
    if (!product.item_id) return;
    emit('add_to_cart', {
      value: Math.round(product.price * product.quantity * 100) / 100,
      items: [product]
    });
    emitOwn('add_to_cart', { value: Math.round(product.price * product.quantity * 100) / 100, items: [product] });
  };

  window.tmTrackPurchase = function (orderNumber, preview, total) {
    var transactionId = String(orderNumber || '').trim();
    if (!transactionId) return;
    var dedupeKey = 'tm_ga4_purchase_' + transactionId.replace(/[^a-zA-Z0-9_-]/g, '');
    try {
      if (localStorage.getItem(dedupeKey)) return;
      localStorage.setItem(dedupeKey, new Date().toISOString());
    } catch (_) {}
    var list = items(preview && preview.cart);
    var purchase = {
      transaction_id: transactionId,
      value: Number.isFinite(Number(total)) ? Number(total) : valueOf(list),
      shipping: Number(preview && preview.shipping && preview.shipping.price || 0),
      items: list
    };
    emit('purchase', purchase); emitOwn('purchase', purchase);
  };

  function beginCheckout() {
    if (location.pathname !== '/pokladna') return;
    var list = items(readJson(localStorage, CART_KEY));
    if (!list.length) return;
    var signature = list.map(function (entry) { return entry.item_id + ':' + entry.quantity; }).join('|');
    var key = 'tm_ga4_checkout_' + signature;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch (_) {}
    var checkout = { value: valueOf(list), items: list };
    emit('begin_checkout', checkout); emitOwn('begin_checkout', checkout);
  }

  function trackPageEcommerce() {
    viewItem();
    beginCheckout();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPageEcommerce, { once: true });
  } else trackPageEcommerce();

  // Safe fallback for server-rendered product data that may become readable only
  // after deferred scripts/assets finish. sessionStorage dedupe prevents duplicates.
  if (/^\/produkt\//.test(location.pathname)) {
    window.addEventListener('load', viewItem, { once: true });
  }
})();
