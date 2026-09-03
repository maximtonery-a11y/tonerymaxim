import type { APIRoute } from 'astro';
import { createNewsletterUnsubscribeConfirmation,validNewsletterEmail } from '../../../lib/newsletter';
import { sendNewsletterUnsubscribeConfirmationEmail } from '../../../lib/mail';
import { STOREFRONT_ORIGIN } from '../../../lib/storefront-url';
export const prerender=false;
export const POST:APIRoute=async({request})=>{const b=await request.json().catch(()=>({})),email=String(b.email||'').trim();if(!validNewsletterEmail(email))return Response.json({ok:false,error:'Zadajte platnú e-mailovú adresu.'},{status:400});try{const x=await createNewsletterUnsubscribeConfirmation(email);if(x.send){const url=`${STOREFRONT_ORIGIN.replace(/\/$/,'')}/newsletter/odhlasit?email=${encodeURIComponent(x.email)}&token=${encodeURIComponent(x.token)}`;await sendNewsletterUnsubscribeConfirmationEmail({email:x.email,confirmUrl:url})}return Response.json({ok:true,message:'Ak je táto adresa prihlásená na odber, poslali sme na ňu odkaz na bezpečné odhlásenie.'})}catch(e){console.error('newsletter unsubscribe request failed',e);return Response.json({ok:false,error:'Odhlásenie sa teraz nepodarilo. Skúste to neskôr.'},{status:500})}};
