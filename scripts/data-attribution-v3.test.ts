import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateContributionProfit} from '../src/lib/profit-engine-v2.ts';
import {attributionEngineV3,attributionSummary} from '../src/lib/attribution-engine-v3.ts';
import {normalizeMerchantSnapshot,syncMerchantApi} from '../src/lib/merchant-api.ts';

const economics:any={product_id:'101',woo_id:'101',sku:'W1420A',merchant_id:'101',purchase_price_used:8,purchase_price_source:'abix'};
test('Profit Engine V2 počíta príspevkový zisk bez miešania DPH',()=>{const out=calculateContributionProfit({revenueWithVat:24.6,adCostEur:1.5,items:[{productId:'101',quantity:1}],economics:new Map([['101',economics]]),vatRate:.23,variableCostEur:.5,clickToOrderRate:.1});assert.equal(out.revenueNoVat,20);assert.equal(out.grossProfitEur,11.5);assert.equal(out.contributionProfitEur,10);assert.equal(out.breakEvenCpaEur,11.5);assert.equal(out.breakEvenCpcEur,1.15);assert.equal(out.costCoverage,'REAL')});
test('Profit Engine označí chýbajúcu nákupnú cenu a nevymyslí ju',()=>{const out=calculateContributionProfit({revenueWithVat:12.3,adCostEur:1,items:[{productId:'missing',quantity:1}],economics:new Map(),vatRate:.23});assert.equal(out.costCoverage,'MISSING');assert.deepEqual(out.missingProductIds,['missing'])});

const base={sessionId:'s1',visitorId:'v1',owner:false,device:'mobile',source:'google',country:'SK',region:'',city:'',language:'sk',viewport:'390x800',userAgent:'Chrome',referrer:''};
const events:any[]=[
 {...base,type:'pageview',ts:'2026-08-24T12:00:00.000Z',path:'/oem/w1420a',meta:{utm_source:'google',utm_medium:'cpc',utm_campaign:'W1420A','gclid':'click-1',campaign_id:'123',ad_group_id:'456',ad_id:'789',keyword_id:'321',product_id:'101'}},
 {...base,type:'add_to_cart',ts:'2026-08-24T12:01:00.000Z',path:'/produkt/w1420a',product:'101',meta:{item_id:'101'}},
 {...base,type:'checkout_start',ts:'2026-08-24T12:02:00.000Z',path:'/pokladna',meta:{}},
 {...base,type:'order_complete',ts:'2026-08-24T12:03:00.000Z',path:'/platba-dokoncena',value:24.6,meta:{order_number:'TM1',item_id:'101',item_ids:'101:1'}},
];
test('Attribution V3 zachová stabilné Google ID a presnú cestu po objednávku',()=>{const learning:any[]=[{productId:'101',clicks:10,purchases:2,costEur:5}],rows=attributionEngineV3(events,learning,[economics] as any);assert.equal(rows.length,1);assert.equal(rows[0].campaign.campaignId,'123');assert.equal(rows[0].campaign.adGroupId,'456');assert.equal(rows[0].campaign.adId,'789');assert.equal(rows[0].confidence,'EXACT');assert.equal(rows[0].order.number,'TM1');assert.equal(rows[0].steps.at(-1)?.type,'order_complete');assert.equal(attributionSummary(rows).attributionCoverage,1)});

test('Merchant normalizácia rozlíši zamietnuté a obmedzené produkty',()=>{const out=normalizeMerchantSnapshot('55',[{name:'accounts/55/products/sk~SK~101',productStatus:{itemLevelIssues:[{code:'price_mismatch',severity:'DISAPPROVED',title:'Price mismatch'},{code:'image',severity:'LIMITED',title:'Image issue'}]}}],[{statistics:{approvedCount:'100',pendingCount:'2',disapprovedCount:'3'}}],[]);assert.equal(out.approved,100);assert.equal(out.disapproved,3);assert.equal(out.limited,1);assert.equal(out.issues[0].offerId,'101')});

test('Merchant API používa iba OAuth a read-only v1 list endpointy',async()=>{const calls:string[]=[];const fetcher:any=async(input:any)=>{const url=String(input);calls.push(url);if(url.includes('oauth2.googleapis.com'))return new Response(JSON.stringify({access_token:'token'}),{status:200});if(url.includes('/products/v1/'))return new Response(JSON.stringify({products:[]}),{status:200});if(url.includes('/issueresolution/v1/'))return new Response(JSON.stringify({aggregateProductStatuses:[]}),{status:200});return new Response(JSON.stringify({accountIssues:[]}),{status:200})};const out=await syncMerchantApi({GOOGLE_MERCHANT_CENTER_ID:'55',GOOGLE_MERCHANT_CLIENT_ID:'id',GOOGLE_MERCHANT_CLIENT_SECRET:'secret',GOOGLE_MERCHANT_REFRESH_TOKEN:'refresh'},fetcher);assert.equal(out.configured,true);assert.ok(calls.some(x=>x.includes('/products/v1/accounts/55/products')));assert.ok(calls.some(x=>x.includes('/issueresolution/v1/accounts/55/aggregateProductStatuses')));assert.equal(calls.some(x=>/productInputs:(insert|patch)|DELETE/.test(x)),false)});

