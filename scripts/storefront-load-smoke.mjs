import { spawn } from 'node:child_process';
import http from 'node:http';

const port=4400;
const env={...process.env,HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'production',TM_MEMORY_PROBE:'1'};
for(const key of ['AUTH_SECRET','SESSION_SECRET','TM_PERSISTENCE_SECRET','TM_ANALYTICS_ADMIN_KEY','ADMIN_API_SECRET','SYNC_SECRET','GOOGLE_ADS_DEVELOPER_TOKEN','GOOGLE_ADS_CLIENT_ID','GOOGLE_ADS_CLIENT_SECRET','GOOGLE_ADS_REFRESH_TOKEN','GOOGLE_MERCHANT_ID'])delete env[key];
const child=spawn(process.execPath,['--import',new URL('./storefront-production-smoke-shim.mjs',import.meta.url).pathname,'./dist/server/entry.mjs'],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function request(path){return new Promise((resolve,reject)=>{const start=performance.now();const req=http.request({host:'127.0.0.1',port,path,headers:{Host:'tonerymaxim.sk'},timeout:5000},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,ms:performance.now()-start}));});req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject);req.end();});}
try{
  for(let i=0;i<50&&!logs.includes('Server listening');i++)await delay(100);
  if(!logs.includes('Server listening'))throw new Error(logs||'server sa nespustil');
  // Zatazovy test musi pokryt aj cestu, na ktorej sa v produkcii objavila 502,
  // a lahky healthcheck pouzivany reverznou proxy.
  const paths=['/','/kosik','/pokladna','/prihlasenie','/tlaciarne','/api/health'];const results=[];
  for(let batch=0;batch<50;batch++)results.push(...await Promise.all(Array.from({length:20},(_,i)=>request(paths[(batch*20+i)%paths.length]))));
  if(results.some(r=>r.status!==200))throw new Error(`HTTP chyby: ${results.filter(r=>r.status!==200).length}`);
  await delay(150);
  const rssValues=[...logs.matchAll(/TM_RSS_KB=(\d+)/g)].map(m=>Number(m[1]));
  const rssKb=Math.max(0,...rssValues);
  const times=results.map(r=>r.ms).sort((a,b)=>a-b);
  const p95=times[Math.floor(times.length*.95)];
  if(p95>2000)throw new Error(`p95 ${p95.toFixed(1)} ms prekročilo 2 s`);
  if(rssKb>300*1024)throw new Error(`RSS ${(rssKb/1024).toFixed(1)} MB prekročilo 300 MB`);
  console.log(JSON.stringify({ok:true,requests:results.length,errors:0,p95Ms:Number(p95.toFixed(1)),rssMB:Number((rssKb/1024).toFixed(1))}));
}finally{child.kill('SIGTERM')}
