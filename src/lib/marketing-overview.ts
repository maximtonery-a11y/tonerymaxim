import { buildVisits, type TMAnalyticsEvent } from './tm-analytics.ts';
import type { LearningAggregate } from './ads-learning-engine.ts';
import { creativePerformance } from './creative-performance.ts';

export function marketingOverview(events:TMAnalyticsEvent[],learning:LearningAggregate[]){
  const since=Date.now()-30*86400000;
  const visits=buildVisits(events).filter(v=>Date.parse(v.startedAt)>=since&&!v.owner);
  const paid=visits.filter(v=>Boolean(v.campaign.gclid)||/cpc|ppc|paid/i.test(v.campaign.medium));
  const orders=paid.filter(v=>v.orderCompleted);
  const revenue=orders.reduce((s,v)=>s+Number(v.orderValue||0),0);
  const cost=learning.reduce((s,v)=>s+Number(v.costEur||0),0);
  const grossProfit=learning.reduce((s,v)=>s+Number(v.grossProfitEur||0),0);
  const campaigns=new Map<string,{name:string;campaignId:string;visits:number;orders:number;revenue:number;activeMs:number;pageviews:number;cartAdds:number;checkouts:number}>();
  for(const visit of paid){
    const name=visit.campaign.campaign||'(nezistená kampaň)',stableKey=visit.campaign.campaignId?`id:${visit.campaign.campaignId}`:`name:${name}`;
    const row=campaigns.get(stableKey)||{name,campaignId:visit.campaign.campaignId||'',visits:0,orders:0,revenue:0,activeMs:0,pageviews:0,cartAdds:0,checkouts:0};
    row.visits++;row.activeMs+=visit.activeMs;row.pageviews+=visit.pageviews;row.cartAdds+=visit.cartAdds;if(visit.checkoutStarted)row.checkouts++;if(visit.orderCompleted){row.orders++;row.revenue+=Number(visit.orderValue||0)}campaigns.set(stableKey,row);
  }
  const campaignRows=[...campaigns.values()].map(x=>({...x,averageActiveSeconds:x.visits?Math.round(x.activeMs/x.visits/1000):0,averagePages:x.visits?Number((x.pageviews/x.visits).toFixed(1)):0,conversionRate:x.visits?x.orders/x.visits:0}));
  return {periodDays:30,paidVisits:paid.length,orders:orders.length,revenue,cost,grossProfit,profitAfterAds:grossProfit-cost,conversionRate:paid.length?orders.length/paid.length:0,roas:cost?revenue/cost:null,poas:cost?grossProfit/cost:null,campaigns:campaignRows.sort((a,b)=>b.revenue-a.revenue),creatives:creativePerformance(paid)};
}
