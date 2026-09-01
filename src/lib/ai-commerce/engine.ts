import { resolveCommerceProducts, type CommerceProduct } from './catalog.ts';
import { quantityOffers, priceForQuantity } from './pricing.ts';
import { isCalendarQuery, searchCalendarProducts } from '../calendar-ai-catalog.ts';

export const AI_COMMERCE_VERSION = '9.0';
export const commerceCapabilities = {
  version: AI_COMMERCE_VERSION,
  channels: ['website'],
  adapters: { mcp: 'planned', acp: 'planned', ucp: 'planned' },
  tools: ['search_products','find_printer_products','get_quantity_offers','price_cart','validate_cart'],
  checkout: { mode: 'merchant_handoff', merchantSubmitsOrder: true },
  cart: { multiItem: true, persistent: true, editable: true },
  offers: { compatible: { '1': 0, '2-3': 10, '4+': 25 }, scope: 'same_sku_only' }
} as const;

function colorOf(p:any) {
  if (p?.color) return p.color;
  const raw=`${p.name||''} ${p.sku||''}`;
  const n=raw.toLowerCase();
  if (/\b(black|čier|cier)\b/.test(n) || /(?:^|[-_\s])bk(?:$|[-_\s])/.test(n) || /(?:crg|tn|clt|mlt|tk)[-_ ]?\d+[a-z0-9-]*bk\b/i.test(raw)) return 'black';
  if (/\b(cyan|azúr|azur)\b/.test(n) || /(?:crg|tn|clt|mlt|tk)[-_ ]?\d+[a-z0-9-]*c\b/i.test(raw)) return 'cyan';
  if (/\b(magenta|purpur)\b/.test(n) || /(?:crg|tn|clt|mlt|tk)[-_ ]?\d+[a-z0-9-]*m\b/i.test(raw)) return 'magenta';
  if (/\b(yellow|žlt|zlt)\b/.test(n) || /(?:crg|tn|clt|mlt|tk)[-_ ]?\d+[a-z0-9-]*y\b/i.test(raw)) return 'yellow';
  return '';
}
export function familyOf(p:any){const raw=`${p.name||''} ${p.sku||''}`.toUpperCase();let m=raw.match(/\bTN[- ]?(\d{3,4})(?:BK|C|M|Y)\b/);if(m)return`TN${m[1]}`;m=raw.match(/\bCRG[- ]?(\d{3})(H?)(?:BK|C|M|Y)\b/);if(m)return`CRG${m[1]}${m[2]}`;m=raw.match(/\b(?:CF|CE)(\d{2})[0-3]([AX])\b/);if(m)return`HP${m[1]}X${m[2]}`;m=raw.match(/\bCLT[- ]?[KCMY](\d+)([LS])\b/);if(m)return`CLT${m[1]}${m[2]}`;m=raw.match(/\bT(\d{3})[1-4](XXL|XL)?\b/);if(m)return`EPSON-T${m[1]}${m[2]||''}`;return'';}
const commerceCache: Map<string,{expires:number,value:any}> = (globalThis as any).__TM_AI_COMMERCE_SEARCH_CACHE__ ||= new Map();
const commerceInFlight: Map<string,Promise<any>> = (globalThis as any).__TM_AI_COMMERCE_IN_FLIGHT__ ||= new Map();
export async function searchCommerce(query:string) {
  query=String(query||'').replace(/\bminoltu\b/gi,'Konica Minolta').replace(/\bminolta\b/gi,'Konica Minolta').replace(/Konica\s+Konica\s+Minolta/gi,'Konica Minolta');
  const cacheKey=query.toLocaleLowerCase('sk-SK').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
  const cached=commerceCache.get(cacheKey);if(cached&&cached.expires>Date.now())return cached.value;
  // Pri prvom dotaze po deployi moze prist viac rovnakych poziadaviek naraz.
  // Jedna spolocna Promise zabrani paralelnemu filtrovaniu celeho katalogu,
  // ktore predtym kratkodobo nasobilo RAM a mohlo zhodit cely Node proces.
  const running=commerceInFlight.get(cacheKey);if(running)return running;
  const operation=(async()=>{
  const result=isCalendarQuery(query)?await searchCalendarProducts(query):await resolveCommerceProducts(query);
  const products=result.products.map((product:any)=>({...product,color:colorOf(product),quantity_offers:quantityOffers(product.price,product.type)}));
  const colors=new Set(products.map((p:any)=>p.color).filter(Boolean));
  const isColorPrinter=['black','cyan','magenta','yellow'].filter(c=>colors.has(c)).length>=3;
  const sets:any[]=[];
  if(isColorPrinter){
    for(const type of ['compatible','original','renovated']){
      const typed=products.filter((p:any)=>p.type===type&&p.purchasable!==false&&p.stock_status!=='outofstock'&&Number(p.stock_quantity??1)!==0);const families=new Map<string,any[]>();for(const p of typed){const f=familyOf(p);if(f){const a=families.get(f)||[];a.push(p);families.set(f,a)}}
      const complete=[...families.entries()].map(([family,list])=>({family,chosen:['black','cyan','magenta','yellow'].map(color=>list.filter((p:any)=>p.color===color).sort((a:any,b:any)=>a.price-b.price)[0]).filter(Boolean)})).filter(x=>x.chosen.length===4).sort((a,b)=>a.chosen.reduce((n,p)=>n+p.price,0)-b.chosen.reduce((n,p)=>n+p.price,0));
      let completeFamilies=complete;
      if(!completeFamilies.length){const fallback=['black','cyan','magenta','yellow'].map(color=>typed.filter((p:any)=>p.color===color).sort((a:any,b:any)=>a.price-b.price)[0]).filter(Boolean);if(fallback.length===4&&typed.filter((p:any)=>p.color).length===4)completeFamilies=[{family:'single-family',chosen:fallback}];}
      for(const entry of completeFamilies){
        const high=/H$/i.test(entry.family);const base=type==='compatible'?'Kompatibilná':type==='original'?'Originálna':'Renovovaná';
        sets.push({type,family:entry.family,capacityVariant:high?'high':'standard',label:`${base}${high?' vysokokapacitná':''} sada`,products:entry.chosen,totalPrice:Math.round(entry.chosen.reduce((n:number,p:any)=>n+p.price,0)*100)/100,discountPercent:0});
      }
    }
  }
  const value={...result,products,presentation:{isColorPrinter,sets,colors:[...colors]}};
  commerceCache.set(cacheKey,{expires:Date.now()+5*60_000,value});
  if(commerceCache.size>500){const oldest=commerceCache.keys().next().value;if(oldest)commerceCache.delete(oldest);}
  return value;
  })();
  commerceInFlight.set(cacheKey,operation);
  try{return await operation;}finally{if(commerceInFlight.get(cacheKey)===operation)commerceInFlight.delete(cacheKey);}
}
export function priceCart(items:Array<{product:CommerceProduct;quantity:number}>){
 const lines=items.map(({product,quantity})=>({product,...priceForQuantity(product.price,product.type,quantity)}));
 return {lines,itemCount:lines.reduce((n,x)=>n+x.quantity,0),subtotal:Math.round(lines.reduce((n,x)=>n+x.totalPrice,0)*100)/100};
}
