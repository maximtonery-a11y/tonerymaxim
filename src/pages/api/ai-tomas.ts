import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { normalizeCommerceState } from '../../lib/ai-commerce/domain.ts';
import { routeCommerceMessage } from '../../lib/ai-commerce/router.ts';
import { searchCommerce } from '../../lib/ai-commerce/engine.ts';
import { saveAiUnanswered } from '../../lib/ai-unanswered.ts';
import { advisorLinks } from '../../lib/ai-advisor-links.ts';
import { isCalendarQuery } from '../../lib/calendar-ai-catalog.ts';

export const prerender = false;
const clean = (v: unknown, max=500) => String(v || '').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const normalized = (v: unknown) => clean(v).toLocaleLowerCase('sk-SK').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
function requestedType(message:string){const n=normalized(message);return /original/.test(n)?'original':/renov|repas/.test(n)?'renovated':/kompatibil/.test(n)?'compatible':null;}
function requestedColor(message:string){const n=normalized(message);return /cier|black|\bbk\b/.test(n)?'black':/cyan|azur/.test(n)?'cyan':/magenta|purpur/.test(n)?'magenta':/yellow|zlt/.test(n)?'yellow':null;}
function requestedQuantity(message:string){const n=normalized(message);const digit=n.match(/\b(\d{1,2})\s*(?:ks|kus|kusy|kusov)?\b/);if(digit)return Math.min(99,Math.max(1,Number(digit[1])));const words:Record<string,number>={jeden:1,jednu:1,jedno:1,dva:2,dve:2,tri:3,styri:4,pat:5};for(const [w,q] of Object.entries(words))if(new RegExp(`\\b${w}\\b`).test(n))return q;return null;}
function upsertCart(state:any,product:any,quantity:number){const key=String(product.id);const found=state.cart.find((x:any)=>String(x.id)===key||String(x.sku)===String(product.sku));if(found)found.quantity=Math.min(99,Number(found.quantity||1)+quantity);else state.cart.push({id:key,sku:String(product.sku||''),quantity});}
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const message = clean(body?.message); if (!message) return Response.json({ok:false,error:'Napíšte otázku alebo produkt.'},{status:400});
    const state = normalizeCommerceState(body?.state); if (!state.sessionId) state.sessionId=randomUUID();
    const route = routeCommerceMessage(message,state);
    const page = clean(body?.page,300) || '/';
    const calendarRoute = Boolean(route.productQuery && isCalendarQuery(route.productQuery));
    const correction=/\b(nie|pise|model|oprava|spravne)\b/.test(normalized(message));
    if (correction && state.currentPrinter && route.intents.includes('PRINTER_SEARCH') && route.productQuery && normalized(route.productQuery)!==normalized(state.currentPrinter)) {
      state.checkoutDraft={...(state.checkoutDraft||{}),printerConflict:{previous:state.currentPrinter,candidate:route.productQuery}};
      const answer=`Vidím rozpor v modeli: predtým ${state.currentPrinter}, teraz ${route.productQuery}. Toner zatiaľ nepridám. Prosím odpíšte presný celý model z výrobného štítku tlačiarne.`;
      state.history=[...state.history,{role:'user' as const,content:message},{role:'assistant' as const,content:answer}].slice(-20);
      return Response.json({ok:true,route,advisor:{answer:[answer],products:[],groups:[],intent:'printer_conflict',confidence:1,unanswered:false},commerce:null,state,action:{kind:'CLARIFY_PRINTER'}},{headers:{'Cache-Control':'no-store'}});
    }
    if ((state.checkoutDraft as any)?.printerConflict && route.intents.some(x=>['PRODUCT_SEARCH','COMPATIBILITY','BUY_INTENT'].includes(x))) {
      const conflict=(state.checkoutDraft as any).printerConflict;const answer=`Najprv potrebujem potvrdiť presný model tlačiarne (${conflict.previous} alebo ${conflict.candidate}). Bez toho toner nepridám, aby sme neposlali nekompatibilný produkt.`;
      state.history=[...state.history,{role:'user' as const,content:message},{role:'assistant' as const,content:answer}].slice(-20);
      return Response.json({ok:true,route,advisor:{answer:[answer],products:[],groups:[],intent:'printer_conflict',confidence:1,unanswered:false},commerce:null,state,action:{kind:'CLARIFY_PRINTER'}},{headers:{'Cache-Control':'no-store'}});
    }
    const needsAdvisor = !calendarRoute && route.intents.some(x => ['ADVICE','POLICY','HUMAN_ESCALATION','UNKNOWN'].includes(x));
    // Poradenska znalostna vrstva a produktovy nakupca sa nacitavaju oddelene.
    // Bezna produktova otazka tak nedrzi v RAM aj cely poradensky modul.
    const advisorPromise = needsAdvisor ? import('../../lib/aiSalesAssistant.ts').then(({buildAssistantAnswer})=>buildAssistantAnswer(message,page,state.history)) : Promise.resolve({
      answer: route.needsProducts ? ['Overil som aktuálny katalóg. Máme v ponuke tieto vhodné produkty:'] : ['Rozumiem.'],
      products: [], groups: [], intent: 'commerce', confidence: 1, unanswered: false,
    });
    const commercePromise = route.needsProducts && route.productQuery ? searchCommerce(route.productQuery) : Promise.resolve(null);
    const resolved = await Promise.all([advisorPromise,commercePromise]);
    let advisor:any = resolved[0];
    let commerce:any = resolved[1];
    if (calendarRoute && commerce?.source === 'calendar' && Array.isArray(commerce.products) && commerce.products.length) {
      const count = commerce.products.length;
      const diaryOverview = /\b(?:diar|diare)\w*\b/.test(normalized(message))
        && /\b(ake|aky|co|mate|predavate|ponukate|ponuke|sortiment)\b/.test(normalized(message));
      advisor = {
        ...advisor,
        answer: [diaryOverview
          ? `V ponuke máme denné, týždenné aj mesačné minidiáre v rôznych farbách. Nižšie zobrazujem ${count} aktuálne dostupných možností; výber môžete spresniť typom alebo farbou.`
          : `V aktuálnej ponuke som našiel ${count} ${count === 1 ? 'vhodný produkt' : count < 5 ? 'vhodné produkty' : 'vhodných produktov'}. Nižšie zobrazujem iba výsledky z katalógu kalendárov a diárov.`],
        products: [], groups: [], intent: 'calendar_search', confidence: 1, unanswered: false, handoffSuggested: false,
      };
    }
    const wantsHuman=route.intents.includes('HUMAN_ESCALATION');
    const needsHandoff=wantsHuman||advisor?.unanswered===true;
    if(wantsHuman)advisor={...advisor,answer:['Rozumiem. Odovzdám vašu otázku pracovníkovi ToneryMAXIM. Doplňte telefón alebo e-mail; spolu s otázkou odošlem aj stručný kontext tejto konverzácie.'],products:[],groups:[],intent:'handoff',confidence:1,unanswered:false,handoffSuggested:true};
    else if(needsHandoff)advisor={...advisor,handoffSuggested:true};
    advisor={...advisor,sources:advisorLinks(advisor)};
    state.lastIntent=route.intents[0] || 'UNKNOWN';
    const previousQuery=state.lastProductQuery;
    const isNewProduct=Boolean(route.productQuery&&previousQuery&&normalized(route.productQuery)!==normalized(previousQuery)&&route.intents.some(x=>['PRODUCT_SEARCH','PRINTER_SEARCH'].includes(x)));
    if(isNewProduct){state.currentType=null;state.currentColor=null;state.currentProductId=null;state.selectedProductId=null;state.pendingQuestion=null;}
    if (route.productQuery) state.lastProductQuery=route.productQuery;
    if (commerce?.source==='printer') state.currentPrinter=route.productQuery;
    const type=requestedType(message);const color=requestedColor(message);const wasPendingType=state.pendingQuestion==='product_type';const wasPendingQuantity=state.pendingQuestion==='quantity';if(type)state.currentType=type;if(color)state.currentColor=color;
    let candidates=commerce?.products||[];
    const canBuy=(p:any)=>p?.purchasable!==false&&String(p?.stock_status||'').toLowerCase()!=='outofstock'&&Number(p?.stock_quantity??1)!==0;
    const availableTypes=[...new Set(candidates.filter(canBuy).map((p:any)=>p.type).filter(Boolean))];
    const isColorPrinter=Boolean(commerce?.presentation?.isColorPrinter);
    if(route.needsProducts&&candidates.length&&availableTypes.length>1&&!isColorPrinter&&!type&&!state.currentType){
      const savedQty=requestedQuantity(message);state.pendingQuestion='product_type';state.checkoutDraft={...(state.checkoutDraft||{}),guidedQuantity:savedQty||null};
      const options=[availableTypes.includes('compatible')?'kompatibilný':null,availableTypes.includes('original')?'originálny':null,availableTypes.includes('renovated')?'renovovaný':null].filter(Boolean);
      const answer=`Pre ${clean(route.productQuery || message, 120)} máme v ponuke ${options.join(', ').replace(/, ([^,]*)$/, ' alebo $1')} toner. Ktorý typ preferujete?`;
      state.history=[...state.history,{role:'user' as const,content:message},{role:'assistant' as const,content:answer}].slice(-20);
      const optionProducts=availableTypes.map(productType=>candidates.filter((p:any)=>canBuy(p)&&p.type===productType).sort((a:any,b:any)=>Number(a.price||0)-Number(b.price||0))[0]).filter(Boolean);
      return Response.json({ok:true,route,advisor:{...advisor,answer:[answer]},commerce:null,state,action:{kind:'ASK_PRODUCT_TYPE',options:availableTypes,products:optionProducts}},{headers:{'Cache-Control':'no-store'}});
    }
    if(state.currentType&&commerce){candidates=candidates.filter((p:any)=>p.type===state.currentType);commerce={...commerce,products:candidates,presentation:{...(commerce.presentation||{}),sets:(commerce.presentation?.sets||[]).filter((s:any)=>s.type===state.currentType)}};}
    const selected=candidates.find((p:any)=>canBuy(p)&&String(p.id)===String(state.selectedProductId||state.currentProductId||''))
      || candidates.find((p:any)=>canBuy(p)&&(!state.currentType||p.type===state.currentType)&&(!state.currentColor||p.color===state.currentColor))
      || candidates.find(canBuy) || null;
    if(selected){state.currentProductId=String(selected.id);if(type||color||route.intents.includes('BUY_INTENT'))state.selectedProductId=String(selected.id);}
    const n=normalized(message);const qty=requestedQuantity(message);let action:any=null;
    if(wasPendingQuantity&&qty&&selected){state.pendingQuestion=null;upsertCart(state,selected,qty);action={kind:'ADD_TO_CART',product:selected,quantity:qty};advisor={...advisor,answer:[`Pridal som ${qty} ks produktu ${selected.name} do nákupu.`]};commerce=null;}
    else if(wasPendingType&&type&&selected){const guidedQty=Number(qty||(state.checkoutDraft as any)?.guidedQuantity||0);state.checkoutDraft={...(state.checkoutDraft||{}),guidedQuantity:null};if(guidedQty>0){state.pendingQuestion=null;upsertCart(state,selected,guidedQty);action={kind:'ADD_TO_CART',product:selected,quantity:guidedQty};advisor={...advisor,answer:[`Vybral som ${selected.name} a pridal ${guidedQty} ks do nákupu.`]};}else{state.pendingQuestion='quantity';action={kind:'OPEN_QUANTITY',product:selected};advisor={...advisor,answer:[`Vybral som ${selected.name}. Koľko kusov potrebujete?`]};}commerce=null;}
    const explicitAdd=/\b(pridaj|zoberiem|kupim|objednaj|daj mi)\b/.test(n)||(/\bchcem\b/.test(n)&&(/\b(kupit|ho|ju|ich|kus|ks|dva|dve|tri|styri|pat)\b/.test(n)));
    if(!action&&route.intents.includes('BUY_INTENT')&&selected){
      if(explicitAdd||qty){const amount=qty||1;const already=state.cart.some((x:any)=>String(x.id)===String(selected.id));if(!already||qty){upsertCart(state,selected,amount);action={kind:'ADD_TO_CART',product:selected,quantity:amount};advisor={...advisor,answer:[`Pridal som ${amount} ks produktu ${selected.name} do nákupu.`]};}else{action={kind:'OPEN_CART'};advisor={...advisor,answer:['Tento produkt už v nákupe máte. Otváram aktuálny nákup.']};}}
      else{state.pendingQuestion='quantity';action={kind:'OPEN_QUANTITY',product:selected};advisor={...advisor,answer:[`Vybrali ste ${selected.name}. Zvoľte množstvo.`]};}
    } else if(route.intents.includes('CART')) {
      action={kind:'OPEN_CART'};const count=state.cart.reduce((sum:number,x:any)=>sum+Number(x.quantity||1),0);advisor={...advisor,answer:[count?`V nákupe máte ${count} ks v ${state.cart.length} položkách.`:'Váš nákup je zatiaľ prázdny.']};
    } else if(route.intents.includes('CHECKOUT')) {
      action=state.cart.length?{kind:'OPEN_CHECKOUT'}:{kind:'OPEN_CART'};advisor={...advisor,answer:[state.cart.length?'Môžeme pokračovať ku kontrole nákupu, adresy, dopravy a platby.':'Nákup je zatiaľ prázdny. Najprv vyberte produkt.']};
    }
    if(!action&&route.needsProducts&&commerce&&!(commerce.products||[]).length){
      const answer = calendarRoute
        ? 'V aktuálnom katalógu som nenašiel presnú zhodu. Skúste uviesť typ (nástenný, stolový, denný, týždenný, mesačný alebo minidiár), motív alebo kód produktu.'
        : 'Podľa zadaného označenia som nenašiel bezpečnú zhodu. Napíšte, prosím, celý model tlačiarne zo štítku alebo presný kód toneru.';
      advisor={...advisor,answer:[answer],products:[],groups:[],intent:calendarRoute?'calendar_search':advisor?.intent,confidence:calendarRoute?1:advisor?.confidence,unanswered:false,handoffSuggested:false};
      action={kind:'CLARIFY_PRODUCT'};
    }
    if(!action&&needsHandoff)action={kind:'OPEN_HANDOFF',reason:wantsHuman?'customer_request':'unanswered'};
    if(advisor?.unanswered===true||advisor?.intent==='fallback'||Number(advisor?.confidence||0)<0.35){void saveAiUnanswered({message,page,intent:String(advisor?.intent||'fallback'),confidence:Number(advisor?.confidence||0),kind:advisor?.unanswered===true||advisor?.intent==='fallback'?'unknown_question':'low_confidence'}).catch(()=>undefined);}
    state.history=[...state.history,{role:'user' as const,content:message},{role:'assistant' as const,content:(advisor.answer||[]).join(' ')}].slice(-20);
    return Response.json({ok:true,route,advisor,commerce,state,action},{headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    console.error('[AI Tomas unified]', error);
    return Response.json({ok:false,error:'AI Tomáš teraz nedokáže bezpečne dokončiť požiadavku. Skúste akciu zopakovať.'},{status:500,headers:{'Cache-Control':'no-store'}});
  }
};
