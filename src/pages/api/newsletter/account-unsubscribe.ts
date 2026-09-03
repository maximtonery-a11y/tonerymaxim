import type { APIRoute } from 'astro';
import { readCustomerSession } from '../../../lib/auth-session';
import { unsubscribeNewsletter } from '../../../lib/newsletter';
export const prerender=false;
export const POST:APIRoute=async({cookies})=>{const s=readCustomerSession(cookies);if(!s)return Response.json({ok:false,error:'Nie ste prihlásený.'},{status:401});await unsubscribeNewsletter(s.email);return Response.json({ok:true,message:'Newsletter bol odhlásený.'})};
