import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmsBrotherColourBadge, corroboratedBrotherBadge, drumNeedsSuffix, exactLabelOffers, hpOrderCode, isShorterReading, labelCandidates, liveLabelOptions, candidateText, liveLabelCandidate, printedTonerCodes, selectedLabelCandidates } from '../src/lib/label-search.ts';
import { createLiveConsensus, focusScore, hasLabelStrokes, sameLabelScene } from '../src/lib/label-camera-frame.ts';
import { isolateLightPrint } from '../src/lib/label-photo.ts';

const read = (text: string, confidence = 96) => labelCandidates(text.split('\n').map(text => ({ text, confidence })));

test('only an independently legible colour suffix can resolve a closed C on a printer badge', () => {
  const precise = read('DCP-9020CDW');
  const noisy = read('DCP-90200DW');
  assert.ok(confirmsBrotherColourBadge(precise, noisy));
  assert.ok(confirmsBrotherColourBadge(precise, [...precise, ...noisy]));
  assert.equal(confirmsBrotherColourBadge(noisy, precise), false);
  assert.equal(confirmsBrotherColourBadge(read('DCP-9020CDW', 63), noisy), false);
  for (const model of ['DCP-9028CDW', 'DCP-90200DN', 'MFC-90200DW', 'S/N: DCP-9020CDW']) {
    assert.equal(confirmsBrotherColourBadge(precise, read(model)), false);
  }
});

test('a gallery badge can lose an extra stroke only when the complete model was also read verbatim', () => {
  const rows = (...texts: string[]) => texts.map(text => [{ text, confidence: 88 }]);
  assert.equal(corroboratedBrotherBadge(rows('DCP-9020CDHW', 'DCP-9020CDW'), new Set())?.[0].text, 'DCP-9020CDW');
  for (const other of ['DCP-9020CDN', 'DCP-9028CDW', 'DCP-9020CD', 'HL-9020CDW']) {
    assert.equal(corroboratedBrotherBadge(rows('DCP-9020CDW', other), new Set()), undefined);
  }
  assert.equal(corroboratedBrotherBadge(rows('DCP-9020CDW', 'S/N: DCP-9020CDW'), new Set()), undefined);
});

test('a new or differently framed scene never reuses the old label positions', () => {
  const frame = Uint8Array.from([25, 160, 82, 110]);
  assert.ok(sameLabelScene(frame, Uint8Array.from([28, 164, 79, 113])));
  assert.equal(sameLabelScene(frame, Uint8Array.from([160, 25, 110, 82])), false);
  assert.equal(sameLabelScene(frame, frame.subarray(1)), false);
  assert.equal(sameLabelScene(undefined, frame), false);
});

test('an unavailable full reference cannot turn into an orderable shorter reference', () => {
  const full = read('Brother TN-9999');
  assert.equal(isShorterReading(read('Brother TN-99')[0], full), true);
  assert.equal(isShorterReading(read('Brother TN-9999')[0], full), false);
  assert.equal(isShorterReading(read('Brother TN-2421')[0], full), false);
  assert.equal(isShorterReading(read('Brother DCP-L3510CD')[0], read('Brother DCP-L3510CDW')), true);
});

test('a bold row can be captured without waiting for separate OCR character boxes', () => {
  const width = 104, height = 32;
  const pixels = new Uint8ClampedArray(width * height * 4);
  function shade(pattern: (x: number, y: number) => number) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
      pixels[4 * (y * width + x) + 1] = pattern(x, y);
    return hasLabelStrokes(pixels, width, height);
  }
  assert.equal(shade(x => 128 + x / 3), false);
  assert.equal(shade(x => x < 52 ? 40 : 180), false);
  assert.equal(shade((x, y) => y > 8 && y < 21 && x % 12 < 6 ? 48 : 188), true);
});

test('light printing on an uneven panel becomes dark ink without turning the panel into text', () => {
  const width = 110, height = 38;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const stroke = x >= 48 && x <= 51 && y >= 11 && y <= 27;
    data.fill(90 + Math.floor(x / 4) + (stroke ? 44 : 0), at, at + 3);
    data[at + 3] = 255;
  }
  const mock = { width, height, getContext: () => ({ getImageData: () => ({ data }), putImageData() {} }) };
  isolateLightPrint(mock as unknown as HTMLCanvasElement);
  assert.equal(data[4 * (19 * width + 49)], 0);
  for (const x of [1, 32, 53, 95]) assert.equal(data[4 * (19 * width + x)], 255);
});

test('frame selection favours sharply focused lettering over a softened view of the same lines', () => {
  const width = 96, height = 40;
  function score(blurred: boolean) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    function ink(x: number): number { return Math.abs(x % 12) < 6 ? 28 : 226; }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const neighbours = [-2, -1, 0, 1, 2].map(offset => ink(x + 12 + offset));
        pixels[4 * (y * width + x) + 1] = blurred ? neighbours.reduce((a, b) => a + b) / neighbours.length : ink(x);
      }
    }
    const frame = { width, height } as HTMLCanvasElement;
    const sample = { getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) } as unknown as HTMLCanvasElement;
    return focusScore(frame, sample);
  }
  assert.ok(score(false) > score(true));
});

test('moving camera confirms complete readings over brief gaps and drops stale or conflicting observations', () => {
  const votes = createLiveConsensus();
  const [printer] = read('Brother DCP-9020CDW');
  const [other] = read('Brother DCP-9022CDW');
  assert.equal(votes.observe(printer,0), undefined);
  assert.equal(votes.observe(undefined,400), undefined);
  assert.equal(votes.observe(printer,800)?.code, printer.code);
  assert.equal(votes.observe(other,1000), undefined);
  assert.equal(votes.observe(printer,1400), undefined);
  assert.equal(votes.observe(undefined,1700), undefined);
  assert.equal(votes.observe(undefined,2100), undefined);
  assert.equal(votes.observe(printer,2500), undefined);
  assert.equal(votes.observe(printer,12000), undefined);
  const supply = liveLabelCandidate([{text:'TN-2421', confidence:79}],new Set());
  assert.equal(supply?.certain,false);
  assert.equal(votes.observe(supply,12400),undefined);
  assert.equal(votes.observe(supply,12800),undefined);
  assert.equal(votes.observe(supply,13200)?.code,'TN-2421');
  assert.equal(liveLabelCandidate([{text:'S/N: TN-2421', confidence:99}],new Set()),undefined);
});

test('partial optical drum references cannot automatically select a black drum when the label may be CMY', () => {
  const products=['Brother DR-241 čierny valec','Brother DR-241CL BK čierny valec','Brother DR-241CL CMY optický valec'].map((title,i)=>({title,url:'/produkt/valec-'+i}));
  for (const code of ['DR-241','DR-241CL']) assert.equal(drumNeedsSuffix(read(code)[0],{products}),true);
  assert.equal(drumNeedsSuffix(read('DR-241CL-CMY')[0],{products}),false);
  assert.equal(drumNeedsSuffix(read('DR-2401')[0],{products}),false);
  assert.deepEqual(read('DR-2410\nDR-241CL-CCMY'),[]);
});

test('full drum marking overrides the family and preserves the single colour-drum designation', () => {
  const result = read('DR-2410L\nDR-241 CL\nDR-241CL-CMY');
  assert.deepEqual(result.map(r => r.code), ['DR-241CL-CMY']);
  const name = (mark: string, suffix: string) => ({ title:'Brother '+mark+' '+suffix, url:'/produkt/'+suffix });
  const products = [name('DR-241CL CMY','azurovy'),name('DR-241CL-CMY','zlty'),name('DR-241CL BK','cierny'),name('DR-241CL CMYK','sada')];
  assert.deepEqual(exactLabelOffers(result[0],{products}).map(p=>p.url), ['/produkt/azurovy','/produkt/zlty']);
  assert.equal(read('DR-241CL-CMY\nDR-242CL-BK').length,2);
  assert.equal(read('Brother LC-426M')[0].kind, 'supply');
});

test('regional codes printed on a coloured cartridge only admit complete references in that colour', () => {
  const print = 'LBTN225/245/255/265/285/296Y';
  assert.deepEqual(printedTonerCodes(print),[225,245,255,265,285,296].map(n=>'TN-'+n+'Y'));
  const [candidate] = read(print);
  const title = (value: string,i: number) => ({ title:value,url:'/produkt/test-'+i });
  const products = ['Brother TN-245Y žltý toner','Brother TN-245M purpurový toner','Brother TN-245Y CMYK sada','Canon TN-245Y','Brother TN-2450Y'].map(title);
  assert.deepEqual(exactLabelOffers(candidate,{products}).map(p=>p.title),[products[0].title]);
  assert.deepEqual(printedTonerCodes('LBTN225/245/255'),[]);
  assert.deepEqual(printedTonerCodes('XTN225/245Y'),[]);
  const privateCodes=new Set<string>();
  labelCandidates([{text:'S/N: '+print,confidence:95}],privateCodes);
  assert.deepEqual(labelCandidates([{text:print,confidence:96}],privateCodes),[]);
  assert.equal(liveLabelCandidate([{text:'ABFX47P15879234KT',confidence:99}],new Set()),undefined);
});
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

test('HP printer product numbers map only from an explicit product field', () => {
  for (const [part, model] of [['4ZB77A', '107A'], ['4ZB78A', '107W'], ['7MD66F', 'M110W'], ['7MD66E', 'M110WE'], ['W1A53A', 'M404DN'], ['W1A56A', 'M404DW']]) {
    assert.deepEqual(read('Product No. ' + part + '#B19'), [{ brand: 'HP', code: model, kind: 'printer', certain: false }]);
    assert.deepEqual(read('S/N: ' + part), []);
    assert.deepEqual(read(part), []);
  }
  assert.deepEqual(read('Product No, _ 4ZB78A').map(row => row.code), ['107W']);
  assert.deepEqual(read('Brother Product No. 4ZB78A'), []);
  assert.deepEqual(read('Product No. 4ZB78A9'), []);
  assert.deepEqual(read('HP Laser 107a').map(candidate => candidate.code), ['107A']);
});

test('a precise selection asks for confirmation and retains private fields across both readings', () => {
  const line = (text: string) => [{ text, confidence: 99 }];
  const selected = (a: string, b: string) => selectedLabelCandidates([line(a), line(b)], new Set(), []);
  assert.deepEqual(selected('HP M110w', 'HP M110we').map(x => [x.code, x.certain]), [['M110W', false], ['M110WE', false]]);
  assert.deepEqual(selected('HP M110we', 'HP M110we').map(x => [x.code, x.certain]), [['M110WE', false]]);
  assert.deepEqual(selected('CE285A', 'S/N: CE285A'), []);
  assert.deepEqual(selected('P/N: 4ZB78A', 'Serial number: 4ZB78A'), []);
  assert.deepEqual(selected('Laser 107w', 'MP Laser 107w').map(x => [x.code, x.certain]), [['107W', false]]);
  assert.deepEqual(read('HP Laserlet 1020').map(x => [x.code, x.certain]), [['1020', false]]);
  const models = ['1020', '1020 Plus', '1020W'].map((name, index) => ({ title: 'HP LaserJet ' + name, url: '/tlaciarne/hp/p' + index }));
  for (const name of ['1020', '1020 Plus']) {
    const candidate = read('HP LaserJet ' + name)[0];
    assert.deepEqual(exactLabelOffers(candidate, { printers: models }).map(x => x.title), ['HP LaserJet ' + name]);
  }
});

test('live camera offers require a legible, unambiguous manufacturer reference', () => {
  const seen = new Set<string>();
  const live = (text: string, confidence = 96) => liveLabelCandidate([{ text, confidence }], seen)?.code;
  assert.equal(live('HP 85A / CE285A'), 'CE285A');
  assert.equal(live('Brother TN-2421'), 'TN-2421');
  assert.equal(live('HP LaserJet M110we'), 'M110WE');
  assert.equal(live('Canon PIXMA TS8551'), 'TS8551');
  assert.equal(live('Product No. 4ZB78A'), '107W');
  assert.equal(live('HP 85A'), '85A');
  assert.equal(liveLabelCandidate([{ text: '106A', confidence: 97 }], seen)?.requiresPairing, true);
  assert.equal(live('35A', 74), undefined);
  assert.equal(live('TN-1 030'), 'TN-1030');
  assert.equal(live('MF443dw'), 'MF443DW');
  assert.equal(live('P1102W'), undefined);
  assert.equal(live('SIN: TN-9900'), undefined);
  assert.equal(live('TN-9900'), undefined);
  assert.equal(liveLabelCandidate([{ text: 'SIN:', confidence: 90 }, { text: 'TN-9901', confidence: 99 }], seen), undefined);
  assert.equal(live('TN-9901'), undefined);
  assert.equal(live('HP 85A CF259A'), undefined);
  assert.equal(live('Brother TN-2421 TN-2411'), undefined);
  assert.equal(live('Brother TN-2421', 60), undefined);
  assert.equal(live('S/N: CE285A'), undefined);
  assert.equal(live('HP CE285A'), undefined);
  assert.equal(liveLabelCandidate([{ text: 'Brother TN-2421', confidence: 99,
    words: [{ text: 'TN-2421', confidence: 50 }] }], seen), undefined);
});

test('a dual-brand physical cartridge keeps both order codes including their complete suffix', () => {
  const pair = (text: string, blocked = new Set<string>()) =>
    liveLabelOptions([{ text, confidence: 92 }], blocked).map(candidateText);
  for (const label of ['H-CF283X/CRG-737', 'CF283X / CRG 737', 'CRG-737 / HP-CF283X','H-CF283XICRG-737','H-CF283X/ICRG-737','CRG-737|CF283X']) {
    assert.deepEqual(pair(label), ['HP CF283X', 'Canon CRG-737']);
  }
  assert.deepEqual(pair('Canon CRG-737'), ['Canon CRG-737']);
  assert.deepEqual(pair('HP CF283X'), ['HP CF283X']);
  assert.deepEqual(pair('HP 85A / CE285A'), ['HP CE285A']);
  assert.deepEqual(pair('HP CE285A / 85A'), ['HP CE285A']);
  assert.deepEqual(pair('H-CF283X/'), []);
  assert.deepEqual(pair('/CRG-737'), []);
  assert.deepEqual(pair('H-CF283X/CRG-7'), []);
  const blocked = new Set<string>();
  assert.deepEqual(pair('S/N: H-CF283XICRG-737', blocked), []);
  assert.deepEqual(pair('S/N: H-CF283X/CRG-737', blocked), []);
  assert.deepEqual(pair('H-CF283X/CRG-737', blocked), []);
});

test('an unbranded printer badge offers each exact catalogue model and retains an explicit brand', () => {
  const refs = ['OKI C530dn', 'Lexmark C530DN', 'OKI C530', 'OKI C530DW', 'OKI C530DN2'].map((title,i) =>
    ({ title, url: '/tlaciarne/' + title.split(' ')[0].toLowerCase() + '/model-' + i }));
  for (const text of ['C530dn', 'OKI C530dn', 'Lexmark C530dn']) {
    const [model] = liveLabelOptions([{ text, confidence: 92 }], new Set());
    assert.equal(candidateText(model), text.toUpperCase().replace('LEXMARK', 'Lexmark'));
    const hits = exactLabelOffers(model, { printers: refs }).map(hit => hit.title);
    assert.deepEqual(hits, text === 'C530dn' ? ['OKI C530dn','Lexmark C530DN'] :
      [text.startsWith('OKI') ? 'OKI C530dn' : 'Lexmark C530DN']);
  }
  assert.deepEqual(liveLabelOptions([{ text: 'S/N: C530dn', confidence: 98 }], new Set()), []);
});


test('printed HP family and model retain the full suffix across OCR word boundaries', () => {
  for (const text of ['LaserJetProM201dw', 'LaserJet Pro M201 dw', 'LaserJetPro M201dw']) {
    assert.deepEqual(liveLabelOptions([{ text, confidence: 95 }], new Set()).map(candidateText), ['HP M201DW']);
  }
  const blocked = new Set<string>();
  assert.deepEqual(liveLabelOptions([{ text: 'S/N: LaserJetProM201dw', confidence: 99 }], blocked), []);
  assert.deepEqual(liveLabelOptions([{ text: 'HP LaserJet Pro M201 dw', confidence: 99 }], blocked), []);
  assert.deepEqual(read('LaserJet Pro M201').map(candidateText), ['HP M201']);
});

test('a clear complete Brother badge is distinctive even when the brand is on a different panel', () => {
  assert.equal(read('DCP-7070DW', 96)[0].certain, true);
  assert.equal(read('DCP-L3510CDW', 95)[0].certain, true);
  assert.equal(read('DCP-L3510CD', 98)[0].certain, false);
  assert.equal(read('DCP-7070DW', 80)[0].certain, false);
  assert.deepEqual(read('S/N: DCP-7070DW'), []);
});

test('only a single compatible supply covering every reference printer can extend a scanned code', async () => {
  const { compatibleScanAlternatives } = await import('../src/lib/product-alternatives.ts');
  const models = Array.from({ length: 83 }, (_, i) => 'brotherdcpj' + i);
  function row(code: string, type: string, printers = models, color = 'Čierna', extra = '') {
    return { brand: 'Brother', printers: printers.map(key => ({ key })), product: {
      product_brand: 'Brother', product_type_key: type, price: 8, color,
      name: 'Brother ' + code + ' čierna atramentová náplň ' + extra,
    } };
  }
  const base = row('LC-123BK', 'original');
  const xl = row('LC-123XLBK', 'compatible');
  const query = 'Brother LC-123BK';
  const rejected = [row('LC-123XLBK', 'compatible', models.slice(0, 82)), row('LC-123XLBK', 'compatible', []),
    row('LC-123XLC', 'compatible'), row('LC-123XLBK', 'compatible', models, 'Žltá'),
    row('LC-123XLBK', 'compatible', models, 'Čierna', 'multipack'),
    row('LC-123XLBK', 'compatible', models, 'Čierna', 'bez čipu'), row('LC-123XLBK', 'renovated')];
  assert.deepEqual(compatibleScanAlternatives(query, [base, ...rejected, xl]), [xl]);
  assert.deepEqual(compatibleScanAlternatives(query, [xl]), []);
  assert.deepEqual(compatibleScanAlternatives(query, [row('LC-123BK', 'original', []), xl]), []);
  assert.deepEqual(compatibleScanAlternatives(query, [base, row('LC-123BK', 'compatible', ['brotherextra1']), xl]), []);
  for (const text of ['Brother LC-123 BK','Brother LC-123XL BK', 'Brother LC-123 XL BK']) {
    assert.equal(read(text)[0]?.code.replace('-', ''), text.includes('XL') ? 'LC123XLBK' : 'LC123BK');
  }
  const canon = (code: string, type: string) => ({ ...base, brand: 'Canon', product: {
    ...base.product, product_brand: 'Canon', product_type_key: type, name: 'Canon ' + code + ' čierna atramentová náplň',
  } });
  assert.equal(compatibleScanAlternatives('Canon PG-545', [canon('PG-545', 'original'), canon('PG-545XL', 'compatible')]).length, 1);
  const hp = (code: string, type: string) => ({ ...base, brand: 'HP', product: {
    ...base.product, product_brand: 'HP', product_type_key: type, name: 'HP ' + code + ' čierny toner',
  } });
  assert.deepEqual(compatibleScanAlternatives('HP CF283A', [hp('CF283A', 'original'), hp('CF283X', 'compatible')]), []);
});

test('scanner keeps trusted compatible alternatives first and binds them to the exact scanned label', () => {
  const base = { title: 'Brother LC-123BK originál', url: '/produkt/original', type: 'original' };
  const xl = { title: 'Brother LC-123XLBK kompatibilná', url: '/produkt/compatible', type: 'compatible', verifiedForLabel: 'Brother LC-123BK' };
  const input = read('Brother LC-123 Bk')[0];
  assert.deepEqual(exactLabelOffers(input, { products: [base, xl] }), [xl, base]);
  assert.deepEqual(exactLabelOffers(read('Brother LC123BK')[0], { products: [base, xl] }), [xl, base]);
  assert.deepEqual(exactLabelOffers(input, { products: [base, { ...xl, verifiedForLabel: 'Brother LC-123Y' }] }), [base]);
  assert.deepEqual(exactLabelOffers(input, { products: [{ ...xl, url: 'https://example.invalid/' }] }), []);
});
