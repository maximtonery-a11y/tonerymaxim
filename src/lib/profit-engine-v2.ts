import type { ProductEconomics } from './product-economics.ts';

export type ProfitInputs={revenueWithVat:number;adCostEur:number;items:Array<{productId:string;quantity:number}>;economics:Map<string,ProductEconomics>;vatRate?:number;variableCostEur?:number;targetProfitShare?:number;clickToOrderRate?:number};
export type ProfitResult={revenueWithVat:number;revenueNoVat:number;purchaseCostEur:number;variableCostEur:number;grossProfitEur:number;adCostEur:number;contributionProfitEur:number;breakEvenCpaEur:number;breakEvenCpcEur:number|null;targetCpaEur:number;targetCpcEur:number|null;targetRoas:number|null;poas:number|null;costCoverage:'REAL'|'ESTIMATED'|'MISSING';missingProductIds:string[]};
const money=(v:number)=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const finite=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;

export function calculateContributionProfit(input:ProfitInputs):ProfitResult{
  const vat=Math.max(0,finite(input.vatRate??.23)),revenueWithVat=Math.max(0,finite(input.revenueWithVat)),revenueNoVat=money(revenueWithVat/(1+vat));
  let purchase=0,real=0,estimated=0;const missing:string[]=[];
  for(const item of input.items||[]){const id=String(item.productId||''),qty=Math.max(1,Math.round(finite(item.quantity)||1));const e=input.economics.get(id)||[...input.economics.values()].find(x=>x.sku.toLowerCase()===id.toLowerCase());if(!e){missing.push(id);continue}purchase+=finite(e.purchase_price_used)*qty;if(e.purchase_price_source==='abix')real++;else estimated++}
  const variable=Math.max(0,finite(input.variableCostEur)),gross=money(revenueNoVat-purchase-variable),ad=Math.max(0,finite(input.adCostEur)),contribution=money(gross-ad),targetShare=Math.min(.95,Math.max(0,finite(input.targetProfitShare??.2))),targetCpa=money(Math.max(0,gross*(1-targetShare))),cvr=Math.max(0,finite(input.clickToOrderRate));
  return{revenueWithVat:money(revenueWithVat),revenueNoVat,purchaseCostEur:money(purchase),variableCostEur:money(variable),grossProfitEur:gross,adCostEur:money(ad),contributionProfitEur:contribution,breakEvenCpaEur:Math.max(0,gross),breakEvenCpcEur:cvr?money(Math.max(0,gross)*cvr):null,targetCpaEur:targetCpa,targetCpcEur:cvr?money(targetCpa*cvr):null,targetRoas:targetCpa?Number((revenueNoVat/targetCpa).toFixed(2)):null,poas:ad?Number((gross/ad).toFixed(2)):null,costCoverage:missing.length?'MISSING':real&&!estimated?'REAL':'ESTIMATED',missingProductIds:[...new Set(missing)].filter(Boolean)};
}

