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

  function viewItem() {
    if (!/^\/produkt\//.test(location.pathname)) return;
    var node = document.getElementById('tm-product-initial-data');
    if (!node) return;
    var raw = null;
    try { raw = JSON.parse(node.textContent || 'null'); } catch (_) { return; }
    var product = item(raw, 1);
    if (!product.item_id) return;
    emit('view_item', {
      value: Math.round(product.price * 100) / 100,
      items: [product]
    });
  }

  window.tmTrackEcommerce = function (name, params) {
    if (!name) return;
    emit(String(name), params || {});
  };

  window.tmTrackCartAdd = function (raw, quantity) {
    var product = item(raw, quantity);
    if (!product.item_id) return;
    emit('add_to_cart', {
      value: Math.round(product.price * product.quantity * 100) / 100,
      items: [product]
    });
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
    emit('purchase', {
      transaction_id: transactionId,
      value: Number.isFinite(Number(total)) ? Number(total) : valueOf(list),
      shipping: Number(preview && preview.shipping && preview.shipping.price || 0),
      items: list
    });
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
    emit('begin_checkout', { value: valueOf(list), items: list });
  }

  function trackPageEcommerce() {
    viewItem();
    beginCheckout();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPageEcommerce, { once: true });
  } else trackPageEcommerce();
})();
