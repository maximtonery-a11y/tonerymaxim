import type { APIRoute } from 'astro';
import { constantTimeEqual, getAdminAccessKey } from '../../../lib/admin-access.ts';
import { readAnalyticsEvents } from '../../../lib/tm-analytics.ts';
import { aggregateLearning } from '../../../lib/ads-learning-engine.ts';
import { readLearningEvents } from '../../../lib/ads-learning-store.ts';
import { marketingOverview } from '../../../lib/marketing-overview.ts';
import { readMarketingDrafts, saveMarketingDraft } from '../../../lib/marketing-drafts.ts';
import { readGoogleAdsStatus } from '../../../lib/google-ads-readonly.ts';
export const prerender=false;
function allowed(request:Request,url:URL,locals:any){const expected=getAdminAccessKey(locals);const supplied=request.headers.get('x-admin-key')||url.searchParams.get('key')||'';return Boolean(expected)&&constantTimeEqual(expected,supplied)}
export const GET:APIRoute=async({request,url,locals})=>{if(!allowed(request,url,locals))return Response.json({ok:false,error:'Unauthorized'},{status:401});const [events,drafts,googleAds]=await Promise.all([readAnalyticsEvents(50000),readMarketingDrafts(),readGoogleAdsStatus((locals as any)?.runtime?.env)]);const learning=aggregateLearning(readLearningEvents());return Response.json({ok:true,generatedAt:new Date().toISOString(),overview:marketingOverview(events,learning),drafts,googleAds},{headers:{'Cache-Control':'no-store'}})};
export const POST:APIRoute=async({request,url,locals})=>{if(!allowed(request,url,locals))return Response.json({ok:false,error:'Unauthorized'},{status:401});try{const draft=await saveMarketingDraft(await request.json());return Response.json({ok:true,draft},{headers:{'Cache-Control':'no-store'}})}catch(error:any){return Response.json({ok:false,error:error?.message||'Uloženie zlyhalo.'},{status:400})}};
