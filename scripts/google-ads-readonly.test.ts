import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGoogleAdsProductRows, googleRowsToLearningEvents, loadGoogleAdsConfig, GOOGLE_ADS_PRODUCT_QUERY } from '../src/lib/google-ads-readonly.ts';
import { buildSearchValidateOnlyOperations,googleAdsValidateOnly } from '../src/lib/google-ads-validate-only.ts';
import { decideSearchTerms,fetchGoogleAdsSearchTermRows,GOOGLE_ADS_SEARCH_TERMS_QUERY } from '../src/lib/google-ads-search-terms.ts';
import { buildShoppingValidateOnlyOperations,googleAdsShoppingValidateOnly,performanceMaxLocalPreflight } from '../src/lib/google-ads-channel-preflight.ts';

const config={developerToken:'dev',clientId:'client',clientSecret:'secret',refreshToken:'refresh',customerId:'1234567890',loginCustomerId:'9876543210',apiVersion:'v25'};

test('Google Ads konfigurácia normalizuje ID a nikdy nepotrebuje write nastavenie',()=>{
  const loaded=loadGoogleAdsConfig({GOOGLE_ADS_DEVELOPER_TOKEN:'d',GOOGLE_ADS_CLIENT_ID:'c',GOOGLE_ADS_CLIENT_SECRET:'s',GOOGLE_ADS_REFRESH_TOKEN:'r',GOOGLE_ADS_CUSTOMER_ID:'123-456-7890',GOOGLE_ADS_LOGIN_CUSTOMER_ID:'987-654-3210',GOOGLE_ADS_API_VERSION:'25'});
  assert.equal(loaded?.customerId,'1234567890'); assert.equal(loaded?.loginCustomerId,'9876543210'); assert.equal(loaded?.apiVersion,'v25');
});

test('neúplná alebo neplatná Google konfigurácia sa bezpečne odmietne',()=>{
  assert.equal(loadGoogleAdsConfig({}),null);
  assert.equal(loadGoogleAdsConfig({GOOGLE_ADS_DEVELOPER_TOKEN:'d',GOOGLE_ADS_CLIENT_ID:'c',GOOGLE_ADS_CLIENT_SECRET:'s',GOOGLE_ADS_REFRESH_TOKEN:'r',GOOGLE_ADS_CUSTOMER_ID:'abc'}),null);
  assert.equal(loadGoogleAdsConfig({GOOGLE_ADS_DEVELOPER_TOKEN:'d',GOOGLE_ADS_CLIENT_ID:'c',GOOGLE_ADS_CLIENT_SECRET:'s',GOOGLE_ADS_REFRESH_TOKEN:'r',GOOGLE_ADS_CUSTOMER_ID:'1234567890',GOOGLE_ADS_API_VERSION:'latest'}),null);
});

test('GAQL je striktne reportovací produktový dotaz za 30 dní',()=>{
  assert.match(GOOGLE_ADS_PRODUCT_QUERY,/FROM shopping_performance_view/);
  assert.match(GOOGLE_ADS_PRODUCT_QUERY,/LAST_30_DAYS/);
  assert.doesNotMatch(GOOGLE_ADS_PRODUCT_QUERY,/\b(?:MUTATE|CREATE|UPDATE|REMOVE)\b/i);
});

test('Google Ads REST klient obnoví token, stránkuje a používa iba search endpoint',async()=>{
  const calls:Array<{url:string,init:any}>=[];
  const fetcher=async(url:any,init:any)=>{calls.push({url:String(url),init});if(String(url).includes('oauth2.googleapis.com'))return new Response(JSON.stringify({access_token:'access'}),{status:200});const body=JSON.parse(init.body);return new Response(JSON.stringify(body.pageToken?{results:[{segments:{date:'2026-08-20',productItemId:'SKU-2'},metrics:{impressions:'5',clicks:'1',costMicros:'100000'}}]}:{results:[{segments:{date:'2026-08-19',productItemId:'SKU-1'},metrics:{impressions:'10',clicks:'2',costMicros:'500000'}}],nextPageToken:'next'}),{status:200});};
  const rows=await fetchGoogleAdsProductRows(config,fetcher as typeof fetch);
  assert.equal(rows.length,2); assert.equal(calls.length,3);
  assert.match(calls[1].url,/googleAds:search$/); assert.doesNotMatch(calls[1].url,/mutate/i);
  assert.equal(calls[1].init.headers['login-customer-id'],'9876543210');
});

test('pri priamom účte sa neposiela MCC hlavička',async()=>{
  let apiHeaders:any;
  const fetcher=async(url:any,init:any)=>{if(String(url).includes('oauth2.googleapis.com'))return new Response(JSON.stringify({access_token:'a'}));apiHeaders=init.headers;return new Response(JSON.stringify({results:[]}));};
  await fetchGoogleAdsProductRows({...config,loginCustomerId:undefined},fetcher as typeof fetch);
  assert.equal(apiHeaders['login-customer-id'],undefined);
});

test('OAuth chyba sa vráti ako riadená chyba a Google API sa už nezavolá',async()=>{
  let calls=0; const fetcher=async()=>{calls++;return new Response(JSON.stringify({error:'invalid_grant',error_description:'Token bol zrušený'}),{status:400});};
  await assert.rejects(fetchGoogleAdsProductRows(config,fetcher as typeof fetch),/Google OAuth zlyhal \(400\).*Token bol zrušený/);
  assert.equal(calls,1);
});

test('Google API chyba sa vráti bez tichého importu dát',async()=>{
  const fetcher=async(url:any)=>String(url).includes('oauth2.googleapis.com')?new Response(JSON.stringify({access_token:'a'})):new Response(JSON.stringify({error:{message:'Developer token nemá prístup'}}),{status:403});
  await assert.rejects(fetchGoogleAdsProductRows(config,fetcher as typeof fetch),/Google Ads API zlyhalo \(403\).*nemá prístup/);
});

test('opakujúci sa page token nemôže spôsobiť nekonečný cyklus',async()=>{
  let apiCalls=0; const fetcher=async(url:any)=>{if(String(url).includes('oauth2.googleapis.com'))return new Response(JSON.stringify({access_token:'a'}));apiCalls++;return new Response(JSON.stringify({results:[],nextPageToken:'same'}));};
  await assert.rejects(fetchGoogleAdsProductRows(config,fetcher as typeof fetch),/opakujúci sa stránkovací token/);
  assert.equal(apiCalls,2);
});

test('Google riadky sa zmenia na idempotentné denné impression/click udalosti',()=>{
  const events=googleRowsToLearningEvents([{segments:{date:'2026-08-20',productItemId:'SKU-1'},metrics:{impressions:'100',clicks:'7',costMicros:'1230000',conversions:2}}]);
  assert.equal(events.length,2); assert.equal(events[0].count,100); assert.equal(events[1].count,7); assert.equal(events[1].costEur,1.23);
  assert.equal(events[1].eventId,'google-ads:2026-08-20:SKU-1:click');
  assert.ok(events.every(e=>e.source==='google_ads'));
});

test('neplatné, záporné a poškodené Google riadky sa neimportujú',()=>{
  const tooLong='X'.repeat(257);
  const events=googleRowsToLearningEvents([
    {segments:{date:'2026-02-31',productItemId:'BAD-DATE'},metrics:{impressions:1}},
    {segments:{date:'2026-08-20',productItemId:''},metrics:{impressions:1}},
    {segments:{date:'2026-08-20',productItemId:tooLong},metrics:{impressions:1}},
    {segments:{date:'2026-08-20',productItemId:'SKU'},metrics:{impressions:-2,clicks:-1,costMicros:-9}},
  ]);
  assert.deepEqual(events,[]);
});

test('nulové metriky nevytvoria prázdne learning udalosti',()=>{
  assert.deepEqual(googleRowsToLearningEvents([{segments:{date:'2026-08-20',productItemId:'SKU'},metrics:{impressions:'0',clicks:'0',costMicros:'0'}}]),[]);
});

const publication:any={mode:'DRY_RUN_ONLY',campaign:{channel:'search',status:'PAUSED',name:'TM Search W1420A',dailyBudgetEur:10,recommendedMaxCpcEur:.25,landingPage:'https://www.tonerymaxim.sk/produkty?s=W1420A'},assets:{headlines:['W1420A skladom','ToneryMAXIM.sk','Rýchle doručenie'],descriptions:['Kvalitný kompatibilný toner skladom.','Nakúpte výhodne na ToneryMAXIM.sk.']},targeting:{keywords:['W1420A toner'],negativeKeywords:['zadarmo']}};

test('validate-only operácie vytvárajú iba pozastavenú Search štruktúru',()=>{
  const operations=buildSearchValidateOnlyOperations(publication,config.customerId),serialized=JSON.stringify(operations);assert.ok(operations.length>=6);assert.match(serialized,/PAUSED/);assert.match(serialized,/campaignBudgets\/-1/);assert.doesNotMatch(serialized,/ENABLED/);
});

test('Google mutate požiadavka má napevno validateOnly true',async()=>{
  const calls:any[]=[];const fetcher=async(url:any,init:any)=>{calls.push({url:String(url),init});return String(url).includes('oauth2.googleapis.com')?new Response(JSON.stringify({access_token:'a'})):new Response(JSON.stringify({mutateOperationResponses:[]}));};
  const out=await googleAdsValidateOnly(config,publication,fetcher as typeof fetch);assert.equal(out.validateOnly,true);const body=JSON.parse(calls[1].init.body);assert.equal(body.validateOnly,true);assert.equal(body.partialFailure,false);assert.match(calls[1].url,/googleAds:mutate$/);
});

test('validate-only odmietne iný kanál alebo kampaň, ktorá nie je PAUSED',()=>{
  assert.throws(()=>buildSearchValidateOnlyOperations({...publication,campaign:{...publication.campaign,channel:'shopping'}},config.customerId),/iba.*Search/i);assert.throws(()=>buildSearchValidateOnlyOperations({...publication,campaign:{...publication.campaign,status:'ENABLED'}},config.customerId),/pozastavená/i);
});

test('search terms GAQL je striktne read-only report za 30 dní',()=>{
  assert.match(GOOGLE_ADS_SEARCH_TERMS_QUERY,/FROM search_term_view/);assert.match(GOOGLE_ADS_SEARCH_TERMS_QUERY,/LAST_30_DAYS/);assert.doesNotMatch(GOOGLE_ADS_SEARCH_TERMS_QUERY,/\b(?:MUTATE|CREATE|UPDATE|REMOVE)\b/i);
});

test('search terms klient bezpečne stránkuje cez search endpoint',async()=>{
  let calls=0;const fetcher=async(url:any,init:any)=>{if(String(url).includes('oauth2.googleapis.com'))return new Response(JSON.stringify({access_token:'a'}));calls++;const body=JSON.parse(init.body);return new Response(JSON.stringify(body.pageToken?{results:[{searchTermView:{searchTerm:'tn2421'}}]}:{results:[{searchTermView:{searchTerm:'w1420a'}}],nextPageToken:'next'}));};const rows=await fetchGoogleAdsSearchTermRows(config,fetcher as typeof fetch);assert.equal(rows.length,2);assert.equal(calls,2);
});

test('Search Terms Decision Engine je konzervatívny a negatívne slovo navrhne až po strate',()=>{
  const row=(term:string,clicks:number,cost:number,conversions=0,value=0)=>({campaign:{name:'Search SK'},adGroup:{name:'Tonery'},searchTermView:{searchTerm:term},metrics:{impressions:100,clicks,costMicros:cost*1_000_000,conversions,conversionsValue:value}}),out=decideSearchTerms([row('w1420a toner',10,5,2,40),row('toner zadarmo',50,30),row('tn2421',5,2)],{},10),by=new Map(out.map(x=>[x.term,x]));assert.equal(by.get('w1420a toner')?.state,'POSILNIŤ');assert.equal(by.get('toner zadarmo')?.state,'ZASTAVIŤ');assert.equal(by.get('toner zadarmo')?.suggestNegative,true);assert.equal(by.get('toner zadarmo')?.negativeMatchType,'EXACT');assert.equal(by.get('tn2421')?.state,'UČÍ SA');assert.equal(by.get('tn2421')?.suggestNegative,false);
});

test('rovnaký search term sa agreguje bez straty nákladov a konverzií',()=>{
  const base:any={campaign:{name:'C'},adGroup:{name:'A'},searchTermView:{searchTerm:'CRG054'},metrics:{impressions:10,clicks:2,costMicros:1000000,conversions:1,conversionsValue:20}},out=decideSearchTerms([base,{...base,metrics:{...base.metrics,clicks:3,costMicros:2000000,conversions:1,conversionsValue:20}}],{},10);assert.equal(out.length,1);assert.equal(out[0].clicks,5);assert.equal(out[0].costEur,3);assert.equal(out[0].conversions,2);
});

const shoppingPublication:any={mode:'DRY_RUN_ONLY',campaign:{channel:'shopping',status:'PAUSED',name:'TM Shopping SK',dailyBudgetEur:10,recommendedMaxCpcEur:.2},products:[{id:'1'}]};
test('Shopping validate-only vytvára iba PAUSED štruktúru s Merchant ID',()=>{const ops=buildShoppingValidateOnlyOperations(shoppingPublication,config.customerId,'123456'),text=JSON.stringify(ops);assert.equal(ops.length,5);assert.match(text,/SHOPPING/);assert.match(text,/123456/);assert.doesNotMatch(text,/ENABLED/)});
test('Shopping volanie používa spoločný hard-coded validateOnly transport',async()=>{const calls:any[]=[];const fetcher=async(url:any,init:any)=>{calls.push({url:String(url),init});return String(url).includes('oauth2.googleapis.com')?new Response(JSON.stringify({access_token:'a'})):new Response('{}')};const out=await googleAdsShoppingValidateOnly(config,shoppingPublication,'123456',fetcher as any);assert.equal(out.validateOnly,true);assert.equal(JSON.parse(calls[1].init.body).validateOnly,true)});
test('PMax lokálny preflight vyžaduje profesionálnu asset group, dva formáty a produkty',()=>{const good=performanceMaxLocalPreflight({mode:'DRY_RUN_ONLY',campaign:{channel:'performance_max',status:'PAUSED'},assets:{headlines:['a','b','c'],descriptions:['a','b'],creativeIds:['square','land'],assetGroups:[{name:'CRG054',squareCreativeIds:['square'],landscapeCreativeIds:['land'],productIds:['1']}]},products:[{id:'1'}]});assert.equal(good.ready,true);assert.equal(good.mode,'LOCAL_PREFLIGHT_ONLY');assert.equal(good.assetGroupCount,1);const bad=performanceMaxLocalPreflight({mode:'DRY_RUN_ONLY',campaign:{channel:'performance_max',status:'PAUSED'},assets:{headlines:[],descriptions:[],creativeIds:[],assetGroups:[]},products:[]});assert.equal(bad.ready,false);assert.ok(bad.blockers.length>=4)});
