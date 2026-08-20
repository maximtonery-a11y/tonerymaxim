import fs from 'node:fs';

export type MarketConfidence = 'HIGH'|'MEDIUM'|'LOW';
export type MarketInitialState = 'POSILNIŤ'|'PONECHAŤ'|'UČÍ SA';
export type MarketPretraining = {
  brand:string; oem:string; catalog_products:number; compatible_printers:number;
  oem_search_signal:number; printer_search_signal_dedup:number; market_demand_estimate:number;
  market_data_confidence:MarketConfidence; competition_index_avg:number|null;
  bid_low_avg_eur:number|null; bid_high_avg_eur:number|null; initial_state:MarketInitialState;
  top_google_signals:string;
};
const norm=(v:unknown)=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const normBrand=(v:unknown)=>{
 const x=norm(v);
 if(x==='KONICA'||x==='MINOLTA'||x==='DEVELOP'||x==='KONICAMINOLTA')return 'KONICAMINOLTA';
 return x;
};
const marketKey=(brand:unknown,oem:unknown)=>`${normBrand(brand)}:${norm(oem)}`;
const num=(v:string)=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null};
function splitCsv(line:string){ const out:string[]=[]; let cur='',q=false; for(let i=0;i<line.length;i++){const c=line[i]; if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===','&&!q){out.push(cur);cur='';}else cur+=c;} out.push(cur); return out; }
export function loadMarketPretrainingCsv(path:string):Map<string,MarketPretraining>{
 const text=fs.readFileSync(path,'utf8').replace(/^\uFEFF/,''); const lines=text.split(/\r?\n/).filter(Boolean); const h=splitCsv(lines.shift()||''); const map=new Map<string,MarketPretraining>();
 for(const line of lines){const a=splitCsv(line); const r:any={}; h.forEach((k,i)=>r[k]=a[i]??''); const oem=String(r.oem||'').trim(); if(!oem)continue; const x:MarketPretraining={brand:r.brand,oem,catalog_products:Number(r.catalog_products||0),compatible_printers:Number(r.compatible_printers||0),oem_search_signal:Number(r.oem_search_signal||0),printer_search_signal_dedup:Number(r.printer_search_signal_dedup||0),market_demand_estimate:Number(r.market_demand_estimate||0),market_data_confidence:(r.market_data_confidence||'LOW') as MarketConfidence,competition_index_avg:num(r.competition_index_avg),bid_low_avg_eur:num(r.bid_low_avg_eur),bid_high_avg_eur:num(r.bid_high_avg_eur),initial_state:(r.initial_state||'UČÍ SA') as MarketInitialState,top_google_signals:r.top_google_signals||''}; const key=marketKey(r.brand,oem); const old=map.get(key); if(!old||x.market_demand_estimate>old.market_demand_estimate)map.set(key,x); }
 return map;
}
export function extractOemCandidates(v:unknown):string[]{ const s=String(v??'').toUpperCase(); const m=s.match(/\b(?:TN|LC|BT|TNP|TK|CF|CE|W|Q|CRG[- ]?|C-EXV|CEXV|PGI?|CLI|C13T|106R|006R|MLT-[A-Z]|CLT-[A-Z])[- ]?[A-Z0-9/]{2,15}\b/g)||[]; return [...new Set(m.map(x=>x.replace(/\s+/g,'')))]; }
function productBrands(product:any):string[]{
 const text=`${product?.product_brand||''} ${product?.name||''} ${(product?.compatible_printers||[]).slice(0,3).join(' ')}`;
 const known=['KONICA MINOLTA','BROTHER','CANON','EPSON','XEROX','SAMSUNG','LEXMARK','KYOCERA','RICOH','OKI','HP'];
 return [...new Set([product?.product_brand,...known.filter(b=>new RegExp(`\\b${b.replace(' ','\\s+')}\\b`,'i').test(text))].map(normBrand).filter(Boolean))];
}
export function findMarketForProduct(product:any, market:Map<string,MarketPretraining>):MarketPretraining|null {
 const brands=productBrands(product);
 for(const field of [product?.mpn,product?.sku,product?.name]) for(const o of extractOemCandidates(field)) {
   for(const brand of brands){const hit=market.get(marketKey(brand,o));if(hit)return hit;}
 }
 return null;
}
