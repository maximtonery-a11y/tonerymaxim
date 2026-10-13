import assert from 'node:assert/strict';
import test from 'node:test';
import { GET } from '../src/pages/api/printers.ts';

test('printer API keeps known brands, does not retain arbitrary URL inputs and replaces old generations', async () => {
  const state = globalThis as any;
  state.__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, generated_at: 'generation-1', total: 2, products: [
    { id: 1, name: 'HP toner', price: '10', compatible_printers: ['HP LaserJet M110w'] },
    { id: 2, name: 'Brother toner', price: '11', compatible_printers: ['Brother DCP-L2532DW'] },
  ] };
  async function get(brand = '') {
    const response = await GET({ url: new URL(`http://localhost/api/printers?brand=${encodeURIComponent(brand)}`) } as any);
    assert.equal(response.status, 200);
    return response.json();
  }
  assert.equal((await get()).printers.length, 2);
  const hp = await get('HP');
  assert.deepEqual(await get('hp'), hp);
  assert.equal(hp.printers[0].title, 'HP LaserJet M110w');
  assert.equal((await get('brother')).printers[0].title, 'Brother DCP-L2532DW');
  for (let i = 0; i < 2_000; i++) assert.equal((await get(`unknown-brand-${i}`)).printers.length, 0);
  assert.equal(state.__TM_PRINTERS_INDEX__.size, 3);
  state.__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, generated_at: 'generation-2', total: 1, products: [
    { id: 3, name: 'HP next toner', price: '12', compatible_printers: ['HP LaserJet M1132'] },
  ] };
  assert.equal((await get('HP')).printers[0].title, 'HP LaserJet M1132');
  assert.equal(state.__TM_PRINTERS_INDEX__.size, 1);
  assert.ok([...state.__TM_PRINTERS_INDEX__.values()].every((v: any) => v.generatedAt === 'generation-2'));
});
