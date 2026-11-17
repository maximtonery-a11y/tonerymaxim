import assert from 'node:assert/strict';
import test from 'node:test';
import { indexPrinterModels, findPrinterModel } from '../src/scripts/product-printer-check.js';

const product = { product_type_key: 'compatible', product_brand: 'HP' };
const models = ['HP LaserJet Pro P1102', 'HP LaserJet Pro P1102W', 'HP LaserJet Pro P1102s',
  'HP LaserJet P1005', 'HP LaserJet M110w', 'HP LaserJet M110we'];
const indexed = indexPrinterModels(models, product);
const find = (query: string) => findPrinterModel(indexed, query);

test('a complete catalog model is listed and a short or partial label asks for a selection', () => {
  assert.equal(find(' hp LASERJET PRO P-1102w ').name, models[1]);
  assert.deepEqual(find('P1102').choices, models.slice(0, 3));
  assert.deepEqual(find('HP P1102W'), { state: 'choose', choices: [models[1]] });
  for (const query of ['1102', 'HP', 'P1102s']) assert.equal(find(query).state, 'choose');
  for (const query of ['HP LaserJet 1005', 'Canon P1102', 'HP LaserJet Pro P1102we',
    'HP LaserJet Pro P1102+', '<img src=x>']) assert.equal(find(query).state, 'unknown');
  for (const query of ['', ' - ', '???', 'x']) assert.equal(find(query).state, 'empty');
});

test('exact suffixes, generations and HP+ handling take precedence over similar names', () => {
  for (const type of ['compatible', 'renovated']) {
    const entries = indexPrinterModels(models, { ...product, product_type_key: type });
    assert.equal(findPrinterModel(entries, 'HP LaserJet M110we').state, 'unknown');
    assert.equal(findPrinterModel(entries, 'HP LaserJet M110w').state, 'listed');
  }
  assert.equal(findPrinterModel(indexPrinterModels(models, { product_type_key: 'original' }), models[5]).state, 'listed');
  const canon = indexPrinterModels(['Canon imageRUNNER ADVANCE C5535i III', 'Canon PIXMA TS8551a'], {});
  assert.equal(findPrinterModel(canon, 'Canon imageRUNNER ADVANCE C5535i II').state, 'choose');
  assert.equal(findPrinterModel(canon, 'Canon PIXMA TS8551').state, 'choose');
  assert.equal(findPrinterModel(canon, 'Canon PIXMA TS8551a').state, 'listed');
});

test('ranges and series are not individual matches and suggestions are bounded', () => {
  const entries = indexPrinterModels(['HP LaserJet M28-M31', 'HP LaserJet M110 series', 'HP 100/102',
    ...Array.from({ length: 20 }, (_, i) => 'Brother HL-L' + (2300 + i) + 'D')], {});
  assert.equal(entries.length, 20);
  assert.equal(findPrinterModel(entries, 'HL-L23').choices.length, 5);
  assert.equal(findPrinterModel([], 'HP LaserJet P1005').state, 'unknown');
});
