import test from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../src/pages/api/admin/ads-intelligence.ts';

const key='0123456789abcdef0123456789abcdef';
const locals={runtime:{env:{TM_ANALYTICS_ADMIN_KEY:key}}};

function context(request:Request){return {request,url:new URL(request.url),locals} as any;}

test('Ads Intelligence API odmietne požiadavku bez admin kľúča',async()=>{
  const request=new Request('https://www.tonerymaxim.sk/api/admin/ads-intelligence');
  const response=await GET(context(request));
  assert.equal(response.status,401); assert.deepEqual(await response.json(),{ok:false,error:'Unauthorized'});
});

test('Ads Intelligence API odmietne nesprávny admin kľúč',async()=>{
  const request=new Request('https://www.tonerymaxim.sk/api/admin/ads-intelligence',{headers:{'x-admin-key':'x'.repeat(32)}});
  assert.equal((await GET(context(request))).status,401);
});

test('oprávnený GET vráti celý prepočet bez cache a bez tajných údajov',async()=>{
  const request=new Request('https://www.tonerymaxim.sk/api/admin/ads-intelligence',{headers:{'x-admin-key':key}});
  const response=await GET(context(request)); const json:any=await response.json();
  assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store'); assert.equal(json.ok,true);
  assert.ok(json.summary.products>7000); assert.equal(json.decisions.length,json.summary.products); assert.equal(json.googleAds.mode,'read-only'); assert.equal(json.googleAds.configured,false);
  const serialized=JSON.stringify(json); assert.doesNotMatch(serialized,/GOOGLE_ADS_CLIENT_SECRET|GOOGLE_ADS_REFRESH_TOKEN|developerToken/);
});

test('Google sync bez serverových credentials zlyhá bezpečne bez sieťového volania',async()=>{
  const request=new Request('https://www.tonerymaxim.sk/api/admin/ads-intelligence',{method:'POST',headers:{'x-admin-key':key,'content-type':'application/json'},body:JSON.stringify({action:'sync_google_ads'})});
  const response=await POST(context(request)); const json:any=await response.json();
  assert.equal(response.status,400); assert.equal(json.ok,false); assert.match(json.error,/nie je nakonfigurovaný/);
});

test('poškodené JSON telo v POST nespôsobí únik interných údajov',async()=>{
  const request=new Request('https://www.tonerymaxim.sk/api/admin/ads-intelligence',{method:'POST',headers:{'x-admin-key':key,'content-type':'application/json'},body:'{bad'});
  const response=await POST(context(request)); const json:any=await response.json();
  assert.equal(response.status,400); assert.equal(json.ok,false); assert.equal(typeof json.error,'string'); assert.doesNotMatch(json.error,/client_secret|refresh_token/i);
});
