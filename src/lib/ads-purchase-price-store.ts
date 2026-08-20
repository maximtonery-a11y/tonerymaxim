import fs from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fetchAbixPurchasePrices, type AbixPriceRecord } from './abix-purchase-prices.ts';

const file=()=>join(resolve(process.env.TM_PERSISTENT_DATA_DIR||join(process.cwd(),'.tm-data')),'ads-intelligence','abix-prices.json');

export function readAdsPurchasePrices():Map<string,{purchase_price:number}>{
  try{
    const raw=JSON.parse(fs.readFileSync(file(),'utf8')) as {prices?:AbixPriceRecord[]};
    return new Map((raw.prices||[]).filter(x=>x?.sku&&Number(x.purchase_price)>0).map(x=>[x.sku.toLowerCase(),{purchase_price:Number(x.purchase_price)}]));
  }catch{return new Map();}
}

export async function refreshAdsPurchasePrices(){
  const parsed=await fetchAbixPurchasePrices();
  const target=file();await mkdir(dirname(target),{recursive:true});const temp=`${target}.${process.pid}.tmp`;await writeFile(temp,JSON.stringify({generated_at:new Date().toISOString(),diagnostics:parsed.diagnostics,prices:[...parsed.prices.values()]}),{encoding:'utf8',mode:0o600});await rename(temp,target);
  return {records:parsed.prices.size,diagnostics:parsed.diagnostics};
}
