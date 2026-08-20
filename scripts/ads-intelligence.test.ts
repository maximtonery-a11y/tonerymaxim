import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProductEconomics } from '../src/lib/product-economics.ts';
import { decideCampaignV2, allocateDailyBudget } from '../src/lib/campaign-decision-engine-v2.ts';
import { DEFAULT_ADS_INTELLIGENCE_SETTINGS } from '../src/lib/ads-intelligence-settings.ts';
import { loadMarketPretrainingCsv, findMarketForProduct } from '../src/lib/market-pretraining.ts';
import { appendLearningEvents, readLearningEvents } from '../src/lib/ads-learning-store.ts';
import { aggregateLearning, learnedDecision } from '../src/lib/ads-learning-engine.ts';
import { sanitizeAdsSettings } from '../src/lib/ads-intelligence-settings.ts';
import { calculateAdsIntelligence } from '../src/lib/ads-intelligence-runtime.ts';

function product(overrides:Record<string,unknown>={}){
  return {id:1,sku:'SKU-1',slug:'hp-w1420a',name:'HP W1420A kompatibilný toner',price:'36.90',stock_status:'instock',product_type_key:'compatible',product_brand:'HP',categories:[{name:'Tonery'}],...overrides} as any;
}

test('ekonomika porovnáva ceny bez DPH a reaguje na sadzbu DPH',()=>{
  const a=buildProductEconomics(product(),{vatRate:.23});
  const b=buildProductEconomics(product(),{vatRate:0});
  assert.equal(a.selling_price_no_vat,30);
  assert.equal(a.estimated_purchase_price,10);
  assert.equal(a.estimated_gross_margin,20);
  assert.ok(b.estimated_gross_margin>a.estimated_gross_margin);
});

test('platená reklama povoľuje iba bežné kompatibilné tonery a atramenty',()=>{
  const ok=buildProductEconomics(product());
  assert.equal(decideCampaignV2(ok,null,{},DEFAULT_ADS_INTELLIGENCE_SETTINGS).eligible,true);
  for(const changes of [
    {name:'HP W1420A No Chip kompatibilný toner'},
    {name:'HP W1420A s OEM čipom kompatibilný toner'},
    {name:'HATONA HP W1420A kompatibilný toner'},
    {product_type_key:'original',name:'HP W1420A originálny toner'},
  ]) assert.equal(decideCampaignV2(buildProductEconomics(product(changes)),null,{},DEFAULT_ADS_INTELLIGENCE_SETTINGS).eligible,false);
});

test('market mapovanie odlišuje rovnaký OEM kód rôznych značiek',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tm-market-'));
  const file=path.join(dir,'market.csv');
  fs.writeFileSync(file,'brand,oem,catalog_products,compatible_printers,oem_search_signal,printer_search_signal_dedup,market_demand_estimate,market_data_confidence,competition_index_avg,bid_low_avg_eur,bid_high_avg_eur,initial_state,top_google_signals\nBrother,TN-320,1,1,10,0,10,HIGH,80,0.2,0.5,PONECHAŤ,x\nKonica Minolta,TN320,1,1,40,0,40,HIGH,90,0.3,0.7,PONECHAŤ,y\n');
  const market=loadMarketPretrainingCsv(file);
  assert.equal(findMarketForProduct(product({name:'Brother TN-320 kompatibilný toner',product_brand:'Brother'}),market)?.market_demand_estimate,10);
  assert.equal(findMarketForProduct(product({name:'Konica Minolta TN320 kompatibilný toner',product_brand:'Konica Minolta'}),market)?.market_demand_estimate,40);
});

test('rozpočet dostane iba obmedzený počet najlepších kandidátov',()=>{
  const e=buildProductEconomics(product());
  const decisions=Array.from({length:250},(_,i)=>({...decideCampaignV2({...e,product_id:String(i),sku:String(i),name:`P${i}`},null,{},DEFAULT_ADS_INTELLIGENCE_SETTINGS),priority_score:250-i}));
  const out=allocateDailyBudget(decisions,{...DEFAULT_ADS_INTELLIGENCE_SETTINGS,dailyBudgetEur:30,maxActiveProducts:100});
  assert.equal(out.filter(x=>x.allocated_daily_budget>0).length,100);
  assert.equal(Math.round(out.reduce((s,x)=>s+x.allocated_daily_budget,0)*100),3000);
});

test('rozpočet zostane presný aj pri duplicitnom product_id',()=>{
  const e=buildProductEconomics(product());
  const base=decideCampaignV2(e,null,{},DEFAULT_ADS_INTELLIGENCE_SETTINGS);
  const decisions=[{...base,product_id:'DUP',priority_score:100},{...base,product_id:'DUP',priority_score:50}];
  const out=allocateDailyBudget(decisions,{...DEFAULT_ADS_INTELLIGENCE_SETTINGS,dailyBudgetEur:30});
  assert.equal(Math.round(out.reduce((sum,d)=>sum+d.allocated_daily_budget,0)*100),3000);
  assert.ok(out[0].allocated_daily_budget>out[1].allocated_daily_budget);
});

test('prázdny alebo neaktívny zoznam nepridelí rozpočet',()=>{
  assert.deepEqual(allocateDailyBudget([],DEFAULT_ADS_INTELLIGENCE_SETTINGS),[]);
  const excluded={...decideCampaignV2(buildProductEconomics(product({stock_status:'outofstock'})),null,{},DEFAULT_ADS_INTELLIGENCE_SETTINGS)};
  assert.equal(allocateDailyBudget([excluded],DEFAULT_ADS_INTELLIGENCE_SETTINGS)[0].allocated_daily_budget,0);
});

test('nastavenia sa orežú na bezpečné rozsahy a NaN použije default',()=>{
  const s=sanitizeAdsSettings({vatRate:99,coldStartCvr:-1,dailyBudgetEur:0,maxActiveProducts:99999,maxCpcAbsolute:Number.NaN});
  assert.equal(s.vatRate,.30); assert.equal(s.coldStartCvr,.005); assert.equal(s.dailyBudgetEur,1); assert.equal(s.maxActiveProducts,1000); assert.equal(s.maxCpcAbsolute,1.5);
});

test('reálna Abix cena má prednosť a zápornú maržu reklama vylúči',()=>{
  const economics=buildProductEconomics(product({price:'12.30'}),{vatRate:.23,realPurchasePrice:11});
  assert.equal(economics.purchase_price_source,'abix'); assert.equal(economics.selling_price_no_vat,10); assert.equal(economics.estimated_gross_margin,-1);
  const decision=decideCampaignV2(economics,null,{},DEFAULT_ADS_INTELLIGENCE_SETTINGS);
  assert.equal(decision.eligible,false); assert.ok(decision.reason_codes.includes('NO_POSITIVE_MARGIN'));
});

test('engine je konzervatívny: pár klikov produkt nezastaví',()=>{
  const e=buildProductEconomics(product());
  const d=decideCampaignV2(e,null,{clicks:3,cost:2,conversions:0},DEFAULT_ADS_INTELLIGENCE_SETTINGS);
  assert.equal(d.state,'UČÍ SA'); assert.ok(d.reason_codes.includes('NOT_ENOUGH_OBSERVED_EVIDENCE'));
});

test('engine zastaví až dostatočne stratový produkt bez konverzie',()=>{
  const e=buildProductEconomics(product());
  const d=decideCampaignV2(e,null,{clicks:60,cost:100,conversions:0},DEFAULT_ADS_INTELLIGENCE_SETTINGS);
  assert.equal(d.state,'ZASTAVIŤ'); assert.ok(d.reason_codes.includes('ENOUGH_EVIDENCE_SPEND_WITHOUT_CONVERSION'));
});

test('dobré CPA posilní produkt, slabý ROAS ho vráti na PONECHAŤ',()=>{
  const e=buildProductEconomics(product());
  const good=decideCampaignV2(e,null,{clicks:50,cost:10,conversions:4,conversion_value:100},DEFAULT_ADS_INTELLIGENCE_SETTINGS);
  assert.equal(good.state,'POSILNIŤ');
  const guarded=decideCampaignV2(e,null,{clicks:50,cost:10,conversions:4,conversion_value:1},DEFAULT_ADS_INTELLIGENCE_SETTINGS);
  assert.equal(guarded.state,'PONECHAŤ'); assert.ok(guarded.reason_codes.includes('ROAS_GUARDRAIL'));
});

test('learning agregácia správne počíta CTR, CPA, ROAS a zisk',()=>{
  const rows=aggregateLearning([
    {eventId:'i',ts:'2026-08-20T00:00:00Z',productId:'SKU',event:'impression',count:100},
    {eventId:'c',ts:'2026-08-20T00:00:00Z',productId:'SKU',event:'click',count:10,costEur:5},
    {eventId:'p',ts:'2026-08-20T00:00:00Z',productId:'SKU',event:'purchase',count:2,orderId:'O',revenueEur:40,grossProfitEur:16},
  ]);
  assert.equal(rows.length,1); assert.equal(rows[0].ctr,.1); assert.equal(rows[0].cvr,.2); assert.equal(rows[0].cpa,2.5); assert.equal(rows[0].roas,8); assert.equal(rows[0].profitAfterAdsEur,11);
});

test('learning politika chráni košíky a zastaví až pri dostatočnej strate',()=>{
  const base={productId:'SKU',impressions:100,clicks:30,addToCarts:2,purchases:0,costEur:15,revenueEur:0,grossProfitEur:0,ctr:.3,cvr:0,cartRate:2/30,cpa:null,roas:null,profitAfterAdsEur:-15,confidence:'MEDIUM' as const};
  assert.equal(learnedDecision(base,10,0).state,'OBMEDZIŤ');
  assert.equal(learnedDecision({...base,clicks:60,addToCarts:0,costEur:25,confidence:'HIGH'},10,0).state,'ZASTAVIŤ');
});

test('learning store odmietne duplicity a neplatné alebo záporné eventy',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tm-learning-'));
  process.env.TM_PERSISTENT_DATA_DIR=dir;
  const valid={eventId:'gads:2026-08-20:campaign:product',ts:'2026-08-20T08:00:00Z',productId:'1',event:'click' as const,count:12,costEur:4.2,source:'google_ads' as const};
  assert.equal(appendLearningEvents([valid,valid,{...valid,eventId:'bad',costEur:-1}]),1);
  assert.equal(readLearningEvents().length,1);
  assert.equal(appendLearningEvents([valid]),0);
});

test('celý reálny katalóg spĺňa finančné a bezpečnostné invarianty',()=>{
  const result=calculateAdsIntelligence(DEFAULT_ADS_INTELLIGENCE_SETTINGS);
  assert.ok(result.summary.products>7_000);
  assert.equal(result.decisions.length,result.summary.products);
  assert.equal(result.decisions.filter(d=>d.allocated_daily_budget>0).length,DEFAULT_ADS_INTELLIGENCE_SETTINGS.maxActiveProducts);
  assert.equal(Math.round(result.decisions.reduce((sum,d)=>sum+d.allocated_daily_budget,0)*100),DEFAULT_ADS_INTELLIGENCE_SETTINGS.dailyBudgetEur*100);
  for(const d of result.decisions){
    for(const value of [d.priority_score,d.max_cpc,d.target_cpa,d.break_even_cpa,d.target_roas,d.allocated_daily_budget]) assert.ok(Number.isFinite(value),`${d.sku}: neplatné číslo`);
    assert.ok(d.max_cpc>=0&&d.max_cpc<=DEFAULT_ADS_INTELLIGENCE_SETTINGS.maxCpcAbsolute,`${d.sku}: CPC mimo limitu`);
    assert.ok(d.allocated_daily_budget>=0,`${d.sku}: záporný rozpočet`);
    if(d.eligible) assert.doesNotMatch(d.name,/\b(?:no\s*chip|bez\s+(?:čipu|cipu|chipu)|oem\s*(?:čip|cip|chip)|hatona)\b/i);
  }
});

test('fuzz 10 000 produktov nikdy nevytvorí NaN, záporné CPC ani stav mimo pravidiel',()=>{
  const states=new Set(['UČÍ SA','PONECHAŤ','POSILNIŤ','OBMEDZIŤ','ZASTAVIŤ','VYLÚČIŤ']);
  for(let i=0;i<10_000;i++){
    const price=i%13===0?'x':String((i%500)/10);
    const p=product({id:i+1,sku:`F-${i}`,price,stock_status:i%7===0?'outofstock':'instock',product_type_key:i%5===0?'original':'compatible',name:i%11===0?`HP F-${i} bez čipu toner`:`HP F-${i} kompatibilný toner`});
    const d=decideCampaignV2(buildProductEconomics(p),null,{clicks:i%80,cost:(i%100)/3,conversions:i%4},DEFAULT_ADS_INTELLIGENCE_SETTINGS);
    assert.ok(states.has(d.state)); assert.ok(Number.isFinite(d.max_cpc)); assert.ok(d.max_cpc>=0); assert.ok(Number.isFinite(d.target_cpa));
  }
});

test('záťažová agregácia 200 000 udalostí zachová presné súčty',()=>{
  const events=Array.from({length:200_000},(_,i)=>({eventId:`stress-${i}`,ts:'2026-08-20T00:00:00Z',productId:`SKU-${i%1000}`,event:'click' as const,count:1,costEur:.01}));
  const start=performance.now(); const rows=aggregateLearning(events); const elapsed=performance.now()-start;
  assert.equal(rows.length,1000); assert.equal(rows.reduce((sum,row)=>sum+row.clicks,0),200_000); assert.equal(Math.round(rows.reduce((sum,row)=>sum+row.costEur,0)),2000);
  assert.ok(elapsed<5_000,`Agregácia trvala ${elapsed.toFixed(1)} ms`);
});
