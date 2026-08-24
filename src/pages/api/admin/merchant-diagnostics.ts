import type { APIRoute } from 'astro';
import { constantTimeEqual,getAdminAccessKey } from '../../../lib/admin-access.ts';
import { merchantDiagnostics } from '../../../lib/merchant-diagnostics.ts';
import { getProductsCache } from '../../../lib/tm-products-cache.ts';
import { readMerchantSnapshot } from '../../../lib/merchant-api.ts';
export const prerender=false;
export const GET:APIRoute=async({request,url,locals})=>{const expected=getAdminAccessKey(locals),supplied=request.headers.get('x-admin-key')||url.searchParams.get('key')||'';if(!expected||!constantTimeEqual(expected,supplied))return Response.json({ok:false,error:'Unauthorized'},{status:401});try{const [cache,google]=await Promise.all([getProductsCache(),readMerchantSnapshot((locals as any)?.runtime?.env)]);return Response.json({ok:true,generatedAt:cache.generated_at,...merchantDiagnostics(cache.products),google},{headers:{'cache-control':'no-store'}})}catch(error:any){return Response.json({ok:false,error:error?.message||'Diagnostika zlyhala.'},{status:500})}};
