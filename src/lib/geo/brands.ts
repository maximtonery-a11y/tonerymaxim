export function getBrandSeo(brand:string){
 const name=brand.toUpperCase();
 return {
   title:`${name} tonery | ToneryMaxim`,
   description:`Kompatibilné, originálne a renovované tonery pre ${name}.`,
   heading:`${name} tonery`
 };
}
