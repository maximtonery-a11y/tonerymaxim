import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TM_DATA_ROOT, readSignedJson, writeSignedJson } from './secure-persistence.ts';

export const AI_EVENT_TYPES = ['question','answer','product_results','handoff_open','handoff_sent','download','new_conversation','resize','feedback'] as const;
export type AiEventType = typeof AI_EVENT_TYPES[number];
type AiEvent = { created_at:string;type:AiEventType;page:string;sessionId:string;detail:Record<string,unknown> };
const ROOT=path.join(TM_DATA_ROOT,'ai','events');

export async function saveAiEvent(input:Omit<AiEvent,'created_at'>){
  if(!AI_EVENT_TYPES.includes(input.type))throw new Error('Neplatný typ udalosti.');
  await writeSignedJson(path.join(ROOT,`${Date.now()}-${randomUUID()}.json`),{created_at:new Date().toISOString(),...input});
}

export async function readAiEventSummary(limit=3000){
  const files=(await readdir(ROOT).catch(()=>[] as string[])).filter(x=>x.endsWith('.json')).sort().reverse().slice(0,Math.max(1,Math.min(limit,10000)));
  const counts=Object.fromEntries(AI_EVENT_TYPES.map(type=>[type,0])) as Record<AiEventType,number>;
  const feedback={up:0,down:0};const pages=new Map<string,number>();const recent:AiEvent[]=[];
  for(const file of files){const event=await readSignedJson<AiEvent>(path.join(ROOT,file)).catch(()=>null);if(!event||!AI_EVENT_TYPES.includes(event.type))continue;counts[event.type]++;pages.set(event.page,(pages.get(event.page)||0)+1);if(event.type==='feedback'){const vote=String(event.detail?.vote||'');if(vote==='up'||vote==='down')feedback[vote]++;}if(recent.length<100)recent.push(event);}
  return{total:files.length,counts,feedback,topPages:[...pages].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([page,count])=>({page,count})),recent};
}
