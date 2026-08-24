import { join } from 'node:path';
import type { GoogleAdsConfig } from './google-ads-readonly.ts';
import { googleAdsAccessToken } from './google-ads-readonly.ts';
import { sanitizeAdsSettings,type AdsIntelligenceSettings } from './ads-intelligence-settings.ts';
import { readSignedJson,writeSignedJson,TM_DATA_ROOT } from './secure-persistence.ts';

export const GOOGLE_ADS_SEARCH_TERMS_QUERY=`SELECT
  segments.date,
  campaign.id,
  campaign.name,
  ad_group.id,
  ad_group.name,
  search_term_view.search_term,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
FROM search_term_view
WHERE segments.date DURING LAST_30_DAYS
  AND metrics.impressions > 0`;

export type SearchIntent='BUY'|'PRODUCT'|'PRINTER'|'INFORMATION'|'IRRELEVANT';
export type SearchRecommendation='NEW_EXACT_KEYWORD'|'KEEP'|'RAISE_BID_REVIEW'|'LOWER_BID_REVIEW'|'NEGATIVE_EXACT_REVIEW'|'NEW_LANDING_PAGE_REVIEW'|'LEARN';
export type SearchTermDecision={term:string;campaign:string;campaignId:string;adGroup:string;adGroupId:string;impressions:number;clicks:number;costEur:number;conversions:number;conversionValueEur:number;ctr:number;cpa:number|null;roas:number|null;intent:SearchIntent;recommendedAction:SearchRecommendation;landingPageSuggestion:string|null;state:'UČÍ SA'|'PONECHAŤ'|'POSILNIŤ'|'OBMEDZIŤ'|'ZASTAVIŤ';reason:string;suggestNegative:boolean;negativeMatchType:'EXACT'|null};
const STATUS_FILE=join(TM_DATA_ROOT,'marketing-v2','search-terms.json');
const n=(v:unknown)=>Math.max(0,Number(v)||0),clean=(v:unknown,max=300)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);

export async function fetchGoogleAdsSearchTermRows(config:GoogleAdsConfig,fetcher:typeof fetch=fetch){
  const token=await googleAdsAccessToken(config,fetcher),url=`https://googleads.googleapis.com/${config.apiVersion}/customers/${config.customerId}/googleAds:search`,headers:Record<string,string>={'Content-Type':'application/json',Authorization:`Bearer ${token}`,'developer-token':config.developerToken};if(config.loginCustomerId)headers['login-customer-id']=config.loginCustomerId;
  const rows:any[]=[];let pageToken:string|undefined;const seen=new Set<string>();let pages=0;do{if(++pages>100)throw new Error('Search terms import prekročil limit 100 strán.');const response=await fetcher(url,{method:'POST',headers,body:JSON.stringify({query:GOOGLE_ADS_SEARCH_TERMS_QUERY,pageSize:10_000,...(pageToken?{pageToken}:{})}),signal:AbortSignal.timeout(30_000)}),json:any=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`Google Ads search terms zlyhali (${response.status}): ${json?.error?.message||'neznáma chyba'}`);rows.push(...(Array.isArray(json.results)?json.results:[]));if(rows.length>500_000)throw new Error('Search terms import prekročil limit 500 000 riadkov.');pageToken=json.nextPageToken||undefined;if(pageToken&&seen.has(pageToken))throw new Error('Search terms API vrátilo opakujúci sa stránkovací token.');if(pageToken)seen.add(pageToken)}while(pageToken);return rows;
}

export function classifySearchIntent(termValue:unknown):SearchIntent{const term=clean(termValue,300).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');if(/\b(bazos|bazár|bazar|servis|oprava|ovladac|driver|manual|navod pdf|zadarmo)\b/.test(term))return'IRRELEVANT';if(/\b(ako|preco|čo je|co je|navod|vymenit|resetovat|problem)\b/.test(term))return'INFORMATION';if(/\b(kupit|objednat|cena|skladom|eshop|najlacnejsi|zlava)\b/.test(term))return'BUY';if(/\b(laserjet|deskjet|officejet|pixma|workforce|ecotank|multifunkc|tlaciaren|tlačiareň|mfc|dcp|hl|mf|lbp)\b/.test(term))return'PRINTER';return'PRODUCT'}

export function decideSearchTerms(rows:any[],raw:Partial<AdsIntelligenceSettings>={},targetCpaEur=10):SearchTermDecision[]{
  const cfg=sanitizeAdsSettings(raw),target=Math.max(1,Number(targetCpaEur)||10),map=new Map<string,any>();
  for(const row of rows){const term=clean(row?.searchTermView?.searchTerm,300);if(!term)continue;const campaign=clean(row?.campaign?.name,180),campaignId=clean(row?.campaign?.id,40),adGroup=clean(row?.adGroup?.name,180),adGroupId=clean(row?.adGroup?.id,40),key=`${campaignId||campaign}\u0000${adGroupId||adGroup}\u0000${term.toLowerCase()}`,x=map.get(key)||{term,campaign,campaignId,adGroup,adGroupId,impressions:0,clicks:0,costEur:0,conversions:0,conversionValueEur:0};x.impressions+=n(row?.metrics?.impressions);x.clicks+=n(row?.metrics?.clicks);x.costEur+=n(row?.metrics?.costMicros)/1_000_000;x.conversions+=n(row?.metrics?.conversions);x.conversionValueEur+=n(row?.metrics?.conversionsValue);map.set(key,x)}
  return [...map.values()].map(x=>{const ctr=x.impressions?x.clicks/x.impressions:0,cpa=x.conversions?x.costEur/x.conversions:null,roas=x.costEur?x.conversionValueEur/x.costEur:null,intent=classifySearchIntent(x.term);let state:SearchTermDecision['state']='UČÍ SA',reason='Zatiaľ je málo dát na bezpečné rozhodnutie.',suggestNegative=false,recommendedAction:SearchRecommendation='LEARN',landingPageSuggestion:string|null=null;
    if(x.conversions>=2&&cpa!==null&&cpa<=target*.8){state='POSILNIŤ';reason=`Výraz prináša objednávky s CPA ${cpa.toFixed(2)} €.`;recommendedAction='NEW_EXACT_KEYWORD'}
    else if(x.conversions>0&&cpa!==null&&cpa<=target){state='PONECHAŤ';reason=`Výraz konvertuje v limite CPA ${target.toFixed(2)} €.`;recommendedAction='KEEP'}
    else if(x.conversions>0){state='OBMEDZIŤ';reason=`CPA ${cpa!.toFixed(2)} € je nad cieľom ${target.toFixed(2)} €.`;recommendedAction='LOWER_BID_REVIEW'}
    else if(x.clicks>=cfg.minClicksBeforePause&&x.costEur>=target*cfg.pauseSpendTargetCpaMultiple){state='ZASTAVIŤ';reason=`${x.clicks} klikov bez objednávky a náklad ${x.costEur.toFixed(2)} € prekročil bezpečný limit.`;suggestNegative=intent==='IRRELEVANT'||intent==='INFORMATION';recommendedAction=suggestNegative?'NEGATIVE_EXACT_REVIEW':'NEW_LANDING_PAGE_REVIEW';landingPageSuggestion=suggestNegative?null:`Vytvoriť presnú vstupnú stránku pre: ${x.term}`}
    else if(x.clicks>=cfg.minClicksBeforeLimit&&x.costEur>=target){state='OBMEDZIŤ';reason=`${x.clicks} klikov bez objednávky; ešte sa neodporúča výraz úplne vylúčiť.`;recommendedAction='LOWER_BID_REVIEW'}
    return{...x,costEur:Number(x.costEur.toFixed(2)),conversionValueEur:Number(x.conversionValueEur.toFixed(2)),ctr:Number(ctr.toFixed(4)),cpa:cpa===null?null:Number(cpa.toFixed(2)),roas:roas===null?null:Number(roas.toFixed(2)),intent,recommendedAction,landingPageSuggestion,state,reason,suggestNegative,negativeMatchType:suggestNegative?'EXACT':null} as SearchTermDecision}).sort((a,b)=>b.costEur-a.costEur);
}

export async function readSearchTermReport(){return readSignedJson<{generatedAt:string;rows:number;decisions:SearchTermDecision[]}>(STATUS_FILE)}
export async function syncSearchTerms(config:GoogleAdsConfig,settings:Partial<AdsIntelligenceSettings>={},targetCpaEur=10,fetcher:typeof fetch=fetch){const rows=await fetchGoogleAdsSearchTermRows(config,fetcher),report={generatedAt:new Date().toISOString(),rows:rows.length,decisions:decideSearchTerms(rows,settings,targetCpaEur)};await writeSignedJson(STATUS_FILE,report);return report}
