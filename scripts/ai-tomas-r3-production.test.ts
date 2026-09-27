import { productPageYield, parsePageYieldValue } from '../src/lib/ai-page-yield.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';

// Execute actual server/client functions, not a copy of their algorithms.
function functionsFrom(relative: string, names: string[]) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
  const found = new Map<string,string>();
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) found.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(found.size, names.length, `Missing functions: ${names.filter(n=>!found.has(n))}`);
  return ts.transpileModule([...found.values()].join('\n'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
}
const serverYield = vm.runInNewContext(functionsFrom('../src/lib/aiSalesAssistant.ts',['parsePageYield'])+';parsePageYield', {productPageYield,normalize:(v:unknown)=>String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()});
const clientYield = vm.runInNewContext(functionsFrom('../src/scripts/ai-sales-assistant.js',['aiText','parseCapacity','costPerPage','costPerPageText'])+';({parseCapacity,costPerPage,costPerPageText})',{productPageYield});
for (const capacity of ['130 ml','700 ML','1,5 ml','0.7 l','500 g','2 × 130 ml','130 ml / 5 ks','']) {
  test(`objem alebo hmotnosť nie sú strany: ${capacity}`,()=>{
    const product={name:'Canon PFI-120BK atramentová náplň',capacity,price:85.80};
    assert.equal(serverYield(product),null);
    assert.equal(clientYield.parseCapacity(product),0);
    assert.equal(clientYield.costPerPageText(product),'');
  });
}
for (const [capacity,pages] of [['3 000 strán',3000],['3.000 pages',3000],['3000',3000],['2\u00a0400 strán',2400]] as const) {
  test(`skutočná výťažnosť zostáva funkčná: ${capacity}`,()=>{
    assert.equal(serverYield({capacity}),pages);
    assert.equal(clientYield.parseCapacity({capacity}),pages);
    assert.equal(clientYield.costPerPage({capacity,price:30}),30/pages);
  });
}
async function ask(message:string,state:any=emptyCommerceState('r3-live')) {
  const response=await POST({request:new Request('http://localhost/api/ai-tomas',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,state})})} as any);
  assert.equal(response.status,200,message);return response.json();
}
test('presný živý rozhovor Epson → nový Brother nevypíše starý kontext',async()=>{
  const first=await ask('Ukáž jedinú kompatibilnú Epson 604XL CMYK sadu. Nič nepridávaj do košíka.');
  const second=await ask('Ako môžem objednať 2 ks kompatibilného Brother TN-2421?',first.state);
  assert.doesNotMatch(second.advisor.answer.join(' '),/Epson|604XL|Nadväzujúca požiadavka/i);
  assert.match(second.advisor.answer.join(' '),/Rýchly nákup.*počet kusov.*pokladni/s);
  assert.ok(second.commerce.products.length);
  assert.ok(second.commerce.products.every((p:any)=>/TN-?2421/i.test(p.name)));
  assert.deepEqual(second.state.cart,[]);
});
test('doručená-neprevzatá zásielka nemá nevyžiadanú vetu o košíku',async()=>{
  const first=await ask('Canon PFI-102');
  const second=await ask('Zásielka je označená ako doručená, ale ja som ju neprevzal. Čo mám robiť?',first.state);
  assert.match(second.advisor.answer.join(' '),/GPS|záznamu o odovzdaní/);
  assert.doesNotMatch(second.advisor.answer.join(' '),/Rešpektujem váš pokyn|košík|overené možnosti/);
  assert.equal(second.commerce,null);assert.deepEqual(second.state.cart,[]);
});
test('výslovný zákaz zostane potvrdený a zachová obsah košíka',async()=>{
  const state={...emptyCommerceState('r3-cart'),cart:[{id:'keep',sku:'KEEP',quantity:2}]};
  const result=await ask('Ukáž Brother TN-2421. Nič nepridávaj do košíka.',state);
  assert.match(result.advisor.answer.join(' '),/nič som nepridal/i);
  assert.deepEqual(result.state.cart,state.cart);assert.notEqual(result.action?.kind,'ADD_TO_CART');
});
test('skutočná otázka na kompatibilitu zachová predchádzajúcu tlačiareň',async()=>{
  const result=await buildAssistantAnswer('Pasuje do nej TN-2421?','/',[{role:'user',content:'Mám Brother HL-L2352DW.'}]);
  assert.ok(result.products.length);assert.ok(result.products.some((p:any)=>/2421/.test(p.name)));
});

for (const [value,expected] of [
  ['130 ml / 3 000 strán',3000],['BK: 2400 strán; C/M/Y: 2100 strán',2100],
  ['130 mililitrov',null],['1.5 pages',null],['- 130 strán',null],['−130 strán',null],
  ['3000–6000 strán',null],['0 strán',null],['3,000 pages',3000],
] as const) test(`jednotky, formát a rozsah: ${value}`,()=>assert.equal(parsePageYieldValue(value),expected));
test('objem nevylučuje samostatnú doloženú výťažnosť',()=>{
  assert.equal(productPageYield({capacity:'130 ml',page_yield:3000}),3000);
  assert.equal(productPageYield({attributes:[{name:'Kapacita (ml)',options:['130']}]}),null);
  assert.equal(productPageYield({attributes:[{name:'Výťažnosť',options:['3 000 strán']}]}),3000);
});

// Render the real customer-facing templates. DOM/event boundaries are inert;
// assertions inspect produced HTML, including set and quantity views.
function renderer() {
  const output:string[]=[];
  const node={querySelector:()=>null,querySelectorAll:()=>[]};
  const noop=()=>{};
  const source=functionsFrom('../src/scripts/ai-sales-assistant.js',[
    'renderCommerceResults','productOfferCard','quantityChooser','aiText','parseCapacity',
    'costPerPage','costPerPageText','isInkOffer','isHighCapacity','aiType','aiTypeLabel','aiColorLabel',
  ]);
  const scope:any={productPageYield,state:{lastQuestion:'PFI',commerceState:{}},
    autoPanelSize:noop,trackEvent:noop,saveCommerceSession:noop,wireAvailability:noop,
    allowedAiProducts:(p:any)=>p,isAiInStock:()=>true,aiColor:(p:any)=>p.color,
    aiImage:(p:any)=>p.image||'',aiStockLabel:()=> 'Skladom',isCalendarProduct:()=>false,
    safeProductUrl:(p:any)=>p.url||'/produkt/test',webResultsUrl:()=>'/produkty?s=test',
    suitableProductsText:(n:number)=>`${n} produktov`,unavailableProductsText:(n:number)=>`${n} produktov`,
    dispatchSentence:()=> 'najbližší pracovný deň',escapeHtml:(v:unknown)=>String(v),
    money:(v:number)=>`${v.toFixed(2)} €`,discount:()=>0,unitPrice:(p:any)=>p.price,
    addMessage:(_role:string,html:string)=>{output.push(html);return node;},
    openCommerceStage:(html:string)=>output.push(html),commerceBack:noop,
    commerce:{querySelector:()=>({onclick:null,addEventListener:noop}),querySelectorAll:()=>[]},
    renderSafeProducts:(products:any[])=>products.forEach(p=>output.push(api.productOfferCard(p,0))),
  };
  const api=vm.runInNewContext(source+';({renderCommerceResults,productOfferCard,quantityChooser})',scope);
  return {api,output};
}
for(const type of ['original','compatible','renovated'])test(`karty, sada a množstvo ${type} PFI neuvádzajú cenu za stranu`,()=>{
  const {api,output}=renderer();
  const product={id:'pfi',sku:'PFI-120BK',name:'Canon PFI-120BK atramentová náplň',capacity:'130 ml',price:85.80,type,color:'black'};
  const pack={...product,id:'pack',name:'Canon PFI-120 CMYK sada atramentových náplní',color:'cmyk',package_shape:'set',price:200.07};
  api.renderCommerceResults({products:[product,pack],presentation:{isColorPrinter:true,sets:[{type,products:[pack],packageKind:'catalog',totalPrice:200.07}]}});
  output.push(api.productOfferCard(product,0));api.quantityChooser(product);
  assert.ok(output.join('').includes('85.80 €'));
  assert.doesNotMatch(output.join(''),/€\/strana|€\/farebná strana|Kapacita 130 strán|pomer cena\/strana/);
});
test('produkt s doloženými stranami si ponechá cenu za stranu aj v množstve',()=>{
  const {api,output}=renderer();const p={name:'Brother TN-2421 toner',capacity:'3 000 strán',price:30,type:'compatible',color:'black'};
  output.push(api.productOfferCard(p,0));api.quantityChooser(p);
  assert.match(output.join(''),/0,0100 €\/strana/);assert.match(output.join(''),/3\s*000 strán/);
});
for(const message of ['Tlačiareň tlačí pásy.','Na papieri sú pruhy.'])test('diagnostika pásov zostáva funkčná: '+message,async()=>{
  const result=await buildAssistantAnswer(message);assert.equal(result.faq,'tlaci-pasy');
});
test('výmena produktu aj bez nákupného slovesa nezachová pôvodnú rodinu',async()=>{
  const result=await buildAssistantAnswer('Môžem dostať ponuku Canon PFI-120?','/',[{role:'user',content:'Epson 604XL'}]);
  assert.doesNotMatch(result.answer.join(' '),/604XL|Nadväzujúca požiadavka/);
  assert.ok(result.products.every((p:any)=>/PFI-120/i.test(p.name)));
});
for(const family of ['Canon PFI-102','Canon PFI-120'])test('skutočný katalóg → API → HTML bez zámeny ml: '+family,async()=>{
  const result=await ask(family);assert.ok(result.commerce.products.length);
  assert.ok(result.commerce.products.some((p:any)=>/ml/i.test(p.capacity)));
  const {api,output}=renderer();api.renderCommerceResults(result.commerce);
  assert.doesNotMatch(output.join(''),/€\/strana|€\/farebná strana|pomer cena\/strana/);
  assert.deepEqual(result.state.cart,[]);
});
