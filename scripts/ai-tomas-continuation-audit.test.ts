import test from 'node:test';
import assert from 'node:assert/strict';
import { POST, requestedQuantity } from '../src/pages/api/ai-tomas.ts';
import { GET as smartSearch } from '../src/pages/api/smart-search.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { isOrderRepeatCommand, isOrderStatusQuestion, selectRequestedOrder } from '../src/lib/ai-order-question.ts';

async function ask(message: string, state: any = emptyCommerceState('continuation-audit')) {
  const response = await POST({ request: new Request('http://localhost/api/ai-tomas', {
    method: 'POST', body: JSON.stringify({ message, state, page: '/' }),
  }) } as any);
  assert.equal(response.status, 200, message);
  return response.json();
}

test('skloňovaná doprava a platba po produkte neotvoria starú CMYK ponuku', async () => {
  let state = (await ask('Canon PFI-102')).state;
  const cart = [{ id: 'keep', sku: 'KEEP', quantity: 2 }];
  state.cart = cart;
  for (const question of [
    'Chcem kompletný prehľad dopravy a platby.',
    'Chcem informácie o platobných možnostiach a poštovnom.',
    'Chcem vedieť cenu dopravy.',
    'Chcem informácie o platbe kartou.',
  ]) {
    const result = await ask(question, state);
    assert.equal(result.commerce, null, question);
    assert.deepEqual(result.state.cart, cart, question);
    assert.equal(result.action, null, question);
    assert.doesNotMatch(result.advisor.answer.join(' '), /PFI|hotový produkt požadovanej sady/i, question);
    if (question.includes('prehľad')) {
      assert.equal(result.advisor.faq, 'doprava-a-platba');
      assert.match(result.advisor.answer.join(' '), /GoPay/);
      assert.match(result.advisor.answer.join(' '), /bankov.*prevod/);
    }
    state = result.state;
  }
});

test('neprevzatá doručená zásielka má rovnakú reklamačnú cestu v prehliadači aj API', async () => {
  for (const question of [
    'Zásielka je označená ako doručená, ale neprevzal som ju.',
    'Tracking ukazuje odovzdané, ale balík som nenašiel.',
    'Objednávka 300945 je doručená, ale nedostal som ju.',
    'Kuriér píše doručené, ale balík som neobdržal.',
  ]) {
    assert.equal(isOrderStatusQuestion(question), false, question);
    const result = await ask(question);
    assert.equal(result.advisor.faq, 'zasielka-oznacena-dorucena', question);
    assert.equal(result.commerce, null, question);
  }
});

test('opakovanie objednávky vyžaduje priamy pokyn bez zákazu košíka', () => {
  for (const question of [
    'Zopakuj poslednú objednávku, ale nič nepridávaj do košíka.',
    'Ukáž poslednú objednávku.',
    'Ako zopakujem poslednú objednávku?',
    'Môžem zopakovať poslednú objednávku?',
    'Je možné zopakovať moju poslednú objednávku?',
    'Nezopakuj poslednú objednávku.',
    'Koľko stála posledná objednávka?',
  ]) assert.equal(isOrderRepeatCommand(question), false, question);
  for (const question of ['Zopakuj poslednú objednávku.', 'Objednaj ako naposledy.', 'Pošli ako naposledy.', 'Chcem zopakovať poslednú objednávku.']) {
    assert.equal(isOrderRepeatCommand(question), true, question);
  }
});

test('stav konkrétnej objednávky sa nikdy nenahradí poslednou objednávkou', () => {
  const orders = [{ number: '300950' }, { number: '300945' }];
  assert.equal(selectRequestedOrder(orders, 'Kde je objednávka 300945?'), orders[1]);
  assert.equal(selectRequestedOrder(orders, 'Kde je objednávka 300001?'), undefined);
  assert.equal(selectRequestedOrder(orders, 'Aký je stav poslednej objednávky?'), orders[0]);
});

test('čísla v OEM kóde nie sú objednané množstvo', () => {
  for (const question of ['Pridaj Canon GI-41 do košíka.', 'Pridaj Canon PG-40.', 'Pridaj HP 85.']) {
    assert.equal(requestedQuantity(question), null, question);
  }
  assert.equal(requestedQuantity('Pridaj mi 2 Canon GI-41.'), 2);
  assert.equal(requestedQuantity('Pridaj Canon GI-41 2 ks.'), 2);
  assert.equal(requestedQuantity('Objednaj 3 ks kompatibilnej Epson 104 CMYK sady.'), 3);
});

test('skutočná odpoveď našeptávača neponúka zakázané varianty M455dn', async () => {
  const response = await smartSearch({ url: new URL('http://localhost/api/smart-search?q=HP%20M455dn') } as any);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.ok(result.products.length > 0, 'M455dn musí mať aj bezpečné výsledky');
  for (const product of result.products) {
    assert.doesNotMatch(JSON.stringify(product), /bez čipu|bez-cipu|OEM čip|oem-cip|hatona/i);
  }
});
