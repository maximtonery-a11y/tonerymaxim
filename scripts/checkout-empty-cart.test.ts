import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import postcss from 'postcss';

const source = await readFile(new URL('../src/scripts/checkout.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('checkout.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set(['renderCheckoutSummary', 'cartPricing', 'cleanQty', 'esc', 'stockText', 'money', 'netFromGross', 'vatFromGross',
  'getSelected', 'isOnlinePayment', 'isCalendarCartItem', 'isCompatibleDiscountItem', 'quantityDiscountRate', 'quantityLineDiscount',
  'seriesPackDiscount', 'seriesBaseKey', 'seriesColorKey', 'normalizeSeriesText', 'seriesText', 'updateShippingOptionPrices']);
const constants = new Set(['SHIPPING', 'PAYMENT', 'VAT_RATE']);
const extracted: string[] = [];
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) extracted.push(node.getText(ast));
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && constants.has(node.name.text)) extracted.push(`const ${node.getText(ast)};`);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(extracted.length, names.size + constants.size);

function harness() {
  let cart: any[] = [];
  class Node {
    hidden = true; textContent = ''; className = ''; value = ''; children: Node[] = []; dataset = {};
    private html = '';
    set innerHTML(value: string) { this.html = value; this.children = []; }
    get innerHTML() { return this.html; }
    appendChild(node: Node) { this.children.push(node); }
  }
  const nodes = new Map<string, Node>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Node()); return nodes.get(selector)!; };
  node('input[name="shipping"]:checked').value = 'dpd_courier';
  node('input[name="payment"]:checked').value = 'gopay';
  const noop = () => {};
  const scope = { document: { querySelector: node, querySelectorAll: () => [], createElement: () => new Node() },
    readCart: () => cart, window: { location: { origin: 'https://www.tonerymaxim.sk' } }, URL,
    tmLoyalty: { ok: false, discountValue: 0 }, tmLoyaltyApply: false,
    couponDiscountForTotal: () => 0, loyaltyDiscountForTotal: () => 0, syncCouponBoxes: noop,
  };
  const render = vm.runInNewContext(`${extracted.join('\n')};renderCheckoutSummary`, scope);
  return { render, node, setCart(value: any[]) { cart = value; } };
}

test('empty → populated → empty hides every order surface and preserves real pricing', () => {
  const h = harness();
  h.render();
  assert.equal(h.node('[data-checkout-empty]').hidden, false);
  for (const selector of ['[data-checkout-form]', '[data-checkout-mobile-guide]', '[data-checkout-mobile-sticky]']) assert.equal(h.node(selector).hidden, true, selector);
  h.setCart([{ id: '52830', name: 'Canon CRG-045 CMYK kompatibilná sada tonerov', price: 75.2, qty: 3, product_type_key: 'compatible', color: 'CMYK' }]);
  h.render();
  assert.equal(h.node('[data-checkout-empty]').hidden, true);
  assert.equal(h.node('[data-checkout-form]').hidden, false);
  assert.equal(h.node('[data-checkout-mobile-guide]').hidden, false);
  assert.equal(h.node('[data-checkout-items]').children.length, 1);
  assert.equal(h.node('[data-summary-subtotal]').textContent.replace(/\s/g, ''), '225,60€');
  assert.equal(h.node('[data-summary-total]').textContent.replace(/\s/g, ''), '203,04€');
  h.setCart([]);
  h.render();
  assert.equal(h.node('[data-checkout-empty]').hidden, false);
  for (const selector of ['[data-checkout-form]', '[data-checkout-mobile-guide]', '[data-checkout-mobile-sticky]']) assert.equal(h.node(selector).hidden, true, selector);
  assert.equal(h.node('[data-checkout-items]').children.length, 0);
});

test('SSR does not expose the form or mobile guide before the browser reads its cart', async () => {
  const page = await readFile(new URL('../src/pages/pokladna.astro', import.meta.url), 'utf8');
  for (const attribute of ['data-checkout-form', 'data-checkout-mobile-guide']) assert.match(page, new RegExp(`<div[^>]*${attribute}[^>]*\\shidden(?:\\s|>)`), attribute);
});

test('checkout CSS honours hidden for desktop, empty state and mobile controls', async () => {
  const css = postcss.parse(await readFile(new URL('../src/styles/checkout.css', import.meta.url), 'utf8'));
  for (const className of ['checkout-layout', 'checkout-empty', 'checkout-mobile-guide', 'checkout-mobile-sticky']) {
    let guarded = false;
    css.walkRules(rule => {
      if (!rule.selectors.includes(`.${className}[hidden]`)) return;
      rule.walkDecls('display', decl => { if (decl.value === 'none' && decl.important) guarded = true; });
    });
    assert.equal(guarded, true, `A display rule must not reveal hidden .${className}`);
  }
});
