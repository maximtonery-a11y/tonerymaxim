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

export function isPackProduct(p:any) {
  const raw=`${p?.name||''} ${p?.sku||''} ${p?.slug||''}`;
  return /\bCMYK\b|\b(?:sada|set)\b|(?:^|[-_])SET(?:[-_]|$)|\b4\s*(?:ks|pack|pk)\b/i.test(raw);
}
function colorOf(p:any) {
  if (isPackProduct(p)) return 'cmyk';
  if (p?.color) return p.color;
  const raw=`${p.name||''} ${p.sku||''}`;
  const n=raw.toLowerCase();
  if (/\b(black|čier|cier)\b/.test(n) || /(?:^|[-_\s])bk(?:$|[-_\s])/.test(n) || /(?:crg|tn|clt|mlt|tk)[-_ ]?\d+[a-z0-9-]*bk\b/i.test(raw)) return 'black';
  if (/\b(cyan|azúr|azur)\b/.test(n) || /(?:crg|tn|clt|mlt|tk)[-_ ]?\d+[a-z0-9-]*c\b/i.test(raw)) return 'cyan';
  if (/\b(magenta|purpur)\b/.test(n) || /(?:crg|tn|clt|mlt|tk)[-_ ]?\d+[a-z0-9-]*m\b/i.test(raw)) return 'magenta';
  if (/\b(yellow|žlt|zlt)\b/.test(n) || /(?:crg|tn|clt|mlt|tk)[-_ ]?\d+[a-z0-9-]*y\b/i.test(raw)) return 'yellow';
  return '';
}
export function familyOf(p:any){const raw=`${p.name||''} ${p.sku||''}`.toUpperCase();let m=raw.match(/\bTN[- ]?(\d{3,4})(?:BK|C|M|Y|\b)/);if(m)return`TN${m[1]}`;m=raw.match(/\bCRG[- ]?(\d{3})(H?)(?:BK|C|M|Y|\b)/);if(m)return`CRG${m[1]}${m[2]}`;m=raw.match(/\b(?:CF|CE)(\d{2})[0-3]?([AX])\b/);if(m)return`HP${m[1]}X${m[2]}`;m=raw.match(/\bCLT[- ]?(?:[KCMY])?(\d+)([LS])\b/);if(m)return`CLT${m[1]}${m[2]}`;m=raw.match(/\bT(\d{3})[1-4]?(XXL|XL)?\b/);if(m)return`EPSON-T${m[1]}${m[2]||''}`;return'';}
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
  const products=result.products.map((product:any)=>({...product,color:colorOf(product),package_shape:isPackProduct(product)?'set':'single',quantity_offers:quantityOffers(product.price,product.type)}));
  const colors=new Set(products.filter((p:any)=>!isPackProduct(p)).map((p:any)=>p.color).filter(Boolean));
  const isColorPrinter=['black','cyan','magenta','yellow'].filter(c=>colors.has(c)).length>=3;
  const sets:any[]=[];
  const catalogPacks=products.filter((p:any)=>isPackProduct(p)&&Number(p.price||0)>0);
  for(const product of catalogPacks){
    const family=familyOf(product);const high=/H$/i.test(family)||/vysokokapacit|high[ -]?yield/i.test(`${product.name||''} ${product.sku||''}`);
    sets.push({type:product.type,family,capacityVariant:high?'high':'standard',label:product.name,products:[product],catalogProduct:product,totalPrice:Number(product.price||0),discountPercent:0,packageKind:'catalog'});
  }
  // Sada smie vzniknúť iba z jedného reálneho katalógového produktu.
  // Štyri samostatné farby sa nikdy neskladajú do virtuálneho balenia — ani
  // interne. Tým sa nemôže syntetická sada omylom dostať do iného klienta API.
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
