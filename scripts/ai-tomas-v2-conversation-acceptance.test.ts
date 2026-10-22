import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConversationContext } from '../src/lib/ai-conversation-context.ts';

// Acceptance criteria from real customer dialogue. These tests intentionally
// specify desired behavior on the isolated branch; they are not proof of
// implementation and can fail until the new orchestrator is implemented.
const page='/produkt/brother-tn-2421-cierny-kompatibilny-toner';
const previous=[
  {role:'user',content:'Koľko zaplatím za 2 tonery s DPD a dobierkou?',topic:'product' as const,productReference:'SKU: TN2421'},
  {role:'assistant',content:'Za dva tonery zaplatíte 28,59 €.',topic:'product' as const,productReference:'SKU: TN2421'},
];

test('New printer recommendation never inherits the opened toner as product query',()=>{
  const question='Vieš mi odporučiť tlačiareň kde je najlacnejšia cena za vytlačenú stranu?';
  const result=resolveConversationContext(question,previous,{lastProductQuery:'TN2421'},page);
  assert.equal(result.relation,'new');
  assert.equal(result.productQuery,null);
  assert.notEqual(result.relation,'clarify');
});

test('Explicit user correction must replace previous toner intent rather than request clarification',()=>{
  const history=[
    ...previous,
    {role:'user',content:'Vieš mi odporučiť tlačiareň kde je najlacnejšia cena za vytlačenú stranu?',topic:'product' as const,productReference:'SKU: TN2421'},
    {role:'assistant',content:'Myslíte produkt TN2421?',topic:'product' as const,productReference:'SKU: TN2421'},
  ];
  const question='Nie, myslím či mi vieš odporučiť tlačiareň, nie toner';
  const result=resolveConversationContext(question,history,{lastProductQuery:'TN2421'},page);
  assert.equal(result.relation,'new');
  assert.equal(result.productQuery,null);
  assert.equal(result.clarification,null);
});

test('Unrelated printer shopping question must not alter existing cart',()=>{
  const question='Aká tlačiareň má najnižšie náklady na tlač?';
  const result=resolveConversationContext(question,previous,{lastProductQuery:'TN2421'},page);
  assert.equal(result.productQuery,null);
  assert.notEqual(result.relation,'clarify');
});
