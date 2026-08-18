import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantAnswer, type AiConversationTurn } from '../src/lib/aiSalesAssistant.ts';
process.env.OPENAI_ASSISTANT_ENABLED='0';

async function convo(first:string, follow:string) {
  const a:any=await buildAssistantAnswer(first,'/');
  const h:AiConversationTurn[]=[{role:'user',content:first},{role:'assistant',content:(a.answer||[]).join(' ')}];
  const b:any=await buildAssistantAnswer(follow,'/',h);
  return {a,b};
}

test('model -> lacnejsi keeps model context', async()=>{const {b}=await convo('Mám Brother HL-L2352DW, aký toner?','a chcem lacnejší kompatibilný'); assert.equal(b.intent,'product_search'); assert.ok((b.products||[]).some((p:any)=>/TN-?2421/i.test(p.name+p.sku))); assert.ok((b.products||[]).every((p:any)=>p.product_type_key==='compatible'));});
test('model -> original keeps model context', async()=>{const {b}=await convo('Mám HP LaserJet M110w','a originál?'); assert.equal(b.intent,'product_search'); assert.ok((b.products||[]).some((p:any)=>/W1420|142A/i.test(p.name+p.sku))); assert.ok((b.products||[]).every((p:any)=>p.product_type_key==='original'));});
test('model -> shipping CZ returns only shipping, no products', async()=>{const {b}=await convo('Mám Brother HL-L2352DW, aký toner?','a posielate to do Česka?'); assert.equal(b.intent,'shipping'); assert.equal((b.products||[]).length,0); assert.equal((b.groups||[]).length,0); assert.match((b.answer||[]).join(' '),/Českej republiky|Ceskej republiky/i);});
test('new model replaces old context', async()=>{const first:any=await buildAssistantAnswer('Mám Brother HL-L2352DW','/'); const h:any=[{role:'user',content:'Mám Brother HL-L2352DW'},{role:'assistant',content:first.answer.join(' ')}]; const b:any=await buildAssistantAnswer('Nie, mám HP M110w','/',h); assert.ok((b.products||[]).some((p:any)=>/W1420|142A/i.test(p.name+p.sku))); assert.ok(!(b.products||[]).some((p:any)=>/TN-?2421/i.test(p.name+p.sku)));});
test('model -> stock followup', async()=>{const {b}=await convo('Potrebujem TN2421','máte ho skladom?'); assert.equal(b.intent,'product_search'); assert.match((b.answer||[]).join(' '),/skladom/i);});
test('model -> delivery followup returns only delivery, no products', async()=>{const {b}=await convo('Potrebujem CF283A','a kedy mi príde?'); assert.ok(['shipping','order'].includes(b.intent)); assert.equal((b.products||[]).length,0); assert.equal((b.groups||[]).length,0); assert.match((b.answer||[]).join(' '),/1–2|1-2|exped|doruč/i);});
test('unrelated followup does not inherit model', async()=>{const {b}=await convo('Potrebujem TN2421','koľko stojí dobierka?'); assert.equal(b.intent,'payment');});
