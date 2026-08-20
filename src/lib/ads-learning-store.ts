import fs from "node:fs";
import path from "node:path";
import type { AdsLearningEvent } from "./ads-learning-engine";

const dataDir=()=>path.join(process.env.TM_PERSISTENT_DATA_DIR||path.resolve(process.cwd(),".tm-data"),"ads-intelligence");
const file=()=>path.join(dataDir(),"learning-events.ndjson");

export function appendLearningEvents(events:AdsLearningEvent[]){
  fs.mkdirSync(dataDir(),{recursive:true});
  const existingIds=new Set(readLearningEvents().map(e=>e.eventId));
  const batchIds=new Set<string>();
  const allowed=new Set(["impression","click","add_to_cart","purchase"]);
  const valid=events.filter(e=>{
    if(!e?.eventId||existingIds.has(e.eventId)||batchIds.has(e.eventId)||!e.productId||!allowed.has(e.event)||!e.ts||!Number.isFinite(Date.parse(e.ts)))return false;
    if(e.costEur!=null&&(!Number.isFinite(Number(e.costEur))||Number(e.costEur)<0))return false;
    if(e.revenueEur!=null&&(!Number.isFinite(Number(e.revenueEur))||Number(e.revenueEur)<0))return false;
    if(e.grossProfitEur!=null&&!Number.isFinite(Number(e.grossProfitEur)))return false;
    if(e.count!=null&&(!Number.isInteger(Number(e.count))||Number(e.count)<1||Number(e.count)>1_000_000))return false;
    if(e.event==='purchase'&&(!e.orderId||!Number.isFinite(Number(e.revenueEur))||!Number.isFinite(Number(e.grossProfitEur))))return false;
    batchIds.add(e.eventId);return true;
  });
  if(valid.length) fs.appendFileSync(file(),valid.map(e=>JSON.stringify(e)).join("\n")+"\n","utf8");
  return valid.length;
}
export function readLearningEvents():AdsLearningEvent[]{
  if(!fs.existsSync(file())) return [];
  const seen=new Set<string>();
  return fs.readFileSync(file(),"utf8").split(/\r?\n/).filter(Boolean).flatMap(line=>{
    try{const e=JSON.parse(line) as AdsLearningEvent;if(!e.eventId||seen.has(e.eventId))return [];seen.add(e.eventId);return [e]}catch{return []}
  });
}
