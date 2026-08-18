import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantAnswer, type AiConversationTurn } from '../src/lib/aiSalesAssistant.ts';
process.env.OPENAI_ASSISTANT_ENABLED='0';

async function run(turns:string[]) {
 let h:AiConversationTurn[]=[]; let r:any;
 for (const q of turns) { r=await buildAssistantAnswer(q,'/',h); h.push({role:'user',content:q},{role:'assistant',content:(r.answer||[]).join(' ')}); h=h.slice(-8); }
 return r;
}
const text=(r:any)=>(r.answer||[]).join(' ');

test('long Brother journey retains product through price stock CZ', async()=>{
 const r=await run(['Mám Brother HL-L2352DW, aký toner?','radšej kompatibilný','ktorý je najlacnejší?','máte ho skladom?','pošlete mi ho do Brna?']);
 assert.equal(r.intent,'product_search'); assert.match(text(r),/Česk|Brn/i); assert.ok((r.products||[]).some((p:any)=>/TN-?2421/i.test(p.name+p.sku)));
});
test('switch Brother to HP and original', async()=>{
 const r=await run(['Mám Brother HL-L2352DW','chcem kompatibilný','nie vlastne mám HP M110w','tak originál','máte ho skladom?']);
 assert.equal(r.intent,'product_search'); assert.ok((r.products||[]).some((p:any)=>/W1420|142A/i.test(p.name+p.sku))); assert.ok(!(r.products||[]).some((p:any)=>/TN-?2421/i.test(p.name+p.sku)));
});
test('OEM pronoun chain', async()=>{
 const r=await run(['Potrebujem CF283A','chcem kompatibilný','koľko stojí?','máte ho skladom?','kedy mi príde?']);
 assert.equal(r.intent,'product_search'); assert.ok((r.products||[]).some((p:any)=>/CF283A/i.test(p.name+p.sku))); assert.match(text(r),/1–2|1-2|exped/i);
});
test('standalone payment breaks product context', async()=>{
 const r=await run(['Potrebujem TN2421','chcem kompatibilný','koľko stojí dobierka?']); assert.equal(r.intent,'payment');
});
test('return to product after standalone payment', async()=>{
 const r=await run(['Potrebujem TN2421','koľko stojí dobierka?','a ten toner máte skladom?']); assert.equal(r.intent,'product_search'); assert.ok((r.products||[]).some((p:any)=>/TN-?2421/i.test(p.name+p.sku)));
});
test('L2350 correction caution', async()=>{
 const r=await run(['Mám Brother HL-L2352DW','nie na počítači mi píše L2350','môžem tam TN2421?']); assert.match(text(r),/štít|stit|presn|kazet|toner/i);
});
test('two products then the first should not hallucinate', async()=>{
 const r=await run(['Porovnaj mi TN2421 a CF283A','ten prvý chcem kompatibilný']); assert.ok(r.intent==='product_search'||r.intent==='fallback');
});
test('unknown off-topic after product gives sane fallback', async()=>{
 const r=await run(['Potrebujem TN2421','aké bude zajtra počasie?']); assert.equal(r.intent,'fallback'); assert.doesNotMatch(text(r),/pasy|dobierka|reklamac/i);
});
test('CZ pickup after product', async()=>{
 const r=await run(['Potrebujem W1420A','pošlete do Česka?','a do DPD pickup boxu?']); assert.match(text(r),/Česk|pickup|iba.*kuri/i);
});
test('chaotic typo model', async()=>{
 const r=await run(['mam broter l2352','potrebujem toner','original nie, radsej kompatibilny']); assert.ok(r.intent==='product_search'||r.intent==='fallback');
});
