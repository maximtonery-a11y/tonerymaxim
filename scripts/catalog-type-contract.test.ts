import assert from 'node:assert/strict';
import test from 'node:test';
import { mapProduct } from '../src/lib/tm-products-cache.ts';

const canonModels = ['Canon i-SENSYS LBP631Cw','Canon i-SENSYS LBP633Cdw','Canon i-SENSYS MF651Cw','Canon i-SENSYS MF655Cdw','Canon i-SENSYS MF657Cdw'];
function fixture(name: string, kind: string) {
  return {id: 38100, name, sku: '052667', slug: 'canon-test', price: '80.54', stock_status: 'onbackorder', images: [],
    short_description: '<p>'+name+'</p><p><strong>Kompatibilné tlačiarne:</strong> '+canonModels.join(', ')+'.</p>',
    description: '<h3>Kompatibilita a alternatívy</h3>', categories: [], tags: [],
    attributes: [{name: 'Typ produktu', options: ['toner']},{name: 'Typ spotrebného materiálu', options: [kind]},
      {name: 'Séria tlačiarne', options: ['Canon i-SENSYS LBP630','Canon i-SENSYS MF650']},
      {name: 'Model tlačiarne', options: canonModels}], meta_data: []};
}
test('Incident 38100: original remains original despite compatibility heading', () => {
  const p=mapProduct(fixture('Canon CRG-067BK čierny originálny toner','originalne'));
  assert.equal(p.product_type_key,'original'); assert.equal(p.product_type_label,'ORIGINÁL');
});
test('Incident 52850: renovated CMYK set remains renovated', () => {
  const p=mapProduct({...fixture('Canon CRG-067H CMYK renovovaná sada tonerov (4 ks)','renovovane'),id:52850});
  assert.equal(p.product_type_key,'renovated'); assert.equal(p.product_type_label,'RENOVOVANÝ');
});
test('Printer series never inflate the model count from five to seven', () => {
  const p=mapProduct(fixture('Canon CRG-067BK čierny originálny toner','originalne'));
  assert.deepEqual(p.compatible_printers,canonModels);
});
test('All three consumable kinds use the explicit attribute before contradictory prose or metadata', () => {
  for(const [value,key] of [['originalne','original'],['kompatibilne','compatible'],['renovovane','renovated']]) {
    const raw=fixture('Canon skúšobná kazeta',value); raw.meta_data=[{key:'_ciq_consumable_type',value:'compatible'}] as any;
    assert.equal(mapProduct(raw).product_type_key,key);
  }
});
test('Invalid physical meta value does not mask a valid business type', () => {
  const raw:any=fixture('Canon skúšobná kazeta','');raw.attributes=[];
  raw.meta_data=[{key:'_ciq_consumable_type',value:'toner'},{key:'_ciq_product_type',value:'original'}];
  assert.equal(mapProduct(raw).product_type_key,'original');
});
test('Explicit product names outrank compatibility text without attributes', () => {
  for(const [name,key] of [['Canon originálny toner','original'],['Canon renovovaný toner','renovated'],['Canon kompatibilný toner','compatible']]) {
    const raw=fixture(name,'');raw.attributes=[];
    assert.equal(mapProduct(raw).product_type_key,key);
  }
});
test('An untyped product is not labelled compatible merely due to its printer list', () => {
  const raw=fixture('Neurčená kazeta','');raw.attributes=[];
  assert.equal(mapProduct(raw).product_type_key,'product');
});
test('Regional imageCLASS models remain present in a combined metadata list', () => {
  const models=['Canon i-SENSYS LBP611Cn','Canon i-SENSYS LBP613Cdw','Canon i-SENSYS MF631Cn','Canon i-SENSYS MF633Cdw','Canon i-SENSYS MF635Cx','Canon imageCLASS LBP612Cdw','Canon imageCLASS MF632Cdw','Canon imageCLASS MF634Cdw'];
  const raw:any=fixture('Canon 045 originálny toner','originalne');raw.attributes=[raw.attributes[0],raw.attributes[1]];
  raw.meta_data=[{key:'_ciq_printer_models',value:models.join(', ')},{key:'_ciq_printer_series',value:'Canon i-SENSYS LBP610, Canon i-SENSYS MF630'}];
  assert.deepEqual(mapProduct(raw).compatible_printers,models);
});

test('Canon generation II models remain distinct from the original generation', () => {
  const models=['Canon i-SENSYS LBP122dw','Canon i-SENSYS LBP122dw II','Canon i-SENSYS MF272dw','Canon i-SENSYS MF272dw II','Canon i-SENSYS MF275dw','Canon i-SENSYS MF275dw II'];
  for(const fromMetadata of [false,true]) {
    const raw:any=fixture('Canon 071 originálny toner','originalne');
    raw.attributes=raw.attributes.slice(0,2);
    if(fromMetadata) raw.meta_data=[{key:'_ciq_printer_models',value:models.join(', ')}];
    else raw.attributes.push({name:'Model tlačiarne',options:models});
    assert.deepEqual(mapProduct(raw).compatible_printers,models);
  }
});
