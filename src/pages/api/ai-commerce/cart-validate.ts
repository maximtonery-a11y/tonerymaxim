import type { APIRoute } from 'astro';
import { normalizeSecureCheckoutCart, discountedLine } from '../../../lib/secure-checkout-cart.ts';
import { availableOptions } from '../../../lib/ai-commerce/options.ts';

export const prerender=false;
export const POST: APIRoute=async({request})=>{
 try{
  const body=await request.json().catch(()=>({})); const cart=await normalizeSecureCheckoutCart(body?.cart);
  const lines=cart.map(item=>({item,...discountedLine(item)}));
  const originalSubtotal=Math.round(lines.reduce((n,x)=>n+x.original,0)*100)/100;
  const subtotal=Math.round(lines.reduce((n,x)=>n+x.final,0)*100)/100;
  return Response.json({ok:true,lines,originalSubtotal,quantityDiscount:Math.round((originalSubtotal-subtotal)*100)/100,subtotal,options:availableOptions(body?.country,subtotal,body?.shipping)} ,{headers:{'Cache-Control':'no-store'}});
 }catch(error:any){return Response.json({ok:false,error:error?.message||'Košík sa nepodarilo overiť.'},{status:Number(error?.status||400),headers:{'Cache-Control':'no-store'}})}
};
