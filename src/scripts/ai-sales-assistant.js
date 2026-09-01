import { collapsePaperRewardCart, isPaperRewardCartItem } from "./paper-reward-cart.js";

(function () {
  const root = document.querySelector('[data-ai-sales-assistant]');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  const panel = root.querySelector('[data-ai-panel]');
  const toggle = root.querySelector('[data-ai-toggle]');
  const close = root.querySelector('[data-ai-close]');
  const back = root.querySelector('[data-ai-back]');
  const progress = root.querySelector('[data-ai-progress]');
  const form = root.querySelector('[data-ai-form]');
  const input = root.querySelector('[data-ai-input]');
  const messages = root.querySelector('[data-ai-messages]');
  const quick = root.querySelector('[data-ai-quick]');
  const nudge = root.querySelector('[data-ai-nudge]');
  const nudgeClose = root.querySelector('[data-ai-nudge-close]');
  const nudgeQuestion = root.querySelector('[data-ai-nudge-question]');
  const handoff = root.querySelector('[data-ai-handoff]');
  const handoffForm = root.querySelector('[data-ai-handoff-form]');
  const handoffQuestion = root.querySelector('[data-ai-handoff-question]');
  const handoffPhone = root.querySelector('[data-ai-handoff-phone]');
  const handoffEmail = root.querySelector('[data-ai-handoff-email]');
  const handoffConsent = root.querySelector('[data-ai-handoff-consent]');
  const handoffHp = root.querySelector('[data-ai-handoff-hp]');
  const handoffStatus = root.querySelector('[data-ai-handoff-status]');
  const handoffClose = root.querySelector('[data-ai-handoff-close]');
  const handoffContinue = root.querySelector('[data-ai-handoff-continue]');
  const resizeButton = root.querySelector('[data-ai-resize]');
  const downloadButton = root.querySelector('[data-ai-download]');
  const supportButton = root.querySelector('[data-ai-support]');
  const newButton = root.querySelector('[data-ai-new]');
  const newDialog = root.querySelector('[data-ai-new-dialog]');

  const SESSION_KEY = 'tm_ai_tomas_state_v1';
  const NUDGE_KEY = 'tm_ai_tomas_nudge_v2';
  function readSavedState(){ try { const x=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null'); return x&&typeof x==='object'?x:{}; } catch { return {}; } }
  const saved=readSavedState();
  let customerProfileLoadStarted = false;
  let nudgeTimer = 0;
  const state = { busy: false, history: Array.isArray(saved.history)?saved.history.slice(-20):[], lastQuestion: saved.lastProductQuery||'', mode: saved.uiMode||'auto', size: saved.uiSize==='expanded'?'expanded':'compact', manualSize:Boolean(saved.uiManualSize), cart: Array.isArray(saved.uiCart)?saved.uiCart:[], offerSets:Array.isArray(saved.uiOfferSets)?saved.uiOfferSets:[], offerSingles:Array.isArray(saved.uiOfferSingles)?saved.uiOfferSingles:[], profile: null, started: Boolean(saved.uiStarted),
    commerceState: {version:1,sessionId:saved.sessionId||'',history:Array.isArray(saved.history)?saved.history.slice(-20):[],currentPrinter:saved.currentPrinter||null,currentProductId:saved.currentProductId||null,selectedProductId:saved.selectedProductId||null,currentColor:saved.currentColor||null,currentType:saved.currentType||null,cart:Array.isArray(saved.cart)?saved.cart:[],checkoutDraft:saved.checkoutDraft||{},lastProductQuery:saved.lastProductQuery||null,lastIntent:saved.lastIntent||null,pendingQuestion:saved.pendingQuestion||null} };
  function saveCommerceSession(){
    state.commerceState.history=state.history.slice(-20);
    state.commerceState.cart=state.cart.map(x=>({id:x.product?.id||'',sku:x.product?.sku||'',quantity:x.qty}));
    try { sessionStorage.setItem(SESSION_KEY,JSON.stringify({...state.commerceState,uiCart:state.cart,uiOfferSets:state.offerSets,uiOfferSingles:state.offerSingles,uiMode:state.mode,uiSize:state.size,uiManualSize:state.manualSize,uiStarted:state.started,uiMessages:messages?.innerHTML||saved.uiMessages||'',resumeOpen:Boolean(saved.resumeOpen)})); } catch {}
  }
  function trackEvent(type,detail={}){fetch('/api/ai-events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,page:location.pathname,sessionId:state.commerceState.sessionId||'',detail})}).catch(()=>{});}
  function setPanelSize(size='compact',options={}){
    if(mobileQuery?.matches)size='expanded';
    state.size=size==='expanded'?'expanded':'compact';
    if(options.manual===true)state.manualSize=true;
    if(options.manual===false)state.manualSize=false;
    root.classList.toggle('is-expanded',state.size==='expanded');
    root.classList.toggle('is-compact',state.size!=='expanded');
    if(resizeButton){const expanded=state.size==='expanded';resizeButton.textContent=expanded?'↙':'⛶';resizeButton.title=expanded?'Zmenšiť okno':'Zväčšiť okno';resizeButton.setAttribute('aria-label',resizeButton.title);}
    saveCommerceSession();
    if(options.track)trackEvent('resize',{size:state.size});
  }
  function autoPanelSize(activity){
    if(state.manualSize||mobileQuery.matches)return;
    setPanelSize(['products','cart','checkout'].includes(activity)?'expanded':'compact');
  }
  function setProgress(step=1){ if(!progress)return; progress.querySelectorAll('span').forEach((x,i)=>x.classList.toggle('is-active',i<step)); }
  function setExperience(mode='home'){
    root.classList.toggle('is-advice',mode==='advice');
    root.classList.toggle('is-shopping',mode==='shop'||mode==='repeat');
  }
  function beginSession(){ setExperience(state.mode==='shop'||state.mode==='repeat'?'shop':'advice');if(state.started) return; state.started=true; root.classList.add('is-started'); home.hidden=true; back.hidden=false; setProgress(1); if(quick) quick.hidden=true; }
  const home = root.querySelector('[data-ai-home]');
  const commerce = root.querySelector('[data-ai-commerce]');
  const liveCart = root.querySelector('[data-ai-livecart]');
  const topCart = root.querySelector('[data-ai-cart-open-top]');
  const topCartCount = root.querySelector('[data-ai-cart-count-top]');
  const topCartTotal = root.querySelector('[data-ai-cart-total-top]');
  const mobileQuery = window.matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)');
  const initialMessagesHtml = messages.innerHTML;
  setPanelSize(state.size);

  function openPanel() {
    if (document.querySelector('.tm-cookie-consent.tm-cookie-is-open')) return;
    if (!customerProfileLoadStarted) {
      customerProfileLoadStarted = true;
      loadCustomerProfile();
    }
    panel.hidden = false;
    toggle.hidden = true;
    toggle.setAttribute('aria-expanded', 'true');
    root.classList.add('is-open');
    if(nudge)nudge.hidden=true;
    if(nudgeTimer){window.clearTimeout(nudgeTimer);nudgeTimer=0;}
    if(!state.started)setExperience('home');
    document.documentElement.classList.add('tm-ai-open');
    setPanelSize(state.size);
  }

  function closePanel(options = {}) {
    input.blur();
    panel.hidden = true;
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', 'false');
    root.classList.remove('is-open', 'has-keyboard');
    document.documentElement.classList.remove('tm-ai-open');
    if (options.restoreFocus) toggle.focus({ preventScroll: true });
    scheduleNudge();
  }

  function scheduleNudge() {
    if(!nudge||!panel.hidden)return;
    try{if(sessionStorage.getItem(NUDGE_KEY)==='dismissed')return;}catch{}
    if(nudgeTimer)window.clearTimeout(nudgeTimer);
    nudgeTimer=window.setTimeout(()=>{
      nudgeTimer=0;
      if(panel.hidden&&!document.hidden)nudge.hidden=false;
      else if(panel.hidden)scheduleNudge();
    },8000);
  }

  function updateViewportState() {
    if (!window.visualViewport) return;
    const viewportHeight = Math.round(window.visualViewport.height);
    root.style.setProperty('--tm-ai-visual-height', `${viewportHeight}px`);
    root.classList.toggle('has-keyboard', mobileQuery.matches && window.innerHeight - viewportHeight > 150);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[char]));
  }

  function textToHtml(answer) {
    const parts = Array.isArray(answer) ? answer : String(answer || '').split(/\n+/).filter(Boolean);
    return parts.map((part, index) => {
      const text = escapeHtml(part);
      if (index === 0 && /:$/.test(part)) return `<p><b>${text}</b></p>`;
      return `<p>${text}</p>`;
    }).join('');
  }

  function addMessage(type, html, options = {}) {
    const item = document.createElement('article');
    item.className = `tm-ai-msg tm-ai-msg--${type}`;
    item.innerHTML = html;
    messages.appendChild(item);
    if (options.scroll !== false) messages.scrollTop = messages.scrollHeight;
    queueMicrotask(saveCommerceSession);
    return item;
  }
  function attachFeedback(item,question='',answer=''){
    if(!item||item.querySelector('[data-ai-feedback]'))return;
    const footer=document.createElement('footer');footer.className='tm-ai-msg__feedback';footer.setAttribute('data-ai-feedback','');footer.innerHTML='<span>Pomohla odpoveď?</span><button type="button" data-ai-vote="up" aria-label="Odpoveď pomohla">👍</button><button type="button" data-ai-vote="down" aria-label="Odpoveď nepomohla">👎</button>';
    footer.addEventListener('click',event=>{const button=event.target.closest('[data-ai-vote]');if(!button||footer.dataset.voted)return;footer.dataset.voted=button.dataset.aiVote;footer.querySelectorAll('button').forEach(x=>x.disabled=true);footer.querySelector('span').textContent='Ďakujeme za hodnotenie.';trackEvent('feedback',{vote:button.dataset.aiVote,question:String(question).slice(0,300),answer:String(answer).slice(0,500)});});
    item.appendChild(footer);
  }
  function appendSources(item,sources){
    if(!item||!Array.isArray(sources)||!sources.length)return;
    const box=document.createElement('div');box.className='tm-ai-msg__sources';box.innerHTML=`<b>Priame odkazy:</b> ${sources.slice(0,3).map(source=>`<a href="${escapeHtml(source.url||'/faq')}" data-ai-source>${escapeHtml(source.label||'Viac informácií')}</a>`).join(' · ')}`;item.appendChild(box);
  }
  if(saved.uiMessages){
    messages.innerHTML=saved.uiMessages;
    state.started=true;
    root.classList.add('is-started');
    home.hidden=true;
    back.hidden=false;
    setExperience(state.mode==='shop'||state.cart.length?'shop':'advice');
  }
  function openHandoff(question='',reason='customer_request'){
    if(!handoff)return;
    handoff.hidden=false;handoff.classList.remove('is-success');handoff.dataset.reason=reason;
    const generic=/\b(clovek|človek|operator|pracovnik|pracovník|kontaktujte ma|hovorit s|hovoriť s)\b/i.test(question);
    if(handoffQuestion)handoffQuestion.value=generic?'':question;
    if(handoffStatus)handoffStatus.textContent=reason==='unanswered'?'AI Tomáš si nie je odpoveďou istý. Otázku môžete odovzdať pracovníkovi.':'Doplňte kontakt a otázku pre pracovníka.';
    requestAnimationFrame(()=>handoff.scrollIntoView({behavior:'smooth',block:'center'}));
    autoPanelSize('checkout');trackEvent('handoff_open',{reason});
  }

  function formatPrice(product) {
    const price = Number(product.price || 0);
    if (!Number.isFinite(price) || price <= 0) return '';
    return price.toLocaleString('sk-SK', { style: 'currency', currency: 'EUR' });
  }

  function isAiInStock(product) {
    const status=String(product?.stock_status||'').toLowerCase();
    return product?.purchasable!==false && status!=='outofstock' && Number(product?.stock_quantity??1)!==0;
  }
  function dispatchSentence() {
    const live=document.querySelector('[data-tm-dispatch-message]')?.textContent?.trim();
    const text=live||'Expedujeme najbližší pracovný deň';
    return text.charAt(0).toLowerCase()+text.slice(1).replace(/[.]$/,'');
  }
  function aiStockLabel(product) {
    if(!isAiInStock(product)) return 'Nie je skladom';
    const qty=Number(product?.stock_quantity);
    return Number.isFinite(qty)&&qty>0?`Skladom ${qty} ks`:'Skladom';
  }
  function slovakCount(count,one,few,many){
    const n=Math.abs(Number(count)||0),last=n%10,lastTwo=n%100;
    if(n===1)return one;
    if(last>=2&&last<=4&&!(lastTwo>=12&&lastTwo<=14))return few;
    return many;
  }
  function suitableProductsText(count){return `${count} ${slovakCount(count,'vhodný produkt','vhodné produkty','vhodných produktov')}`;}
  function unavailableProductsText(count){return count===1?'1 ďalší produkt, ktorý nie je skladom':`${count} ${slovakCount(count,'ďalší produkt','ďalšie produkty','ďalších produktov')}, ktoré nie sú skladom`;}

  function productPayload(product) {
    return {
      id: product.id || '',
      sku: product.sku || '',
      name: product.name || 'Produkt',
      price: Number(product.price || 0),
      image: product.image || '',
      url: product.url || `/produkty?s=${encodeURIComponent(product.sku || product.name || '')}`,
      slug: product.slug || '',
      product_type_key: product.product_type_key || 'product',
      product_type_label: product.product_type_label || 'PRODUKT',
      color: product.color || '',
      capacity: product.capacity || '',
      warranty: product.warranty || '24 mesiacov',
      stock_status: product.stock_status || 'instock',
      stock_quantity: product.stock_quantity || null,
      stock_text: product.stock_text || '',
      source: product.source || '',
    };
  }

  function renderProductCard(product) {
    const name = escapeHtml(product.name || 'Produkt');
    const sku = escapeHtml(product.sku || '');
    const type = escapeHtml(product.product_type_label || product.type || '');
    const capacity = escapeHtml(product.capacity || '');
    const url = escapeHtml(product.url || `/produkty?s=${encodeURIComponent(product.sku || product.name || '')}`);
    const price = escapeHtml(formatPrice(product));
    const payload = escapeHtml(JSON.stringify(productPayload(product)));

    return `
      <article class="tm-ai-product">
        <strong>${name}</strong>
        <div class="tm-ai-product__meta">
          ${sku ? `<span>${sku}</span>` : ''}
          ${type ? `<span>${type}</span>` : ''}
          ${capacity ? `<span>${capacity}</span>` : ''}
        </div>
        ${price ? `<div class="tm-ai-product__price">${price}</div>` : ''}
        <div class="tm-ai-product__actions">
          <a href="${url}">Otvoriť</a>
          <button type="button" data-ai-add-to-cart="${payload}">Do košíka</button>
        </div>
      </article>`;
  }

  function groupTitle(group) {
    const count = Number(group.count || 0);
    return `${escapeHtml(group.label || 'produkty')} (${count})`;
  }

  function renderGroups(groups) {
    if (!Array.isArray(groups) || !groups.length) return '';

    return `
      <div class="tm-ai-groups">
        ${groups.map((group, index) => `
          <details class="tm-ai-group" ${index === 0 ? 'open' : ''}>
            <summary>${groupTitle(group)}</summary>
            <div class="tm-ai-product-list">
              ${(group.products || []).map(renderProductCard).join('')}
            </div>
          </details>
        `).join('')}
      </div>`;
  }

  function addToCart(product) {
    if (window.ToneryMaximCart && typeof window.ToneryMaximCart.addToCart === 'function') {
      window.ToneryMaximCart.addToCart({ ...product, qty: 1 });
      if (typeof window.ToneryMaximCart.showAddCartDrawer === 'function') {
        window.ToneryMaximCart.showAddCartDrawer({ ...product, qty: 1 });
      }
      return true;
    }

    const event = new CustomEvent('tm:add-to-cart', { detail: { ...product, qty: 1 } });
    window.dispatchEvent(event);

    try {
      const key = 'tm_cart_v1';
      const current = JSON.parse(localStorage.getItem(key) || '[]');
      const existing = current.find((item) => item.sku && product.sku && item.sku === product.sku);
      if (existing) existing.qty = Number(existing.qty || 1) + 1;
      else current.push({ ...product, qty: 1 });
      localStorage.setItem(key, JSON.stringify(current));
      window.dispatchEvent(new Event('storage'));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function askAssistant(question) {
    state.mode='advice';setExperience('advice');
    beginSession();
    if (!question || state.busy) return;
    state.busy = true;
    state.lastQuestion = question;
    if (handoff) handoff.hidden = true;

    addMessage('user', `<p>${escapeHtml(question)}</p>`);
    const requestHistory = state.history.slice(-12);
    const loading = addMessage('bot', '<p>Hľadám odpoveď…</p>');

    try {
      const response = await fetch('/api/ai-sales-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, page: location.pathname, history: requestHistory }),
      });

      const data = await response.json();
      loading.innerHTML = `${textToHtml(data.answer || 'Nenašiel som presnú odpoveď.')}${renderGroups(data.groups)}`;
      appendSources(loading,data.sources);
      state.history.push({ role: 'user', content: question });
      state.history.push({ role: 'assistant', content: Array.isArray(data.answer) ? data.answer.join(' ') : String(data.answer || '') });
      if (state.history.length > 20) state.history = state.history.slice(-20);
      saveCommerceSession();
      if (handoff && data.handoffSuggested === true) {
        openHandoff(question,data.unanswered===true?'unanswered':'customer_request');
      }
      // Po doručení odpovede ju vždy ukážeme od začiatku. Pri dlhej ponuke
      // sa tak odpoveď neschová pod horným okrajom chatu ani pod vstupným poľom.
      requestAnimationFrame(() => {
        const targetTop = Math.max(0, loading.offsetTop - 8);
        messages.scrollTo({ top: targetTop, behavior: 'smooth' });
      });
    } catch (error) {
      loading.innerHTML = '<p>Teraz sa mi nepodarilo odpovedať. Skúste napísať model tlačiarne alebo toneru presnejšie.</p>';
      requestAnimationFrame(() => messages.scrollTo({ top: Math.max(0, loading.offsetTop - 8), behavior: 'smooth' }));
    } finally {
      state.busy = false;
    }
  }

  toggle.addEventListener('click', openPanel);
  close.addEventListener('click', () => closePanel({ restoreFocus: true }));

  root.addEventListener('click', (event) => {
    if (mobileQuery.matches && event.target === root && !panel.hidden) closePanel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closePanel({ restoreFocus: true });
  });

  window.addEventListener('tm:cookie-panel', (event) => {
    if (event.detail?.open && !panel.hidden) closePanel();
  });

  window.visualViewport?.addEventListener('resize', updateViewportState);
  window.visualViewport?.addEventListener('scroll', updateViewportState);
  updateViewportState();



  const money = (n) => Number(n || 0).toLocaleString('sk-SK',{style:'currency',currency:'EUR'});
  const isCalendarProduct = p => String(p?.source||'')==='kalendare-2027' || String(p?.product_type_key||'').toLowerCase()==='calendar';
  const discount = (p,q) => isCalendarProduct(p) ? (q>=21?15:(q>=3?5:0)) : String(p?.type || p?.product_type_key || '').toLowerCase()==='compatible' ? (q>=4?25:(q>=2?10:0)) : 0;
  const unitPrice = (p,q) => Number(p?.price||0)*(1-discount(p,q)/100);
  const linePrice = (p,q) => unitPrice(p,q)*q;
  const cartKey = p => String(p?.sku || p?.id || p?.name || '').trim().toLowerCase();
  const WEB_CART_KEY = 'tm_cart_v1';
  const cleanCartQty = value => Math.max(1,Math.min(99,parseInt(value,10)||1));
  function webCartProduct(product,qty){
    return {id:String(product?.id||product?.sku||product?.name||''),productId:String(product?.id||''),product_id:String(product?.id||''),sku:String(product?.sku||''),name:String(product?.name||'Produkt'),price:Number(product?.price||0),qty:cleanCartQty(qty),image:String(product?.image||''),url:String(product?.url||product?.detail_url||''),slug:String(product?.slug||''),color:String(product?.color||product?.farba||''),capacity:product?.capacity||product?.yield||product?.page_yield||'',stock_status:String(product?.stock_status||'instock'),stock_quantity:product?.stock_quantity??null,stock_text:String(product?.stock_text||''),product_type_key:String(product?.product_type_key||product?.productTypeKey||product?.type||''),product_type_label:String(product?.product_type_label||product?.productTypeLabel||''),source:String(product?.source||''),loyalty_reward:isPaperRewardCartItem(product)};
  }
  function readWebCart(){
    try{const value=JSON.parse(localStorage.getItem(WEB_CART_KEY)||'[]');return collapsePaperRewardCart(Array.isArray(value)?value:[]);}catch{return[];}
  }
  function hydrateSharedCart(){
    state.cart=readWebCart().map(item=>({product:{...item,id:item.productId||item.product_id||item.id||item.sku},qty:cleanCartQty(item.qty)}));
  }
  function syncSharedCart(){
    const cart=collapsePaperRewardCart(state.cart.map(({product,qty})=>webCartProduct(product,qty)));
    try{
      if(window.ToneryMaximCart&&typeof window.ToneryMaximCart.saveCart==='function')window.ToneryMaximCart.saveCart(cart);
      else localStorage.setItem(WEB_CART_KEY,JSON.stringify(cart));
      const count=cart.reduce((sum,item)=>sum+cleanCartQty(item.qty),0);
      document.querySelectorAll('[data-cart-count]').forEach(el=>{el.textContent=String(count);});
      window.dispatchEvent(new CustomEvent('tm:cart-synced',{detail:{cart,count,source:'ai-tomas'}}));
    }catch(error){console.error('[AI Tomas cart sync]',error);}
  }
  hydrateSharedCart();
  window.addEventListener('tm:cart-synced',event=>{
    if(event.detail?.source!=='storefront'||!Array.isArray(event.detail.cart))return;
    state.cart=event.detail.cart.map(item=>({product:{...item,id:item.productId||item.product_id||item.id||item.sku},qty:cleanCartQty(item.qty)}));
    const count=state.cart.reduce((sum,item)=>sum+item.qty,0);
    if(liveCart){liveCart.hidden=count===0;root.querySelector('[data-ai-cart-count]').textContent=`${count} ks`;root.querySelector('[data-ai-cart-total]').textContent=`· ${money(cartTotal())}`;}
    if(topCart){topCart.hidden=count===0;topCartCount.textContent=`${count} ks`;topCartTotal.textContent=`· ${money(cartTotal())}`;}
    saveCommerceSession();
  });
  function cartTotal(){ return state.cart.reduce((n,x)=>n+linePrice(x.product,x.qty),0); }
  function updateLiveCart(){
    if(!liveCart) return; const count=state.cart.reduce((n,x)=>n+x.qty,0);
    liveCart.hidden=count===0; root.querySelector('[data-ai-cart-count]').textContent=`${count} ks`;
    root.querySelector('[data-ai-cart-total]').textContent=`· ${money(cartTotal())}`;
    if(topCart){ topCart.hidden=count===0; topCartCount.textContent=`${count} ks`; topCartTotal.textContent=`· ${money(cartTotal())}`; }
    syncSharedCart();saveCommerceSession();
  }
  function addCommerceItem(product,qty=1){ if(isPaperRewardCartItem(product))return;const k=cartKey(product),x=state.cart.find(i=>cartKey(i.product)===k&&!isPaperRewardCartItem(i.product));if(x)x.qty+=qty;else state.cart.push({product,qty}); updateLiveCart(); }
  function askNextStep(){
    setProgress(2);
    const count=state.cart.reduce((n,x)=>n+x.qty,0);
    const a=addMessage('bot',`<div class="tm-ai-next-step"><p><b>Nákup má ${count} ks. Čo chcete urobiť ďalej?</b></p><div><button type="button" data-ai-next-more>＋ Pridať ďalší produkt</button><button type="button" class="primary" data-ai-next-review>Skontrolovať nákup →</button></div></div>`);
    a.querySelector('[data-ai-next-more]').onclick=()=>{setProgress(1);state.mode='shop';input.value='';input.placeholder='Napíšte ďalší produkt alebo model tlačiarne…';input.focus();};
    a.querySelector('[data-ai-next-review]').onclick=renderCart;
  }
  function renderTypeQuestion(action){
    const labels={compatible:'Kompatibilné',original:'Originálne',renovated:'Renovované'};
    const options=Array.isArray(action?.options)?action.options:[];
    if(!options.length)return;
    const counts=action?.counts&&typeof action.counts==='object'?action.counts:{};
    const material=escapeHtml(action?.material||'produkty');
    const reason={compatible:'Najlepší pomer ceny a výťažnosti. Rovnaká kompatibilita s uvedenou tlačiarňou.',original:'Originálna náplň výrobcu tlačiarne.',renovated:'Repasovaná originálna kazeta – ekologickejšia voľba.'};
    const cards=options.map(type=>`<article class="tm-ai-type-card is-${type}">${type==='compatible'?'<em>Odporúčame – najvýhodnejší</em>':''}<b>${labels[type]||type}</b><small>${Number(counts[type]||0)} ${material} skladom</small><p>${reason[type]||''}</p>${type==='compatible'?'<p class="tm-ai-type-card__saving">Pri 2 ks zľava 10 % · pri 4 ks zľava 25 %</p>':''}<button type="button" data-ai-type-more="${type}">Zobraziť ponuku</button></article>`).join('');
    const a=addMessage('bot',`<div class="tm-ai-type-compare"><div class="tm-ai-guided-title"><b>Najprv vyberte typ</b><span>Potom zobrazím všetky vhodné farby, kapacity a sady.</span></div><div class="tm-ai-type-grid">${cards}</div></div>`);
    a.querySelectorAll('[data-ai-type-more]').forEach(b=>b.onclick=()=>unifiedAsk(labels[b.dataset.aiTypeMore]));
  }
  function openCommerceStage(html,step=2){autoPanelSize('products');setExperience('shop');setProgress(step);messages.hidden=true;form.hidden=true;if(quick)quick.hidden=true;commerce.hidden=false;commerce.classList.add('is-focus-stage');commerce.innerHTML=html;commerce.scrollTop=0;}
  function commerceBack(){ commerce.hidden=true;commerce.classList.remove('is-focus-stage');messages.hidden=false;form.hidden=false;setProgress(1);if(quick)quick.hidden=state.mode!=='advice';messages.scrollTop=messages.scrollHeight;saveCommerceSession(); }
  function goBack(){
    if(!commerce.hidden){ commerceBack(); return; }
    const lastStep=messages.querySelector('.tm-ai-purchase-step:last-child');
    if(lastStep){ lastStep.closest('.tm-ai-msg')?.remove(); messages.scrollTop=messages.scrollHeight; setProgress(1); return; }
    state.started=false;root.classList.remove('is-started');home.hidden=false;messages.querySelectorAll('.tm-ai-msg:not(.tm-ai-msg--welcome)').forEach(x=>x.remove());quick.hidden=true;back.hidden=true;setProgress(1);
  }
  function renderCart(){
    autoPanelSize('cart');
    setExperience('shop');
    setProgress(3);
    messages.hidden=true; form.hidden=true; if(quick)quick.hidden=true; commerce.hidden=false;commerce.classList.add('is-focus-stage');
    commerce.innerHTML=`<div class="tm-ai-commerce__head"><button class="tm-ai-back" data-c-back>← Späť k ponuke</button><div><b>Váš nákup</b><small>${state.cart.reduce((n,x)=>n+x.qty,0)} ks</small></div></div>${state.cart.length?`<div class="tm-ai-cart-list">${state.cart.map((x,i)=>{const reward=isPaperRewardCartItem(x.product),offer=nextQuantityOffer(x.product,x.qty);return`<div class="tm-ai-cart-item"><div><strong>${escapeHtml(x.product.name)}</strong><small>${escapeHtml(x.product.sku||'')}${reward?' · automatická vernostná odmena':discount(x.product,x.qty)?` · zľava ${discount(x.product,x.qty)} %`:''}</small></div><b>${money(linePrice(x.product,x.qty))}</b><div class="tm-ai-cart-controls">${reward?`<strong>${x.qty} ks</strong>`:`<button aria-label="Znížiť množstvo" data-c-minus="${i}">−</button><strong>${x.qty} ks</strong><button aria-label="Zvýšiť množstvo" data-c-plus="${i}">+</button><button class="remove" data-c-remove="${i}">Odstrániť</button>`}</div>${!reward&&offer?`<button class="tm-ai-offer" data-c-offer="${i}" data-q="${offer.quantity}">💡 Výhodnejšie: ${offer.label} · ${money(unitPrice(x.product,offer.quantity))}/ks</button>`:''}</div>`}).join('')}</div><div class="tm-ai-cart-total"><span>Spolu za tovar</span><b>${money(cartTotal())}</b></div><div class="tm-ai-commerce__actions tm-ai-cart-actions"><button class="primary" data-c-checkout>Pokračovať v rýchlom nákupe →</button><button class="secondary" data-c-web>Dokončiť objednávku na webe</button><button class="secondary" data-c-more>＋ Pridať ďalší produkt</button></div><p class="tm-ai-cart-note">Môžete pokračovať s AI alebo prejsť do bežného košíka. Položky aj množstvá zostanú rovnaké.</p>`:'<div class="tm-ai-empty-cart"><b>Váš nákup je zatiaľ prázdny.</b><button class="primary" data-c-more>Nájsť toner</button></div>'}`;
    commerce.scrollTop=0;
    commerce.querySelector('[data-c-back]')?.addEventListener('click',commerceBack); commerce.querySelector('[data-c-more]')?.addEventListener('click',()=>{commerceBack();state.mode='shop';input.focus()});
    commerce.querySelectorAll('[data-c-minus]').forEach(b=>b.onclick=()=>{const i=+b.dataset.cMinus;state.cart[i].qty=Math.max(1,state.cart[i].qty-1);updateLiveCart();renderCart()});
    commerce.querySelectorAll('[data-c-plus]').forEach(b=>b.onclick=()=>{state.cart[+b.dataset.cPlus].qty++;updateLiveCart();renderCart()});
    commerce.querySelectorAll('[data-c-remove]').forEach(b=>b.onclick=()=>{state.cart.splice(+b.dataset.cRemove,1);updateLiveCart();renderCart()});
    commerce.querySelectorAll('[data-c-offer]').forEach(b=>b.onclick=()=>{state.cart[+b.dataset.cOffer].qty=+b.dataset.q;updateLiveCart();renderCart()});
    commerce.querySelector('[data-c-checkout]')?.addEventListener('click',prepareHandoff);
    commerce.querySelector('[data-c-web]')?.addEventListener('click',()=>{syncSharedCart();saveCommerceSession();closePanel();location.href='/kosik';});
  }
  function nextQuantityOffer(product,qty){
    if(isCalendarProduct(product)){
      if(qty<3)return{quantity:3,label:'3 ks so zľavou 5 %'};
      if(qty<21)return{quantity:21,label:'21 ks so zľavou 15 %'};
      return null;
    }
    if(aiType(product)==='compatible'){
      if(qty<2)return{quantity:2,label:'2 ks so zľavou 10 %'};
      if(qty<4)return{quantity:4,label:'4 ks so zľavou 25 %'};
    }
    return null;
  }
  function quantityChooser(product){
    const calendar=isCalendarProduct(product),compatible=aiType(product)==='compatible',discounted=calendar||compatible;
    const capacity=parseCapacity(product),per100=capacity&&Number(product.price)>0?Number(product.price)/capacity*100:0;
    const quantities=calendar?[1,3,21]:[1,2,3,4];
    const chooser=discounted?`<p>Vyberte množstvo a využite zľavu:</p><div class="tm-ai-qty-grid">${quantities.map(q=>`<button type="button" data-ai-q="${q}" ${q===(calendar?21:4)?'class="best"':''}><b>${q} ks</b><span>${money(unitPrice(product,q))}/ks</span>${discount(product,q)?`<em>−${discount(product,q)} %</em>`:''}</button>`).join('')}</div>`:`<div class="tm-ai-simple-qty"><label>Koľko kusov chcete kúpiť?<input type="number" min="1" max="99" value="1" data-ai-simple-qty></label><button type="button" data-ai-simple-add>Pridať do nákupu</button></div>`;
    openCommerceStage(`<div class="tm-ai-commerce__head"><button data-ai-q-back>← Späť na ponuku</button><b>Vyberte množstvo</b></div><div class="tm-ai-purchase-step"><div class="tm-ai-selected-product"><div><p><b>${escapeHtml(product.name)}</b></p><small>${escapeHtml(product.sku||'')}</small></div><strong>${money(product.price)}</strong></div>${capacity?`<p class="tm-ai-cost-note">Kapacita ${capacity.toLocaleString('sk-SK')} strán · <b>${costPerPageText(product)}</b></p>`:''}${chooser}</div>`,2);
    commerce.querySelector('[data-ai-q-back]').onclick=commerceBack;
    commerce.querySelectorAll('[data-ai-q]').forEach(b=>b.onclick=()=>{const q=+b.dataset.aiQ;state.commerceState.pendingQuestion=null;addCommerceItem(product,q);renderCart();});
    commerce.querySelector('[data-ai-simple-add]')?.addEventListener('click',()=>{const q=Math.max(1,Math.min(99,Number(commerce.querySelector('[data-ai-simple-qty]')?.value||1)));state.commerceState.pendingQuestion=null;addCommerceItem(product,q);renderCart();});
  }
  function setChooser(set){
    const compatible=set.type==='compatible';
    const ink=isInkOffer(set.products),items=ink?'náplní':'tonerov',discountTarget=ink?'každú kompatibilnú náplň':'každý kompatibilný toner';
    const option=(q)=>{const rate=compatible?(q>=4?25:q>=2?10:0):0,base=Number(set.totalPrice||set.products.reduce((n,p)=>n+Number(p.price||0),0)),per=base*(1-rate/100);return `<button type="button" data-ai-set-q="${q}" ${q===4&&compatible?'class="best"':''}><b>${q} ${q===1?'sada':'sady'}</b><span>${q*4} ${items} · ${money(per)}/sada</span><small>Spolu ${money(per*q)}</small>${rate?`<em>−${rate} %</em>`:''}</button>`};
    openCommerceStage(`<div class="tm-ai-commerce__head"><button data-ai-q-back>← Späť na ponuku</button><b>Vyberte množstvo sád</b></div><div class="tm-ai-purchase-step"><p><b>${escapeHtml(set.label||`Sada 4 ${items}`)}</b></p>${compatible?`<p class="tm-ai-cost-note">Zľava na ${discountTarget}: 2–3 sady −10 %, 4 a viac sád −25 %.</p>`:''}<div class="tm-ai-qty-grid">${[1,2,3,4].map(option).join('')}</div></div>`,2);
    commerce.querySelector('[data-ai-q-back]').onclick=commerceBack;
    commerce.querySelectorAll('[data-ai-set-q]').forEach(b=>b.onclick=()=>{const q=Number(b.dataset.aiSetQ);state.commerceState.pendingQuestion=null;set.products.forEach(p=>addCommerceItem(p,q));renderCart();});
  }
  function renderCommerceResults(data){
    autoPanelSize('products');trackEvent('product_results',{count:Array.isArray(data?.products)?data.products.length:0,query:state.lastQuestion});
    const all=allowedAiProducts(Array.isArray(data?.products)?data.products:[]);
    if(!all.length){ addMessage('bot','<p>Nenašiel som vhodný produkt. Skúste presný kód toneru alebo model tlačiarne.</p>'); return; }
    const available=all.filter(isAiInStock), unavailable=all.filter(p=>!isAiInStock(p));
    const query=escapeHtml(state.lastQuestion||'túto tlačiareň');
    addMessage('bot',`<div class="tm-ai-offer-summary"><b>Overil som aktuálnu ponuku pre ${query}.</b><p>${available.length?`Na sklade máme <strong>${suitableProductsText(available.length)}</strong> a ${dispatchSentence()}.`:'Momentálne nemáme vhodný produkt skladom.'}${unavailable.length?` V ponuke máme aj <strong>${unavailableProductsText(unavailable.length)}</strong>; ich dostupnosť vám vieme zistiť.`:''}</p><div class="tm-ai-summary-actions"><a href="${escapeHtml(webResultsUrl(all))}">Zobraziť všetky na webe</a></div></div>`,{scroll:false});
    const colorPrinter=Boolean(data?.presentation?.isColorPrinter) || [...new Set(all.map(aiColor).filter(Boolean))].length>=3;
    if(colorPrinter){
      const sets=Array.isArray(data?.presentation?.sets)?data.presentation.sets.filter(set=>Array.isArray(set.products)&&set.products.length===4):[];
      const typeOrder=['compatible','original','renovated'],colorOrder=['black','cyan','magenta','yellow'];
      const singleGroups=typeOrder.map(type=>({type,products:available.filter(p=>aiType(p)===type&&aiColor(p)).sort((a,b)=>Number(isHighCapacity(a))-Number(isHighCapacity(b))||colorOrder.indexOf(aiColor(a))-colorOrder.indexOf(aiColor(b))||Number(a.price)-Number(b.price))})).filter(group=>group.products.length);
      const singles=singleGroups.flatMap(group=>group.products);
      state.offerSets=sets;state.offerSingles=singles;saveCommerceSession();
      if(sets.length||singleGroups.length){
        const labels={compatible:'Kompatibilná sada',original:'Originálna sada',renovated:'Renovovaná sada'};
        const recommended=sets.find(s=>s.type==='compatible'&&s.capacityVariant==='high')||sets.find(s=>s.type==='compatible')||null;
        const indexedSets=sets.map((set,index)=>({set,index}));
        const setCardsByType=new Map(typeOrder.map(type=>{
          const cards=indexedSets.filter(item=>item.set.type===type).map(({set,index:i})=>{
            const compatible=set.type==='compatible';
            const capacities=set.products.map(parseCapacity).filter(Boolean);
            const minCapacity=capacities.length?Math.min(...capacities):0;
            const setPage=minCapacity?Number(set.totalPrice)/minCapacity:0;
            const itemLabel=isInkOffer(set.products)?'náplne':'tonery';
            return `<article class="tm-ai-set-card is-${set.type}${set===recommended?' is-recommended':''}">${set===recommended?'<span class="tm-ai-recommend-badge">Odporúčame – najlepší pomer cena/strana</span>':''}<div class="tm-ai-set-card__head"><div><b>${escapeHtml(set.label||labels[set.type])}</b><small>4 ${itemLabel}: BK + C + M + Y · skladom${setPage?` · ${setPage.toLocaleString('sk-SK',{minimumFractionDigits:4,maximumFractionDigits:4})} €/farebná strana`:''}</small></div><strong>${money(set.totalPrice)}</strong></div><div class="tm-ai-set-toners">${set.products.map(p=>`<span>${aiImage(p)?`<img src="${escapeHtml(aiImage(p))}" alt="${escapeHtml(p.name)}" loading="lazy">`:''}<span><b>${escapeHtml(aiColorLabel(aiColor(p)).split(' / ')[0])}</b><small>${escapeHtml(p.name||p.sku||(isInkOffer([p])?'Náplň':'Toner'))}</small><em>${aiStockLabel(p)}${costPerPage(p)?` · ${costPerPageText(p)}`:''}</em></span></span>`).join('')}</div>${compatible?'<p class="tm-ai-set-discount">Zľava na každú farbu v sade: 2–3 sady −10 % · 4 a viac sád −25 %</p>':''}<div class="tm-ai-set-actions"><button type="button" data-ai-set="${i}">⚡ Rýchly nákup s AI</button><a href="${escapeHtml(webResultsUrl(set.products))}">Zobraziť na webe</a></div></article>`;
          }).join('');
          return [type,cards];
        }));
        let singleIndex=0;
        const singleSectionsByType=new Map(typeOrder.map(type=>[type,'']));
        singleGroups.forEach(group=>{const cards=group.products.map(p=>{const i=singleIndex++,cpp=costPerPage(p);return `<article class="tm-ai-single-color">${aiImage(p)?`<img src="${escapeHtml(aiImage(p))}" alt="${escapeHtml(p.name)}" loading="lazy">`:''}<span><b>${escapeHtml(p.name||'')}</b><small>${aiColorLabel(aiColor(p))}${isHighCapacity(p)?' · vysoká kapacita':''}</small><small>${escapeHtml(p.sku||'')}</small><em class="is-stock">${aiStockLabel(p)}</em><strong>${money(p.price)}</strong>${cpp?`<mark>${costPerPageText(p)}</mark>`:''}</span><div><button type="button" data-ai-single="${i}">⚡ Rýchly nákup s AI</button><a href="${escapeHtml(p.url||webResultsUrl([p]))}">Zobraziť na webe</a></div></article>`}).join('');singleSectionsByType.set(group.type,`<section class="tm-ai-single-type is-${group.type}"><h4>${group.type==='compatible'?'<span class="tm-ai-recommend-badge">Odporúčame – najlepší pomer cena/strana</span>':''}<span>Jednotlivé ${group.type==='compatible'?'kompatibilné':group.type==='original'?'originálne':'renovované'} tonery skladom</span></h4><div class="tm-ai-single-grid">${cards}</div></section>`)});
        const offerSections=typeOrder.map(type=>{const setCards=setCardsByType.get(type)||'',singleSection=singleSectionsByType.get(type)||'';if(!setCards&&!singleSection)return'';const typeLabel=type==='compatible'?'Kompatibilné možnosti':type==='original'?'Originálne možnosti':'Renovované možnosti';return `<section class="tm-ai-offer-section is-${type}"><h4>${typeLabel}</h4>${setCards?`<div class="tm-ai-set-list">${setCards}</div>`:''}${singleSection}</section>`}).join('');
        const unavailableCards=unavailable.slice(0,4).map((p,i)=>productOfferCard(p,i,true)).join('');
        const box=addMessage('bot',`<div class="tm-ai-color-offer tm-ai-guided-offer"><div class="tm-ai-guided-title"><b>Vyberte spôsob nákupu</b><span>Najskôr zobrazujeme kompatibilné, potom originálne a renovované možnosti.</span></div>${offerSections}${unavailableCards?`<section class="tm-ai-offer-section is-unavailable"><h4>V ponuke, momentálne nie je skladom</h4><div class="tm-ai-shop-products">${unavailableCards}</div></section>`:''}<div class="tm-ai-discovery__footer"><a href="${escapeHtml(webResultsUrl(all))}">Zobraziť kompletnú ponuku na webe →</a></div></div>`);
        wireAvailability(box,unavailable.slice(0,4));
        return;
      }
      const black=all.filter(p=>aiColor(p)==='black');
      if(black.length){ renderSafeProducts(black,'Kompletná sada 4 tonerov momentálne nie je dostupná. Možnosti pre BK / čiernu:',all); return; }
    }
    renderSafeProducts(all,'Našiel som tieto možnosti:',all);
  }

  function productOfferCard(p,index,unavailable=false){
    const img=aiImage(p),color=aiColor(p),type=aiType(p),href=aiText(p?.url)||`/produkty?s=${encodeURIComponent(aiText(p?.sku)||aiText(p?.name))}`;
    return `<article class="tm-ai-product-card is-${type}${unavailable?' is-unavailable':''}">${img?`<div class="tm-ai-card-image"><img src="${escapeHtml(img)}" alt="${escapeHtml(aiText(p?.name))}" loading="lazy"></div>`:''}<div class="tm-ai-card-content"><div class="tm-ai-card-badges"><span class="tm-ai-product-kind">${aiTypeLabel(p)}</span>${color?`<span class="tm-ai-color-badge">${aiColorLabel(color)}</span>`:''}</div><strong>${escapeHtml(aiText(p?.name)||'Toner')}</strong><small>${escapeHtml(aiText(p?.sku))}</small><em class="${unavailable?'is-out':'is-stock'}">${aiStockLabel(p)}</em><b>${money(Number(p?.price||0))}</b><div class="tm-ai-card-actions">${unavailable?`<button type="button" data-ai-availability="${index}">Zistiť dostupnosť</button>`:`<button type="button" data-ai-buy="${index}">⚡ Rýchly nákup s AI</button>`}<a href="${escapeHtml(href)}">Zobraziť na webe</a></div></div></article>`;
  }
  function wireAvailability(box,products){
    box.querySelectorAll('[data-ai-availability]').forEach(btn=>btn.onclick=()=>{const p=products[Number(btn.dataset.aiAvailability)];openHandoff(`Prosím zistite dostupnosť produktu ${p?.name||''} (${p?.sku||''}).`,'product_availability');});
  }

  function renderSafeProducts(products,title,allProducts=products){
    const list=Array.isArray(products)?products.filter(Boolean):[];
    if(!list.length){ addMessage('bot','<p>Pre túto voľbu momentálne nemám vhodný toner.</p>'); return; }
    const chosen=[];
    ['compatible','original','renovated'].forEach(t=>{const p=list.find(x=>aiType(x)===t);if(p)chosen.push(p)});
    for(const p of list){if(chosen.length>=3)break;if(!chosen.includes(p))chosen.push(p)}
    const inStock=chosen.filter(isAiInStock),out=chosen.filter(p=>!isAiInStock(p));
    const ordered=[...inStock,...out];
    const cards=ordered.slice(0,6).map((p,i)=>productOfferCard(p,i,!isAiInStock(p))).join('');
    const colors=['cyan','magenta','yellow'].filter(c=>allProducts.some(p=>aiColor(p)===c));
    const box=addMessage('bot',`<div class="tm-ai-discovery"><p><b>${escapeHtml(title)}</b></p><div class="tm-ai-shop-products">${cards}</div>${colors.length?`<div class="tm-ai-other-colors"><b>Ostatné farby:</b>${colors.map(c=>`<button type="button" data-ai-more-color="${c}">${aiColorLabel(c)}</button>`).join('')}</div>`:''}<div class="tm-ai-discovery__footer"><a href="${webResultsUrl(allProducts)}">Zobraziť kompletnú ponuku na webe →</a><small><b>⚡ Rýchly nákup s AI Tomášom</b></small></div></div>`);
    box.querySelectorAll('[data-ai-buy]').forEach(btn=>btn.onclick=()=>quantityChooser(ordered[Number(btn.dataset.aiBuy)]));
    wireAvailability(box,ordered);
    box.querySelectorAll('[data-ai-more-color]').forEach(btn=>btn.onclick=()=>renderSafeProducts(allProducts.filter(p=>aiColor(p)===btn.dataset.aiMoreColor),`Možnosti pre ${aiColorLabel(btn.dataset.aiMoreColor)}`,allProducts));
  }
  function isExcludedAiProduct(p){
    const raw=`${p?.name||''} ${p?.sku||''} ${p?.slug||''} ${p?.description||''} ${p?.short_description||''}`.toLowerCase();
    const text=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    return /hatona/.test(text) ||
      /bez[\s_-]*(cip|cipa|cipu)|no[\s_-]*chip/.test(text) ||
      /oem[\s_-]*(cip|cipa|cipom)|s[\s_-]*oem[\s_-]*(cip|cipom)|originaln(y|ym)[\s_-]*(cip|cipom)/.test(text);
  }
  function allowedAiProducts(products){
    return (products||[]).filter(p=>!isExcludedAiProduct(p));
  }
  function aiText(v){ return v==null?'':String(v); }
  function isInkOffer(products){return (Array.isArray(products)?products:[products]).some(p=>/atrament|\bink\b|cartridge|kazet/i.test(`${aiText(p?.name)} ${aiText(p?.product_type_label)}`));}
  function parseCapacity(p){const raw=aiText(p?.capacity);const m=raw.replace(/\s/g,'').match(/(\d{2,7})/);const n=m?Number(m[1]):0;return Number.isFinite(n)&&n>0?n:0;}
  function costPerPage(p){const capacity=parseCapacity(p),price=Number(p?.price||0);return capacity&&price>0?price/capacity:0;}
  function costPerPageText(p){const value=costPerPage(p);return value?`${value.toLocaleString('sk-SK',{minimumFractionDigits:4,maximumFractionDigits:4})} €/strana`:'';}
  function isHighCapacity(p){return /(?:CRG[- ]?\d{3}H(?:BK|C|M|Y)|vysokokapacit|high[ -]?yield)/i.test(`${p?.name||''} ${p?.sku||''}`);}
  function aiType(p){
    const t=(aiText(p?.type)+' '+aiText(p?.product_type)+' '+aiText(p?.name)).toLowerCase();
    if(/origin/.test(t)) return 'original';
    if(/renov/.test(t)) return 'renovated';
    return 'compatible';
  }
  function aiColor(p){
    const explicit=aiText(p?.color).toLowerCase();
    if(['black','cyan','magenta','yellow'].includes(explicit))return explicit;
    const raw=(aiText(p?.color)+' '+aiText(p?.colour)+' '+aiText(p?.sku)+' '+aiText(p?.name));
    const t=raw.toLowerCase();
    if (/\b(black|čier\w*|cier\w*)\b/.test(t) || /(?:^|[-_\s])bk(?:$|[-_\s])/.test(t) || /(?:crg|tn|clt|mlt|tk)[-_ ]?\d+[a-z0-9-]*bk\b/i.test(raw)) return 'black';
    if (/\b(cyan|azúr\w*|azur\w*)\b/.test(t) || /(?:crg|tn|clt|mlt|tk)[-_ ]?\d+[a-z0-9-]*c\b/i.test(raw)) return 'cyan';
    if (/\b(magenta|purpur\w*)\b/.test(t) || /(?:crg|tn|clt|mlt|tk)[-_ ]?\d+[a-z0-9-]*m\b/i.test(raw)) return 'magenta';
    if (/\b(yellow|žlt\w*|zlt\w*)\b/.test(t) || /(?:crg|tn|clt|mlt|tk)[-_ ]?\d+[a-z0-9-]*y\b/i.test(raw)) return 'yellow';
    return '';
  }
  function aiImage(p){
    const vals=[p?.image,p?.image_url,p?.imageUrl,p?.thumbnail,p?.featured_image,Array.isArray(p?.images)?p.images[0]:null];
    for(const v of vals){
      if(typeof v==='string' && v.trim()) return v;
      if(v && typeof v==='object'){ const u=v.src||v.url; if(typeof u==='string'&&u.trim()) return u; }
    }
    return '';
  }
  function aiTypeLabel(p){ if(p?.source==='kalendare-2027'||p?.product_type_key==='calendar')return p?.product_type_label||'Kalendár 2027';const t=aiType(p); return t==='original'?'Originálny':t==='renovated'?'Renovovaný':'Kompatibilný'; }
  function aiColorLabel(c){ return ({black:'BK / čierny',cyan:'C / cyan',magenta:'M / magenta',yellow:'Y / žltý'})[c]||''; }
  function productTypeLabel(p){ if(p?.source==='kalendare-2027'||p?.product_type_key==='calendar')return p?.product_type_label||'Kalendár 2027';return p.type==='original'?'Originál':p.type==='renovated'?'Renovovaný':'Kompatibilný'; }
  function pickRecommendedProducts(products){
    const order=['compatible','original','renovated']; const picked=[];
    order.forEach(type=>{const p=products.find(x=>x.type===type);if(p)picked.push(p)});
    for(const p of products){if(picked.length>=3)break;if(!picked.includes(p))picked.push(p)}
    return picked.slice(0,3);
  }
  function webResultsUrl(products){
    const p=products[0]||{}; const term=state.commerceState?.lastProductQuery||state.lastQuestion||p.sku||p.name||'';
    if(p?.source==='kalendare-2027'||p?.product_type_key==='calendar'){
      const calendarQuery=String(term).toLocaleLowerCase('sk-SK').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      if(/\b(?:diar|minidiar)\w*\b/.test(calendarQuery)){
        const sub=/\bdenn\w*\b/.test(calendarQuery)?'daily':/\btyzden\w*\b/.test(calendarQuery)?'weekly':/\bmesac\w*\b/.test(calendarQuery)?'monthly':/\bminidiar\w*\b/.test(calendarQuery)?'mini':'';
        return `/kalendare/#/?cat=${encodeURIComponent('Diáre')}${sub?`&sub=${sub}`:''}`;
      }
      return '/kalendare/';
    }
    return `/produkty?s=${encodeURIComponent(term)}`;
  }
  function renderCommerceProductList(products,title){
    products=allowedAiProducts(products);
    const recommended=pickRecommendedProducts(products);
    const a=addMessage('bot',`<div class="tm-ai-discovery"><p><b>${escapeHtml(title)}</b></p><p class="tm-ai-discovery__hint">Vybral som najprehľadnejšie možnosti. Môžete si pozrieť detail na webe alebo nechať AI Tomáša pripraviť nákup.</p><div class="tm-ai-shop-products">${recommended.map((p,i)=>`<article><span class="tm-ai-product-kind">${productTypeLabel(p)}</span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.sku||'')}</small><b class="tm-ai-card-price">${money(p.price)}</b><div class="tm-ai-card-actions"><a href="${escapeHtml(p.url||`/produkty?s=${encodeURIComponent(p.sku||p.name||'')}`)}">Detail produktu</a><button data-ai-buy="${i}">⚡ Kúpiť cez AI</button></div></article>`).join('')}</div><div class="tm-ai-discovery__footer"><a href="${webResultsUrl(products)}">Zobraziť všetky produkty na webe →</a><small><b>⚡ Rýchly nákup s AI Tomášom</b></small></div></div>`);
    a.querySelectorAll('[data-ai-buy]').forEach(b=>b.onclick=()=>quantityChooser(recommended[+b.dataset.aiBuy]));
  }
  async function shopSearch(question){
    beginSession();
    state.lastQuestion=question;
    state.mode='shop'; if(quick)quick.hidden=true; addMessage('user',`<p>${escapeHtml(question)}</p>`); const loading=addMessage('bot','<p>Hľadám vhodné produkty…</p>');
    try{
      const r=await fetch('/api/ai-commerce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:question})});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const d=await r.json();
      if(!d?.ok||!Array.isArray(d?.products)||!d.products.length){loading.innerHTML='<p>Nenašiel som bezpečný presný výsledok. Napíšte presný kód toneru alebo model tlačiarne.</p>';return}
      renderCommerceResults(d);
      loading.remove();
    }catch(err){
      console.error('[AI Tomas shopSearch]',err);
      loading.innerHTML='<p>Produkty sa teraz nepodarilo načítať. Skúste to znova.</p>';
    }
  }
  function renderGuestOrderVerification(box){
    box.innerHTML='<form class="tm-ai-order-verify" data-ai-order-verify><p><b>Bezpečné overenie objednávky</b></p><p>Zadajte údaje použité v objednávke.</p><label>Číslo objednávky<input name="orderNumber" inputmode="numeric" autocomplete="off" required maxlength="12"></label><label>E-mail<input name="email" type="email" autocomplete="email" required maxlength="160"></label><label>PSČ<input name="postcode" autocomplete="postal-code" required maxlength="20"></label><button type="submit">Overiť stav</button><small data-ai-order-error aria-live="polite"></small></form>';
    const verify=box.querySelector('[data-ai-order-verify]');
    verify?.addEventListener('submit',async event=>{event.preventDefault();const button=verify.querySelector('button'),error=verify.querySelector('[data-ai-order-error]'),formData=new FormData(verify);button.disabled=true;error.textContent='Overujem…';
      try{const r=await fetch('/api/ai-order-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderNumber:formData.get('orderNumber'),email:formData.get('email'),postcode:formData.get('postcode')})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Overenie sa nepodarilo.');const order=d.order;box.innerHTML=`<p><b>Objednávka ${escapeHtml(order.number)}</b></p><p>Stav: <b>${escapeHtml(order.statusLabel)}</b></p>${order.shipping?`<p>Doprava: ${escapeHtml(order.shipping)}</p>`:''}${order.tracking?`<p>Sledovanie zásielky: ${escapeHtml(order.tracking)}</p>`:''}`;}
      catch(err){error.textContent=err?.message||'Overenie sa nepodarilo.';button.disabled=false;}
    });
  }
  async function unifiedAsk(question){
    if(state.mode==='auto')state.mode=looksLikeShopping(question)?'shop':'advice';
    beginSession(); if(!question||state.busy)return;
    if(/\b(?:kde|stav|sleduj|tracking|doruc|odoslan)\w*.*\b(?:objednavk|tracking|zasielk)\w*|\b(?:objednavk|zasielk)\w*.*\b(?:kde|stav|tracking|doruc|odoslan)\w*/i.test(question)){
      state.busy=true;state.lastQuestion=question;addMessage('user',`<p>${escapeHtml(question)}</p>`);const loading=addMessage('bot','<p>Bezpečne overujem stav objednávky…</p>');
      try{const r=await fetch('/api/ai-order-status',{method:'GET',cache:'no-store'});const d=await r.json();
        if(r.status===401){renderGuestOrderVerification(loading);return;}
        if(!r.ok||!d.ok)throw new Error('Stav objednávky sa nepodarilo načítať.');
        if(!d.orders?.length){loading.innerHTML='<p>Vo vašom účte som nenašiel žiadnu objednávku.</p>';return;}
        const order=d.orders[0];loading.innerHTML=`<p><b>Objednávka ${escapeHtml(order.number)}</b></p><p>Stav: <b>${escapeHtml(order.statusLabel)}</b>${order.date?` · ${escapeHtml(new Date(order.date).toLocaleDateString('sk-SK'))}`:''}</p>${order.shipping?`<p>Doprava: ${escapeHtml(order.shipping)}</p>`:''}${order.tracking?`<p>Sledovanie zásielky: ${escapeHtml(order.tracking)}</p>`:''}`;
      }catch(err){loading.innerHTML=`<p>${escapeHtml(err?.message||'Stav objednávky sa nepodarilo načítať.')}</p>`;}finally{state.busy=false;}return;
    }
    if(/(zopak|ako naposledy|posledn.*objedn)/i.test(question)){
      addMessage('user',`<p>${escapeHtml(question)}</p>`);const ps=state.profile?.lastOrder?.products||[];
      if(!state.profile){addMessage('bot','<p>Poslednú objednávku môžem načítať iba prihlásenému zákazníkovi. Prihláste sa a skúste to znova.</p>');return;}
      if(!ps.length){addMessage('bot','<p>V poslednej objednávke nie je produkt, ktorý je teraz bezpečne dostupný. Nič som automaticky nenahradil.</p>');return;}
      ps.forEach(p=>addCommerceItem(p,Math.max(1,Number(p.historical_quantity||1))));const unavailable=state.profile.lastOrder?.unavailableProducts?.length||0;
      addMessage('bot',`<p>Pripravil som dostupné produkty z poslednej objednávky.${unavailable?` ${unavailable} nedostupných položiek som nepridal ani automaticky nenahradil.`:''}</p>`,{scroll:false});askNextStep();return;
    }
    state.busy=true; state.lastQuestion=question;trackEvent('question',{question:String(question).slice(0,300)});
    addMessage('user',`<p>${escapeHtml(question)}</p>`); const loading=addMessage('bot','<p>Overujem informácie a katalóg…</p>');
    try{
      const r=await fetch('/api/ai-tomas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:question,page:location.pathname,state:state.commerceState})});
      const d=await r.json(); if(!r.ok||!d?.ok)throw new Error(d?.error||'Požiadavka zlyhala.');
      const shoppingAction=['ASK_PRODUCT_TYPE','OPEN_QUANTITY','ADD_TO_CART','OPEN_CART','OPEN_CHECKOUT'].includes(d.action?.kind);
      if(d.commerce?.products?.length||shoppingAction){state.mode='shop';setExperience('shop');}
      else autoPanelSize('advice');
      state.commerceState=d.state||state.commerceState; state.history=Array.isArray(d.state?.history)?d.state.history.slice(-20):state.history;
      loading.innerHTML=textToHtml(d.advisor?.answer||'');
      appendSources(loading,d.advisor?.sources);attachFeedback(loading,question,(d.advisor?.answer||[]).join(' '));trackEvent('answer',{intent:d.advisor?.intent||'',unanswered:Boolean(d.advisor?.unanswered)});
      if(d.advisor?.handoffSuggested===true||d.action?.kind==='OPEN_HANDOFF')openHandoff(question,d.action?.reason||'customer_request');
      if(d.commerce?.products?.length)renderCommerceResults(d.commerce);
      else if(d.advisor?.products?.length)renderSafeProducts(d.advisor.products,`Vhodné produkty pre ${question}`,d.advisor.products);
      if(d.action?.kind==='ADD_TO_CART'&&d.action.product){
        const exists=state.cart.find(x=>cartKey(x.product)===cartKey(d.action.product));
        if(exists)exists.qty=Math.max(exists.qty,Number((d.state?.cart||[]).find(x=>String(x.id)===String(d.action.product.id))?.quantity||exists.qty));
        else state.cart.push({product:d.action.product,qty:Math.max(1,Number(d.action.quantity||1))});
        updateLiveCart();askNextStep();
      } else if(d.action?.kind==='OPEN_QUANTITY'&&d.action.product) quantityChooser(d.action.product);
      else if(d.action?.kind==='ASK_PRODUCT_TYPE') renderTypeQuestion(d.action);
      else if(d.action?.kind==='OPEN_CART') renderCart();
      else if(d.action?.kind==='OPEN_CHECKOUT') state.cart.length?prepareHandoff():renderCart();
      if(!loading.textContent.trim()&& !d.commerce?.products?.length)loading.innerHTML='<p>Nenašiel som bezpečnú odpoveď. Skúste presný kód toneru alebo model tlačiarne.</p>';
      saveCommerceSession(); requestAnimationFrame(()=>loading.scrollIntoView({behavior:'smooth',block:'start'}));
    }catch(err){console.error('[AI Tomas unifiedAsk]',err);loading.innerHTML=`<p>${escapeHtml(err?.message||'Akciu sa nepodarilo dokončiť. Skúste ju zopakovať.')}</p>`;}
    finally{state.busy=false;}
  }
  function looksLikeShopping(q){ return /\b(chcem|objedna|objednaj|kúp|kup|potrebujem|pridaj|toner|náplň|napln|\b(?:cf|ce|crg|tn|dr|w)\s*-?\s*\d{2,})/i.test(q) && !/(rozdiel|prečo|preco|ako|problém|problem|nepasuje|pásy|pasy|reklamac|doprava|platba)/i.test(q); }
  function prepareHandoff(){
    autoPanelSize('checkout');
    setExperience('shop');
    if(!state.cart.length)return; messages.hidden=true;form.hidden=true;if(quick)quick.hidden=true;commerce.hidden=false;commerce.classList.add('is-focus-stage');
    const c=state.profile?.customer||{};
    commerce.innerHTML=`<div class="tm-ai-commerce__head"><button data-co-back>← Späť do nákupu</button><b>Kontaktné a doručovacie údaje</b></div><p class="tm-ai-checkout-note">${state.profile?.customer ? 'Údaje som predvyplnil z vášho účtu. Môžete ich zmeniť.' : 'Nakúpiť môžete aj bez registrácie. Objednávku odošlete až po záverečnej kontrole v pokladni.'}</p><div class="tm-ai-checkout-form"><fieldset><legend>Fakturačné a kontaktné údaje</legend><label>Meno a priezvisko<input data-co-name value="${escapeHtml(`${c.first_name||''} ${c.last_name||''}`.trim())}" autocomplete="name"></label><label>Ulica a číslo<input data-co-street value="${escapeHtml(c.address||'')}" autocomplete="street-address"></label><div class="tm-ai-checkout-row"><label>PSČ<input data-co-zip value="${escapeHtml(c.zip||'')}" maxlength="5"></label><label>Mesto<input data-co-city value="${escapeHtml(c.city||'')}"></label></div><label>E-mail<input data-co-email value="${escapeHtml(c.email||'')}" type="email"></label><label>Telefón<input data-co-phone value="${escapeHtml(c.phone||'')}" type="tel"></label><label class="tm-ai-checkline"><input type="checkbox" data-co-company-enabled> Nakupujem na firmu</label><div data-co-company-box hidden><label>Názov firmy<input data-co-company value="${escapeHtml(c.company||'')}"></label><div class="tm-ai-checkout-row"><label>IČO<input data-co-ico value="${escapeHtml(c.ico||'')}" maxlength="8"></label><label>DIČ<input data-co-dic value="${escapeHtml(c.dic||'')}"></label></div><label>IČ DPH<input data-co-icdph value="${escapeHtml(c.icdph||c.ic_dph||'')}"></label></div></fieldset><fieldset><legend>Doručenie a platba</legend><label class="tm-ai-checkline"><input type="checkbox" data-co-different> Doručiť na inú adresu</label><div data-co-delivery-box hidden><label>Meno alebo firma príjemcu<input data-co-delivery-name></label><label>Ulica a číslo<input data-co-delivery-street></label><div class="tm-ai-checkout-row"><label>PSČ<input data-co-delivery-zip maxlength="5"></label><label>Mesto<input data-co-delivery-city></label></div><label>Telefón príjemcu<input data-co-delivery-phone type="tel"></label></div><label>Doprava<select data-co-shipping><option value="gls_courier">GLS kuriér</option><option value="dpd_courier">DPD kuriér</option><option value="gls_pickup">GLS ParcelShop / Balíkomat</option><option value="dpd_pickup">DPD Pickup</option><option value="dpd_box">DPD Pickup Box</option></select></label><label>Platba<select data-co-payment><option value="cod">Dobierka</option><option value="gopay">GoPay</option><option value="applepay">Apple Pay</option><option value="googlepay">Google Pay</option><option value="bank_prepaid">Bankový prevod</option></select></label></fieldset></div><div class="tm-ai-commerce__actions"><button class="primary" data-co-review>Skontrolovať a pripraviť pokladňu</button></div>`;
    if(state.profile?.lastOrder?.shipping)commerce.querySelector('[data-co-shipping]').value=state.profile.lastOrder.shipping;
    if(state.profile?.lastOrder?.payment)commerce.querySelector('[data-co-payment]').value=state.profile.lastOrder.payment;
    commerce.querySelector('[data-co-back]').onclick=renderCart;
    const companyToggle=commerce.querySelector('[data-co-company-enabled]'),differentToggle=commerce.querySelector('[data-co-different]');
    const toggleBoxes=()=>{commerce.querySelector('[data-co-company-box]').hidden=!companyToggle.checked;commerce.querySelector('[data-co-delivery-box]').hidden=!differentToggle.checked};companyToggle.onchange=toggleBoxes;differentToggle.onchange=toggleBoxes;if(c.company){companyToggle.checked=true;toggleBoxes();}
    commerce.querySelector('[data-co-review]').onclick=()=>{const v=x=>commerce.querySelector(x)?.value.trim()||'';const customer={name:v('[data-co-name]'),street:v('[data-co-street]'),zip:v('[data-co-zip]'),city:v('[data-co-city]'),email:v('[data-co-email]'),phone:v('[data-co-phone]'),companyEnabled:companyToggle.checked,company:v('[data-co-company]'),ico:v('[data-co-ico]'),dic:v('[data-co-dic]'),icdph:v('[data-co-icdph]'),differentAddress:differentToggle.checked,delivery:{name:v('[data-co-delivery-name]'),street:v('[data-co-delivery-street]'),zip:v('[data-co-delivery-zip]'),city:v('[data-co-delivery-city]'),phone:v('[data-co-delivery-phone]')}};if(!customer.name||!customer.street||!/^\d{5}$/.test(customer.zip)||!customer.city||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)||customer.phone.replace(/\D/g,'').length<9){alert('Doplňte platné fakturačné a kontaktné údaje.');return}if(customer.companyEnabled&&(!customer.company||!/^\d{8}$/.test(customer.ico.replace(/\D/g,'')))){alert('Pri nákupe na firmu doplňte názov firmy a 8-miestne IČO.');return}if(customer.differentAddress&&(!customer.delivery.name||!customer.delivery.street||!/^\d{5}$/.test(customer.delivery.zip)||!customer.delivery.city)){alert('Doplňte platnú dodaciu adresu.');return}reviewHandoff(customer,v('[data-co-shipping]'),v('[data-co-payment]'))};
  }
  async function reviewHandoff(customer,shipping,payment){
    const labels={gls_courier:'GLS kuriér',dpd_courier:'DPD kuriér',gls_pickup:'GLS ParcelShop / Balíkomat',dpd_pickup:'DPD Pickup',dpd_box:'DPD Pickup Box',cod:'Dobierka',gopay:'GoPay',applepay:'Apple Pay',googlepay:'Google Pay',bank_prepaid:'Bankový prevod'};
    commerce.innerHTML='<p class="tm-ai-checkout-note">Overujem aktuálne ceny, sklad, dopravu a platbu…</p>';
    let checked;
    try{const r=await fetch('/api/ai-commerce/cart-validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cart:state.cart.map(x=>({id:x.product.id,sku:x.product.sku,qty:x.qty})),country:'SK',shipping})});checked=await r.json();if(!r.ok||!checked?.ok)throw new Error(checked?.error||'Košík sa nepodarilo overiť.');}
    catch(error){commerce.innerHTML=`<p class="tm-ai-checkout-note">${escapeHtml(error?.message||'Overenie zlyhalo.')}</p><div class="tm-ai-commerce__actions"><button data-r-back>Skúsiť znova</button><button data-r-products>Upraviť produkty</button></div>`;commerce.querySelector('[data-r-back]').onclick=()=>reviewHandoff(customer,shipping,payment);commerce.querySelector('[data-r-products]').onclick=renderCart;return;}
    const shippingOption=checked.options?.shipping?.find(x=>x.id===shipping);const paymentOption=checked.options?.payment?.find(x=>x.id===payment);const shippingPrice=Number(shippingOption?.price||0),paymentPrice=Number(paymentOption?.price||0),grand=Number(checked.subtotal||0)+shippingPrice+paymentPrice;
    commerce.innerHTML=`<div class="tm-ai-commerce__head"><button data-r-back>← Upraviť údaje</button><b>Kontrola</b></div><div class="tm-ai-review"><p>${customer.companyEnabled?`<b>${escapeHtml(customer.company)}</b><br>IČO: ${escapeHtml(customer.ico)}${customer.dic?` · DIČ: ${escapeHtml(customer.dic)}`:''}${customer.icdph?` · IČ DPH: ${escapeHtml(customer.icdph)}`:''}<br>`:''}<b>${escapeHtml(customer.name)}</b><br>${escapeHtml(customer.street)}<br>${escapeHtml(customer.zip)} ${escapeHtml(customer.city)}<br>${escapeHtml(customer.email)} · ${escapeHtml(customer.phone)}</p>${customer.differentAddress?`<p><b>Dodacia adresa:</b><br>${escapeHtml(customer.delivery.name)}<br>${escapeHtml(customer.delivery.street)}<br>${escapeHtml(customer.delivery.zip)} ${escapeHtml(customer.delivery.city)}${customer.delivery.phone?`<br>${escapeHtml(customer.delivery.phone)}`:''}</p>`:''}<p><b>Doprava:</b> ${escapeHtml(labels[shipping]||shipping)} (${money(shippingPrice)})<br><b>Platba:</b> ${escapeHtml(labels[payment]||payment)} (${money(paymentPrice)})</p><p>Tovar: ${money(checked.subtotal)}${checked.quantityDiscount?`<br>Množstevná zľava: −${money(checked.quantityDiscount)}`:''}<br><b>Celkom: ${money(grand)}</b></p><small>Ceny a sklad boli práve overené serverom. AI objednávku neodosiela. Otvorí pripravenú pokladňu, kde ju skontrolujete a odošlete vy.</small></div><div class="tm-ai-commerce__actions"><button data-r-products>Upraviť produkty</button><button class="primary" data-r-go>Prejsť do pripravenej pokladne</button></div>`;
    commerce.querySelector('[data-r-back]').onclick=prepareHandoff;commerce.querySelector('[data-r-products]').onclick=renderCart;commerce.querySelector('[data-r-go]').onclick=()=>doHandoff(customer,shipping,payment);
  }
  async function doHandoff(customer,shipping,payment){
    const go=commerce.querySelector('[data-r-go]'); if(go){go.disabled=true;go.textContent='Overujem ceny a sklad…';}
    try{
      const validation=await fetch('/api/ai-commerce/cart-validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cart:state.cart.map(x=>({id:x.product.id,sku:x.product.sku,qty:x.qty})),country:'SK',shipping})});
      const checked=await validation.json(); if(!validation.ok||!checked?.ok)throw new Error(checked?.error||'Košík sa nepodarilo overiť.');
    }catch(error){alert(error?.message||'Košík sa nepodarilo overiť.');reviewHandoff(customer,shipping,payment);return;}
    const parts=customer.name.split(/\s+/);const first_name=parts.shift()||'',last_name=parts.join(' ');
    syncSharedCart();localStorage.setItem('tm_checkout_selection_v1',JSON.stringify({shipping,payment,savedAt:new Date().toISOString()}));localStorage.setItem('tm_ai_checkout_handoff_v1',JSON.stringify({createdAt:Date.now(),first_name,last_name,email:customer.email,phone:customer.phone,address:customer.street,zip:customer.zip,city:customer.city,companyEnabled:customer.companyEnabled,company:customer.company,ico:customer.ico,dic:customer.dic,icdph:customer.icdph,differentAddress:customer.differentAddress,delivery:customer.delivery,shipping,payment}));saveCommerceSession();closePanel();location.href='/pokladna';
  }
  async function loadCustomerProfile(){try{const r=await fetch('/api/ai-commerce-profile',{cache:'no-store'});if(!r.ok)return;const d=await r.json();if(!d.ok||!d.loggedIn)return;state.profile=d;const repeat=root.querySelector('[data-ai-repeat]');if(repeat){repeat.hidden=!d.lastOrder;repeat.onclick=()=>{beginSession();const ps=d.lastOrder?.products||[];if(!ps.length){addMessage('bot','<p>Produkty z poslednej objednávky už nie sú dostupné. Nič som automaticky nenahradil.</p>');return;}ps.forEach(p=>addCommerceItem(p,Math.max(1,Number(p.historical_quantity||1))));if(d.lastOrder?.unavailableProducts?.length)addMessage('bot',`<p>${d.lastOrder.unavailableProducts.length} položiek z poslednej objednávky už nie je dostupných a nebolo pridaných.</p>`,{scroll:false});renderCart()}}const frequent=root.querySelector('[data-ai-frequent]');const items=Array.isArray(d.frequentProducts)?d.frequentProducts.slice(0,4):[];if(frequent&&items.length){frequent.hidden=false;frequent.innerHTML=`<b>Kupujete najčastejšie</b><div>${items.map((p,i)=>`<button type="button" data-ai-frequent-product="${i}"><span>${escapeHtml(p.name)}</span><small>${Math.max(1,Number(p.suggested_quantity||1))} ks · ${money(p.price)}</small></button>`).join('')}</div>`;frequent.querySelectorAll('[data-ai-frequent-product]').forEach(btn=>btn.onclick=()=>{const p=items[Number(btn.dataset.aiFrequentProduct)];beginSession();quantityChooser(p);});}}catch{}}

  root.addEventListener('click',(event)=>{if(event.target.closest('[data-ai-cart-open],[data-ai-cart-open-top]')){event.preventDefault();renderCart();}});
  root.addEventListener('click',(event)=>{
    const setButton=event.target.closest('[data-ai-set]');
    if(setButton){event.preventDefault();const set=state.offerSets[Number(setButton.dataset.aiSet)];if(set)setChooser(set);return;}
    const productButton=event.target.closest('[data-ai-single]');
    if(productButton){event.preventDefault();const product=state.offerSingles[Number(productButton.dataset.aiSingle)];if(product)quantityChooser(product);}
  });
  root.addEventListener('click',(event)=>{
    const link=event.target.closest('a[href]');if(!link)return;
    try{const next={...readSavedState(),resumeOpen:false,uiStarted:true,uiMode:state.mode,uiSize:state.size,uiManualSize:state.manualSize,uiMessages:messages.innerHTML,uiCart:state.cart};sessionStorage.setItem(SESSION_KEY,JSON.stringify(next));}catch{}
    closePanel();
  });
  back?.addEventListener('click',goBack);
  updateLiveCart();
  const onCheckoutPage=/^\/(?:kosik|pokladna)(?:\/|$)/i.test(location.pathname);
  if(saved.resumeOpen&&!onCheckoutPage){
    try{sessionStorage.setItem(SESSION_KEY,JSON.stringify({...readSavedState(),resumeOpen:false}));}catch{}
    openPanel();
  }
  root.querySelectorAll('[data-ai-mode]').forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.aiMode;beginSession();messages.hidden=false;form.hidden=false;if(quick)quick.hidden=state.mode!=='advice';input.placeholder=state.mode==='shop'?'Napíšte toner alebo model tlačiarne…':'Napíšte otázku alebo čo potrebujete…';input.focus()}));

  nudgeClose?.addEventListener('click',()=>{
    nudge.hidden=true;
    try{sessionStorage.setItem(NUDGE_KEY,'dismissed');}catch{}
    trackEvent('nudge_dismissed');
  });
  nudgeQuestion?.addEventListener('click',()=>{
    const question=nudgeQuestion.dataset.aiPrompt||'';
    nudge.hidden=true;
    try{sessionStorage.removeItem(NUDGE_KEY);}catch{}
    openPanel();state.mode='advice';beginSession();messages.hidden=false;form.hidden=false;
    unifiedAsk(question);trackEvent('nudge_used',{question});
  });
  scheduleNudge();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&panel.hidden)scheduleNudge();});

  quick.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ai-prompt]');
    if (!button) return;
    input.value = '';
    unifiedAsk(button.dataset.aiPrompt || button.textContent.trim());
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = input.value.trim();
    input.value = '';
    unifiedAsk(question);
  });


  function hideHandoff(options = {}) {
    if (!handoff) return;
    handoff.hidden = true;
    handoff.classList.remove('is-success');
    if (handoffStatus) handoffStatus.textContent = '';
    if (options.focusInput) input?.focus({ preventScroll: true });
  }

  handoffClose?.addEventListener('click', () => hideHandoff({ focusInput: true }));
  handoffContinue?.addEventListener('click', () => hideHandoff({ focusInput: true }));

  resizeButton?.addEventListener('click',()=>setPanelSize(state.size==='expanded'?'compact':'expanded',{manual:true,track:true}));
  supportButton?.addEventListener('click',()=>openHandoff(state.lastQuestion||'','customer_request'));
  downloadButton?.addEventListener('click',()=>{
    const lines=['AI Tomáš – komunikácia ToneryMAXIM',`Vytvorené: ${new Date().toLocaleString('sk-SK')}`,`Stránka: ${location.href}`,''];
    state.history.forEach(turn=>lines.push(`${turn.role==='assistant'?'AI Tomáš':'Zákazník'}: ${String(turn.content||'').replace(/\s+/g,' ').trim()}`));
    if(state.cart.length){lines.push('','Pripravený nákup:');state.cart.forEach(item=>lines.push(`- ${item.qty}× ${item.product?.name||'Produkt'} (${item.product?.sku||'bez SKU'}) – ${money(linePrice(item.product,item.qty))}`));lines.push(`Spolu za tovar: ${money(cartTotal())}`);}
    lines.push('','Ceny a dostupnosť sa môžu zmeniť. Pred objednaním ich AI Tomáš a pokladňa znovu overia.');
    const blob=new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`AI-Tomas-komunikacia-${new Date().toISOString().slice(0,10)}.txt`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);trackEvent('download',{turns:state.history.length,cartItems:state.cart.length});
  });
  function closeNewDialog(){if(newDialog)newDialog.hidden=true;}
  function resetConversation(keepCart){
    const kept=keepCart?state.cart:[];state.history=[];state.lastQuestion='';state.mode='auto';state.started=false;state.offerSets=[];state.offerSingles=[];state.cart=kept;
    state.commerceState={version:1,sessionId:'',history:[],currentPrinter:null,currentProductId:null,selectedProductId:null,currentColor:null,currentType:null,cart:kept.map(x=>({id:x.product?.id||'',sku:x.product?.sku||'',quantity:x.qty})),checkoutDraft:{},lastProductQuery:null,lastIntent:null,pendingQuestion:null};
    messages.innerHTML=initialMessagesHtml;messages.hidden=false;form.hidden=false;commerce.hidden=true;commerce.innerHTML='';home.hidden=false;back.hidden=true;quick.hidden=false;root.classList.remove('is-started');setExperience('home');setProgress(1);hideHandoff();closeNewDialog();updateLiveCart();state.manualSize=false;setPanelSize('compact');saveCommerceSession();trackEvent('new_conversation',{keptCart:keepCart,cartItems:kept.length});input.focus();
  }
  newButton?.addEventListener('click',()=>{if(!newDialog)return;newDialog.hidden=false;autoPanelSize('checkout');});
  newDialog?.querySelector('[data-ai-new-keep]')?.addEventListener('click',()=>resetConversation(true));
  newDialog?.querySelector('[data-ai-new-all]')?.addEventListener('click',()=>resetConversation(false));
  newDialog?.querySelector('[data-ai-new-cancel]')?.addEventListener('click',closeNewDialog);

  handoffForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = handoffQuestion?.value.trim() || state.lastQuestion || '';
    const phone = handoffPhone?.value.trim() || '';
    const email = handoffEmail?.value.trim() || '';
    if (!question) { if (handoffStatus) handoffStatus.textContent = 'Napíšte otázku pre pracovníka.'; return; }
    if (!phone && !email) { if (handoffStatus) handoffStatus.textContent = 'Zadajte telefón alebo e-mail.'; return; }
    if (!handoffConsent?.checked) { if (handoffStatus) handoffStatus.textContent = 'Potvrďte súhlas s kontaktovaním.'; return; }
    const button = handoffForm.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    if (handoffStatus) handoffStatus.textContent = 'Odosielam…';
    try {
      const response = await fetch('/api/ai-handoff', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ phone, email, question, page:location.pathname, consent:true, reason:handoff?.dataset.reason||'customer_request', history:state.history.slice(-12), website:handoffHp?.value || '' }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Odoslanie sa nepodarilo.');
      if (handoffStatus) handoffStatus.textContent = 'Odoslané. Kolega dostal vašu otázku a kontakt. Môžete pokračovať s AI Tomášom.';
      trackEvent('handoff_sent',{reason:handoff?.dataset.reason||'customer_request'});
      handoff?.classList.add('is-success');
      if (handoffPhone) handoffPhone.value = ''; if (handoffEmail) handoffEmail.value = ''; if (handoffConsent) handoffConsent.checked = false;
    } catch (error) { if (handoffStatus) handoffStatus.textContent = error?.message || 'Odoslanie sa nepodarilo. Skúste kontakt info@tonerymaxim.sk.'; }
    finally { if (button) button.disabled = false; }
  });

  messages.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ai-add-to-cart]');
    if (!button) return;

    try {
      const product = JSON.parse(button.dataset.aiAddToCart || '{}');
      product.type = String(product.product_type_key || '').toLowerCase().includes('origin') ? 'original' : String(product.product_type_key || '').toLowerCase().includes('renov') ? 'renovated' : 'compatible';
      quantityChooser(product);
      button.textContent = 'Vybrať množstvo';
    } catch (_) {
      button.textContent = 'Chyba';
    }
  });
})();
