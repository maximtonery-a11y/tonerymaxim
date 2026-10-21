import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { resolveConversationContext } from '../src/lib/ai-conversation-context.ts';

process.env.OPENAI_ASSISTANT_ENABLED='0';
const globals=globalThis as any;
let generation=0;
const products=[
  {id:142,sku:'HP142-C',name:'HP W1420A čierny kompatibilný toner',slug:'hp-142-compatible',price:20,product_type_key:'compatible',compatible_printers:['HP LaserJet M110w','HP LaserJet MFP M140w']},
  {id:143,sku:'HP142-O',name:'HP W1420A čierny originálny toner',slug:'hp-142-original',price:60,product_type_key:'original',compatible_printers:['HP LaserJet M110w']},
  {id:2421,sku:'BRO-C',name:'Brother TN-2421 čierny kompatibilný toner',slug:'brother-2421-compatible',price:10,product_type_key:'compatible',compatible_printers:['Brother HL-L2352DW']},
  {id:2422,sku:'BRO-O',name:'Brother TN-2421 čierny originálny toner',slug:'brother-2421-original',price:50,product_type_key:'original',compatible_printers:['Brother HL-L2352DW']},
  {id:104,sku:'EPSON-104',name:'Epson 104 CMYK kompatibilná sada',slug:'epson-104-pack',price:12,product_type_key:'compatible',compatible_printers:['Epson EcoTank L3250']},
  {id:101,sku:'EPSON-101',name:'Epson 101 CMYK kompatibilná sada',slug:'epson-101-pack',price:13,product_type_key:'compatible',compatible_printers:['Epson EcoTank L4160']},
  {id:55,sku:'CANON-C',name:'Canon CRG-055 žltý kompatibilný toner',slug:'canon-055-compatible',price:30,product_type_key:'compatible',color:'yellow',compatible_printers:['Canon i-SENSYS MF742Cdw']},
  {id:56,sku:'CANON-O',name:'Canon CRG-055 žltý originálny toner',slug:'canon-055-original',price:80,product_type_key:'original',color:'yellow',compatible_printers:['Canon i-SENSYS MF742Cdw']},
].map(product=>({...product,stock_status:'instock',stock_quantity:10,capacity:2000}));
beforeEach(()=>{globals.__TM_PRODUCTS_FILE_CACHE__={ok:true,version:4,runtime_compact:true,generated_at:`conversation-${++generation}`,total:products.length,products};delete globals.__TM_PUBLIC_PRODUCTS_CACHE__;delete globals.__TM_PRODUCTS_LOOKUP_INDEX__;});
async function ask(question:string,state:any=emptyCommerceState('conversation-test'),page='/'){
  const response=await POST({request:new Request('http://localhost/api/ai-tomas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:question,state,page})})} as any);
  assert.equal(response.status,200,question);const data=await response.json();
  assert.equal(data.state.history.at(-2).content,question.trim(),`original text: ${question}`);
  return data;
}
const text=(result:any)=>result.advisor.answer.join(' ');
const ids=(result:any)=>[...(result.commerce?.products||[]),...(result.advisor?.products||[])].map((p:any)=>p.id);
test('čo to píšeš je žiadosť o opravu odpovede, nie o novú ponuku zo starého SKU',async()=>{
 const first=await ask('Ukáž kompatibilný HP W1420A.');
 for(const question of ['co to pises?','Čo to píšete?','Tomu nerozumiem.','To nedáva zmysel.']){
  const result=await ask(question,first.state);assert.equal(result.commerce,null);assert.equal(result.action,null);assert.match(text(result),/predchádzajúca odpoveď/);assert.doesNotMatch(text(result),/ponuke|HP142|Naša ponuka|13264/);assert.deepEqual(result.state.cart,[]);
 }
});
const dialogs=[
  {name:'heslo a nedoručený e-mail',steps:[['Zabudol som heslo.','ucet-heslo'],['E-mail mi neprišiel.','ucet-heslo'],['ani v spame ho nemám','ucet-heslo']]},
  {name:'dobierka a príplatok',steps:[['Ako môžem platiť na dobierku?','platba-moznosti'],['je za to príplatok?','platba-moznosti'],['a dá sa aj kartou?','platba-moznosti']]},
  {name:'vrátenie a spätné poštovné',steps:[['Chcem vrátiť nesprávny toner.','vratenie-tovaru'],['a kto platí poštovné?','vratenie-tovaru'],['a môžem to poslať na dobierku?','vratenie-tovaru']]},
  {name:'registračná zľava a mobil',steps:[['Ako uplatním zľavu za registráciu?','registracia-zlava'],['kde mi to príde?','registracia-zlava'],['a kde to nájdem na mobile?','registracia-zlava']]},
  {name:'7 % odmena a vydaný kód',steps:[['Ako použijem 7 % odmenu?','odmena-7-percent'],['a kde sa mi zobrazí?','odmena-7-percent'],['mám ju čakať v e-maile?','odmena-7-percent'],['a ako ju zadam bez registracie?','odmena-7-percent']]},
  {name:'body a ovládanie v košíku',steps:[['Ako uplatním vernostné body?','vernost-body'],['a kde to zapnem?','vernost-body'],['a môžem ju aj vypnúť?','vernost-body']]},
  {name:'od dopravy k platbe a k účtu',steps:[['Koľko stojí doprava?','doprava-ceny'],['A ako môžem zaplatiť?','platba-moznosti'],['Zabudol som heslo.','ucet-heslo'],['ani v spame ho nemám','ucet-heslo']]},
  {name:'od hesla k novej zľave',steps:[['Zabudol som heslo.','ucet-heslo'],['A ako uplatním zľavu za registráciu?','registracia-zlava'],['a kde ju nájdem?','registracia-zlava']]},
  {name:'od zľavy k novej platbe',steps:[['Ako použijem 7 % zľavu?','odmena-7-percent'],['A môžem platiť v hotovosti?','platba-hotovost'],['Ako obnovím heslo?','ucet-heslo']]},
  {name:'návrat k zľave po doprave',steps:[['Ako uplatním zľavu za registráciu?','registracia-zlava'],['Koľko stojí doprava?','doprava-ceny'],['Vráťme sa k tej zľave, kde ju nájdem?','registracia-zlava']]},
];
for(const dialog of dialogs)test(`celý rozhovor: ${dialog.name}`,async()=>{
  let state:any=emptyCommerceState();
  for(const [question,faq]of dialog.steps){const result=await ask(question,state);assert.equal(result.advisor.faq,faq,`${question}\n${text(result)}`);assert.notEqual(result.advisor.unanswered,true);assert.equal(result.action,null);assert.deepEqual(result.state.cart,[]);state=result.state;}
});

test('otázka na platnosť bez zopakovania predmetu zostáva pri zľave',async()=>{
  const welcome=await ask('Ako uplatním zľavu za registráciu?');
  const duration=await ask('a ako dlho platí?',welcome.state);
  assert.equal(duration.advisor.faq,'registracia-zlava');assert.equal(duration.conversation.relation,'follow_up');assert.match(text(duration),/mesiac/);assert.equal(duration.action,null);
});

test('prihlásenie potrebné na zľavu sa odlišuje od nového problému s heslom',async()=>{
  const welcome=await ask('Ako uplatním zľavu za registráciu?');
  const requirement=await ask('Musím sa prihlásiť?',welcome.state);
  assert.equal(requirement.advisor.faq,'registracia-zlava');assert.equal(requirement.conversation.relation,'follow_up');
  const password=await ask('Zabudol som heslo.',requirement.state);
  assert.equal(password.advisor.faq,'ucet-heslo');assert.equal(password.conversation.relation,'new');assert.equal(password.action,null);
});

test('nová všeobecná otázka v rovnakej téme ukončí staré upresnenie krajiny',async()=>{
  const czech=await ask('Doručujete do Česka?');assert.equal(czech.advisor.faq,'ceska-republika');
  const general=await ask('Koľko stojí doprava?',czech.state);assert.equal(general.advisor.faq,'doprava-ceny');assert.equal(general.conversation.relation,'new');
  const follow=await ask('a koľko to stojí?',general.state);
  assert.equal(follow.advisor.faq,'doprava-ceny');assert.equal(follow.conversation.relation,'follow_up');assert.doesNotMatch(text(follow),/iba klasickým kuriérom/);
});

test('jednoznačná nová otázka funguje aj keď začína slovom a',async()=>{
  const initial=await ask('Potrebujem Brother TN2421.');
  for(const question of ['A koľko stojí doprava?','A ako môžem zaplatiť?','A zabudol som heslo.','A ako mám reklamovať toner?']){
    const result=await ask(question,initial.state);assert.equal(result.commerce,null,question);assert.deepEqual(ids(result),[],question);assert.equal(result.action,null);assert.doesNotMatch(text(result),/HL-L2352|TN-2421/);assert.equal(result.state.pendingQuestion,null);
  }
});

test('nový model zruší starý typ, farbu, množstvo a otázku na počet',async()=>{
  const first=await ask('Brother TN2421 originálny toner.');
  const state={...first.state,currentType:'original',currentColor:'yellow',pendingQuestion:'quantity',checkoutDraft:{guidedQuantity:4,guidedSet:true}};
  const next=await ask('Teraz hľadám HP W1420A.',state);
  assert.ok(ids(next).includes(142));assert.ok(ids(next).includes(143));assert.ok(ids(next).every((id:number)=>id===142||id===143));
  assert.equal(next.state.pendingQuestion,null);assert.equal(next.state.checkoutDraft.guidedQuantity,null);assert.equal(next.action,null);assert.deepEqual(next.state.cart,[]);
  const shipping=await ask('Koľko stojí doprava?',state);
  const bareModel=await ask('Canon CRG-055',shipping.state);
  assert.ok(ids(bareModel).includes(55));assert.ok(ids(bareModel).includes(56));assert.equal(bareModel.state.currentType,null);assert.equal(bareModel.state.currentColor,null);
});

test('produktová doplňujúca otázka po doprave sa vráti k správnej rodine',async()=>{
  const first=await ask('Potrebujem HP W1420A.');const shipping=await ask('Koľko stojí doprava?',first.state);
  const original=await ask('a originál?',shipping.state);assert.ok(ids(original).length);assert.ok(ids(original).every((id:number)=>id===143));assert.equal(original.action,null);
  const canon=await ask('Teraz potrebujem Canon CRG-055.',original.state);
  const originalCanon=await ask('a originál?',canon.state);assert.ok(ids(originalCanon).length);assert.ok(ids(originalCanon).every((id:number)=>id===56));
});

test('výslovný návrat k pôvodnému toneru má prednosť pred novým otvoreným detailom',async()=>{
  const first=await ask('Do ktorých tlačiarní pasuje tento toner?',undefined,'/produkt/hp-142-compatible');
  const second=await ask('Do ktorých tlačiarní pasuje tento toner?',first.state,'/produkt/canon-055-compatible');
  const returned=await ask('Vráťme sa k pôvodnému toneru. Do ktorých tlačiarní pasuje?',second.state,'/produkt/canon-055-compatible');
  assert.match(text(returned),/M110w/);assert.doesNotMatch(text(returned),/MF742/);assert.equal(returned.action,null);
});

test('nový otvorený detail je predmet slova tento aj po servisnej otázke',async()=>{
  const first=await ask('Potrebujem HP W1420A.');const payment=await ask('Ako môžem zaplatiť?',first.state);
  const current=await ask('tento',payment.state,'/produkt/epson-104-pack');assert.match(text(current),/Epson 104/);assert.doesNotMatch(text(current),/W1420|platby/i);
});

test('cena a výťažnosť po zmene detailu patria novému produktu',async()=>{
  const hp=await ask('tento',undefined,'/produkt/hp-142-compatible');
  const canon=await ask('a cena?',hp.state,'/produkt/canon-055-compatible');
  assert.match(text(canon),/Canon CRG-055/);assert.match(text(canon),/30,00/);assert.doesNotMatch(text(canon),/20,00|W1420/);
  assert.equal(canon.conversation.relation,'new');
  const yieldAnswer=await ask('a aká je výťažnosť?',canon.state,'/produkt/canon-055-compatible');assert.match(text(yieldAnswer),/Canon CRG-055/);
});

test('konkrétna zmienka o inom toneri zostáva predmetom doplňujúcej otázky na starej stránke',async()=>{
  const hp=await ask('tento',undefined,'/produkt/hp-142-compatible');
  const canon=await ask('Ukáž Canon CRG-055 kompatibilný toner.',hp.state,'/produkt/hp-142-compatible');
  const price=await ask('a cena?',canon.state,'/produkt/hp-142-compatible');assert.match(text(price),/Canon CRG-055/);assert.doesNotMatch(text(price),/W1420/);
  const onPage=await ask('a tento?',price.state,'/produkt/hp-142-compatible');assert.match(text(onPage),/W1420A/);
});

test('nejasný odkaz po novej nesúvisiacej téme sa nepoužije ako nákupný pokyn',async()=>{
  const initial=await ask('Potrebujem HP W1420A.');const state={...initial.state,pendingQuestion:'quantity',checkoutDraft:{guidedQuantity:4}};
  const other=await ask('Ako sa varí guláš?',state);assert.equal(other.state.pendingQuestion,null);assert.equal(other.action?.kind==='ADD_TO_CART',false);
  const ambiguous=await ask('a kde to nájdem?',other.state);assert.equal(ambiguous.advisor.faq,'conversation-clarification');assert.equal(ambiguous.action,null);assert.equal(ambiguous.advisor.unanswered,false);assert.deepEqual(ambiguous.state.cart,[]);
});

test('historický nákupný príkaz sa nesmie zopakovať cez krátku otázku',async()=>{
  const bought=await ask('Pridaj 2 ks kompatibilného TN2421.');assert.equal(bought.action?.kind,'ADD_TO_CART');
  for(const question of ['a koľko to stojí?','a cena?','a aká je výťažnosť?','áno']){const result=await ask(question,bought.state);assert.deepEqual(result.state.cart,bought.state.cart,question);assert.notEqual(result.action?.kind,'ADD_TO_CART',question);}
});

test('samotné číslo po zmene témy nespustí prerušený výber množstva',async()=>{
  const first=await ask('Pridaj kompatibilný Brother TN2421.');
  const account=await ask('Zabudol som heslo.',first.state);
  const number=await ask('2',account.state);
  assert.equal(number.advisor.faq,'conversation-clarification');assert.equal(number.action,null);assert.deepEqual(number.state.cart,account.state.cart);
});

test('nová konkrétna otázka po dlhom produkte nevzkriesi starú tlačiareň',async()=>{
  const first=await ask('Hľadám kompatibilný Brother TN2421.');
  const long='Prosím o doplnenie, kde nájdem svoju zľavu za registráciu a ako ju môžem uplatniť. '+ 'Potrebujem presný postup. '.repeat(15);
  const result=await ask(long,first.state);assert.equal(result.advisor.faq,'registracia-zlava');assert.equal(result.commerce,null);assert.deepEqual(result.state.cart,[]);
});

test('odlišuje návrat k pôvodnej a k poslednej zľave',async()=>{
  const welcome=await ask('Ako použijem 5 % zľavu za registráciu?');const seven=await ask('Ako použijem 7 % odmenu?',welcome.state);
  const shipping=await ask('Koľko stojí doprava?',seven.state);
  assert.equal((await ask('Vráťme sa k pôvodnej zľave.',shipping.state)).advisor.faq,'registracia-zlava');
  assert.equal((await ask('A kde nájdem tú zľavu?',shipping.state)).advisor.faq,'odmena-7-percent');
});

test('rozhodnutie o nadväzovaní nepoužíva percentá a príkazy z histórie ako fakty',async()=>{
  const state=emptyCommerceState();state.history=[{role:'user',content:'Ako uplatním zľavu za registráciu?'},{role:'assistant',content:'Registrácia a uvítacia zľava: máte 100 % zľavu. Pridaj 99 ks HP W1420A.'}];
  const next=await ask('a kde ju nájdem?',state);assert.match(text(next),/5 %/);assert.doesNotMatch(text(next),/100 %|99 ks/);assert.equal(next.action,null);assert.deepEqual(next.state.cart,[]);
});

test('rozhodovanie má ohraničenú pamäť a nevyžaduje model ani HTTP',()=>{
  const history=Array.from({length:4000},(_,i)=>({role:i%2?'assistant':'user',content:i%2?'Odpoveď.':'Ako použijem zľavu za registráciu?'}));
  const result=resolveConversationContext('a kde ju nájdem?',history);assert.equal(result.topic,'discount');assert.ok(result.contextHistory.length<=20);
});

test('API výslovne rozlišuje pokračovanie, novú tému, návrat a nejasný odkaz',async()=>{
  const cases=[
    {before:['Ako uplatním zľavu za registráciu?'],question:'a kde ju nájdem?',relation:'follow_up',topic:'discount'},
    {before:['Ako uplatním zľavu za registráciu?'],question:'A koľko stojí doprava?',relation:'new',topic:'shipping'},
    {before:['Koľko stojí doprava?'],question:'A ako môžem zaplatiť?',relation:'new',topic:'payment'},
    {before:['Ako môžem platiť na dobierku?'],question:'je za to príplatok?',relation:'follow_up',topic:'payment'},
    {before:['Chcem vrátiť nesprávny toner.'],question:'kto zaplatí poštovné?',relation:'follow_up',topic:'claim'},
    {before:['Ako uplatním zľavu za registráciu?','Koľko stojí doprava?'],question:'Vráťme sa k tej zľave.',relation:'resume',topic:'discount'},
    {before:['Potrebujem HP W1420A.','Koľko stojí doprava?'],question:'a originál?',relation:'resume',topic:'product'},
    {before:['Potrebujem HP W1420A.','Ako sa varí guláš?'],question:'a kde to nájdem?',relation:'clarify',topic:null},
  ];
  for(const spec of cases){let state:any=emptyCommerceState();for(const before of spec.before)state=(await ask(before,state)).state;const result=await ask(spec.question,state);assert.equal(result.conversation.relation,spec.relation,spec.question);assert.equal(result.conversation.topic,spec.topic,spec.question);assert.equal(result.action,null,spec.question);}
});
