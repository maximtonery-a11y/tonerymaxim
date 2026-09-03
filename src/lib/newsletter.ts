import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { readSignedJson, writeSignedJson, TM_DATA_ROOT } from './secure-persistence.ts';

export type NewsletterSource='newsletter-page'|'footer'|'registration'|'account'|'unsubscribe-page'|'legacy-import';
type Status='pending'|'subscribed'|'unsubscribed';
type Rec={
  email:string;status:Status;source:NewsletterSource;consentVersion:'2026-09-03-v1'|'legacy-import-unknown';
  consentAt?:string;confirmedAt?:string;unsubscribedAt?:string;
  tokenHash?:string;tokenExpiresAt?:string;
  unsubscribeTokenHash?:string;unsubscribeTokenExpiresAt?:string;
  legacyImportedAt?:string;updatedAt:string
};
type Db={version:1;records:Rec[]};
const PATH=join(TM_DATA_ROOT,'newsletter','subscribers.json');
let chain=Promise.resolve();
const norm=(v:unknown)=>String(v||'').trim().toLowerCase().slice(0,254);
export const validNewsletterEmail=(v:unknown)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm(v));
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
async function read():Promise<Db>{return(await readSignedJson<Db>(PATH))||{version:1,records:[]}}
async function mutate(fn:(d:Db)=>void){const job=chain.then(async()=>{const d=await read();fn(d);await writeSignedJson(PATH,d)});chain=job.catch(()=>undefined);await job}
export async function getNewsletterRecord(v:unknown){const e=norm(v),d=await read();return d.records.find(r=>r.email===e)||null}

export async function createNewsletterConfirmation(v:unknown,source:NewsletterSource){
  const email=norm(v);if(!validNewsletterEmail(email))throw Error('Zadajte platný e-mail.');
  const old=await getNewsletterRecord(email);if(old?.status==='subscribed')return{email,token:'',alreadySubscribed:true};
  const token=randomBytes(32).toString('hex'),now=new Date(),exp=new Date(now.getTime()+86400000);
  await mutate(d=>{const r=d.records.find(x=>x.email===email),n:Rec={email,status:'pending',source,consentVersion:'2026-09-03-v1',consentAt:now.toISOString(),tokenHash:hash(token),tokenExpiresAt:exp.toISOString(),updatedAt:now.toISOString()};r?Object.assign(r,n):d.records.push(n)});
  return{email,token,alreadySubscribed:false}
}
export async function confirmNewsletter(v:unknown,token:string){
  const email=norm(v),now=new Date();let ok=false;
  await mutate(d=>{const r=d.records.find(x=>x.email===email);if(!r||r.status!=='pending'||!r.tokenHash||!r.tokenExpiresAt||new Date(r.tokenExpiresAt)<=now||r.tokenHash!==hash(token))return;r.status='subscribed';r.confirmedAt=now.toISOString();r.updatedAt=now.toISOString();delete r.tokenHash;delete r.tokenExpiresAt;delete r.unsubscribedAt;ok=true});return ok
}

// Verejný formulár nikdy neodhlási cudziu adresu priamo. Najprv pošle overovací odkaz na daný e-mail.
export async function createNewsletterUnsubscribeConfirmation(v:unknown){
  const email=norm(v);if(!validNewsletterEmail(email))throw Error('Zadajte platný e-mail.');
  const old=await getNewsletterRecord(email);
  // Rovnaká odpoveď navonok aj pre neexistujúcu/odhlásenú adresu – neprezrádzame databázu odberateľov.
  if(!old||old.status!=='subscribed')return{email,token:'',send:false};
  const token=randomBytes(32).toString('hex'),now=new Date(),exp=new Date(now.getTime()+86400000);
  await mutate(d=>{const r=d.records.find(x=>x.email===email);if(!r)return;r.unsubscribeTokenHash=hash(token);r.unsubscribeTokenExpiresAt=exp.toISOString();r.updatedAt=now.toISOString()});
  return{email,token,send:true};
}
export async function confirmNewsletterUnsubscribe(v:unknown,token:string){
  const email=norm(v),now=new Date();let ok=false;
  await mutate(d=>{const r=d.records.find(x=>x.email===email);if(!r||r.status!=='subscribed'||!r.unsubscribeTokenHash||!r.unsubscribeTokenExpiresAt||new Date(r.unsubscribeTokenExpiresAt)<=now||r.unsubscribeTokenHash!==hash(token))return;const iso=now.toISOString();r.status='unsubscribed';r.unsubscribedAt=iso;r.updatedAt=iso;delete r.unsubscribeTokenHash;delete r.unsubscribeTokenExpiresAt;delete r.tokenHash;delete r.tokenExpiresAt;ok=true});return ok;
}

// Prihlásený zákazník môže odhlásiť iba e-mail zo svojej overenej session.
export async function unsubscribeNewsletter(v:unknown){
  const email=norm(v);if(!validNewsletterEmail(email))return;const now=new Date().toISOString();
  await mutate(d=>{const r=d.records.find(x=>x.email===email);if(r){r.status='unsubscribed';r.unsubscribedAt=now;r.updatedAt=now;delete r.tokenHash;delete r.tokenExpiresAt;delete r.unsubscribeTokenHash;delete r.unsubscribeTokenExpiresAt}else d.records.push({email,status:'unsubscribed',source:'account',consentVersion:'2026-09-03-v1',unsubscribedAt:now,updatedAt:now})})
}

export async function importConfirmedNewsletterEmails(values:unknown[]){
  const emails=[...new Set(values.map(norm).filter(validNewsletterEmail))];const now=new Date().toISOString();let added=0,keptUnsubscribed=0,existing=0;
  await mutate(d=>{for(const email of emails){const r=d.records.find(x=>x.email===email);if(r?.status==='unsubscribed'){keptUnsubscribed++;continue}if(r?.status==='subscribed'){existing++;continue}if(r){r.status='subscribed';r.source='legacy-import';r.consentVersion='legacy-import-unknown';r.legacyImportedAt=r.legacyImportedAt||now;r.updatedAt=now;delete r.tokenHash;delete r.tokenExpiresAt;existing++;continue}d.records.push({email,status:'subscribed',source:'legacy-import',consentVersion:'legacy-import-unknown',legacyImportedAt:now,updatedAt:now});added++}});
  return{received:values.length,valid:emails.length,added,existing,keptUnsubscribed};
}
export async function listNewsletterRecords(){const d=await read();return d.records.map(r=>({...r,tokenHash:undefined,unsubscribeTokenHash:undefined}));}
