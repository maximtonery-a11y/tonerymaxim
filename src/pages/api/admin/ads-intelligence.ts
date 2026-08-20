import type { APIRoute } from 'astro';
import { constantTimeEqual } from '../../../lib/admin-access.ts';
import { loadAdsIntelligenceSettings, saveAdsIntelligenceSettings } from '../../../lib/ads-intelligence-settings-store.ts';
import { calculateAdsIntelligence } from '../../../lib/ads-intelligence-runtime.ts';
import { refreshAdsPurchasePrices } from '../../../lib/ads-purchase-price-store.ts';
import { getAdminAccessKey } from '../../../lib/admin-access.ts';
import { readGoogleAdsStatus, syncGoogleAdsReadOnly } from '../../../lib/google-ads-readonly.ts';
export const prerender=false;
function tmKey(locals:any){return getAdminAccessKey(locals)}
function allowed(request:Request,url:URL,locals:any){const expected=tmKey(locals);if(!expected)return ['localhost','127.0.0.1'].includes(url.hostname);const supplied=url.searchParams.get('key')||request.headers.get('x-admin-key')||'';return constantTimeEqual(expected,supplied)}
function runtimeEnv(locals:any){return locals?.runtime?.env||{}}
export const GET:APIRoute=async({request,url,locals})=>{if(!allowed(request,url,locals))return Response.json({ok:false,error:'Unauthorized'},{status:401});try{const settings=await loadAdsIntelligenceSettings();const googleAds=await readGoogleAdsStatus(runtimeEnv(locals));return Response.json({ok:true,googleAds,...calculateAdsIntelligence(settings)},{headers:{'Cache-Control':'no-store'}})}catch(e:any){return Response.json({ok:false,error:e?.message||String(e)},{status:500})}};
export const POST:APIRoute=async({request,url,locals})=>{if(!allowed(request,url,locals))return Response.json({ok:false,error:'Unauthorized'},{status:401});try{const body=await request.json();if(body?.action==='refresh_abix'){const refresh=await refreshAdsPurchasePrices();const settings=await loadAdsIntelligenceSettings();return Response.json({ok:true,refresh,googleAds:await readGoogleAdsStatus(runtimeEnv(locals)),...calculateAdsIntelligence(settings)},{headers:{'Cache-Control':'no-store'}})}if(body?.action==='sync_google_ads'){const googleAds=await syncGoogleAdsReadOnly(runtimeEnv(locals));const settings=await loadAdsIntelligenceSettings();return Response.json({ok:true,googleAds,...calculateAdsIntelligence(settings)},{headers:{'Cache-Control':'no-store'}})}const settings=await saveAdsIntelligenceSettings(body?.settings||body||{});return Response.json({ok:true,googleAds:await readGoogleAdsStatus(runtimeEnv(locals)),...calculateAdsIntelligence(settings)},{headers:{'Cache-Control':'no-store'}})}catch(e:any){return Response.json({ok:false,error:e?.message||String(e)},{status:400})}};
