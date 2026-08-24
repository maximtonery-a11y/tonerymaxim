import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { imageDimensions } from '../src/lib/marketing-creatives.ts';
import { merchantDiagnostics } from '../src/lib/merchant-diagnostics.ts';
import { marketingOverview } from '../src/lib/marketing-overview.ts';
import { campaignBuilder } from '../src/lib/campaign-builder.ts';
import { saveMarketingDraft } from '../src/lib/marketing-drafts.ts';
import { decideMarketingDraft,readMarketingApprovals,reviewMarketingDraft } from '../src/lib/marketing-approval.ts';
import { buildGoogleAdsPublication } from '../src/lib/google-ads-publication.ts';
import { GET as creativeGet,POST as creativePost } from '../src/pages/api/admin/marketing-creatives.ts';
import { GET as approvalGet,POST as approvalPost } from '../src/pages/api/admin/marketing-approval.ts';
import { POST as publicationPost } from '../src/pages/api/admin/google-ads-publication.ts';
import { POST as validateOnlyPost } from '../src/pages/api/admin/google-ads-validate-only.ts';
import { GET as searchTermsGet } from '../src/pages/api/admin/search-terms.ts';
import { buildProtectedSearchCodes,decideSearchTermAction,exportApprovedNegativeTerms,protectedSearchTerm } from '../src/lib/search-term-actions.ts';
import { creativePerformance } from '../src/lib/creative-performance.ts';
import { budgetGuard,landingPageDiagnostics,marketingAlerts,marketingControlCenter,paidFunnel } from '../src/lib/marketing-control-center.ts';
import { GET as controlCenterGet } from '../src/pages/api/admin/marketing-control-center.ts';
import { deploymentAction,enqueueDeployment,readDeploymentQueue } from '../src/lib/marketing-deployment-queue.ts';
import { GET as deploymentGet } from '../src/pages/api/admin/marketing-deployment-queue.ts';
import { GET as dataV3Get } from '../src/pages/api/admin/data-attribution-v3.ts';
import { TM_PRODUCT_CACHE_ROOT } from '../src/lib/runtime-paths.ts';

const key='0123456789abcdef0123456789abcdef',locals={runtime:{env:{TM_ANALYTICS_ADMIN_KEY:key}}};
const context=(request:Request)=>({request,url:new URL(request.url),locals}) as any;

test('knižnica obrázkov odmietne anonymný GET aj POST',async()=>{
  assert.equal((await creativeGet(context(new Request('https://www.tonerymaxim.sk/api/admin/marketing-creatives')))).status,401);
  assert.equal((await creativePost(context(new Request('https://www.tonerymaxim.sk/api/admin/marketing-creatives',{method:'POST'})))).status,401);
});

test('schvaľovacie API odmietne anonymný prístup',async()=>{
  assert.equal((await approvalGet(context(new Request('https://www.tonerymaxim.sk/api/admin/marketing-approval')))).status,401);
  assert.equal((await publicationPost(context(new Request('https://www.tonerymaxim.sk/api/admin/google-ads-publication',{method:'POST'})))).status,401);
  assert.equal((await validateOnlyPost(context(new Request('https://www.tonerymaxim.sk/api/admin/google-ads-validate-only',{method:'POST'})))).status,401);
  assert.equal((await searchTermsGet(context(new Request('https://www.tonerymaxim.sk/api/admin/search-terms')))).status,401);
  assert.equal((await controlCenterGet(context(new Request('https://www.tonerymaxim.sk/api/admin/marketing-control-center')))).status,401);
  assert.equal((await deploymentGet(context(new Request('https://www.tonerymaxim.sk/api/admin/marketing-deployment-queue')))).status,401);
  assert.equal((await dataV3Get(context(new Request('https://www.tonerymaxim.sk/api/admin/data-attribution-v3')))).status,401);
});

test('validate-only API zostáva bez explicitného serverového povolenia zamknuté',async()=>{
  const request=new Request('https://www.tonerymaxim.sk/api/admin/google-ads-validate-only',{method:'POST',headers:{'x-admin-key':key,'content-type':'application/json'},body:'{}'});assert.equal((await validateOnlyPost(context(request))).status,423);
});

test('rozmery PNG sa čítajú z binárnych dát, nie z názvu súboru',()=>{
  const png=Buffer.alloc(100);png.writeUInt8(0x89,0);png.write('PNG',1);png.writeUInt32BE(1200,16);png.writeUInt32BE(628,20);
  assert.deepEqual(imageDimensions(png,'image/png'),{width:1200,height:628});
  assert.equal(imageDimensions(Buffer.from('not-image'),'image/png'),null);
});

test('oprávnené API uloží validovaný obrázok a vráti jeho náhľad',async()=>{
  const png=Buffer.alloc(100);png.writeUInt8(0x89,0);png.write('PNG',1);png.writeUInt32BE(1200,16);png.writeUInt32BE(628,20);
  const form=new FormData();form.set('name','Test landscape');form.set('file',new File([png],'test.png',{type:'image/png'}));
  const upload=await creativePost(context(new Request('https://www.tonerymaxim.sk/api/admin/marketing-creatives',{method:'POST',headers:{'x-admin-key':key},body:form})));
  assert.equal(upload.status,201);const saved:any=await upload.json();assert.equal(saved.item.width,1200);assert.ok(saved.item.usage.includes('landscape'));
  const preview=await creativeGet(context(new Request(`https://www.tonerymaxim.sk/api/admin/marketing-creatives?id=${saved.item.id}`,{headers:{'x-admin-key':key}})));
  assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/png');assert.equal((await preview.arrayBuffer()).byteLength,100);
});

test('oprávnené API odmietne falošný alebo príliš malý obrázok',async()=>{
  const form=new FormData();form.set('file',new File([Buffer.alloc(200)],'fake.png',{type:'image/png'}));
  const response=await creativePost(context(new Request('https://www.tonerymaxim.sk/api/admin/marketing-creatives',{method:'POST',headers:{'x-admin-key':key},body:form})));
  assert.equal(response.status,400);assert.match((await response.json()).error,/poškodený|rozmery/i);
});

test('Merchant diagnostika rozlíši vhodný produkt a chyby',()=>{
  const product:any={id:1,sku:'W1420A',slug:'w1420a',name:'HP W1420A kompatibilný toner',price:20,stock_status:'instock',stock_quantity:5,product_type_key:'compatible',product_brand:'HP',images:[{src:'https://www.tonerymaxim.sk/images/w1420a.jpg'}],short_description_html:'Kompatibilný toner s vysokou kapacitou pre spoľahlivú každodennú tlač.',categories:[{name:'Tonery'}]};
  const good=merchantDiagnostics([product]);assert.equal(good.eligiblePaid,1);assert.equal(good.errors,0);
  const bad=merchantDiagnostics([{...product,id:2,slug:'bad',price:0,images:[],stock_status:'outofstock'}]);assert.ok(bad.errors>=2);assert.ok(bad.warnings>=1);
});

test('prehľad pripíše objednávku iba platenej návšteve',()=>{
  const now=new Date().toISOString(),base:any={ts:now,path:'/',visitorId:'v',owner:false,userAgent:'Chrome'};
  const events:any[]=[{...base,type:'pageview',sessionId:'paid',meta:{gclid:'x',utm_medium:'cpc',utm_campaign:'A'}},{...base,type:'order_complete',sessionId:'paid',value:40,meta:{order_number:'1'}},{...base,type:'pageview',sessionId:'direct'},{...base,type:'order_complete',sessionId:'direct',value:80,meta:{order_number:'2'}}];
  const out=marketingOverview(events,[{costEur:5,grossProfitEur:15} as any]);assert.equal(out.paidVisits,1);assert.equal(out.orders,1);assert.equal(out.revenue,40);assert.equal(out.profitAfterAds,10);assert.equal(out.campaigns[0].averagePages,1);assert.equal(out.campaigns[0].checkouts,0);
});

test('vlastná analytika nečíta obsah formulárov na citlivých stránkach',async()=>{
  const client=await readFile(new URL('../public/tm-analytics.js',import.meta.url),'utf8');
  assert.match(client,/SAFE_PRIVATE_EVENTS/);assert.doesNotMatch(client,/input\.value|FormData\(|querySelector\(['"]input/);assert.match(client,/delete payload\.search/);assert.match(client,/delete payload\.product/);
});

function campaignProducts(){return[
  {id:1,sku:'W1420A',slug:'hp-w1420a',name:'HP W1420A kompatibilný toner',price:24.9,stock_status:'instock',stock_quantity:8,product_type_key:'compatible',product_brand:'HP',categories:[{name:'Tonery'}],compatible_printers:['HP LaserJet M110w'],images:[{src:'https://www.tonerymaxim.sk/w1420a.jpg'}]},
  {id:2,sku:'W1420A-NC',slug:'hp-w1420a-no-chip',name:'HP W1420A kompatibilný toner bez čipu',price:15,stock_status:'instock',stock_quantity:8,product_type_key:'compatible',product_brand:'HP',categories:[{name:'Tonery'}]},
  {id:3,sku:'W1420A-O',slug:'hp-w1420a-original',name:'HP W1420A originálny toner',price:70,stock_status:'instock',stock_quantity:2,product_type_key:'original',product_brand:'HP',categories:[{name:'Tonery'}]},
] as any[]}

test('Campaign Builder pustí iba skladový kompatibilný produkt s kladnou maržou',()=>{
  const plan=campaignBuilder(campaignProducts(),[],{selection:'W1420A',channel:'shopping',goal:'profit',dailyBudgetEur:10});
  assert.equal(plan.ready,true);assert.equal(plan.products.length,1);assert.equal(plan.products[0].sku,'W1420A');assert.ok(plan.summary.recommendedMaxCpcEur>0);
});

test('Campaign Builder dodrží limity textov Google a pridá negatívne výrazy',()=>{
  const plan=campaignBuilder(campaignProducts(),[],{selection:'HP W1420A',channel:'search',goal:'orders',dailyBudgetEur:12});
  assert.equal(plan.limits.allHeadlinesValid,true);assert.equal(plan.limits.allDescriptionsValid,true);assert.ok(plan.structure.headlines.length>=5);assert.ok(plan.structure.negativeKeywords.includes('zadarmo'));
});

test('Campaign Builder nájde OEM kód rovnako s pomlčkou aj bez nej',()=>{
  const products:any[]=[{...campaignProducts()[0],sku:'CRG-054',name:'Canon CRG-054 kompatibilný toner'}];
  const plan=campaignBuilder(products,[],{selection:'CRG054',channel:'search',goal:'profit',dailyBudgetEur:10});
  assert.equal(plan.ready,true);assert.equal(plan.products[0].sku,'CRG-054');
});

test('PMax sa bez square a landscape obrázka nesmie označiť ako pripravený',()=>{
  const input:any={selection:'W1420A',channel:'performance_max',goal:'profit',dailyBudgetEur:15,creativeIds:['square']};
  const square:any={id:'square',usage:['square']};const blocked=campaignBuilder(campaignProducts(),[square],input);assert.equal(blocked.ready,false);assert.match(blocked.blockers.join(' '),/horizontálny/);
  const landscape:any={id:'land',usage:['landscape']};const ready=campaignBuilder(campaignProducts(),[square,landscape],{...input,creativeIds:['square','land']});assert.equal(ready.ready,true);
});

test('prázdny alebo nepredajný výber zostane bezpečne zablokovaný',()=>{
  const plan=campaignBuilder(campaignProducts(),[],{selection:'neexistuje',channel:'shopping',goal:'profit',dailyBudgetEur:-100});assert.equal(plan.ready,false);assert.equal(plan.summary.eligible,0);assert.equal(plan.input.dailyBudgetEur,1);
});

test('schválenie vyžaduje serverovo pripravený koncept a zanechá audit',async()=>{
  const plan:any=campaignBuilder(campaignProducts(),[],{selection:'W1420A',channel:'shopping',goal:'profit',dailyBudgetEur:10});
  const draft=await saveMarketingDraft({name:'Approval test',selection:'W1420A',channel:'shopping',goal:'profit',dailyBudgetEur:10,plan,state:'ready'});
  const reviewed=await reviewMarketingDraft(draft);assert.equal(reviewed.workflowState,'review_required');
  const approved=await decideMarketingDraft(draft,'approve');assert.equal(approved.workflowState,'approved');assert.equal(approved.decisionState,'PONECHAŤ');
  const store=await readMarketingApprovals();assert.ok(store.audit.some(x=>x.draftId===draft.id&&x.action==='approved'));
});

test('zmena konceptu po kontrole zablokuje staré schválenie',async()=>{
  const plan:any=campaignBuilder(campaignProducts(),[],{selection:'W1420A',channel:'shopping',goal:'profit',dailyBudgetEur:10});
  const draft=await saveMarketingDraft({name:'Tamper test',selection:'W1420A',channel:'shopping',goal:'profit',dailyBudgetEur:10,plan,state:'ready'});await reviewMarketingDraft(draft);
  const changed=await saveMarketingDraft({...draft,dailyBudgetEur:99});
  await assert.rejects(()=>decideMarketingDraft(changed,'approve'),/zmenil/i);
});

test('Google export je vždy dry-run, pozastavený a obsahuje CSV produkty',async()=>{
  const plan:any=campaignBuilder(campaignProducts(),[],{selection:'W1420A',channel:'search',goal:'profit',dailyBudgetEur:10});
  const draft:any=await saveMarketingDraft({name:'Export test',selection:'W1420A',channel:'search',goal:'profit',dailyBudgetEur:10,plan,state:'ready'});const reviewed=await reviewMarketingDraft(draft);const approval=await decideMarketingDraft(draft,'approve');
  assert.equal(reviewed.workflowState,'review_required');const out:any=buildGoogleAdsPublication(draft,approval,plan);assert.equal(out.ready,true);assert.equal(out.bundle.mode,'DRY_RUN_ONLY');assert.equal(out.bundle.campaign.status,'PAUSED');assert.match(out.csv,/W1420A/);assert.equal(out.bundle.targeting.country,'SK');const tracking=new URL(out.bundle.tracking.variants[0].finalUrl);assert.equal(tracking.searchParams.get('utm_source'),'google');assert.equal(tracking.searchParams.get('utm_content'),'text-rsa-default');assert.equal(tracking.searchParams.get('campaign_id'),'{campaignid}');assert.equal(tracking.searchParams.get('ad_group_id'),'{adgroupid}');assert.equal(tracking.searchParams.get('ad_id'),'{creative}');
});

test('Google export zablokuje neschválenú alebo ekonomicky neplatnú kampaň',()=>{
  const plan:any=campaignBuilder(campaignProducts(),[],{selection:'W1420A',channel:'search',goal:'profit',dailyBudgetEur:10});plan.products[0].grossMargin=0;
  const draft:any={id:'x',name:'x',selection:'W1420A',channel:'search',goal:'profit',dailyBudgetEur:10,state:'ready',creativeIds:[],headline:'',description:'',plan};const approval:any={workflowState:'review_required',fingerprint:'x'};
  const out=buildGoogleAdsPublication(draft,approval,plan);assert.equal(out.ready,false);assert.match(out.blockers.join(' '),/schválený|maržu/i);
});

test('admin API vykoná celý bezpečný tok koncept → kontrola → schválenie → export',async()=>{
  await mkdir(TM_PRODUCT_CACHE_ROOT,{recursive:true});await copyFile(new URL('../.tm-cache/products.json',import.meta.url),`${TM_PRODUCT_CACHE_ROOT}/products.json`);
  const draft=await saveMarketingDraft({name:'API export W1420A',selection:'W1420A',channel:'search',goal:'profit',dailyBudgetEur:10,state:'draft'});
  const call=(handler:any,body:any)=>handler(context(new Request(`https://www.tonerymaxim.sk/api/admin/${body.action==='export'?'google-ads-publication':'marketing-approval'}`,{method:'POST',headers:{'x-admin-key':key,'content-type':'application/json'},body:JSON.stringify(body.action==='export'?{draftId:draft.id}:body)})));
  const review=await call(approvalPost,{action:'review',draftId:draft.id});assert.equal(review.status,200);
  const approve=await call(approvalPost,{action:'approve',draftId:draft.id});assert.equal(approve.status,200);
  const exported=await call(publicationPost,{action:'export',draftId:draft.id});assert.equal(exported.status,200);const json:any=await exported.json();assert.equal(json.publication.bundle.mode,'DRY_RUN_ONLY');assert.ok(json.publication.bundle.products.length>=1);
});

const losingTerm=(term:string):any=>({term,campaign:'Search SK',adGroup:'Tonery',impressions:500,clicks:50,costEur:30,conversions:0,conversionValueEur:0,ctr:.1,cpa:null,roas:null,state:'ZASTAVIŤ',reason:'Stratový výraz.',suggestNegative:true,negativeMatchType:'EXACT'});

test('OEM kód a značka ToneryMAXIM sú chránené pred negatívnym slovom',async()=>{
  const products:any[]=[{sku:'W1420A',name:'HP W1420A kompatibilný toner'}],codes=buildProtectedSearchCodes(products);assert.equal(protectedSearchTerm('W1420A toner',codes).protected,true);assert.equal(protectedSearchTerm('tonerymaxim zľava',codes).protected,true);await assert.rejects(()=>decideSearchTermAction(losingTerm('W1420A toner'),products,'approve_negative'),/OEM|katalógový/i);
});

test('schválené nerelevantné negatívne slovo sa exportuje iba ako EXACT a nie je publikované',async()=>{
  const decision=losingTerm('oprava tlačiarne zadarmo');await decideSearchTermAction(decision,[],'approve_negative');const out=await exportApprovedNegativeTerms([decision],[]);assert.equal(out.rows.length,1);assert.equal(out.rows[0].matchType,'EXACT');assert.equal(out.mode,'APPROVED_NOT_PUBLISHED');assert.match(out.csv,/oprava tlačiarne zadarmo/);
});

test('nové metriky automaticky zneplatnia staré schválenie negatívneho slova',async()=>{
  const old=losingTerm('servis laserovej tlačiarne');await decideSearchTermAction(old,[],'approve_negative');const changed={...old,clicks:51,costEur:31};const out=await exportApprovedNegativeTerms([changed],[]);assert.equal(out.rows.some(x=>x.keyword===old.term),false);
});

function fakeVisit(content:string,index:number,order=false,cart=0,owner=false):any{return{sessionId:String(index),visitorId:String(index),owner,startedAt:new Date().toISOString(),lastSeenAt:new Date().toISOString(),durationMs:60000,activeMs:45000,pageviews:3,device:'desktop',source:'google',referrer:'',userAgent:'Chrome',browser:'Chrome',os:'Windows',country:'SK',region:'',city:'',language:'sk',viewport:'',landingPage:'/',exitPage:'/',returning:false,googleQuery:'',campaign:{source:'google',medium:'cpc',campaign:'Search SK',term:'',content,gclid:'g'},clicks:1,maxScroll:80,cartAdds:cart,cartRemoves:0,checkoutStarted:order,orderCompleted:order,orderNumber:order?String(index):'',orderValue:order?25:0,shipping:'',payment:'',pages:[],searches:[],products:[],events:[]}}

test('Creative Performance drží malú vzorku v UČÍ SA a úspešný variant posilní',()=>{
  const small=creativePerformance(Array.from({length:29},(_,i)=>fakeVisit('small',i)));assert.equal(small[0].state,'UČÍ SA');const good=creativePerformance(Array.from({length:30},(_,i)=>fakeVisit('good',i,i<2)));assert.equal(good[0].state,'POSILNIŤ');assert.equal(good[0].orders,2);assert.equal(good[0].averageActiveSeconds,45);
});

test('Creative Performance zastaví až veľkú vzorku bez košíka a ignoruje majiteľa',()=>{
  const visits=Array.from({length:60},(_,i)=>fakeVisit('bad',i));visits.push(fakeVisit('bad',999,true,1,true));const out=creativePerformance(visits);assert.equal(out[0].visits,60);assert.equal(out[0].state,'ZASTAVIŤ');assert.equal(out[0].orders,0);
});

test('Etapa 10 Budget Guard mení odporúčanie najviac o 15 % hore alebo 20 % dole',()=>{
  const profitable:any[] = Array.from({length:3},(_,i)=>({productId:String(i),impressions:100,clicks:30,addToCarts:5,purchases:3,costEur:10,revenueEur:60,grossProfitEur:25,profitAfterAdsEur:15,confidence:'MEDIUM'}));const up=budgetGuard(profitable,30);assert.equal(up.state,'POSILNIŤ');assert.equal(up.recommendedDailyBudgetEur,34.5);assert.equal(up.automaticChange,false);
  const losing:any[] = Array.from({length:3},(_,i)=>({productId:String(i),impressions:200,clicks:60,addToCarts:0,purchases:0,costEur:25,revenueEur:0,grossProfitEur:0,profitAfterAdsEur:-25,confidence:'HIGH'}));const down=budgetGuard(losing,30);assert.equal(down.state,'OBMEDZIŤ');assert.equal(down.recommendedDailyBudgetEur,24);
});

test('Etapa 11 diagnostika lievika a landing page nájde veľkú vzorku bez košíka',()=>{
  const visits=Array.from({length:60},(_,i)=>fakeVisit('landing',i));visits.forEach(v=>v.landingPage='/produkt/test');const funnel=paidFunnel(visits),pages=landingPageDiagnostics(visits);assert.equal(funnel.stages[0].value,60);assert.equal(funnel.stages[2].value,0);assert.equal(pages[0].state,'ZASTAVIŤ');assert.equal(pages[0].path,'/produkt/test');
});

test('Etapa 12 upozorní na rozdiel medzi Google klikmi a vlastným meraním',()=>{
  const funnel=paidFunnel([]),alerts=marketingAlerts(funnel,[],{eligiblePaid:100,errors:0,warnings:0,excludedChipless:0},{configured:true,mode:'read-only',apiVersion:'v25',lastSyncAt:new Date().toISOString(),clicks:20} as any);assert.ok(alerts.some(x=>x.code==='tracking_gap'&&x.severity==='critical'));
});

test('Etapa 13 riadiace centrum zoradí kritické úlohy a nič nemení automaticky',()=>{
  const center=marketingControlCenter([],[],{eligiblePaid:0,errors:5,warnings:0,excludedChipless:0},{configured:false,mode:'read-only',apiVersion:'v25'} as any,30);assert.equal(center.automaticChanges,false);assert.ok(center.alerts.some(x=>x.code==='merchant_errors'));assert.ok(center.todayActions.length>=1);assert.equal(center.todayActions[0].priority,1);
});

test('publikačný rad odmietne duplicitu a vyžaduje presné dvojité potvrdenie',async()=>{const bundle:any={mode:'DRY_RUN_ONLY',approvalFingerprint:'a',campaign:{name:'TM Search test',channel:'search',status:'PAUSED'}},first=await enqueueDeployment('draft-x',bundle),second=await enqueueDeployment('draft-x',bundle);assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);await assert.rejects(()=>deploymentAction(first.item.id,'confirm','áno'),/presne znieť/i);const confirmed=await deploymentAction(first.item.id,'confirm','PAUSED: TM Search test');assert.equal(confirmed.status,'APPROVED_FOR_VALIDATE_ONLY');const validated=await deploymentAction(first.item.id,'validated',undefined,{validateOnly:true});assert.equal(validated.status,'VALIDATED');assert.equal((validated.validation as any).validateOnly,true)});

test('zrušená položka publikačného radu sa dá zaradiť znova, validovaná nie je zmazateľná',async()=>{const bundle:any={mode:'DRY_RUN_ONLY',approvalFingerprint:'b',campaign:{name:'TM Shopping cancel',channel:'shopping',status:'PAUSED'}},q=await enqueueDeployment('draft-y',bundle);const cancelled=await deploymentAction(q.item.id,'cancel');assert.equal(cancelled.status,'CANCELLED');const again=await enqueueDeployment('draft-y',bundle);assert.equal(again.duplicate,false);await deploymentAction(again.item.id,'confirm','PAUSED: TM Shopping cancel');await deploymentAction(again.item.id,'validated',undefined,{validateOnly:true});await assert.rejects(()=>deploymentAction(again.item.id,'cancel'),/nemožno/i);const store=await readDeploymentQueue();assert.ok(store.audit.some(x=>x.action==='cancelled'))});
