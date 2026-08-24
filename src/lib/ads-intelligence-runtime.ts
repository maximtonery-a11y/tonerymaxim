import path from 'node:path';
import fs from 'node:fs';
import { buildCatalogEconomics } from './product-economics.ts';
import { loadMarketPretrainingCsv, findMarketForProduct } from './market-pretraining.ts';
import { decideCampaignV2, allocateDailyBudget } from './campaign-decision-engine-v2.ts';
import type { AdsIntelligenceSettings } from './ads-intelligence-settings.ts';
import { readLearningEvents } from './ads-learning-store.ts';
import { aggregateLearning } from './ads-learning-engine.ts';
import { readAdsPurchasePrices } from './ads-purchase-price-store.ts';
import { getProductsCache } from './tm-products-cache.ts';

let marketCache: ReturnType<typeof loadMarketPretrainingCsv> | null = null;
let snapshotCache:{file:string;mtimeMs:number;value:any}|null=null;
function resolveExisting(candidates:string[]) { for (const p of candidates) if (fs.existsSync(p)) return p; throw new Error(`Ads Intelligence data missing: ${candidates.join(', ')}`); }
async function baseData(){
  // Marketing pouziva tu istu produktovu cache ako e-shop. Nacitanie druheho
  // 32 MB products.json a jeho trvale drzanie v RAM v minulosti vedelo zhodit
  // cely storefront.
  const catalog=(await getProductsCache()).products || [];
  const marketPath=resolveExisting([path.resolve('data/market-pretraining-sk.csv'),path.resolve('src/data/market-pretraining-sk.csv')]);
  const market=marketCache || (marketCache=loadMarketPretrainingCsv(marketPath));
  return {catalog,market};
}
/** Heavy calculation for the standalone Ads worker only. */
export async function calculateAdsIntelligenceLive(settings:AdsIntelligenceSettings, options:{decisionLimit?:number}={}){
  const {catalog,market}=await baseData();
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
  const limit=options.decisionLimit==null?decisions.length:Math.max(0,Math.min(decisions.length,Math.floor(options.decisionLimit)));
  return {generated_at:new Date().toISOString(),settings,summary:{products:catalog.length,market_clusters:market.size,eligible:decisions.filter(d=>d.eligible).length,real_purchase_prices:purchasePrices.size,counts,daily_budget:settings.dailyBudgetEur},decisions:decisions.slice(0,limit)};
}

function snapshotCandidates(){
  const persistent=process.env.TM_PERSISTENT_DATA_DIR?.trim();
  return [persistent?path.join(persistent,'ads-intelligence','snapshot.json'):'',path.resolve('src/data/ads-intelligence-snapshot.json')].filter(Boolean);
}

/** Storefront-safe reader: never loads products, market data or learning data. */
export async function calculateAdsIntelligence(settings:AdsIntelligenceSettings, options:{decisionLimit?:number}={}){
  const file=resolveExisting(snapshotCandidates());
  const stat=fs.statSync(file);
  if(!snapshotCache||snapshotCache.file!==file||snapshotCache.mtimeMs!==stat.mtimeMs){
    snapshotCache={file,mtimeMs:stat.mtimeMs,value:JSON.parse(fs.readFileSync(file,'utf8'))};
  }
  const stored=snapshotCache.value;
  const all=Array.isArray(stored?.decisions)?stored.decisions:[];
  const limit=options.decisionLimit==null?all.length:Math.max(0,Math.min(all.length,Math.floor(options.decisionLimit)));
  return {...stored,settings,summary:{...(stored?.summary||{}),daily_budget:settings.dailyBudgetEur},decisions:all.slice(0,limit),calculation_mode:'snapshot'};
}

export function writeAdsIntelligenceSnapshot(snapshot:any){
  const base=process.env.TM_PERSISTENT_DATA_DIR?.trim()||path.resolve('.tm-data');
  const dir=path.join(base,'ads-intelligence');
  const file=path.join(dir,'snapshot.json');
  const temp=`${file}.${process.pid}.tmp`;
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(temp,JSON.stringify(snapshot));
  fs.renameSync(temp,file);
  snapshotCache=null;
  return file;
}
