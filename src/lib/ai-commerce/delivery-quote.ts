import { availableOptions } from './options.ts';
import { priceForQuantity } from './pricing.ts';
import type { ConversationTurn } from './domain.ts';

const norm=(text: string)=>text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const money=(value:number)=>value.toLocaleString('sk-SK',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const round=(value:number)=>Math.round(value*100)/100;

/** History supplies delivery preferences only; all prices come from shop rules. */
export function productDeliveryQuote(product:any, message:string, history:ConversationTurn[], quantity:number){
  const userMessages=[message,...history.filter(turn=>turn.role==='user').map(turn=>turn.content).reverse()].map(norm);
  let country='SK',method:'courier'|'pickup'|null=null,cod:boolean|null=null;
  let countryFound=false,methodFound=false;
  for(const text of userMessages){
    if(!countryFound){
      if(/\b(?:cesk\w*|ceska|cr|cz|brna|brno|prah\w*)\b/.test(text)){country='CZ';countryFound=true;}
      else if(/\b(?:slovensk\w*|sk)\b/.test(text)){countryFound=true;}
      else if(/\b(?:nemeck\w*|rakusk\w*|polsk\w*|madarsk\w*)\b/.test(text)){country='other';countryFound=true;}
    }
    if(!methodFound){
      const pickup=/\b(?:pickup|parcelshop|balikomat\w*|box\w*|vydajn\w*)\b/.test(text);
      const courier=/\bkurier\w*\b/.test(text);
      if(pickup||courier){method=pickup===courier?null:pickup?'pickup':'courier';methodFound=true;}
    }
    if(cod===null){
      if(/\b(?:bez|nechcem|nie)\s+(?:platb\w*\s+)?dobierk\w*|\b(?:kartou|prevodom|gopay|apple\s*pay|google\s*pay)\b/.test(text))cod=false;
      else if(/\bdobierk\w*\b/.test(text))cod=true;
    }
  }
  if(country==='other')return {answer:['Do ktorej krajiny chcete tovar doručiť? Pre tento cieľ vám cenu dopravy potrebujeme potvrdiť individuálne.'],quote:null};
  const price=Number(product.price);
  if(!Number.isFinite(price)||price<=0)return {answer:[`Pri produkte ${product.name} teraz nemám aktuálnu cenu. Pozrite si, prosím, jeho detail.`],quote:null};
  const type=product.product_type_key||(/original/.test(norm(product.name))?'original':/renov|repas/.test(norm(product.name))?'renovated':'compatible');
  const goods=priceForQuantity(price,type,quantity);
  const options=availableOptions(country,goods.totalPrice);
  const codPrice=options.payment.find(option=>option.id==='cod')!.price;
  const payment=cod===true?codPrice:0;
  const selected=options.shipping.filter(option=>!method||(method==='pickup')===('requiresPickup'in option));
  const available=selected.length?selected:options.shipping;
  const seen=new Set<string>();
  const totals=available.filter(option=>{const group='requiresPickup'in option?'pickup':'courier';if(seen.has(group))return false;seen.add(group);return true;}).map(option=>({
    id:'requiresPickup'in option?'pickup':'courier',label:'requiresPickup'in option?'Výdajné miesto alebo box GLS/DPD':'Kuriér GLS/DPD na adresu',
    shipping:option.price,payment,total:round(goods.totalPrice+option.price+payment),
  }));
  const answer=[`Počítam ${quantity} ks produktu ${product.name}. Cena tovaru je ${money(goods.totalPrice)} s DPH${goods.discountPercent?` po množstevnej zľave ${goods.discountPercent} %`:''}.`];
  if(country==='CZ'&&method==='pickup')answer.push('Do Českej republiky posielame iba kuriérom na adresu; výdajné miesta a boxy tu neponúkame.');
  if(goods.totalPrice>=options.freeShippingThreshold)answer.push(`Doprava je zdarma. Spolu${cod===true?' aj s dobierkou':''} zaplatíte ${money(totals[0].total)}.`);
  else for(const option of totals)answer.push(`• ${option.label}: doprava ${money(option.shipping)}${payment?`, dobierka ${money(payment)}`:''}; spolu ${money(option.total)}.`);
  if(cod===null)answer.push(`Pri dobierke sa k uvedeným sumám pripočíta ${money(codPrice)}.`);
  answer.push('Výpočet platí pre uvedený produkt a počet kusov, bez ďalších kupónov a vernostných bodov.');
  return {answer,quote:{productId:String(product.id),sku:String(product.sku),quantity,unitPrice:price,goodsTotal:goods.totalPrice,quantityDiscountPercent:goods.discountPercent,country,options:totals,otherDiscountsIncluded:false}};
}
