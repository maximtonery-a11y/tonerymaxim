import { readFile, writeFile } from "node:fs/promises";
const FILE = new URL("../src/data/calendar-products.json", import.meta.url);
const BASE = "https://www.pressgroup.sk";

const decode = (s) => s.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&[a-z]+;|&#\d+;/gi," ");
const text = (html) => decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," "));
const status = (chunk) => {
  const hits = [...chunk.matchAll(/(Skladom|Nedostupné|VYPREDANÉ|V obmedzenom množstve)/gi)];
  if (!hits.length) return null;
  const word = hits.at(-1)[1].toLowerCase();
  return word === "skladom" || word === "v obmedzenom množstve";
};
async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 20000);
  try {
    const response = await fetch(url,{headers:{"User-Agent":"ToneryMaximCalendarStockBot/1.0 (+https://tonerymaxim.sk/kalendare)",Accept:"text/html"},signal:controller.signal});
    if (!response.ok) throw new Error(url+": HTTP "+response.status);
    const bytes=await response.arrayBuffer();
    const headerCharset=(response.headers.get("content-type")||"").match(/charset=([^; ]+)/i)?.[1];
    const utf8=new TextDecoder("utf-8").decode(bytes);
    const declared=headerCharset||utf8.match(/<meta[^>]+charset=["']?([^"' >]+)/i)?.[1]||utf8.match(/charset=["']?([^"' >]+)/i)?.[1];
    const charset=declared&&/^(?:utf-8|windows-1250|iso-8859-2|windows-1252)$/i.test(declared)?declared:"windows-1250";
    const html=new TextDecoder(charset).decode(bytes);
    if (html.length<1000 || html.length>3_000_000) throw new Error("Unexpected HTML size: "+url);
    return html;
  } finally { clearTimeout(timer); }
}
const products=JSON.parse(await readFile(FILE,"utf8"));
const known=new Set(products.map(p=>p.sku));
const urls=new Set([BASE+"/eshop/minidiare/c-9.xhtml",BASE+"/eshop/nastenne-kalendare/c-1.xhtml",BASE+"/eshop/stolove-kalendare/c-2.xhtml",BASE+"/eshop/pracovne/c-12.xhtml",BASE+"/eshop/rocna-planovacia-mapa-2027/p-5676975.xhtml"]);
const home=await fetchHtml(BASE+"/");
for (const m of home.matchAll(/href=["']([^"'?#]+(?:\/c-\d+|\/cid\/\d+)\.xhtml)["']/gi)) {
  const url=new URL(m[1],BASE);
  if(url.origin===BASE && url.pathname.startsWith("/eshop/")) urls.add(url.href);
}
const found=new Map();
const errors=[];
const queue=[...urls],visited=new Set();
while(queue.length && visited.size<90) {
 const url=queue.shift(); if(visited.has(url))continue; visited.add(url);
 try {
  const html=await fetchHtml(url);
  const flat=text(html);
  const matches=[...flat.matchAll(/Obj\.\s*(?:č[ií]slo|.islo|cislo)\s*:\s*([A-Z]{1,3}-[A-Z0-9-]+)/gi)];
  let prev=0;
  for(const m of matches) {
    const sku=m[1].toUpperCase();
    const chunk=flat.slice(Math.max(prev,m.index-900),m.index);
    prev=m.index+m[0].length;
    if(!known.has(sku)) continue;
    const inStock=status(chunk);
    if(inStock===null)continue;
    if(found.has(sku)&&found.get(sku)!==inStock) throw new Error("Contradictory availability for "+sku);
    found.set(sku,inStock);
  }
  for(const m of html.matchAll(/href=["']([^"']+\.xhtml(?:\?[^"']*)?)["']/gi)) {
    const next=new URL(m[1],url);
    if(next.origin!==BASE || !next.pathname.startsWith("/eshop/"))continue;
    // Follow product category pagination but never cart/action URLs.
    if(/(?:\/c-\d+|\/cid\/\d+)\.xhtml$/.test(next.pathname) && !visited.has(next.href) && !queue.includes(next.href)) queue.push(next.href);
  }
 }catch(error){errors.push(String(error.message||error));}
}
if(found.size!==known.size) {
 console.error(JSON.stringify({status:"FAILED_INCOMPLETE",found:found.size,total:known.size,missing:[...known].filter(sku=>!found.has(sku)),pages:visited.size,errors},null,2));
 process.exit(1);
}
const stamp=new Date().toISOString();
const changes=[];
for(const p of products){
 if(!found.has(p.sku)) continue;
 const next=found.get(p.sku);
 if(p.availability?.inStock!==next) changes.push({sku:p.sku,from:p.availability?.inStock,to:next});
 p.availability={...(p.availability||{}),inStock:next,raw:next?"Skladom":"Nedostupné",checkedAt:stamp,source:"pressgroup.sk"};
}
await writeFile(FILE,JSON.stringify(products,null,2)+"\n");
console.log(JSON.stringify({status:"OK",checked:found.size,total:known.size,pages:visited.size,changes,errors},null,2));
