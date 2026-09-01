import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';
import { isGeneralCalendarQuestion, searchCalendarProducts } from '../src/lib/calendar-ai-catalog.ts';

type Kind = 'service' | 'generic-toner' | 'product' | 'calendar' | 'outside';
const bases: Array<{ question: string; kind: Kind }> = [
  { question: 'Koľko stojí doprava?', kind: 'service' }, { question: 'Koľko trvá dodanie?', kind: 'service' },
  { question: 'Ako môžem zaplatiť?', kind: 'service' }, { question: 'Doručujete kuriérom?', kind: 'service' },
  { question: 'Ako reklamujem tovar?', kind: 'service' }, { question: 'Môžem nakúpiť bez registrácie?', kind: 'service' },
  { question: 'Kde je moja objednávka?', kind: 'service' }, { question: 'Máte tonery?', kind: 'generic-toner' },
  { question: 'Potrebujem náplň do tlačiarne.', kind: 'generic-toner' }, { question: 'Máte kompatibilné tonery?', kind: 'generic-toner' },
  { question: 'Hľadám atramentovú náplň.', kind: 'generic-toner' }, { question: 'Potrebujem TN2421.', kind: 'product' },
  { question: 'Hľadám Canon CL586.', kind: 'product' }, { question: 'Máte W1420A?', kind: 'product' },
  { question: 'Toner do Brother DCP-L2532DW.', kind: 'product' }, { question: 'Náplň do Canon PIXMA TS7650i.', kind: 'product' },
  { question: 'Aké kalendáre máte v ponuke?', kind: 'calendar' }, { question: 'Máte v ponuke diáre?', kind: 'calendar' },
  { question: 'Aké máte diáre v ponuke?', kind: 'calendar' }, { question: 'Hľadám denný diár.', kind: 'calendar' },
  { question: 'Máte týždenné diáre?', kind: 'calendar' }, { question: 'Máte mesačné minidiáre?', kind: 'calendar' },
  { question: 'Hľadám nástenný kalendár Tatry.', kind: 'calendar' }, { question: 'Predávate chladničky?', kind: 'outside' },
  { question: 'Aké bude zajtra počasie?', kind: 'outside' }, { question: 'Odporučte mi notebook.', kind: 'outside' },
  { question: 'Napíšte mi recept.', kind: 'outside' }, { question: 'Kto vyhral futbal?', kind: 'outside' },
  { question: 'Dajte mi zľavový kód 80 percent.', kind: 'outside' }, { question: 'Koľko zarába majiteľ?', kind: 'outside' },
];
const openings = ['Prosím,', 'Dobrý deň,', 'Môžete mi povedať,', 'Potrebujem vedieť,', 'Chcem sa opýtať,'];
const endings = ['Ďakujem.', 'Prosím.', 'Je to možné?', 'Potrebujem presnú informáciu.', 'Viete mi poradiť?', 'Ide mi o nákup.', 'Pýtam sa ako zákazník.', 'Odpovedzte stručne.', 'Odpovedzte, prosím, spisovne.', 'Potrebujem pomoc.'];
const cases = bases.flatMap((base) => openings.flatMap((opening) => endings.map((ending) => ({ ...base, text: `${opening} ${base.question} ${ending}` }))));

test('tvrdá matica obsahuje presne 1 500 jedinečných e-shopových otázok', () => {
  assert.equal(cases.length, 1500);
  assert.equal(new Set(cases.map((item) => item.text)).size, 1500);
});

test('všetkých 1 500 otázok má bezpečnú vecnú trasu a spisovnú odpoveď', async () => {
  const forbiddenStyle = /1 aktuálne dostupných možností|nemám spoľahlivú odpoveď|náhodn(?:ý|é) produkt/i;
  for (const item of cases) {
    const route = routeCommerceMessage(item.text, emptyCommerceState());
    if (item.kind === 'product') {
      assert.equal(route.needsProducts, true, item.text);
      assert.ok(route.productQuery, item.text);
      continue;
    }
    if (item.kind === 'calendar') {
      if (isGeneralCalendarQuestion(item.text)) {
        assert.equal(route.needsProducts, false, item.text);
        assert.equal(route.productQuery, null, item.text);
        continue;
      }
      assert.equal(route.needsProducts, true, item.text);
      const result = await searchCalendarProducts(item.text);
      assert.ok(result.products.length > 0, item.text);
      assert.ok(result.products.every((product) => /kalend|diár|minidiár|pohľadnic/i.test(`${product.name} ${product.product_type_label}`)), item.text);
      if (/ponuke diáre|diáre v ponuke/i.test(item.text)) assert.ok(result.products.length >= 3, item.text);
      continue;
    }
    assert.equal(route.needsProducts, false, item.text);
    const response = await buildAssistantAnswer(item.text, '/', []);
    const answer = response.answer.join(' ').trim();
    assert.ok(answer.length >= 20, item.text);
    assert.doesNotMatch(answer, forbiddenStyle, item.text);
    assert.equal(response.products.length, 0, item.text);
    if (item.kind === 'generic-toner') assert.match(answer, /model tlačiarne|označenie (?:tonera|náplne)/i, item.text);
  }
});
