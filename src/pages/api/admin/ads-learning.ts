import type { APIRoute } from "astro";
import { constantTimeEqual, getAdminAccessKey } from "../../../lib/admin-access";
import { appendLearningEvents, readLearningEvents } from "../../../lib/ads-learning-store";
import { aggregateLearning } from "../../../lib/ads-learning-engine";
export const prerender=false;
function tmKey(locals:any){return getAdminAccessKey(locals)}
function allowed(request:Request,url:URL,locals:any){const expected=tmKey(locals);if(!expected)return ["localhost","127.0.0.1"].includes(url.hostname);const supplied=url.searchParams.get("key")||request.headers.get("x-admin-key")||"";return constantTimeEqual(expected,supplied)}
export const GET:APIRoute=async({request,url,locals})=>{if(!allowed(request,url,locals))return Response.json({ok:false,error:"Unauthorized"},{status:401});const events=readLearningEvents();return Response.json({ok:true,events:events.length,aggregates:aggregateLearning(events)},{headers:{"Cache-Control":"no-store"}})};
export const POST:APIRoute=async({request,url,locals})=>{if(!allowed(request,url,locals))return Response.json({ok:false,error:"Unauthorized"},{status:401});const body=await request.json().catch(()=>null);const events=Array.isArray(body)?body:Array.isArray(body?.events)?body.events:[body];if(events.length>10_000)return Response.json({ok:false,error:"Too many events"},{status:413});const accepted=appendLearningEvents(events);return Response.json({ok:true,accepted,rejected:events.length-accepted},{headers:{"Cache-Control":"no-store"}})};
