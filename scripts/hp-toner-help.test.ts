import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { hpPlusAdviceArticle } from '../src/data/hp-plus-advice.ts';
import { HP_TONER_HELP_PATH } from '../src/lib/hp-toner-help.ts';

process.env.OPENAI_ASSISTANT_ENABLED = '0';
async function ask(message: string, page = '/', state: any = emptyCommerceState()) {
  const response = await POST({ request: new Request('http://localhost/api/ai-tomas', { method: 'POST', body: JSON.stringify({ message, page, state }) }) } as any);
  assert.equal(response.status, 200);
  return response.json();
}

test('HP+ guide distinguishes activation, cartridge policy, protection and firmware without promising a universal unlock', () => {
  const article = hpPlusAdviceArticle;
  assert.equal(`/poradna/${article.slug}`, HP_TONER_HELP_PATH);
  const text = JSON.stringify(article);
  assert.match(article.answer, /aktivované HP\+.*originálne kazety/i);
  assert.match(text, /Vypnutie ochrany pôsobí na ďalšie vložené kazety/);
  assert.match(text, /Instant Ink.*nezrušia podmienky/);
  assert.match(text, /dynamické zabezpečenie/);
  assert.match(text, /Notify.*manuálne/);
  assert.match(text, /bezpečnostné opravy/);
  assert.match(text, /MFP 4301, 4302 a 4303/);
  assert.match(text, /Ponuky závisia od modelu, firmvéru/);
  assert.ok(article.sources!.length >= 5);
  for (const source of article.sources!) {
    const url = new URL(source.href);
    assert.equal(url.protocol, 'https:');
    assert.ok(url.hostname === 'hp.com' || url.hostname.endsWith('.hp.com'));
  }
});

test('questions about HP+ and cartridge settings include the guide without showing product offers', async () => {
  for (const question of ['Čo znamená HP+?', 'Ako vypnúť HP+?', 'Ako nastaviť Cartridge Policy?', 'Čo znamená Cartridge Protection?']) {
    const result = await ask(question);
    const text = result.advisor.answer.join(' ');
    assert.equal(result.advisor.faq, 'hp-plus-nastavenie', question);
    assert.match(text, /originálne kazety HP počas životnosti/);
    assert.match(text, /túto podmienku nezruší/);
    assert.match(text, /automatickú inštaláciu firmvéru/);
    assert.ok(result.advisor.sources.some((source: any) => source.url === HP_TONER_HELP_PATH), question);
    assert.equal(result.commerce, null);
    assert.equal(result.action, null);
  }
});

test('restricted HP compatibility links the guide once, retains policy links and leaves the cart untouched', async () => {
  const g = globalThis as any;
  const previous = g.__TM_PRODUCTS_FILE_CACHE__;
  g.__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, runtime_compact: true, generated_at: 'hp-help-guide-fixture', total: 2, products: [
    { id: 142, sku: 'HP-142XL', name: 'HP W1420XL (142XL) čierny kompatibilný toner nefunguje v HP+', slug: 'hp-w1420xl', compatible_printers: ['HP LaserJet M110w', 'HP LaserJet MFP M140w'], price: 26.91 },
    { id: 2421, sku: 'TN-2421', name: 'Brother TN-2421 čierny kompatibilný toner', slug: 'brother-tn-2421', compatible_printers: ['Brother HL-L2352DW'], price: 12.96 },
  ] };
  delete g.__TM_PUBLIC_PRODUCTS_CACHE__;
  delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
  try {
    const state = { ...emptyCommerceState(), cart: [{ id: '142', sku: 'HP-142XL', quantity: 1 }] };
    const result = await ask('Do ktorých tlačiarní pasuje tento toner?', '/produkt/hp-w1420xl', state);
    assert.ok(result.advisor.answer.includes('Tieto tonery sú určené pre tieto tlačiarne:'));
    assert.doesNotMatch(result.advisor.answer.join(' '), /katalóg/i);
    assert.equal(result.advisor.sources.filter((source: any) => source.url === HP_TONER_HELP_PATH).length, 1);
    assert.deepEqual(result.advisor.answer.filter((line: string) => line.startsWith('• ')), ['• HP LaserJet M110w', '• HP LaserJet MFP M140w']);
    assert.deepEqual(result.state.cart, state.cart);
    assert.equal(result.action, null);
    const mixed = await ask('Bude tento toner fungovať s mojím firmvérom? Môžem ho vrátiť alebo reklamovať?', '/produkt/hp-w1420xl', result.state);
    assert.equal(mixed.advisor.sources.filter((source: any) => source.url === HP_TONER_HELP_PATH).length, 1);
    assert.ok(mixed.advisor.sources.some((source: any) => source.url === '/odstupenie-od-zmluvy'));
    assert.ok(mixed.advisor.sources.some((source: any) => source.url === '/reklamacie'));
    assert.ok(mixed.advisor.sources.length <= 4);
    const other = await ask('Do ktorých tlačiarní pasuje tento toner?', '/produkt/brother-tn-2421', result.state);
    assert.ok(!other.advisor.sources.some((source: any) => source.url === HP_TONER_HELP_PATH));
    assert.doesNotMatch(other.advisor.answer.join(' '), /HP\+/);
  } finally {
    if (previous) g.__TM_PRODUCTS_FILE_CACHE__ = previous; else delete g.__TM_PRODUCTS_FILE_CACHE__;
    delete g.__TM_PUBLIC_PRODUCTS_CACHE__;
    delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
  }
});
