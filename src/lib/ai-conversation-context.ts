// Conversation references are resolved before the advisor or catalogue runs.
// History identifies a subject; it never supplies prices, policy or permission
// to purchase. Only the current customer message can authorize an action.
import { hasExplicitCartAddCommand } from './ai-cart-safety.ts';
import { isProductPriceQuestion } from './ai-commerce/price-question.ts';
export type ConversationTopic = 'product' | 'calendar' | 'discount' | 'shipping' | 'payment' | 'account' | 'claim' | 'diagnostic' | 'order' | 'contact' | 'legal';
export type ConversationTurn = { role: string; content: string; topic?: ConversationTopic | 'other'; relation?: string; productPage?: string; productReference?: string };
export function conversationTopicTag(value: unknown): ConversationTopic | 'other' | undefined {
  return ['product','calendar','discount','shipping','payment','account','claim','diagnostic','order','contact','legal','other'].includes(String(value)) ? value as ConversationTopic|'other' : undefined;
}
type ContextState = { lastProductQuery?: string | null; currentProductId?: string | null; selectedProductId?: string | null; pendingQuestion?: string | null; pendingProductQuestion?: string | null };
type Frame = { topic: ConversationTopic; anchor: string; start: number; end: number; reference: string | null; page?: string };
export function conversationProductPage(value: unknown): string | undefined {
  try {const path=new URL(String(value||''),'https://www.tonerymaxim.sk').pathname;return /^\/produkt\/[a-z0-9%_-]+\/?$/i.test(path)?path.replace(/\/$/,'').slice(0,300):undefined;} catch {return undefined;}
}
export type ConversationContext = {
  relation: 'new' | 'follow_up' | 'resume' | 'clarify' | 'acknowledge';
  topic: ConversationTopic | null;
  question: string;
  contextHistory: ConversationTurn[];
  productQuery: string | null;
  orderNumber: string | null;
  explicitProductReturn: boolean;
  resetSelection: boolean;
  clarification: string | null;
};
const norm = (value: unknown) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const referenceWords = /\b(?:ten|tento|ta|tato|tieto|tuto|to|toho|tohto|tom|ho|ju|jej|ich|tam|takto|teda|potom|to iste)\b/;
const explicitReturn = /\b(?:vratme|vrat|vratit|spat|naspat|povodn\w*|predchadzajuc\w*|predtym|este\s+k)\b/;
const acknowledgement = /^(?:(?:dobre|ok|okay|dakujem|vdaka|super|rozumiem|jasne|ano|nie|v poriadku|dakujem pekne)[,.! ]*)+$/;
const quantity = /^(?:(?:a|tak|prosim)\s+)?-?\d+(?:[.,]\d+)?\s*(?:ks|kus\w*)?[?.! ]*$/;
const productModifier = /\b(?:original\w*|kompatibiln\w*|renovovan\w*|repasovan\w*|skladom|vytaznost|kapacita|vydrz|kolko\s+stran)\b/;

export function conversationProductReference(message: string): string | null {
  const sku = message.match(/\b(?:sku|k[oó]d\s+produktu)\s*[:#-]?\s*([a-z0-9_-]+)/i);
  if (sku) return `SKU: ${sku[1]}`;
  const oem = message.match(/\b(?:(?:cf|ce|crg|tn|dr|wt|mc|q|clt|mlt|tk|pgi|pfi|cli|lc|gi|pg)(?:[- ]?[a-z])?[- ]?\d{2,}[a-z0-9-]*|w[- ]?\d{3,}[a-z0-9-]*)\b/i);
  if (oem) return oem[0];
  const branded = message.match(/\b(?:hp|brother|canon|epson|samsung|oki|xerox|kyocera|lexmark|ricoh|sharp|toshiba|pantum|dell|konica(?:\s+minolta)?)(?:\s+[a-z][a-z-]*){0,5}\s+[a-z-]*\d+[a-z0-9-]*\b/i);
  return branded?.[0] || null;
}

export function conversationTopic(message: string): ConversationTopic | null {
  const n = norm(message);
  if(isProductPriceQuestion(message)&&conversationProductReference(message))return 'product';
  if (/\b(?:reklam\w*|vrat(?:it|ite|im|ime|ia)|vraten\w*|odstup\w*|refund\w*|nespravny\s+toner|zly\s+toner|vymenit\s+tovar)\b/.test(n.replace(/\bvratit\s+sa\b/g,''))) return 'claim';
  if (/\b(?:hesl\w*|prihlas\w*|profil\w*)\b/.test(n)) return 'account';
  if (/\b(?:zlav\w*|kupon\w*|odmen\w*|vernost\w*|akciov\w*|bod(?:y|ov|mi|och|u|om)?)\b|\b(?:5|7)\s*(?:%|percent)/.test(n)) return 'discount';
  if (/\b(?:registr\w*|zaregistr\w*|ucet|uctu)\b/.test(n)) return 'account';
  if (/firmware|firmver|hp\s*\+|cartridge\s+(?:policy|protection)|authorized\s+hp|\b(?:netlaci|nerozpozna|pasy|pruhy|smuhy|bled\w*|rozmaz\w*|podavac\w*|neberie\s+papier)\b/.test(n)) return 'diagnostic';
  if (/\b(?:kalenda\w*|kaledar\w*|kalemdar\w*|diar\w*|minidiar\w*|planovac\w*)\b|\b(?:D|NK|SK|PF|PP)(?:-\d+){1,4}\b/i.test(n)) return 'calendar';
  if (/\b(?:dobierk\w*|gopay|plat(?:b|ob)\w*|plati(?:t|m|me|te|s|a)|zaplat\w*|kartou|hotovost\w*|bankov\w*\s+prevod\w*|prevodom|faktur\w*|firemn\w*\s+udaj\w*|ico|dic)\b/.test(n)) return 'payment';
  if (/\b(?:doprav\w*|postovn\w*|kurier\w*|doruc\w*|packet\w*|zasielkovn\w*|pickup|balikomat|parcelshop|gls|dpd|z-?box)\b/.test(n)) return 'shipping';
  if (/cesk|\b(?:cr|cz|brna|brno|praha|prahy)\b/.test(n) && /\b(?:do|posiel\w*|posl\w*|doruc\w*)\b/.test(n)) return 'shipping';
  if (/\b(?:objednavk\w*|zasielk\w*|balik\w*|tracking|exped\w*)\b/.test(n)) return 'order';
  if (/\b(?:kontakt\w*|telefon\w*|otvarac\w*|otvoren\w*|pracovn\w*\s+doba|vas\w*\s+(?:e-?mail|adres\w*)|e-?mail\w*\s+(?:firmy|podpory))\b/.test(n)) return 'contact';
  if (/\b(?:gdpr|cookies|obchodn\w*\s+podmien\w*|osobn\w*\s+udaj\w*)\b/.test(n)) return 'legal';
  if (conversationProductReference(message) || /\b(?:toner\w*|napln\w*|atrament\w*|tlaciarn\w*|valec|valca|kazet\w*)\b/.test(n) || productModifier.test(n)) return 'product';
  return null;
}

function continuation(message: string) {
  const n = norm(message);
  return referenceWords.test(n) || quantity.test(n) || acknowledgement.test(n)
    || /\b(?:nepris\w*|nezobraz\w*|neodpoc\w*|nenajdem|nevidim|nenachadzam|priplatok|zotriet)\b/.test(n)
    || /\b(?:kde|kam|ako)\b.*\b(?:sa|mi|to|ju|ho)\b.*\b(?:zobraz\w*|uplat\w*|najd\w*|zad\w*|aktiv\w*)\b/.test(n)
    || /^(?:a\s+)?kedy(?:\s+mi)?\s+pride[?.! ]*$/.test(n)
    || /^(?:(?:a|ale|tak|prosim)\s+)*(?:ako\s+dlho|na\s+ako\s+dlho|dokedy|kedy)\s+(?:to\s+)?(?:plati|trva|pride|funguje)[?.! ]*$/.test(n)
    || /^(?:(?:a|ale|tak|prosim)\s+)*(?:kde|kam|ako|preco|dokedy|kedy|ako\s+dlho|ako\s+funguje|na\s+mobile|na\s+pc|v\s+spame)[?.! ]*$/.test(n);
}

function answerTopic(message: string): ConversationTopic | null {
  const title = message.split(':', 1)[0];
  if (title.length > 85 || !message.includes(':')) return null;
  // Only a heading is used. A reply mentioning other benefits or products
  // in its body cannot silently change the active topic.
  return conversationTopic(title);
}

function framesFromHistory(history: ConversationTurn[]) {
  const frames: Frame[] = [];
  let active: Frame | null = null;
  for (let i = 0; i < history.length; i++) {
    const turn = history[i];
    if(turn.topic==='other'){active=null;continue;}
    if (turn.role === 'assistant') {
      const topic = turn.topic || answerTopic(turn.content);
      if (active && topic && active.topic !== topic && ['discount', 'account'].includes(topic)) active.topic = topic;
      if(active?.topic==='product'&&!active.reference&&/^myslite\s+(?:produkt\s+)?/.test(norm(turn.content))){
        const title=turn.content.split('?')[0],reference=conversationProductReference(title);
        if(reference)active.reference=reference+(/kompatibil/.test(norm(title))?' kompatibilný':/original/.test(norm(title))?' originálny':/renov/.test(norm(title))?' renovovaný':'');
      }
      if (active) active.end = i;
      continue;
    }
    const topic = turn.topic || conversationTopic(turn.content);
    const reference = topic === 'product' ? turn.productReference||conversationProductReference(turn.content) : null;
    if (topic) {
      const changedProduct = reference && active?.reference && norm(reference) !== norm(active.reference);
      const changedPage = topic==='product'&&turn.productPage&&active?.page&&turn.productPage!==active.page;
      const orderNumber=topic==='order'?turn.content.match(/\b(?:tm\s*)?(\d{5,12})\b/i)?.[1]:null;
      const changedOrder=orderNumber&&active?.topic==='order'&&active.anchor.match(/\b(?:tm\s*)?(\d{5,12})\b/i)?.[1]!==orderNumber;
      const detailedSubject = topic==='discount'&&/registr|uvitac|\b[57]\s*(?:%|percent)|vernost|\bbod|papier/.test(norm(turn.content))
        ||topic==='shipping'&&/cesk|\b(?:cr|cz|brna|brno|praha|prahy)\b/.test(norm(turn.content));
      const previous=active as Frame|null;
      const changedSubject=previous!==null&&previous.topic===topic&&detailedSubject&&subject({...previous,anchor:turn.content})!==subject(previous);
      if (!active || turn.relation === 'new' || active.topic !== topic || changedProduct || changedSubject || changedOrder || changedPage) {
        active = { topic, anchor: turn.content, reference, start: i, end: i, page:turn.productPage };
        frames.push(active);
      } else {
        active.end = i;
        if (reference) { active.reference = reference; active.anchor = turn.content; }
      }
    } else if (active && continuation(turn.content)) active.end = i;
    else active = null;
  }
  return { frames, active };
}

function subject(frame: Frame): string {
  const n = norm(frame.anchor);
  switch (frame.topic) {
    case 'discount': return /papier/.test(n) ? 'papierová vernostná odmena' : /vernost|\bbod/.test(n) ? 'vernostné body' : /7\s*(?:%|percent)|dalsi\s+nakup/.test(n) ? '7 % odmena na ďalší nákup' : /registr|5\s*(?:%|percent)|uvitac/.test(n) ? 'uvítacia zľava 5 % za registráciu' : /kupon|zlavov\w*\s+kod/.test(n) ? 'zľavový kupón' : 'zľava';
    case 'account': return /hesl|obnov/.test(n) ? 'obnova zabudnutého hesla' : 'prihlásenie do zákazníckeho účtu';
    case 'claim': return /vrat|odstup|nespravny|zly/.test(n) ? 'vrátenie tovaru' : 'reklamácia tovaru';
    case 'shipping': return /cesk|ceska|\bcr\b|\bcz\b|brn|prah/.test(n) ? 'doprava do Českej republiky' : 'doprava a doručenie';
    case 'payment': return /dobierk/.test(n) ? 'platba na dobierku' : /prevod/.test(n) ? 'platba bankovým prevodom' : /kart|gopay/.test(n) ? 'platba kartou cez GoPay' : 'možnosti platby';
    case 'diagnostic': return /firmware|firmver|hp\s*\+|cartridge/.test(n) ? 'HP+ a nastavenie firmvéru tlačiarne' : /pas|pruh|smuh/.test(n) ? 'tlačiareň tlačí pásy' : 'problém s tlačou';
    case 'calendar': return /denn/.test(n) ? 'denný diár' : /tyzden/.test(n) ? 'týždenný diár' : /mesac/.test(n) ? 'mesačný diár' : /diar/.test(n) ? 'diár' : /stolov/.test(n) ? 'stolový kalendár' : /nastenn/.test(n) ? 'nástenný kalendár' : 'kalendár';
    case 'contact': return 'kontakt a pracovná doba ToneryMAXIM';
    case 'legal': return /cookies/.test(n) ? 'nastavenie cookies' : 'obchodné podmienky a ochrana osobných údajov';
    case 'order': return 'stav objednávky';
    case 'product': return frame.reference || 'produkt';
  }
}

export function resolveConversationContext(message: string, history: ConversationTurn[] = [], state: ContextState = {}, page = ''): ConversationContext {
  const question = String(message || '').trim(), n = norm(question);
  const turns = history.slice(-20);
  const { frames, active } = framesFromHistory(turns);
  const explicit = conversationTopic(question);
  const reference = explicit === 'product' ? conversationProductReference(question) : null;
  const returns = explicitReturn.test(n);
  const newCue = /\b(?:ina\s+otazka|zmenme\s+temu|nova\s+otazka|teraz\s+nieco\s+ine)\b/.test(n);
  const result: ConversationContext = { relation: 'new', topic: explicit, question, contextHistory: [], productQuery: null, orderNumber:null, explicitProductReturn: false, resetSelection: false, clarification: null };
  if (!question) return result;
  const productPage=conversationProductPage(page);
  if(quantity.test(n)&&active&&!['product','calendar','discount'].includes(active.topic))return {...result,relation:'clarify',topic:null,resetSelection:true,clarification:'Čo znamená tento počet — kusy produktu, číslo objednávky alebo iný údaj? Napíšte, prosím, k čomu sa vzťahuje.'};
  if(productPage&&active?.topic==='product'&&active.page&&productPage!==active.page&&!reference&&(explicit==='product'||/\b(?:cena|cenu|stoji|tento|ten|to)\b/.test(n)))return {...result,topic:'product',resetSelection:true};
  if (acknowledgement.test(n) && !/^(ano|nie)[.! ]*$/.test(n)) return { ...result, relation: 'acknowledge', topic: active?.topic || null, contextHistory: active ? turns.slice(active.start, active.end + 1) : [] };
  if (/^\/produkt\//.test(page) && /^(?:(?:a|ano|myslim)[, ]+)?(?:tento|tato|tieto|tuto|ten|to)(?:\s+(?:produkt|toner|napln|sada|sadu|kompatibilny|originalny|renovovany)){0,3}[?.! ]*$/.test(n)) return {...result,topic:'product'};
  if(hasExplicitCartAddCommand(question)&&!explicit&&active?.topic==='product')return {...result,relation:'follow_up',topic:'product',productQuery:active.reference||state.lastProductQuery||null,contextHistory:turns.slice(active.start,active.end+1)};
  if(!explicit&&isProductPriceQuestion(question)){
    const product=frames.findLast(frame=>frame.topic==='product');
    if(product)return {...result,relation:active===product?'follow_up':'resume',topic:'product',productQuery:product.reference||state.lastProductQuery||null,contextHistory:turns.slice(product.start,product.end+1)};
  }
  if(!explicit&&active?.topic==='product'&&/\b(?:cena|cenu|ceny|stoji|stoja)\b/.test(n))return {...result,relation:'follow_up',topic:'product',productQuery:active.reference||state.lastProductQuery||null,contextHistory:turns.slice(active.start,active.end+1)};
  if(!explicit&&active?.topic==='calendar'&&/\b(?:modr\w*|cerven\w*|zelen\w*|ciern\w*|farb\w*|denn\w*|tyzdenn\w*|mini\w*)\b/.test(n))return {...result,relation:'follow_up',topic:'calendar',question:`${question} ${subject(active)}.`,contextHistory:turns.slice(active.start,active.end+1)};

  let target = active;
  if (explicit) {
    // A postage question during a return is about returning the goods unless
    // the customer explicitly switches to a new purchase or outbound delivery.
    const returnPostage = active?.topic === 'claim' && (explicit === 'shipping'||explicit === 'payment') && (/postovn|doprav/.test(n)||/dobierk/.test(n)&&/poslat|poslem|odoslat/.test(n)&&referenceWords.test(n))
      && !/nov\w*\s+(?:nakup|objednavk)|dorucenie\s+(?:noveho|nakupu)|ina\s+otazka/.test(n);
    if (returnPostage) result.topic = 'claim';
    const discountRequirement = active?.topic === 'discount' && explicit === 'account' && !newCue && !/\bhesl\w*\b/.test(n)
      && (/\b(?:musim|treba|potrebujem|je\s+nutne|je\s+potrebne)\b.*\b(?:prihlas\w*|registr\w*|zaregistr\w*)\b/.test(n)
        || referenceWords.test(n) && /\b(?:prihlas\w*|registr\w*|zaregistr\w*|ucet|uctu)\b/.test(n));
    if (discountRequirement) result.topic = 'discount';
    const candidates = frames.filter(frame => frame.topic === result.topic);
    if (returns && /povodn/.test(n)) target = candidates[0] || null;
    else if (reference) target = candidates.findLast(frame => norm(frame.reference) === norm(reference)) || null;
    else target = candidates.at(-1) || null;
    const newProduct = reference && (!active?.reference || norm(reference) !== norm(active.reference));
    const compatibilityCheck=/\b(?:pasuj\w*|hodi\w*|je\s+(?:to\s+)?kompatibiln\w*)\b/.test(n);
    result.resetSelection = Boolean(newProduct && !state.pendingProductQuestion && (active?.reference || /\b(?:hladam|najdi|potrebujem|chcem|ina|dalsia|teraz)\b/.test(n)) && !compatibilityCheck)
      || explicit==='calendar'&&active?.topic!=='calendar';
    if (newProduct && !target) return result;
    // A fully stated new question never inherits qualifiers such as Czech
    // delivery, an old colour or the former purchase quantity by accident.
    if (!returns && !returnPostage && !discountRequirement && !referenceWords.test(n) && !/^a\s+/.test(n)
      && !productModifier.test(n) && !quantity.test(n)) return result;
  } else if (newCue || !continuation(question)) return { ...result, resetSelection: true };

  if (!target && !explicit && /^(?:a\s+)?(?:tento|tato|tieto|tuto|ten|to)(?:\s+(?:produkt|toner))?[?.! ]*$/.test(n)) {
    // The existing page resolver can identify a newly opened product detail.
    return { ...result, topic: 'product' };
  }
  if (!target && !turns.length && state.lastProductQuery && state.pendingQuestion && (explicit === 'product' || quantity.test(n))) target = { topic: 'product', anchor: state.lastProductQuery, reference: state.lastProductQuery, start: 0, end: -1 };
  if (!target && explicit === 'product' && (state.lastProductQuery || state.currentProductId || /^\/produkt\//.test(page))) return result;
  if (!target && !explicit && (continuation(question) || returns)) return {
    ...result, relation: 'clarify', resetSelection: true,
    clarification: 'Na čo nadväzujete — na produkt, dopravu, platbu, zľavu alebo inú predchádzajúcu otázku? Napíšte, prosím, čo konkrétne máte na mysli.',
  };
  if (!target) return result;
  result.topic = target.topic;
  result.relation = active === target ? 'follow_up' : 'resume';
  result.contextHistory = turns.slice(target.start, target.end + 1);
  if (result.topic === 'product') {
    if(returns&&!target.reference)return {...result,relation:'clarify',productQuery:null,resetSelection:true,clarification:'Ku ktorému produktu sa chcete vrátiť? Napíšte jeho označenie alebo otvorte jeho detail.'};
    result.productQuery = target.reference || state.lastProductQuery || null;
    result.explicitProductReturn = returns && Boolean(result.productQuery);
  } else {
    if(result.topic==='order')result.orderNumber=target.anchor.match(/\b(?:tm\s*)?(\d{5,12})\b/i)?.[1]||null;
    // The suffix contains a subject only, never historical buy commands.
    const contextSubject = subject(target);
    if ((!explicit || explicit !== target.topic || returns || referenceWords.test(n)) && !n.includes(norm(contextSubject))) result.question = `${question} ${contextSubject}.`;
  }
  return result;
}
