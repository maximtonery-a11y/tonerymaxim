import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';

const component=readFileSync(new URL('../src/components/FloatingAdvisor.astro',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/styles/ai-sales-assistant.css',import.meta.url),'utf8');
const api=readFileSync(new URL('../src/pages/api/ai-tomas.ts',import.meta.url),'utf8');
const admin=readFileSync(new URL('../src/pages/admin/ai-tomas-unanswered.astro',import.meta.url),'utf8');

test('osobný odber je servisná otázka aj po produktovej konverzácii',async()=>{
  const answer=await buildAssistantAnswer('máte možnosť osobného odberu?','/pokladna',[
    {role:'user',content:'hľadám CRG054'},{role:'assistant',content:'Našiel som vhodné tonery.'},
  ] as any);
  assert.equal(answer.intent,'shipping');
  assert.equal(answer.faq,'doprava-osobny-odber');
  assert.equal(answer.products.length,0);
  assert.match(answer.answer.join(' '),/GLS|DPD/);
  assert.match(answer.answer.join(' '),/Osobný odber.+momentálne.+nie je/i);
});

test('hotovosť je platobná otázka aj po produktovej konverzácii',async()=>{
  const answer=await buildAssistantAnswer('môžem platiť v hotovosti?','/pokladna',[
    {role:'user',content:'hľadám CRG054'},{role:'assistant',content:'Našiel som vhodné tonery.'},
  ] as any);
  assert.equal(answer.intent,'payment');
  assert.equal(answer.products.length,0);
  assert.match(answer.answer.join(' '),/dobierk/i);
});

test('panel má všetky požadované ovládacie prvky',()=>{
  for(const hook of ['data-ai-resize','data-ai-download','data-ai-support','data-ai-new','data-ai-new-keep','data-ai-new-all','data-ai-new-cancel'])assert.ok(component.includes(hook),hook);
  assert.match(css,/is-compact/);assert.match(css,/is-expanded/);
});

test('veľkosť, rozhovor a košík sa ukladajú a nová komunikácia chráni košík',()=>{
  assert.match(ui,/uiSize:state\.size/);
  assert.match(ui,/uiManualSize:state\.manualSize/);
  assert.match(ui,/uiMessages:messages\?\.innerHTML/);
  assert.match(ui,/resetConversation\(true\)/);
  assert.match(ui,/resetConversation\(false\)/);
  assert.match(ui,/const kept=keepCart\?state\.cart:\[\]/);
});

test('odpovede majú hodnotenie, zdroje, podporu a stiahnutie',()=>{
  for(const token of ['attachFeedback','appendSources','/api/ai-events','/api/ai-handoff','AI-Tomas-komunikacia-'])assert.ok(ui.includes(token),token);
  assert.match(api,/Doprava a platba/);
  assert.match(api,/saveAiUnanswered/);
});

test('administrácia obsahuje udalosti, hodnotenie a neúspešné otázky',()=>{
  for(const token of ['readAiEventSummary','feedback.up','feedback.down','data.items','topPages'])assert.ok(admin.includes(token),token);
});
