import { join } from 'node:path';
import { appendLearningEvents } from './ads-learning-store.ts';
import type { AdsLearningEvent } from './ads-learning-engine.ts';
import { readSignedJson, writeSignedJson, TM_DATA_ROOT } from './secure-persistence.ts';

export type GoogleAdsConfig = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
  loginCustomerId?: string;
  apiVersion: string;
};

export type GoogleAdsSyncStatus = {
  configured: boolean;
  mode: 'read-only';
  customerId?: string;
  apiVersion: string;
  lastSyncAt?: string;
  rows?: number;
  importedEvents?: number;
  impressions?: number;
  clicks?: number;
  costEur?: number;
  googleConversions?: number;
  googleConversionValueEur?: number;
  error?: string;
};

const STATUS_FILE = join(TM_DATA_ROOT, 'ads-intelligence', 'google-ads-status.json');
const REQUIRED = ['GOOGLE_ADS_DEVELOPER_TOKEN','GOOGLE_ADS_CLIENT_ID','GOOGLE_ADS_CLIENT_SECRET','GOOGLE_ADS_REFRESH_TOKEN','GOOGLE_ADS_CUSTOMER_ID'] as const;

function value(source:any, name:string):string {
  return String(source?.[name] ?? process.env[name] ?? (import.meta.env as any)?.[name] ?? '').trim();
}
function customerId(value:string):string { return value.replace(/\D/g,''); }

export function loadGoogleAdsConfig(source:any={}):GoogleAdsConfig|null {
  if(REQUIRED.some(name=>!value(source,name))) return null;
  const config:GoogleAdsConfig={
    developerToken:value(source,'GOOGLE_ADS_DEVELOPER_TOKEN'),
    clientId:value(source,'GOOGLE_ADS_CLIENT_ID'),
    clientSecret:value(source,'GOOGLE_ADS_CLIENT_SECRET'),
    refreshToken:value(source,'GOOGLE_ADS_REFRESH_TOKEN'),
    customerId:customerId(value(source,'GOOGLE_ADS_CUSTOMER_ID')),
    loginCustomerId:customerId(value(source,'GOOGLE_ADS_LOGIN_CUSTOMER_ID'))||undefined,
    apiVersion:value(source,'GOOGLE_ADS_API_VERSION')||'v25',
  };
  if(!/^\d{6,}$/.test(config.customerId)||!/^(v)?\d+$/.test(config.apiVersion)) return null;
  config.apiVersion=config.apiVersion.startsWith('v')?config.apiVersion:`v${config.apiVersion}`;
  return config;
}

export async function readGoogleAdsStatus(source:any={}):Promise<GoogleAdsSyncStatus>{
  const config=loadGoogleAdsConfig(source);
  const saved=await readSignedJson<GoogleAdsSyncStatus>(STATUS_FILE);
  return {...(saved||{}),configured:Boolean(config),mode:'read-only',apiVersion:config?.apiVersion||'v25',customerId:config?.customerId};
}

async function accessToken(config:GoogleAdsConfig, fetcher:typeof fetch):Promise<string>{
  const body=new URLSearchParams({grant_type:'refresh_token',client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken});
  const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15_000)});
  const json:any=await response.json().catch(()=>({}));
  if(!response.ok||!json.access_token) throw new Error(`Google OAuth zlyhal (${response.status}): ${json.error_description||json.error||'bez access tokenu'}`);
  return String(json.access_token);
}

export const GOOGLE_ADS_PRODUCT_QUERY=`SELECT
  segments.date,
  segments.product_item_id,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
FROM shopping_performance_view
WHERE segments.date DURING LAST_30_DAYS
  AND metrics.impressions > 0`;

export async function fetchGoogleAdsProductRows(config:GoogleAdsConfig, fetcher:typeof fetch=fetch):Promise<any[]>{
  const token=await accessToken(config,fetcher);
  const url=`https://googleads.googleapis.com/${config.apiVersion}/customers/${config.customerId}/googleAds:search`;
  const headers:Record<string,string>={'Content-Type':'application/json',Authorization:`Bearer ${token}`,'developer-token':config.developerToken};
  if(config.loginCustomerId) headers['login-customer-id']=config.loginCustomerId;
  const rows:any[]=[]; let pageToken:string|undefined; const seenPageTokens=new Set<string>(); let pages=0;
  do {
    if(++pages>100) throw new Error('Google Ads API prekročilo bezpečný limit 100 strán výsledkov.');
    const response=await fetcher(url,{method:'POST',headers,body:JSON.stringify({query:GOOGLE_ADS_PRODUCT_QUERY,pageSize:10_000,...(pageToken?{pageToken}:{})}),signal:AbortSignal.timeout(30_000)});
    const json:any=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(`Google Ads API zlyhalo (${response.status}): ${json?.error?.message||'neznáma chyba'}`);
    rows.push(...(Array.isArray(json.results)?json.results:[]));
    if(rows.length>500_000) throw new Error('Google Ads API prekročilo bezpečný limit 500 000 riadkov.');
    pageToken=json.nextPageToken||undefined;
    if(pageToken&&seenPageTokens.has(pageToken)) throw new Error('Google Ads API vrátilo opakujúci sa stránkovací token.');
    if(pageToken) seenPageTokens.add(pageToken);
  } while(pageToken);
  return rows;
}

export function googleRowsToLearningEvents(rows:any[]):AdsLearningEvent[]{
  const events:AdsLearningEvent[]=[];
  for(const row of rows){
    const date=String(row?.segments?.date||'');
    const productId=String(row?.segments?.productItemId||'').trim();
    const parsedDate=new Date(`${date}T00:00:00.000Z`);
    const validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(parsedDate.getTime())&&parsedDate.toISOString().slice(0,10)===date;
    if(!validDate||!productId||productId.length>256) continue;
    const impressions=Math.max(0,Math.round(Number(row?.metrics?.impressions)||0));
    const clicks=Math.max(0,Math.round(Number(row?.metrics?.clicks)||0));
    const costEur=Math.max(0,(Number(row?.metrics?.costMicros)||0)/1_000_000);
    const ts=`${date}T12:00:00.000Z`; const prefix=`google-ads:${date}:${productId}`;
    if(impressions) events.push({eventId:`${prefix}:impression`,ts,productId,event:'impression',count:impressions,source:'google_ads'});
    if(clicks) events.push({eventId:`${prefix}:click`,ts,productId,event:'click',count:clicks,costEur,source:'google_ads'});
  }
  return events;
}

export async function syncGoogleAdsReadOnly(source:any={}, fetcher:typeof fetch=fetch):Promise<GoogleAdsSyncStatus>{
  const config=loadGoogleAdsConfig(source);
  if(!config) throw new Error('Google Ads nie je nakonfigurovaný. Doplňte všetky GOOGLE_ADS_* premenné.');
  try{
    const rows=await fetchGoogleAdsProductRows(config,fetcher);
    const events=googleRowsToLearningEvents(rows);
    const importedEvents=appendLearningEvents(events);
    const metrics=rows.reduce((a,row)=>({impressions:a.impressions+(Number(row?.metrics?.impressions)||0),clicks:a.clicks+(Number(row?.metrics?.clicks)||0),costEur:a.costEur+(Number(row?.metrics?.costMicros)||0)/1_000_000,conversions:a.conversions+(Number(row?.metrics?.conversions)||0),value:a.value+(Number(row?.metrics?.conversionsValue)||0)}),{impressions:0,clicks:0,costEur:0,conversions:0,value:0});
    const status:GoogleAdsSyncStatus={configured:true,mode:'read-only',customerId:config.customerId,apiVersion:config.apiVersion,lastSyncAt:new Date().toISOString(),rows:rows.length,importedEvents,impressions:metrics.impressions,clicks:metrics.clicks,costEur:Number(metrics.costEur.toFixed(6)),googleConversions:metrics.conversions,googleConversionValueEur:metrics.value};
    await writeSignedJson(STATUS_FILE,status); return status;
  }catch(error:any){
    const status:GoogleAdsSyncStatus={configured:true,mode:'read-only',customerId:config.customerId,apiVersion:config.apiVersion,lastSyncAt:new Date().toISOString(),error:error?.message||String(error)};
    await writeSignedJson(STATUS_FILE,status).catch(()=>undefined); throw error;
  }
}
