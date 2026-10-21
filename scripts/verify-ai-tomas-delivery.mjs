// Real HTTP conversation; no cart mutations, orders, emails or account access.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
const value=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const local=!value('--base-url'),base=local?'http://127.0.0.1:43821':new URL(value('--base-url')).origin;
const output=value('--output')||'docs/verification/ai-tomas-delivery-2026-10-21.json';
const report={at:new Date().toISOString(),base,scope:local?'Production build over HTTP with isolated catalogue fixtures; model disabled':'Live anonymous advisory conversation',passed:false,cases:[]};
let server,temp,state={},unitPrice=0,currentSku='';
const round=n=>Math.round(n*100)/100;
async function request(question){
 const payload=JSON.stringify({message:question,page:'/',state});const started=Date.now();let response;
 if(local)response=await new Promise((resolve,reject)=>{const req=httpRequest(`${base}/api/ai-tomas`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://www.tonerymaxim.sk'}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,json:()=>JSON.parse(text)}));});req.on('error',reject);req.setTimeout(30000,()=>req.destroy(new Error('timeout')));req.end(payload);});
 else response=await fetch(`${base}/api/ai-tomas`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Origin:base},body:payload,signal:AbortSignal.timeout(30000)});
 const body=await response.json();report.cases.push({question,status:response.status,ms:Date.now()-started,answer:body.advisor?.answer,conversation:body.conversation,quote:body.quote,products:body.commerce?.products?.map(p=>({sku:p.sku,price:p.price})),action:body.action,cart:body.state?.cart});
 assert.equal(response.status,200,question);assert.equal(body.ok,true);assert.equal(body.action,null);assert.deepEqual(body.state.cart,[]);state=body.state;return body;
}
function checkQuote(body,quantity,cod=false){
 assert.equal(body.quote.sku,currentSku);assert.equal(body.quote.quantity,quantity);
 const original=round(unitPrice*quantity),goods=round(original-round(original*(quantity>=4?.25:quantity>=2?.1:0)));
 assert.equal(body.quote.goodsTotal,goods);
 for(const option of body.quote.options){const shipping=goods>=29?0:option.id==='courier'?3.9:2.9;assert.equal(option.shipping,shipping);assert.equal(option.payment,cod?1.2:0);assert.equal(option.total,round(goods+shipping+(cod?1.2:0)));}
}
try{
 if(local){
  temp=await mkdtemp(join(tmpdir(),'tm-delivery-'));const preload=join(temp,'catalogue.mjs');
  const products=[{id:39951,sku:'13276',name:'HP W1420A čierny kompatibilný toner',slug:'hp-compatible',price:18.24},{id:15048,sku:'15048',name:'Brother TN2421 čierny kompatibilný toner',slug:'brother-compatible',price:12.96}].map(p=>({...p,product_type_key:'compatible',stock_status:'instock',stock_quantity:20,compatible_printers:['HP LaserJet M110w']}));
  await writeFile(preload,'globalThis.__TM_PRODUCTS_FILE_CACHE__='+JSON.stringify({ok:true,version:4,runtime_compact:true,generated_at:'delivery-http',total:2,products})+';');
  server=spawn(process.execPath,['--import',preload,'dist/server/entry.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:'43821',TM_CACHE_DIR:temp,OPENAI_ASSISTANT_ENABLED:'0',TM_DISABLE_BACKGROUND_WORKERS:'1',TM_DISABLE_INDEXNOW:'1'},stdio:'ignore'});
  let ready=false;for(let i=0;i<100;i++){try{ready=await new Promise(resolve=>{const req=httpRequest(`${base}/api/ai-tomas`,res=>{res.resume();resolve(res.statusCode<500)});req.on('error',()=>resolve(false));req.end();});}catch{}if(ready)break;if(server.exitCode!==null)throw new Error('Server stopped');await new Promise(resolve=>setTimeout(resolve,50));}assert.ok(ready);
 }
 const hp=await request('Ukáž mi kompatibilný toner HP W1420A.');assert.equal(hp.commerce.products.length,1);unitPrice=hp.commerce.products[0].price;currentSku=hp.commerce.products[0].sku;
 await request('Koľko stojí doprava?');checkQuote(await request('Koľko bude stáť toner aj s dopravou?'),1);
 checkQuote(await request('Koľko budú stáť 2 kusy aj s dopravou?'),2);
 checkQuote(await request('A koľko to bude spolu na dobierku?'),2,true);
 const brother=await request('Ukáž mi kompatibilný toner Brother TN2421.');assert.equal(brother.commerce.products.length,1);unitPrice=brother.commerce.products[0].price;currentSku=brother.commerce.products[0].sku;
 await request('Môžem zaplatiť kartou?');checkQuote(await request('A koľko zaplatím spolu aj s dopravou?'),1);
 report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{server?.kill('SIGTERM');if(temp)await rm(temp,{recursive:true,force:true});await mkdir('docs/verification',{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({base,passed:report.passed,cases:report.cases.length,error:report.error,output}));}
