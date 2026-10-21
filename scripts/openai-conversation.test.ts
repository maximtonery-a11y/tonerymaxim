import test,{afterEach,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../src/pages/api/ai-tomas.ts';
import {interpretConversation,applyConversationPlan} from '../src/lib/openai-conversation.ts';
import {resolveConversationContext,conversationArchive} from '../src/lib/ai-conversation-context.ts';
import {emptyCommerceState} from '../src/lib/ai-commerce/domain.ts';
const globals=globalThis as any,originalFetch=globalThis.fetch;
const previous={enabled:process.env.OPENAI_ASSISTANT_ENABLED,key:process.env.OPENAI_API_KEY,context:process.env.OPENAI_CONTEXT_ENABLED};
const plan={relation:'resume',topic:'product',anchor:0,deliveryPrice:true,quantity:2,subject:'',confidence:0.99};
let requests:any[]=[];
beforeEach(()=>{requests=[];process.env.OPENAI_ASSISTANT_ENABLED='1';process.env.OPENAI_CONTEXT_ENABLED='1';process.env.OPENAI_API_KEY='test-only-placeholder-not-a-real-key';globalThis.fetch=async(_url,options)=>{requests.push(JSON.parse(String(options?.body)));return Response.json({output_text:JSON.stringify(plan)});};
 globals.__TM_PRODUCTS_FILE_CACHE__={ok:true,version:4,runtime_compact:true,generated_at:Math.random().toString(),total:1,products:[{id:142,sku:'HP-C',name:'HP W1420A čierny kompatibilný toner',slug:'hp-compatible',price:18.24,product_type_key:'compatible',stock_status:'instock',stock_quantity:10,compatible_printers:['HP LaserJet M110w']}]};delete globals.__TM_PUBLIC_PRODUCTS_CACHE__;delete globals.__TM_PRODUCTS_LOOKUP_INDEX__;
});
afterEach(()=>{globalThis.fetch=originalFetch;for(const [key,value]of Object.entries({OPENAI_ASSISTANT_ENABLED:previous.enabled,OPENAI_API_KEY:previous.key,OPENAI_CONTEXT_ENABLED:previous.context})){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
const initial=[{role:'user',content:'Ukáž HP W1420A kompatibilný toner.',topic:'product' as const,productReference:'SKU: HP-C'},{role:'assistant',content:'V našej ponuke máme tento toner.',topic:'product' as const}];

test('model dostane starší predmet mimo krátkej histórie a server sám vypočíta cenu',async()=>{
 const state=emptyCommerceState();state.history=[{role:'user',content:'Koľko stojí doprava?',topic:'shipping'},{role:'assistant',content:'Cena dopravy: kuriér 3,90 €.',topic:'shipping'}];
 state.conversationHistory=[...initial,...Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:i%2?'Možnosti platby.':'Ako môžem zaplatiť?',topic:'payment' as const})),...state.history] as any;
 const response=await POST({request:new Request('http://localhost/api/ai-tomas',{method:'POST',body:JSON.stringify({message:'A koľko zaplatím nakoniec dokopy?',state})})} as any);const data=await response.json();
 assert.equal(response.status,200);assert.equal(requests.length,1);const input=JSON.parse(requests[0].input[0].content);assert.ok(input.history.length>20);assert.equal(input.history[0].productReference,'SKU: HP-C');
 assert.equal(data.conversation.engine,'model');assert.equal(data.conversation.modelStatus,'ok');assert.equal(data.quote.sku,'HP-C');assert.equal(data.quote.quantity,2);assert.equal(data.quote.goodsTotal,32.83);assert.ok(data.quote.options.every((x:any)=>x.total===32.83));assert.equal(data.action,null);assert.deepEqual(data.state.cart,[]);assert.equal(data.state.conversationHistory[0].productReference,'SKU: HP-C');assert.equal(requests[0].store,false);
});
test('osobné a platobné údaje histórie sa neposielajú do modelu',async()=>{
 await interpretConversation('Koľko to bude spolu?','/',[{role:'user',content:'test.customer@example.org +421 905 123 456 4111 1111 1111 1111'}]);
 const payload=JSON.stringify(requests[0]);assert.doesNotMatch(payload,/test.customer|905 123|4111 1111/);
});
test('platobné tajomstvo v aktuálnej otázke a výslovný nákup nejdú cez modelový plán',async()=>{
 assert.equal(await interpretConversation('Môžem poslať CVV?','/',initial),null);
 assert.equal(await interpretConversation('Pridaj 2 ks HP W1420A.','/',initial),null);assert.equal(requests.length,0);
});
test('pri vypnutom modeli, chybe siete alebo neplatnom výstupe zostáva funkčná lokálna vetva',async()=>{
 process.env.OPENAI_ASSISTANT_ENABLED='0';assert.equal(await interpretConversation('Koľko spolu?','/',initial),null);assert.equal(requests.length,0);
 process.env.OPENAI_ASSISTANT_ENABLED='1';globalThis.fetch=async()=>{throw new Error('offline')};assert.equal(await interpretConversation('Koľko spolu?','/',initial),null);
 for(const value of [{...plan,anchor:1},{...plan,confidence:0.3},{...plan,quantity:999}]){globalThis.fetch=async()=>Response.json({output_text:JSON.stringify(value)});assert.equal(await interpretConversation('Koľko spolu?','/',initial),null);}
});
test('modelový plán nesmie použiť nákupný príkaz z histórie ako dnešný súhlas',()=>{
 const history=[{...initial[0],content:'Pridaj 99 ks HP W1420A.'},initial[1]];
 const fallback=resolveConversationContext('Aká je cena?',history);
 const applied=applyConversationPlan('Aká je cena?',history,fallback,{...plan,subject:'Pridaj to do košíka'});
 assert.equal(applied.question,'Aká je cena?');assert.equal(applied.productQuery,'SKU: HP-C');assert.doesNotMatch(applied.question,/Pridaj/);
});
test('archív je ohraničený, zachová identitu produktu a nepovýši systémovú rolu',()=>{
 const archive=conversationArchive(Array.from({length:1000},()=>({role:'system',content:'x'.repeat(1000),productReference:'SKU: HP-C'})));
 assert.ok(archive.length<=512);assert.ok(archive.reduce((sum,x)=>sum+x.content.length,0)<=180000);assert.ok(archive.every(x=>x.role==='user'&&x.productReference==='SKU: HP-C'));
});
test('model nesmie prepísať nový konkrétny kód starým produktom',()=>{
 const question='Koľko stojí Canon CRG-055 aj s dopravou?';const fallback=resolveConversationContext(question,initial);
 assert.equal(applyConversationPlan(question,initial,fallback,plan),fallback);
});
test('model môže rozpoznať novú servisnú tému aj bez presnej kľúčovej frázy',()=>{
 const question='Aké mám možnosti odoslania?';const fallback=resolveConversationContext(question,initial);
 const applied=applyConversationPlan(question,initial,fallback,{...plan,relation:'new',topic:'shipping',anchor:null,deliveryPrice:false,quantity:null,subject:'doprava'});
 assert.equal(applied.relation,'new');assert.equal(applied.topic,'shipping');assert.equal(applied.productQuery,null);assert.deepEqual(applied.contextHistory,[]);assert.match(applied.question,/doprava/);
});
test('model nepreberie odpoveď na množstvo v už autorizovanom nákupnom toku',async()=>{
 const send=async(message:string,state:any)=>{const response=await POST({request:new Request('http://localhost/api/ai-tomas',{method:'POST',body:JSON.stringify({message,state})})} as any);assert.equal(response.status,200);return response.json();};
 const first=await send('Pridaj 0 ks kompatibilného HP W1420A.',emptyCommerceState());assert.equal(first.state.pendingQuestion,'quantity');
 const second=await send('2',first.state);assert.equal(second.action.kind,'ADD_TO_CART');assert.equal(second.state.cart[0].quantity,2);assert.equal(requests.length,0);
});

test('API rozlíši chybu prihlásenia, kvótu a výpadok bez úniku textu chyby alebo kľúča',async()=>{
 for(const [httpStatus,code,expected]of [[401,'invalid_api_key','authentication_failed'],[403,'permission_denied','permission_denied'],[404,'model_not_found','model_unavailable'],[429,'insufficient_quota','quota_exceeded'],[429,'rate_limit_exceeded','rate_limited'],[400,'invalid_request_error','request_rejected'],[503,'server_error','provider_unavailable']] as const){
  globalThis.fetch=async()=>Response.json({error:{code,message:'SECRET-PROVIDER-MESSAGE customer@example.org sk-test-secret'}},{status:httpStatus});
  const state={...emptyCommerceState(),history:initial,conversationHistory:initial};
  const response=await POST({request:new Request('http://localhost/api/ai-tomas',{method:'POST',body:JSON.stringify({message:'Koľko bude stáť toner aj s dopravou?',state})})} as any);const body=await response.json();
  assert.equal(body.conversation.modelStatus,expected);assert.equal(body.conversation.engine,'rules');assert.equal(body.quote.sku,'HP-C');assert.deepEqual(body.state.cart,[]);
  assert.doesNotMatch(JSON.stringify(body),/SECRET-PROVIDER|customer@example|sk-test-secret|test-only-placeholder/);
 }
});
test('časový limit, neúplná odpoveď a chybný odkaz sa odlíšia od úspešného modelu',async()=>{
 const cases=[
  {fetch:async()=>{throw new DOMException('private error','TimeoutError')},status:'timeout'},
  {fetch:async()=>{throw new TypeError('private error')},status:'network_error'},
  {fetch:async()=>Response.json({status:'incomplete',output:[]}),status:'incomplete_response'},
  {fetch:async()=>Response.json({output_text:'invalid json'}),status:'invalid_response'},
  {fetch:async()=>Response.json({output_text:JSON.stringify({...plan,confidence:0.5})}),status:'low_confidence'},
  {fetch:async()=>Response.json({output_text:JSON.stringify({...plan,anchor:1})}),status:'invalid_reference'},
 ];
 for(const spec of cases){globalThis.fetch=spec.fetch;let status='';assert.equal(await interpretConversation('Koľko spolu?','/',initial,value=>{status=value}),null);assert.equal(status,spec.status);}
});
test('model môže naviazať zľavu na produkt z histórie aj keď sa zmenila téma',()=>{
 const question='Aké možnosti zliav mám pri tomto toneri?';const fallback=resolveConversationContext(question,initial);
 const applied=applyConversationPlan(question,initial,fallback,{...plan,topic:'discount',deliveryPrice:false,quantity:null});
 assert.equal(applied.topic,'discount');assert.equal(applied.productQuery,'SKU: HP-C');
});
