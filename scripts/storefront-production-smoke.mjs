import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';

// The work sandbox blocks uv_interface_addresses. Production is unaffected;
// this local override only lets the built Astro server print its address here.
os.networkInterfaces = () => ({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});

const port=4399;
const childEnv={...process.env,HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'production'};
for(const key of ['AUTH_SECRET','SESSION_SECRET','TM_PERSISTENCE_SECRET','TM_ANALYTICS_ADMIN_KEY','ADMIN_API_SECRET','SYNC_SECRET','GOOGLE_ADS_DEVELOPER_TOKEN','GOOGLE_ADS_CLIENT_ID','GOOGLE_ADS_CLIENT_SECRET','GOOGLE_ADS_REFRESH_TOKEN','GOOGLE_MERCHANT_ID'])delete childEnv[key];
const child=spawn(process.execPath,['--import',new URL('./storefront-production-smoke-shim.mjs',import.meta.url).pathname,'./dist/server/entry.mjs'],{
  cwd:process.cwd(),env:childEnv,stdio:['ignore','pipe','pipe']
});
let logs='';
child.stdout.on('data',d=>logs+=d);
child.stderr.on('data',d=>logs+=d);

function request(path,host,options={}){return new Promise((resolve,reject)=>{const body=options.body||'';const req=http.request({host:'127.0.0.1',port,path,method:options.method||'GET',headers:{Host:host,...options.headers,...(body?{'Content-Length':Buffer.byteLength(body)}:{})},timeout:5000},res=>{let responseBody='';res.setEncoding('utf8');res.on('data',d=>responseBody+=d);res.on('end',()=>resolve({path,host,status:res.statusCode,location:res.headers.location||'',bytes:Buffer.byteLength(responseBody),body:responseBody}));});req.on('timeout',()=>req.destroy(new Error(`Timeout ${path}`)));req.on('error',reject);if(body)req.write(body);req.end();});}
function delay(ms){return new Promise(r=>setTimeout(r,ms))}

try{
  for(let i=0;i<50;i++){if(logs.includes('Server listening'))break;if(child.exitCode!==null)throw new Error(`Server skončil (${child.exitCode}): ${logs}`);await delay(100)}
  if(!logs.includes('Server listening'))throw new Error(`Server sa nespustil: ${logs}`);
  const results=[];
  for(const host of ['tonerymaxim.sk','www.tonerymaxim.sk'])for(const path of ['/','/kosik','/pokladna','/api/health'])results.push(await request(path,host));
  for(const r of results){if(r.status!==200)throw new Error(`${r.host}${r.path}: HTTP ${r.status}, location=${r.location}`);if(r.bytes<20)throw new Error(`${r.host}${r.path}: prázdna odpoveď`)}
  const cart=results.find(r=>r.path==='/kosik');
  const checkout=results.find(r=>r.path==='/pokladna');
  if(!cart.body.includes('Vaše produkty'))throw new Error('Košík nemá očakávaný obsah.');
  if(!checkout.body.includes('Pokladňa'))throw new Error('Pokladňa nemá očakávaný obsah.');
  console.log(JSON.stringify({ok:true,routes:results.map(({body,...r})=>r)},null,2));
}finally{
  child.kill('SIGTERM');
}
