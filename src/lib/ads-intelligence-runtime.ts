import fs from 'node:fs';
import path from 'node:path';
import { buildCatalogEconomics } from './product-economics.ts';
import { loadMarketPretrainingCsv, findMarketForProduct } from './market-pretraining.ts';
import { decideCampaignV2, allocateDailyBudget } from './campaign-decision-engine-v2.ts';
import type { AdsIntelligenceSettings } from './ads-intelligence-settings.ts';
import { readLearningEvents } from './ads-learning-store.ts';
import { aggregateLearning } from './ads-learning-engine.ts';
import { readAdsPurchasePrices } from './ads-purchase-price-store.ts';

let cache: { catalog:any[]; market:ReturnType<typeof loadMarketPretrainingCsv>; economics:ReturnType<typeof buildCatalogEconomics> } | null = null;
function resolveExisting(candidates:string[]) { for (const p of candidates) if (fs.existsSync(p)) return p; throw new Error(`Ads Intelligence data missing: ${candidates.join(', ')}`); }
function baseData(){
  if(cache) return cache;
  const catalogPath=resolveExisting([path.resolve('.tm-cache/products.json'),path.resolve('src/data/products.json')]);
  const marketPath=resolveExisting([path.resolve('data/market-pretraining-sk.csv'),path.resolve('src/data/market-pretraining-sk.csv')]);
  const catalog=JSON.parse(fs.readFileSync(catalogPath,'utf8')).products || [];
  const market=loadMarketPretrainingCsv(marketPath);
  const economics=buildCatalogEconomics(catalog);
  cache={catalog,market,economics}; return cache;
}
export function calculateAdsIntelligence(settings:AdsIntelligenceSettings){
  const {catalog,market}=baseData();
  // VAT is a live setting, therefore economics must be recalculated when the
  // administrator changes it. Catalog and market parsing remain cached.
  const purchasePrices=readAdsPurchasePrices();
  const economics=buildCatalogEconomics(catalog,{vatRate:settings.vatRate,purchasePrices});
  // Learning data is read only for this admin calculation; storefront requests never touch it.
  const learning = new Map(aggregateLearning(readLearningEvents()).map(a => [String(a.productId), a]));
  const raw=economics.map((e:any,i:number)=>{
    const a=learning.get(String(e.product_id)) || learning.get(String(e.sku));
    const signals=a ? { clicks:a.clicks, impressions:a.impressions, cost:a.costEur, conversions:a.purchases, conversion_value:a.revenueEur } : {};
    return decideCampaignV2(e,findMarketForProduct(catalog[i],market),signals,settings);
  });
  const decisions=allocateDailyBudget(raw,settings).sort((a,b)=>b.priority_score-a.priority_score);
  const states=['UČÍ SA','PONECHAŤ','POSILNIŤ','OBMEDZIŤ','ZASTAVIŤ','VYLÚČIŤ'];
  const counts=Object.fromEntries(states.map(s=>[s,decisions.filter(d=>d.state===s).length]));
  return {generated_at:new Date().toISOString(),settings,summary:{products:catalog.length,market_clusters:market.size,eligible:decisions.filter(d=>d.eligible).length,real_purchase_prices:purchasePrices.size,counts,daily_budget:settings.dailyBudgetEur},decisions};
}
