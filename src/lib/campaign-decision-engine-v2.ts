import type { ProductEconomics } from './product-economics.ts';
import type { MarketPretraining } from './market-pretraining.ts';
import type { CampaignSignals } from './campaign-decision-engine.ts';
import { sanitizeAdsSettings, type AdsIntelligenceSettings } from './ads-intelligence-settings.ts';

export type UiState='UČÍ SA'|'PONECHAŤ'|'POSILNIŤ'|'OBMEDZIŤ'|'ZASTAVIŤ'|'VYLÚČIŤ';
export type DecisionV2={
  product_id:string; sku:string; name:string; eligible:boolean; state:UiState; phase:'COLD_START'|'OBSERVED';
  priority_score:number; max_cpc:number; target_cpa:number; break_even_cpa:number; target_roas:number;
  budget_weight:number; allocated_daily_budget:number; market_demand:number; market_confidence:string;
  observed_clicks:number; observed_cost:number; observed_conversions:number; reason_codes:string[];
};
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const money=(v:number)=>Math.round(v*100)/100;
const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const excludedPaidVariant=(e:ProductEconomics)=>/(?:\bno\s*chip\b|\bbez\s+(?:čipu|cipu|chipu)|\boem\s*(?:čip|cip|chip)|\bhatona\b)/i.test(e.name);

export function decideCampaignV2(e:ProductEconomics,m:MarketPretraining|null,s:CampaignSignals={},raw:Partial<AdsIntelligenceSettings>={}):DecisionV2{
 const cfg=sanitizeAdsSettings(raw); const reasons:string[]=[];
 const clicks=n(s.clicks),cost=n(s.cost),conv=n(s.conversions),value=n(s.conversion_value);
 const phase:DecisionV2['phase']=(clicks>0||cost>0||conv>0)?'OBSERVED':'COLD_START';
 const eligible=cfg.enabled&&e.merchant_eligible&&e.product_type==='compatible'&&(e.material_type==='toner'||e.material_type==='ink')&&!excludedPaidVariant(e)&&e.selling_price>0&&e.purchase_price_used>0&&e.estimated_gross_margin>0;
 if(!cfg.enabled)reasons.push('ENGINE_DISABLED'); if(!e.merchant_eligible)reasons.push('NOT_MERCHANT_ELIGIBLE');
 if(e.stock_status!=='instock')reasons.push('OUT_OF_STOCK'); if(e.estimated_gross_margin<=0)reasons.push('NO_POSITIVE_MARGIN');
 if(e.product_type!=='compatible')reasons.push('PAID_ADS_COMPATIBLE_ONLY');
 if(e.material_type!=='toner'&&e.material_type!=='ink')reasons.push('UNSUPPORTED_PAID_MATERIAL');
 if(excludedPaidVariant(e))reasons.push('EXCLUDED_CHIP_OR_HATONA_VARIANT');
 const safety=e.confidence==='high'?cfg.marginSafetyHigh:e.confidence==='medium'?cfg.marginSafetyMedium:cfg.marginSafetyLow;
 const breakEven=Math.max(0,e.estimated_gross_margin), targetCpa=money(breakEven*safety);
 const observedCvr=clicks>0&&conv>0?clamp(conv/clicks,0.005,0.20):cfg.coldStartCvr;
 let maxCpc=money(targetCpa*observedCvr);
 if(m?.bid_low_avg_eur&&m.bid_low_avg_eur>0)maxCpc=Math.min(maxCpc,m.bid_low_avg_eur);
 maxCpc=Math.min(maxCpc,cfg.maxCpcAbsolute);
 const targetRoas=targetCpa>0?money((e.selling_price/targetCpa)*100):9999;
 const demand=m?.market_demand_estimate||0;
 let score=eligible?35:0; score+=Math.min(35,Math.log10(demand+1)*12); score+=e.confidence_score*.2;
 if(e.product_type==='compatible')score+=8; score=Math.round(clamp(score,0,100));
 let state:UiState=eligible?'PONECHAŤ':'VYLÚČIŤ';
 if(eligible&&phase==='COLD_START'){
   if(!m||demand<=0){state='UČÍ SA';reasons.push('MARKET_ZERO_OR_UNKNOWN_IS_LEARNING_NOT_STOP');}
   else if(m.market_data_confidence!=='LOW'&&demand>=cfg.scaleDemandThreshold){state='POSILNIŤ';reasons.push('STRONG_PRETRAINED_MARKET_DEMAND');}
   else {state='PONECHAŤ';reasons.push('SAFE_COLD_START');}
 }
 if(eligible&&phase==='OBSERVED'){
   if(conv>0){const cpa=cost/conv; if(cpa<=targetCpa){state='POSILNIŤ';reasons.push('CPA_WITHIN_TARGET');} else {state='OBMEDZIŤ';reasons.push('CPA_ABOVE_TARGET');}}
   else if(clicks>=cfg.minClicksBeforePause&&cost>=targetCpa*cfg.pauseSpendTargetCpaMultiple){state='ZASTAVIŤ';reasons.push('ENOUGH_EVIDENCE_SPEND_WITHOUT_CONVERSION');}
   else if(clicks>=cfg.minClicksBeforeLimit&&cost>=targetCpa){state='OBMEDZIŤ';reasons.push('EARLY_SPEND_WITHOUT_CONVERSION');}
   else {state='UČÍ SA';reasons.push('NOT_ENOUGH_OBSERVED_EVIDENCE');}
   if(value>0&&cost>0&&value/cost*100<targetRoas&&state==='POSILNIŤ'){state='PONECHAŤ';reasons.push('ROAS_GUARDRAIL');}
 }
 const weight=state==='POSILNIŤ'?1.5:state==='PONECHAŤ'?1:state==='UČÍ SA'?.7:state==='OBMEDZIŤ'?.4:0;
 return {product_id:e.product_id,sku:e.sku,name:e.name,eligible,state,phase,priority_score:score,max_cpc:money(maxCpc),target_cpa:targetCpa,break_even_cpa:money(breakEven),target_roas:targetRoas,budget_weight:weight,allocated_daily_budget:0,market_demand:demand,market_confidence:m?.market_data_confidence||'NONE',observed_clicks:clicks,observed_cost:money(cost),observed_conversions:conv,reason_codes:reasons};
}

export function allocateDailyBudget(decisions:DecisionV2[],raw:Partial<AdsIntelligenceSettings>={}):DecisionV2[]{
 const cfg=sanitizeAdsSettings(raw);
 // This is a planning allocation for the best candidates, not a promise of a
 // one-cent Google budget for thousands of individual products.
 const indexed=decisions.map((decision,index)=>({decision,index}));
 const active=indexed.filter(x=>x.decision.eligible&&x.decision.budget_weight>0).sort((a,b)=>b.decision.priority_score-a.decision.priority_score).slice(0,cfg.maxActiveProducts);
 const totalWeight=active.reduce((s,x)=>s+x.decision.budget_weight*Math.max(1,x.decision.priority_score),0);
 if(totalWeight<=0)return decisions.map(d=>({...d,allocated_daily_budget:0}));
 const totalCents=Math.round(cfg.dailyBudgetEur*100);
 const shares=active.map(x=>{const d=x.decision;const exact=totalCents*(d.budget_weight*Math.max(1,d.priority_score))/totalWeight;return {index:x.index,cents:Math.floor(exact),remainder:exact-Math.floor(exact)}});
 let left=totalCents-shares.reduce((s,x)=>s+x.cents,0);
 shares.sort((a,b)=>b.remainder-a.remainder);
 for(let i=0;i<left;i++)shares[i%shares.length].cents++;
 const byIndex=new Map(shares.map(x=>[x.index,x.cents/100]));
 return decisions.map((d,index)=>({...d,allocated_daily_budget:byIndex.get(index)||0}));
}
