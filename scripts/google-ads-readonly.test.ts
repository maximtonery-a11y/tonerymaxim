import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGoogleAdsProductRows, googleRowsToLearningEvents, loadGoogleAdsConfig, GOOGLE_ADS_PRODUCT_QUERY } from '../src/lib/google-ads-readonly.ts';

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
