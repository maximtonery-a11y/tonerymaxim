import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readSignedJson, writeSignedJson, TM_DATA_ROOT } from './secure-persistence.ts';
import type { MarketingDraft } from './marketing-drafts.ts';

export type MarketingWorkflowState='review_required'|'approved'|'rejected';
export type MarketingDecisionState='UČÍ SA'|'PONECHAŤ'|'POSILNIŤ'|'OBMEDZIŤ'|'ZASTAVIŤ';
export type MarketingApproval={draftId:string;workflowState:MarketingWorkflowState;decisionState:MarketingDecisionState;fingerprint:string;reviewedAt:string;approvedAt?:string;rejectedAt?:string;note?:string};
export type MarketingAuditEvent={id:string;draftId:string;action:'reviewed'|'approved'|'rejected'|'approval_invalidated'|'exported';at:string;note?:string;fingerprint:string};

const FILE=join(TM_DATA_ROOT,'marketing-v2','approvals.json');
const clean=(v:unknown,max=300)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const campaignFingerprint=(draft:MarketingDraft)=>createHash('sha256').update(JSON.stringify(canonical({name:draft.name,goal:draft.goal,channel:draft.channel,selection:draft.selection,dailyBudgetEur:draft.dailyBudgetEur,headline:draft.headline,description:draft.description,creativeIds:draft.creativeIds,plan:draft.plan}))).digest('hex');

async function readStore(){return await readSignedJson<{approvals:MarketingApproval[];audit:MarketingAuditEvent[]}>(FILE)||{approvals:[],audit:[]}}
async function writeStore(store:{approvals:MarketingApproval[];audit:MarketingAuditEvent[]}){await writeSignedJson(FILE,{approvals:store.approvals.slice(0,500),audit:store.audit.slice(-5000)})}
export async function readMarketingApprovals(){return readStore()}

function validServerPlan(draft:MarketingDraft){const p:any=draft.plan;return draft.state==='ready'&&p?.ready===true&&Array.isArray(p?.blockers)&&p.blockers.length===0&&Number(p?.summary?.eligible)>0&&p?.limits?.allHeadlinesValid===true&&p?.limits?.allDescriptionsValid===true}
export async function reviewMarketingDraft(draft:MarketingDraft){
  if(!validServerPlan(draft))throw new Error('Koncept neprešiel serverovou kontrolou kampane.');
  const store=await readStore(),now=new Date().toISOString(),fingerprint=campaignFingerprint(draft);
  const old=store.approvals.find(x=>x.draftId===draft.id);const workflowState:MarketingWorkflowState='review_required';
  const approval:MarketingApproval={draftId:draft.id,workflowState,decisionState:'UČÍ SA',fingerprint,reviewedAt:now};
  store.approvals=[approval,...store.approvals.filter(x=>x.draftId!==draft.id)];
  if(old?.workflowState==='approved'&&old.fingerprint!==fingerprint)store.audit.push({id:randomUUID(),draftId:draft.id,action:'approval_invalidated',at:now,fingerprint,note:'Koncept sa po schválení zmenil.'});
  store.audit.push({id:randomUUID(),draftId:draft.id,action:'reviewed',at:now,fingerprint});await writeStore(store);return approval;
}
export async function decideMarketingDraft(draft:MarketingDraft,action:'approve'|'reject',note?:unknown){
  if(!validServerPlan(draft))throw new Error('Koncept už nie je pripravený na schválenie.');
  const store=await readStore(),current=store.approvals.find(x=>x.draftId===draft.id),fingerprint=campaignFingerprint(draft),now=new Date().toISOString();
  if(!current||current.workflowState!=='review_required')throw new Error('Koncept musí najskôr prejsť kontrolou.');
  if(current.fingerprint!==fingerprint)throw new Error('Koncept sa od kontroly zmenil. Spustite kontrolu znova.');
  const safeNote=clean(note,300);const approval:MarketingApproval={...current,workflowState:action==='approve'?'approved':'rejected',decisionState:action==='approve'?'PONECHAŤ':'ZASTAVIŤ',...(action==='approve'?{approvedAt:now}:{rejectedAt:now}),...(safeNote?{note:safeNote}:{})};
  store.approvals=[approval,...store.approvals.filter(x=>x.draftId!==draft.id)];store.audit.push({id:randomUUID(),draftId:draft.id,action:action==='approve'?'approved':'rejected',at:now,fingerprint,...(safeNote?{note:safeNote}:{})});await writeStore(store);return approval;
}

export async function recordMarketingExport(draftId:string,fingerprint:string,note='Google Ads dry-run export'){
  const store=await readStore(),now=new Date().toISOString();store.audit.push({id:randomUUID(),draftId,action:'exported',at:now,fingerprint,note:clean(note,300)});await writeStore(store);
}

