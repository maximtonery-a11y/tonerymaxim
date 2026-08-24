import type { GoogleAdsConfig } from './google-ads-readonly.ts';
import { googleAdsAccessToken } from './google-ads-readonly.ts';

const micros=(v:unknown)=>Math.max(1_000_000,Math.round(Number(v||0)*1_000_000));
const clean=(v:unknown,max=255)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);

export function buildSearchValidateOnlyOperations(publication:any,customerId:string){
  if(publication?.mode!=='DRY_RUN_ONLY'||publication?.campaign?.channel!=='search')throw new Error('Validate-only adaptér etapy 6 podporuje iba schválenú Search kampaň.');
  if(publication?.campaign?.status!=='PAUSED')throw new Error('Kampaň musí zostať pozastavená.');
  const root=`customers/${customerId}`,budget=`${root}/campaignBudgets/-1`,campaign=`${root}/campaigns/-2`,adGroup=`${root}/adGroups/-3`;
  const headlines=(publication?.assets?.headlines||[]).slice(0,15).map((text:string)=>({text:clean(text,30)})),descriptions=(publication?.assets?.descriptions||[]).slice(0,4).map((text:string)=>({text:clean(text,90)}));
  if(headlines.length<3||descriptions.length<2)throw new Error('Search reklama nemá minimálne 3 nadpisy a 2 opisy.');
  const operations:any[]=[
    {campaignBudgetOperation:{create:{resourceName:budget,name:`${clean(publication.campaign.name,180)} | rozpočet`,amountMicros:String(micros(publication.campaign.dailyBudgetEur)),deliveryMethod:'STANDARD',explicitlyShared:false}}},
    {campaignOperation:{create:{resourceName:campaign,name:clean(publication.campaign.name,180),status:'PAUSED',advertisingChannelType:'SEARCH',campaignBudget:budget,manualCpc:{enhancedCpcEnabled:false},networkSettings:{targetGoogleSearch:true,targetSearchNetwork:true,targetContentNetwork:false,targetPartnerSearchNetwork:false}}}},
    {adGroupOperation:{create:{resourceName:adGroup,name:`${clean(publication.campaign.name,180)} | hlavná skupina`,campaign,status:'PAUSED',type:'SEARCH_STANDARD',cpcBidMicros:String(micros(publication.campaign.recommendedMaxCpcEur))}}},
    {adGroupAdOperation:{create:{adGroup,status:'PAUSED',ad:{responsiveSearchAd:{headlines,descriptions},finalUrls:[clean(publication.tracking?.variants?.[0]?.finalUrl||publication.campaign.landingPage,2048)]}}}},
  ];
  for(const keyword of (publication?.targeting?.keywords||[]).slice(0,50))operations.push({adGroupCriterionOperation:{create:{adGroup,status:'PAUSED',keyword:{text:clean(keyword,80),matchType:'PHRASE'}}}});
  for(const keyword of (publication?.targeting?.negativeKeywords||[]).slice(0,50))operations.push({campaignCriterionOperation:{create:{campaign,negative:true,keyword:{text:clean(keyword,80),matchType:'PHRASE'}}}});
  return operations;
}

export async function googleAdsValidateOnly(config:GoogleAdsConfig,publication:any,fetcher:typeof fetch=fetch){
  const operations=buildSearchValidateOnlyOperations(publication,config.customerId);return googleAdsValidateOperations(config,operations,fetcher);
}

export async function googleAdsValidateOperations(config:GoogleAdsConfig,operations:any[],fetcher:typeof fetch=fetch){
  if(!Array.isArray(operations)||!operations.length)throw new Error('Validate-only požiadavka nemá operácie.');
  const token=await googleAdsAccessToken(config,fetcher),url=`https://googleads.googleapis.com/${config.apiVersion}/customers/${config.customerId}/googleAds:mutate`;
  const headers:Record<string,string>={'Content-Type':'application/json',Authorization:`Bearer ${token}`,'developer-token':config.developerToken};if(config.loginCustomerId)headers['login-customer-id']=config.loginCustomerId;
  const body={mutateOperations:operations,partialFailure:false,validateOnly:true,responseContentType:'MUTABLE_RESOURCE'};
  const response=await fetcher(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30_000)}),json:any=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`Google Ads validate-only zlyhalo (${response.status}): ${json?.error?.message||'neznáma chyba'}`);
  return{ok:true,validateOnly:true,operations:operations.length,requestId:response.headers.get('request-id')||undefined,results:Array.isArray(json.mutateOperationResponses)?json.mutateOperationResponses.length:0};
}
