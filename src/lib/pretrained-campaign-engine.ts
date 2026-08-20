import type { ProductEconomics } from './product-economics.ts';
import { decideCampaign, type CampaignSignals, type CampaignDecision } from './campaign-decision-engine.ts';
import type { MarketPretraining } from './market-pretraining.ts';
export type PretrainedDecision=CampaignDecision & {market_demand_estimate:number;market_confidence:string;market_state:string;market_bid_low:number|null;market_bid_high:number|null;market_competition:number|null;market_budget_factor:number;decision_phase:'COLD_START'|'LEARNING'|'OBSERVED'};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function decidePretrainedCampaign(e:ProductEconomics,m:MarketPretraining|null,s:CampaignSignals={}):PretrainedDecision{
 const d=decideCampaign(e,s); const clicks=Number(s.clicks||0),conv=Number(s.conversions||0); const phase=conv>0||clicks>=20?'OBSERVED':clicks>0?'LEARNING':'COLD_START';
 let factor=1; if(m){ if(m.initial_state==='POSILNIŤ')factor=1.25; else if(m.initial_state==='UČÍ SA')factor=.65; if(m.market_data_confidence==='LOW')factor=Math.min(factor,.75); }
 else factor=.6;
 // Market layer may boost/limit budget, but never PAUSE/EXCLUDE an otherwise eligible product.
 let action=d.action; const reasons=[...d.reason_codes];
 if(phase==='COLD_START' && d.eligible && (action==='PAUSE'||action==='EXCLUDE')) action='KEEP';
 if(phase==='COLD_START' && d.eligible && m?.initial_state==='UČÍ SA'){action='KEEP';reasons.push('MARKET_ZERO_OR_UNKNOWN_IS_LEARNING_NOT_STOP');}
 if(phase==='COLD_START' && d.eligible && m?.initial_state==='POSILNIŤ' && m.market_data_confidence!=='LOW' && m.market_demand_estimate>=150 && d.priority_score>=75){action='SCALE';reasons.push('MARKET_PRETRAINING_STRONG');}
 // Cold-start must be deliberately conservative: economics alone cannot SCALE before real ad evidence.
 if(phase==='COLD_START' && d.eligible && action==='SCALE' && !(m?.initial_state==='POSILNIŤ' && m.market_data_confidence!=='LOW' && m.market_demand_estimate>=150)){action='KEEP';reasons.push('COLD_START_SCALE_REQUIRES_STRONG_MARKET_SIGNAL');}
 if(!m)reasons.push('NO_MARKET_MAPPING_LEARN_SAFELY');
 const googleCeiling=m?.bid_low_avg_eur && m.bid_low_avg_eur>0 ? m.bid_low_avg_eur : null;
 // Economics is the hard ceiling. Google bid is context only; never raises max CPC above economics.
 const maxCpc=googleCeiling==null?d.max_cpc:Math.min(d.max_cpc,googleCeiling);
 const weight=clamp(d.budget_weight*factor,0,2);
 return {...d,action,max_cpc:Math.round(maxCpc*100)/100,budget_weight:Math.round(weight*100)/100,reason_codes:[...new Set(reasons)],market_demand_estimate:m?.market_demand_estimate||0,market_confidence:m?.market_data_confidence||'NONE',market_state:m?.initial_state||'UČÍ SA',market_bid_low:m?.bid_low_avg_eur??null,market_bid_high:m?.bid_high_avg_eur??null,market_competition:m?.competition_index_avg??null,market_budget_factor:factor,decision_phase:phase};
}
