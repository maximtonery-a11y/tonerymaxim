import type { MarketingDraft } from './marketing-drafts.ts';
import type { MarketingApproval } from './marketing-approval.ts';

type CampaignPlan=Record<string,any>;
const clean=(v:unknown,max=500)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const csv=(v:unknown)=>`"${String(v??'').replace(/"/g,'""')}"`;

export function buildGoogleAdsPublication(draft:MarketingDraft,approval:MarketingApproval,plan:CampaignPlan,now=new Date()){
  const blockers:string[]=[];
  if(approval.workflowState!=='approved')blockers.push('Koncept nie je manuálne schválený.');
  if(!plan?.ready||plan?.blockers?.length)blockers.push('Aktuálny serverový prepočet kampane neprešiel.');
  if(!Number.isFinite(plan?.summary?.eligible)||plan.summary.eligible<1)blockers.push('Kampaň nemá vhodný produkt.');
  if(!plan?.limits?.allHeadlinesValid||!plan?.limits?.allDescriptionsValid)blockers.push('Texty prekračujú povolené limity Google Ads.');
  const headlines=(plan?.structure?.headlines||[]).map((x:unknown)=>clean(x,30)).filter(Boolean);
  const descriptions=(plan?.structure?.descriptions||[]).map((x:unknown)=>clean(x,90)).filter(Boolean);
  if(draft.channel==='search'&&(headlines.length<3||descriptions.length<2))blockers.push('Search reklama potrebuje aspoň 3 nadpisy a 2 opisy.');
  if(draft.channel==='performance_max'&&(!(plan?.structure?.creativeIds||[]).length))blockers.push('Performance Max nemá schválené obrazové podklady.');
  const products=(plan?.products||[]).map((p:any)=>({id:clean(p.id,80),sku:clean(p.sku,80),name:clean(p.name,200),priceEur:Number(p.price||0),grossMarginEur:Number(p.grossMargin||0)}));
  if(products.some((p:any)=>p.priceEur<=0||p.grossMarginEur<=0))blockers.push('Niektorý produkt už nemá kladnú cenu alebo maržu.');
  const generatedAt=now.toISOString(),expiresAt=new Date(now.getTime()+24*60*60*1000).toISOString();
  const campaign={name:clean(plan?.structure?.campaignName||draft.name,120),channel:draft.channel,goal:draft.goal,dailyBudgetEur:Number(draft.dailyBudgetEur),landingPage:clean(plan?.structure?.landingPage,1000),recommendedMaxCpcEur:Number(plan?.summary?.recommendedMaxCpcEur||0),status:'PAUSED'};
  const creativeIds=(plan?.structure?.creativeIds||[]).map((x:unknown)=>clean(x,80)),variantIds=creativeIds.length?creativeIds:['text-rsa-default'],trackingVariants=variantIds.map((content:string)=>{const url=new URL(campaign.landingPage);url.searchParams.set('utm_source','google');url.searchParams.set('utm_medium','cpc');url.searchParams.set('utm_campaign',campaign.name);url.searchParams.set('utm_content',content);url.searchParams.set('campaign_id','{campaignid}');url.searchParams.set('ad_group_id','{adgroupid}');url.searchParams.set('ad_id','{creative}');url.searchParams.set('asset_group_id','{assetgroupid}');url.searchParams.set('keyword_id','{criterionid}');url.searchParams.set('product_id','{product_id}');url.searchParams.set('matchtype','{matchtype}');url.searchParams.set('network','{network}');url.searchParams.set('device','{device}');return{content,finalUrl:url.toString()}});
  const bundle={schemaVersion:2,mode:'DRY_RUN_ONLY',generatedAt,expiresAt,approvalFingerprint:approval.fingerprint,campaign,assets:{headlines,descriptions,creativeIds,assetGroups:plan?.structure?.assetGroups||[]},tracking:{utmSource:'google',utmMedium:'cpc',variants:trackingVariants},targeting:{keywords:(plan?.structure?.keywords||[]).map((x:unknown)=>clean(x,80)),negativeKeywords:(plan?.structure?.negativeKeywords||[]).map((x:unknown)=>clean(x,80)),productGroups:plan?.structure?.productGroups||[],country:'SK',language:'sk'},products};
  const rows=[['campaign','channel','status','daily_budget_eur','max_cpc_eur','landing_page','product_id','sku','product_name','price_eur','gross_margin_eur'],...products.map((p:any)=>[campaign.name,campaign.channel,campaign.status,campaign.dailyBudgetEur,campaign.recommendedMaxCpcEur,campaign.landingPage,p.id,p.sku,p.name,p.priceEur,p.grossMarginEur])];
  return{ready:blockers.length===0,blockers,bundle,csv:rows.map(row=>row.map(csv).join(',')).join('\r\n')};
}
