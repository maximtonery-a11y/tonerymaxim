import type {APIRoute} from 'astro';
import {constantTimeEqual,getAdminAccessKey} from '../../../lib/admin-access.ts';
import {readAnalyticsEvents,buildVisits} from '../../../lib/tm-analytics.ts';
import {creativePerformance} from '../../../lib/creative-performance.ts';
import {readSearchTermReport} from '../../../lib/google-ads-search-terms.ts';
import {aggregateLearning} from '../../../lib/ads-learning-engine.ts';
import {readLearningEvents} from '../../../lib/ads-learning-store.ts';
import {budgetGuard} from '../../../lib/marketing-control-center.ts';
import {buildOptimizationRecommendations,createExperiment,experimentAction,readOptimizationV2,recommendationAction,saveRecommendations} from '../../../lib/marketing-optimization-v2.ts';
export const prerender=false;
function ok(request:Request,url:URL,locals:any){const e=getAdminAccessKey(locals),s=request.headers.get('x-admin-key')||url.searchParams.get('key')||'';return Boolean(e)&&constantTimeEqual(e,s)}
export const GET:APIRoute=async({request,url,locals})=>{if(!ok(request,url,locals))return Response.json({ok:false,error:'Unauthorized'},{status:401});const store=await readOptimizationV2();return Response.json({ok:true,...store,automaticChanges:false},{headers:{'cache-control':'no-store'}})}
export const POST:APIRoute=async({request,url,locals})=>{if(!ok(request,url,locals))return Response.json({ok:false,error:'Unauthorized'},{status:401});try{const b=await request.json();if(b.action==='create_experiment')return Response.json({ok:true,item:await createExperiment(b)},{status:201});if(b.action==='approve_experiment'||b.action==='cancel_experiment')return Response.json({ok:true,item:await experimentAction(String(b.id),b.action==='approve_experiment'?'approve':'cancel',b.confirmation)});if(b.action==='approve_recommendation'||b.action==='reject_recommendation')return Response.json({ok:true,item:await recommendationAction(String(b.id),b.action==='approve_recommendation'?'approve':'reject')});if(b.action==='refresh_recommendations'){const [events,report]=await Promise.all([readAnalyticsEvents(200000),readSearchTermReport()]),visits=buildVisits(events),creative=creativePerformance(visits),learning=aggregateLearning(readLearningEvents()),budget=budgetGuard(learning,Math.max(1,Number(b.dailyBudgetEur)||30)),items=buildOptimizationRecommendations(creative,report?.decisions||[],budget);return Response.json({ok:true,items:await saveRecommendations(items),automaticChanges:false})}return Response.json({ok:false,error:'Neplatná akcia.'},{status:400})}catch(e:any){return Response.json({ok:false,error:e?.message||'Optimalizácia zlyhala.'},{status:400})}}

