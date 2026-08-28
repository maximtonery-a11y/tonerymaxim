import type { APIRoute } from 'astro';
import { AI_EVENT_TYPES, saveAiEvent } from '../../lib/ai-events';
export const prerender=false;
const attempts=new Map<string,{count:number;reset:number}>();
const MAX_ATTEMPT_BUCKETS=1000;
const clean=(value:unknown,max=300)=>String(value||'').replace(/[<>\u0000-\u001f]/g,' ').trim().slice(0,max);
export const POST:APIRoute=async({request,clientAddress})=>{
  try{
    const key=String(clientAddress||request.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim(),now=Date.now(),current=attempts.get(key);
    if(!current||current.reset<now){for(const [k,v] of attempts){if(v.reset<now)attempts.delete(k)}while(attempts.size>=MAX_ATTEMPT_BUCKETS){const k=attempts.keys().next().value;if(typeof k!=='string')break;attempts.delete(k)}attempts.set(key,{count:1,reset:now+60_000});}else{current.count++;if(current.count>60)return Response.json({ok:false},{status:429});}
    const body=await request.json().catch(()=>({}));const type=clean(body?.type,30) as typeof AI_EVENT_TYPES[number];if(!AI_EVENT_TYPES.includes(type))return Response.json({ok:false},{status:400});
    const raw=body?.detail&&typeof body.detail==='object'?body.detail:{};const detail=Object.fromEntries(Object.entries(raw).slice(0,10).map(([k,v])=>[clean(k,40),clean(v,500)]));
    await saveAiEvent({type,page:clean(body?.page,300)||'/',sessionId:clean(body?.sessionId,100),detail});
    return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({ok:false},{status:400,headers:{'Cache-Control':'no-store'}});}
};
