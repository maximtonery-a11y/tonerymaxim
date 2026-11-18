import test from 'node:test';
import assert from 'node:assert/strict';
import { exactLabelOffers, hpOrderCode, labelCandidates } from '../src/lib/label-search.ts';

const read = (text: string, confidence = 96) => labelCandidates(text.split('\n').map(text => ({ text, confidence })));
test('retains complete manufacturer references and distinguishes supplies from printers', () => {
  for (const [text, code, kind] of [
    ['HP CE285AD', 'CE285AD', 'supply'], ['Canon PG-545 XL', 'PG-545XL', 'supply'],
    ['Brother TN 2421', 'TN-2421', 'supply'], ['Brother DR-2401', 'DR-2401', 'supply'],
    ['Canon GI-490BK', 'GI-490BK', 'supply'], ['Epson C13T03V14A', 'C13T03V14A', 'supply'],
    ['HP LaserJet Pro M110we', 'M110WE', 'printer'], ['HP LaserJet Pro 4002dw', '4002DW', 'printer'],
    ['Brother DCP L2532DW', 'DCP-L2532DW', 'printer'], ['Canon PIXMA G3411', 'G3411', 'printer'],
    ['HP Laser 107w', '107W', 'printer'], ['HP DeskJet 2720', '2720', 'printer'],
    ['Xerox WorkCentre 6025', '6025', 'printer'], ['Samsung Xpress C460w', 'C460W', 'printer'],
    ['Kyocera ECOSYS M2040dn', 'M2040DN', 'printer'],
    ['Epson EcoTank L3250', 'L3250', 'printer'], ['Canon iPF8300', 'IPF8300', 'printer'],
  ]) {
    assert.deepEqual(read(text).map(row => [row.code, row.kind, row.certain]), [[code, kind, true]], text);
  }
});

test('uncertainty stays local and sensitive labels never become queries', () => {
  assert.deepEqual(read('Serial number:\nCE285A\nS/N: TN-2421\nEAN: 1234567890123\nWi-Fi password: P1102W\nHSTNS-1234'), []);
  assert.deepEqual(read('HP LaserJet\n230 V\n2026\n600 pages'), []);
  assert.deepEqual(labelCandidates([{ text: '1325', confidence: 97 }], new Set(), ['HP']), []);
  assert.equal(read('HP DeskJet\n2720')[0]?.code, '2720');
  assert.deepEqual(read('Canon\nP1102W'), []);
  assert.equal(read('85A\nLASERJET')[0]?.certain, false);
  assert.equal(read('TN-2421', 64)[0]?.certain, false);
  assert.equal(read('HP CE285A CE285AD').length, 2);
  assert.equal(read('HP CE285A\nCE285A').length, 1);
  assert.equal(labelCandidates([{ text: 'HP CE285A', confidence: 98, words: [{ text: 'CE285A', confidence: 49 }] }])[0].certain, false);
  assert.deepEqual(read('HP Dual Pack\nFor use with P1102w M1132'), []);
});

test('returns only exact references from the correct brand and product or printer route', () => {
  const candidate = read('HP CE285A')[0];
  const match = { title: 'HP CE285A originálny toner', url: '/produkt/hp-ce285a', price: 10.17 };
  const oem = { title: 'HP toner 85A', url: '/produkt/hp-85a', oem: 'CE285A' };
  assert.deepEqual(exactLabelOffers(candidate, { products: [match, match, oem,
    { title: 'HP CE285AD', url: '/produkt/dualpack' }, { title: 'Canon CE285A', url: '/produkt/canon' },
    { title: 'HP CE285A', url: '//inak.sk/produkt/x' }, { title: 'HP CE285A', url: '/kosik' }] }), [match, oem]);
  for (const code of ['M110W', 'M110WE']) {
    const printer = read('HP LaserJet ' + code)[0];
    const models = ['M110W', 'M110WE', 'M110', 'M110W2'].map(name => ({ title: 'HP LaserJet ' + name, url: '/tlaciarne/hp/' + name.toLowerCase() }));
    assert.deepEqual(exactLabelOffers(printer, { printers: models }).map(hit => hit.title), ['HP LaserJet ' + code]);
  }
  assert.deepEqual(exactLabelOffers(read('Brother TN-2421')[0], { products: [{ title: 'Brother DR-2421', url: '/produkt/valec' }] }), []);
  assert.deepEqual(exactLabelOffers(read('HP CE285D')[0], { products: [match] }), []);
});

test('commercial aliases need a catalogue pairing and a cropped serial cannot become an order code', () => {
  const candidate = read('85A\nLaserJet')[0];
  const single = { title: 'HP CE285A (85A) čierny toner', url: '/produkt/hp-85a' };
  const pack = { title: 'HP 85A / CE285AD originálne tonery (2 ks)', url: '/produkt/hp-pack' };
  assert.equal(hpOrderCode(candidate, [single, pack]), 'CE285A');
  assert.equal(hpOrderCode(candidate, [pack]), undefined);
  assert.equal(hpOrderCode(candidate, [single, { ...single, title: 'HP CE285X (85A)' }]), undefined);
  const privateCodes = new Set<string>();
  labelCandidates([{ text: 'S/N: CE285A', confidence: 97 }], privateCodes);
  assert.deepEqual(labelCandidates([{ text: 'CE285A', confidence: 99 }], privateCodes), []);
});

test('a tap on a short label keeps the manufacturer seen on the original box', () => {
  assert.deepEqual(labelCandidates([{ text: '545', confidence: 92 }], new Set(), ['CANON']), [
    { brand: 'Canon', code: '545', kind: 'supply', certain: false }]);
  assert.equal(read('Epson\n101')[0].certain, false);
  assert.equal(read('85A')[0].certain, false);
  assert.deepEqual(read('545'), []);
  for (const label of ['Canon\n570\nPGBK', 'Canon 570 PGBK']) {
    assert.deepEqual(read(label).map(row => [row.code, row.certain]), [['570PGBK', false]]);
  }
});
