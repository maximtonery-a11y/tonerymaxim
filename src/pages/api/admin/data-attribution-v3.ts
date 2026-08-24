import type {APIRoute} from 'astro';
import {constantTimeEqual,getAdminAccessKey} from '../../../lib/admin-access.ts';
import {readAnalyticsEvents} from '../../../lib/tm-analytics.ts';
import {readLearningEvents} from '../../../lib/ads-learning-store.ts';
import {aggregateLearning} from '../../../lib/ads-learning-engine.ts';
import {getProductsCache} from '../../../lib/tm-products-cache.ts';
import {buildCatalogEconomics} from '../../../lib/product-economics.ts';
import {readAdsPurchasePrices} from '../../../lib/ads-purchase-price-store.ts';
import {attributionEngineV3,attributionSummary} from '../../../lib/attribution-engine-v3.ts';
import {readMerchantSnapshot,syncMerchantApi} from '../../../lib/merchant-api.ts';
export const prerender=false;
function allowed(request:Request,url:URL,locals:any){const expected=getAdminAccessKey(locals),supplied=request.headers.get('x-admin-key')||url.searchParams.get('key')||'';return Boolean(expected)&&constantTimeEqual(expected,supplied)}
function env(locals:any){return locals?.runtime?.env||{}}
async function data(locals:any){const [events,cache,merchant]=await Promise.all([readAnalyticsEvents(50000),getProductsCache(),readMerchantSnapshot(env(locals))]),learning=aggregateLearning(readLearningEvents()),economics=buildCatalogEconomics(cache.products,{purchasePrices:readAdsPurchasePrices()}),journeys=attributionEngineV3(events,learning,economics),byId=new Map(economics.flatMap(x=>[[x.product_id,x],[x.merchant_id,x],[x.sku,x]]));return{summary:attributionSummary(journeys),journeys:journeys.slice(0,500),merchant:{...merchant,issues:merchant.issues.slice(0,500).map(x=>{const e=byId.get(x.offerId);return{...x,productName:e?.name||x.offerId,webPriceEur:e?.selling_price??null,priceMismatch:Boolean(e&&x.googlePriceEur!=null&&Math.abs(e.selling_price-x.googlePriceEur)>.01)}})},economics:{products:economics.length,realPurchasePrices:economics.filter(x=>x.purchase_price_source==='abix').length,estimatedPurchasePrices:economics.filter(x=>x.purchase_price_source==='estimated').length,missingPrices:economics.filter(x=>!(x.purchase_price_used>0)).length}}}
export const GET:APIRoute=async({request,url,locals})=>{if(!allowed(request,url,locals))return Response.json({ok:false,error:'Unauthorized'},{status:401});try{return Response.json({ok:true,generatedAt:new Date().toISOString(),...(await data(locals))},{headers:{'cache-control':'no-store'}})}catch(e:any){return Response.json({ok:false,error:e?.message||'DATA V3 sa nepodarilo načítať.'},{status:500})}}
export const POST:APIRoute=async({request,url,locals})=>{if(!allowed(request,url,locals))return Response.json({ok:false,error:'Unauthorized'},{status:401});try{const body=await request.json();if(body?.action!=='sync_merchant')return Response.json({ok:false,error:'Neplatná akcia.'},{status:400});const merchant=await syncMerchantApi(env(locals));return Response.json({ok:true,merchant},{headers:{'cache-control':'no-store'}})}catch(e:any){return Response.json({ok:false,error:e?.message||'Merchant synchronizácia zlyhala.'},{status:400})}}
