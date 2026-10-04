// Run after npm run build. Only local GET requests; background workers disabled.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
process.env.ASTRO_NODE_AUTOSTART='disabled';
process.env.TM_DISABLE_BACKGROUND_WORKERS='1';
process.env.TM_TONER_CARE_ENABLED='0';
const {handler}=await import('../dist/server/entry.mjs');
const server=createServer(handler);
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const address=server.address();
const base=`http://127.0.0.1:${address.port}`;
try {
 const home=await (await fetch(base)).text();
 const mobile=home.match(/<div[^>]*class="tm-mobile-search-examples"[^>]*>([\s\S]*?)<\/div>/)?.[1]||'';
 const desktop=home.match(/<div[^>]*class="examples"[^>]*>([\s\S]*?)<\/div>/)?.[1]||'';
 const links=block=>[...block.matchAll(/href="([^"]+)"/g)].map(x=>x[1].replaceAll('&amp;','&'));
 assert.equal(links(mobile).length,6);assert.equal(links(desktop).length,5);
 assert.ok(links(mobile).includes('/tlaciarne/hp/hp-laserjet-m1132'));
 const unique=[...new Set([...links(mobile),...links(desktop)])];
 for(const agent of ['Mozilla/5.0 (Linux; Android 17) AppleWebKit/537.36 Chrome/153.0.0.0 Mobile Safari/537.36','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36']) {
  for(const link of unique){
   const response=await fetch(base+link,{headers:{'user-agent':agent},signal:AbortSignal.timeout(20000)});
   const body=await response.text();assert.equal(response.status,200,link);
   assert.doesNotMatch(body,/>\s*0\s+nájdených produktov|Model tlačiarne sa nenašiel/,link);
   if(link.includes('m1132'))assert.match(body,/CE285A/);
  }
 }
 for(const link of ['/api/health','/api/storefront-check','/kosik','/pokladna'])assert.equal((await fetch(base+link)).status,200,link);
 console.log(`PASS: ${unique.length} distinct quick links for both User-Agents, all 11 homepage shortcuts present; health/cart/checkout 200.`);
} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
