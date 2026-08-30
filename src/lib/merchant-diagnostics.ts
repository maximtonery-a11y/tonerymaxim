import { buildMerchantProducts } from './merchant-products.ts';
import { excludedChiplessCompatibleProduct } from './merchant-feed.ts';
import type { TmProduct } from './tm-products-cache.ts';
import { resolvedPublicationBrand } from './product-publication-policy.ts';
export type MerchantIssue={productId:string;sku:string;name:string;severity:'error'|'warning';code:string;message:string};
export function merchantDiagnostics(products:TmProduct[],origin='https://www.tonerymaxim.sk'){
  const transformed=buildMerchantProducts(products.filter(p=>!excludedChiplessCompatibleProduct(p)),origin),issues:MerchantIssue[]=[];
  const transformedIds=new Set(transformed.map(p=>String(p.id)));
  for(const source of products){
    const sourceId=String(source.id||source.sku||source.slug||'');
    if(transformedIds.has(sourceId)||excludedChiplessCompatibleProduct(source))continue;
    const base={productId:sourceId,sku:String(source.sku||sourceId),name:String(source.name||'')};
    if(!resolvedPublicationBrand(source))issues.push({...base,severity:'error',code:'ambiguous_brand',message:'Produkt nemá jednoznačne určenú značku a nesmie sa publikovať.'});
    if(!(Number(source.price)>0))issues.push({...base,severity:'error',code:'invalid_price',message:'Cena nie je platná.'});
    const images=Array.isArray(source.images)?source.images:[source.image];
    if(!images.some(Boolean))issues.push({...base,severity:'error',code:'missing_image',message:'Chýba použiteľný hlavný obrázok.'});
    if(source.stock_status!=='instock')issues.push({...base,severity:'warning',code:'out_of_stock',message:'Produkt nie je skladom.'});
  }
  for(const p of transformed){
    const base={productId:p.id,sku:p.id,name:p.name};
    if(!p.image)issues.push({...base,severity:'error',code:'missing_image',message:'Chýba použiteľný hlavný obrázok.'});
    if(!p.url)issues.push({...base,severity:'error',code:'invalid_url',message:'Chýba platná produktová URL.'});
    if(!(p.price>0))issues.push({...base,severity:'error',code:'invalid_price',message:'Cena nie je platná.'});
    if(p.description.length<40)issues.push({...base,severity:'error',code:'short_description',message:'Popis je príliš krátky.'});
    if(p.availability!=='in_stock')issues.push({...base,severity:'warning',code:'out_of_stock',message:'Produkt nie je skladom.'});
    if(p.productType==='original'&&!p.identifierExists)issues.push({...base,severity:'warning',code:'missing_identifiers',message:'Originálu chýba GTIN alebo kombinácia značka + MPN.'});
    if(p.productType==='compatible'&&!p.oemCodes.length)issues.push({...base,severity:'warning',code:'missing_oem',message:'Kompatibilnému produktu chýba rozpoznaný OEM kód.'});
  }
  const eligiblePaid=transformed.filter(p=>p.productType==='compatible'&&p.availability==='in_stock'&&p.image&&p.url&&p.price>0&&p.description.length>=40);
  const byCode=Object.fromEntries([...new Set(issues.map(i=>i.code))].map(code=>[code,issues.filter(i=>i.code===code).length]));
  return{sourceProducts:products.length,transformedProducts:transformed.length,eligiblePaid:eligiblePaid.length,errors:issues.filter(i=>i.severity==='error').length,warnings:issues.filter(i=>i.severity==='warning').length,excludedChipless:products.filter(excludedChiplessCompatibleProduct).length,byCode,issues:issues.slice(0,1000)};
}
