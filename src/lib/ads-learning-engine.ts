export type AdsLearningEvent = {
  ts: string;
  productId: string;
  oem?: string;
  event: "impression"|"click"|"add_to_cart"|"purchase";
  costEur?: number;
  revenueEur?: number;
  grossProfitEur?: number;
  orderId?: string;
  eventId: string;
  count?: number;
  source?: 'google_ads'|'store'|'manual';
};

export type LearningAggregate = {
  productId: string;
  oem?: string;
  impressions: number;
  clicks: number;
  addToCarts: number;
  purchases: number;
  costEur: number;
  revenueEur: number;
  grossProfitEur: number;
  ctr: number|null;
  cvr: number|null;
  cartRate: number|null;
  cpa: number|null;
  roas: number|null;
  profitAfterAdsEur: number;
  confidence: "LOW"|"MEDIUM"|"HIGH";
};

const n=(v:any)=>Number.isFinite(Number(v))?Number(v):0;

export function aggregateLearning(events: AdsLearningEvent[]): LearningAggregate[] {
  const m=new Map<string,LearningAggregate>();
  for(const e of events){
    if(!e?.productId) continue;
    const a=m.get(e.productId)||{
      productId:e.productId,oem:e.oem,impressions:0,clicks:0,addToCarts:0,purchases:0,
      costEur:0,revenueEur:0,grossProfitEur:0,ctr:null,cvr:null,cartRate:null,cpa:null,
      roas:null,profitAfterAdsEur:0,confidence:"LOW"
    };
    const count=Math.max(1,Math.round(n(e.count)||1));
    if(e.event==="impression") a.impressions+=count;
    if(e.event==="click"){ a.clicks+=count; a.costEur+=n(e.costEur); }
    if(e.event==="add_to_cart") a.addToCarts+=count;
    if(e.event==="purchase"){
      a.purchases+=count; a.revenueEur+=n(e.revenueEur); a.grossProfitEur+=n(e.grossProfitEur);
    }
    m.set(e.productId,a);
  }
  for(const a of m.values()){
    a.ctr=a.impressions? a.clicks/a.impressions:null;
    a.cvr=a.clicks? a.purchases/a.clicks:null;
    a.cartRate=a.clicks? a.addToCarts/a.clicks:null;
    a.cpa=a.purchases? a.costEur/a.purchases:null;
    a.roas=a.costEur? a.revenueEur/a.costEur:null;
    a.profitAfterAdsEur=a.grossProfitEur-a.costEur;
    a.confidence=a.clicks>=50||a.purchases>=8?"HIGH":a.clicks>=15||a.purchases>=3?"MEDIUM":"LOW";
  }
  return [...m.values()];
}

export type LearnedDecision = {
  state:"UČÍ SA"|"PONECHAŤ"|"POSILNIŤ"|"OBMEDZIŤ"|"ZASTAVIŤ";
  reason:string;
  bidMultiplier:number;
};

/**
 * Conservative toner learning policy.
 * Never punishes 3 clicks / 0 orders. Hard negative action needs enough evidence
 * AND economics. Market demand is prior/context, never a stop signal by itself.
 */
export function learnedDecision(a:LearningAggregate, breakEvenCpa:number, _marketDemand:number):LearnedDecision{
  const be=Math.max(0,n(breakEvenCpa));
  if(a.clicks<15 && a.purchases<3)
    return {state:"UČÍ SA",reason:`Málo dát (${a.clicks} klikov, ${a.purchases} objednávok).`,bidMultiplier:1};

  if(a.purchases>=3 && a.cpa!==null && be>0 && a.cpa<=be*0.65 && a.profitAfterAdsEur>0)
    return {state:"POSILNIŤ",reason:`CPA ${a.cpa.toFixed(2)} € je bezpečne pod break-even ${be.toFixed(2)} €.`,bidMultiplier:1.15};

  if(a.purchases>=2 && a.cpa!==null && be>0 && a.cpa<=be)
    return {state:"PONECHAŤ",reason:`CPA ${a.cpa.toFixed(2)} € je v ekonomickom limite.`,bidMultiplier:1};

  // Cart intent protects a product from premature stopping.
  if(a.clicks>=25 && a.clicks<50 && a.purchases===0 && a.addToCarts>0)
    return {state:"OBMEDZIŤ",reason:`${a.clicks} klikov bez objednávky, ale ${a.addToCarts}× košík – ponechať test s nižším CPC.`,bidMultiplier:.8};

  // Stop only on materially sufficient loss sample.
  if(a.clicks>=50 && a.purchases===0 && a.costEur>=Math.max(be*1.5,20))
    return {state:"ZASTAVIŤ",reason:`${a.clicks} klikov bez objednávky a náklad ${a.costEur.toFixed(2)} € prekročil bezpečný testovací limit.`,bidMultiplier:0};

  if(a.purchases>=3 && a.cpa!==null && be>0 && a.cpa>be*1.25)
    return {state:"OBMEDZIŤ",reason:`CPA ${a.cpa.toFixed(2)} € je nad break-even ${be.toFixed(2)} €.`,bidMultiplier:.75};

  return {state:"PONECHAŤ",reason:`Dáta sú použiteľné, ale ešte nedávajú silný dôvod meniť reklamu.`,bidMultiplier:1};
}
