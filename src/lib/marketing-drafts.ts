import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readSignedJson, writeSignedJson, TM_DATA_ROOT } from './secure-persistence.ts';

export type MarketingDraft = {
  id: string;
  name: string;
  goal: 'orders'|'profit'|'new_customers'|'remarketing';
  channel: 'search'|'shopping'|'performance_max';
  selection: string;
  dailyBudgetEur: number;
  headline: string;
  description: string;
  creativeIds: string[];
  plan?: Record<string,unknown>;
  state: 'draft'|'ready'|'archived';
  createdAt: string;
  updatedAt: string;
};

const FILE=join(TM_DATA_ROOT,'marketing-v2','drafts.json');
const clean=(value:unknown,max=300)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const allowed=<T extends string>(value:unknown,values:T[],fallback:T)=>values.includes(value as T)?value as T:fallback;

export async function readMarketingDrafts():Promise<MarketingDraft[]>{
  const saved=await readSignedJson<{drafts:MarketingDraft[]}>(FILE);
  return Array.isArray(saved?.drafts)?saved!.drafts:[];
}

export async function saveMarketingDraft(input:Partial<MarketingDraft>):Promise<MarketingDraft>{
  const drafts=await readMarketingDrafts();
  const now=new Date().toISOString();
  const existing=input.id?drafts.find(d=>d.id===input.id):undefined;
  const draft:MarketingDraft={
    id:existing?.id||randomUUID(),
    name:clean(input.name||existing?.name||'Nová reklama',120),
    goal:allowed(input.goal,['orders','profit','new_customers','remarketing'],existing?.goal||'profit'),
    channel:allowed(input.channel,['search','shopping','performance_max'],existing?.channel||'shopping'),
    selection:clean(input.selection||existing?.selection||'',300),
    dailyBudgetEur:Math.max(1,Math.min(10000,Number(input.dailyBudgetEur??existing?.dailyBudgetEur??10)||10)),
    headline:clean(input.headline||existing?.headline||'',90),
    description:clean(input.description||existing?.description||'',180),
    creativeIds:Array.isArray(input.creativeIds)?input.creativeIds.map(x=>clean(x,80)).filter(Boolean).slice(0,20):(existing?.creativeIds||[]),
    plan:input.plan&&typeof input.plan==='object'?input.plan:existing?.plan,
    state:allowed(input.state,['draft','ready','archived'],existing?.state||'draft'),
    createdAt:existing?.createdAt||now,updatedAt:now,
  };
  const next=existing?drafts.map(d=>d.id===draft.id?draft:d):[draft,...drafts];
  await writeSignedJson(FILE,{drafts:next.slice(0,500)});
  return draft;
}
