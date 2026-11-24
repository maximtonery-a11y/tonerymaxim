import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(),'tm-account-navigation-'));
const originalFetch = globalThis.fetch;
after(async()=>{globalThis.fetch=originalFetch;await rm(directory,{recursive:true,force:true});});
Object.assign(process.env,{WOO_URL:'https://woo.example.invalid',WOO_CONSUMER_KEY:'fixture',WOO_CONSUMER_SECRET:'fixture'});
const outfile=join(directory,'app.mjs');
await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:
  "export * from './src/lib/account-orders.ts';export {getWooCustomerById,updateWooCustomer,wooRequest} from './src/lib/woo-client.ts';"},
  bundle:true,platform:'node',format:'esm',packages:'external',outfile,define:{'import.meta.env':'{}'},logLevel:'silent'});
const app=await import(pathToFileURL(outfile).href);
let nextCustomer=2000;
function fixture(count=3) {
  const customer=++nextCustomer;
  const rows=Array.from({length:count},(_,i)=>({id:7000+i,customer_id:customer,status:i===1?'cancelled':'completed',total:'10.00',total_tax:'1.00',currency:'EUR',
    refunds:i===0?[{total:'-3.00'}]:[],meta_data:[{key:'tm_order_number',value:String(310000+i)},{key:'private_note',value:'not-for-the-account'}],line_items:[]}));
  const calls:Array<{url:URL;method:string}>=[];
  globalThis.fetch=async(input:any,options:any={})=>{
    const url=new URL(String(input));const method=options.method||'GET';calls.push({url,method});
    assert.equal(url.hostname,'woo.example.invalid');
    await new Promise(resolve=>setTimeout(resolve,4));
    if(url.pathname.endsWith('/customers/'+customer))return Response.json({id:customer,email:'fixture@example.invalid',first_name:'Test'});
    assert.equal(url.pathname,'/wp-json/wc/v3/orders');
    if(method==='POST') { rows.unshift({...rows[0],id:9000,refunds:[],...JSON.parse(options.body)});return Response.json(rows[0]); }
    const size=Number(url.searchParams.get('per_page')||20),page=Number(url.searchParams.get('page')||1);
    const fields=url.searchParams.get('_fields')?.split(',');
    const selected=rows.slice((page-1)*size,page*size).map(order=>fields?Object.fromEntries(fields.map(key=>[key,(order as any)[key]])):order);
    return Response.json(selected,{headers:{'X-WP-Total':String(rows.length),'X-WP-TotalPages':String(Math.ceil(rows.length/size))}});
  };
  return{customer,rows,calls};
}

test('landing reads only one order page and never mistakes a partial history for a lifetime sum',async()=>{
  const f=fixture(151);const result=await app.getAccountHomePreview(f.customer);
  assert.equal(result.count,151);assert.equal(result.spending,null);assert.equal(result.latestOrder.tmNumber,'310000');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url.searchParams.get('per_page'),'20');
  assert.doesNotMatch(JSON.stringify(result),/private_note|not-for-the-account/);
  await app.getAccountOrdersPage(f.customer);assert.equal(f.calls.length,1,'The history reuses the landing read');
});

test('a complete short history keeps the accurate sum, excluding cancellations and subtracting refunds',async()=>{
  const f=fixture(3);const result=await app.getAccountHomePreview(f.customer);
  assert.equal(result.count,3);assert.deepEqual(result.spending,[{currency:'EUR',total:17}]);
  assert.equal(f.calls.length,1);
});

test('a new account has a confirmed zero count without scanning or inventing orders',async()=>{
  const f=fixture(0);const result=await app.getAccountHomePreview(f.customer);
  assert.equal(result.count,0);assert.equal(result.latestOrder,null);assert.deepEqual(result.spending,[]);assert.equal(f.calls.length,1);
});

test('simultaneous customer, home and order requests share their upstream reads',async()=>{
  const f=fixture(61);
  await Promise.all(Array.from({length:20},()=>Promise.all([app.getWooCustomerById(f.customer),app.getAccountHomePreview(f.customer),app.getAccountOrdersPage(f.customer)])));
  assert.equal(f.calls.filter(call=>call.url.pathname.includes('/customers/')).length,1);
  assert.equal(f.calls.filter(call=>call.url.pathname.endsWith('/orders')).length,1);
});

test('an actual successful Woo order write invalidates both the page and lifetime summary without extra HTTP',async()=>{
  const f=fixture(3);
  await app.getAccountHomePreview(f.customer);await app.getAccountOverview(f.customer);
  const before=f.calls.length;
  await app.wooRequest('/orders',{method:'POST',body:{customer_id:f.customer,total:'10.00',status:'completed'}});
  assert.equal(f.calls.length,before+1,'Invalidation itself must not contact Woo');
  const page=await app.getAccountOrdersPage(f.customer);assert.equal(page.total,4);assert.equal(page.orders[0].id,9000);
  const summary=await app.getAccountOverview(f.customer);assert.equal(summary.count,4);assert.deepEqual(summary.spending,[{currency:'EUR',total:27}]);
});

test('an old customer read finishing after a profile write cannot replace the newly saved settings',async()=>{
  const customer=++nextCustomer;let finish!:(response:Response)=>void;let ready!:()=>void;
  const started=new Promise<void>(resolve=>{ready=resolve;});let reads=0,writes=0;
  globalThis.fetch=async(input:any,options:any)=>{
    assert.equal(new URL(String(input)).hostname,'woo.example.invalid');
    if(options.method==='PUT'){writes++;return Response.json({id:customer,email:'fixture@example.invalid',first_name:'Saved'});}
    reads++;ready();return new Promise<Response>(resolve=>{finish=resolve;});
  };
  const old=app.getWooCustomerById(customer);await started;
  await app.updateWooCustomer(customer,{first_name:'Saved'});
  finish(Response.json({id:customer,email:'fixture@example.invalid',first_name:'Old'}));await old;
  assert.equal((await app.getWooCustomerById(customer)).first_name,'Saved');assert.equal(reads,1);assert.equal(writes,1);
});

test('invalid identities and cross-customer order pages are rejected and never cached',async()=>{
  const f=fixture(1);f.rows[0].customer_id=0;
  await assert.rejects(app.getAccountOrdersPage(f.customer),app.AccountOrderError);
  await assert.rejects(app.getAccountOrdersPage(f.customer),app.AccountOrderError);
  assert.equal(f.calls.length,2);
  await assert.rejects(app.getAccountOrdersPage(0),app.AccountOrderError);assert.equal(f.calls.length,2);
});
