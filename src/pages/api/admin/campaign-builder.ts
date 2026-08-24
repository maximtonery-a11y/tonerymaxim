import type { APIRoute } from 'astro';
import { constantTimeEqual,getAdminAccessKey } from '../../../lib/admin-access.ts';
import { campaignBuilder } from '../../../lib/campaign-builder.ts';
import { readMarketingCreatives } from '../../../lib/marketing-creatives.ts';
import { getProductsCache } from '../../../lib/tm-products-cache.ts';
export const prerender=false;
export const POST:APIRoute=async({request,url,locals})=>{const expected=getAdminAccessKey(locals),supplied=request.headers.get('x-admin-key')||url.searchParams.get('key')||'';if(!expected||!constantTimeEqual(expected,supplied))return Response.json({ok:false,error:'Unauthorized'},{status:401});try{const body=await request.json();if(!['search','shopping','performance_max'].includes(body?.channel))return Response.json({ok:false,error:'Neplatný typ kampane.'},{status:400});const [cache,creatives]=await Promise.all([getProductsCache(),readMarketingCreatives()]);return Response.json({ok:true,plan:campaignBuilder(cache.products,creatives,body)},{headers:{'cache-control':'no-store'}})}catch(error:any){return Response.json({ok:false,error:error?.message||'Návrh kampane zlyhal.'},{status:400})}};
