// Read-only AI audit: questions explicitly forbid all cart mutations.
import { pathToFileURL } from 'node:url';
export function displayedProducts(data) {
  return [...(Array.isArray(data?.commerce?.products)?data.commerce.products:[]),...(Array.isArray(data?.advisor?.products)?data.advisor.products:[])];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const base=process.argv[2]||'https://www.tonerymaxim.sk';
 for(const code of ['HP CF226A','Brother LC-123XL','Canon GI-490C','Epson 16XL','Samsung MLT-R116','Xerox 108R01124','Lexmark 51B2H00','Kyocera TK-1160','OKI 45807111','Ricoh 841297']){
  const response=await fetch(new URL('/api/ai-tomas',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:`Hľadám ${code}. Iba zobraz produkty, nič nepridávaj do košíka ani neobjednávaj.`,page:'/'}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok||data.ok!==true)throw new Error(`${code}: HTTP ${response.status}`);
  if(data.state?.cart?.length||/ADD|REMOVE|UPDATE_CART|CLEAR_CART/.test(data.action?.kind||''))throw new Error(`${code}: unexpected cart action`);
  const products=displayedProducts(data);
  // Counts alone do not prove relevance: include identities for review.
  console.log(JSON.stringify({query:code,advisorCount:data.advisor?.products?.length||0,commerceCount:data.commerce?.products?.length||0,displayedCount:products.length,action:data.action?.kind||null,products:products.map(p=>({id:p.id,sku:p.sku,name:p.name,price:p.price,stock:p.stock_quantity})),answer:data.advisor?.answer}));
 }
}
