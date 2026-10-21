import { aiKnowledge } from '../data/ai-knowledge.ts';
import { isProductPriceQuestion } from './ai-commerce/price-question.ts';
import { hasExplicitCartAddCommand } from './ai-cart-safety.ts';
import { resolveConversationContext } from './ai-conversation-context.ts';

type Turn = { role: string; content: string };
const norm = (value: string) => String(value || '').toLocaleLowerCase('sk-SK').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const percent = (text: string, value: number) => new RegExp(`\\b${value}\\s*(?:%|percent\\w*)`).test(text);
const topic = /\b(?:zlav\w*|kupon\w*|vernost\w*|bod(?:y|ov|mi|och|u|om)?|odmen\w*|uvitac\w*)\b/;
const followUp = /\b(?:kde|kam|ako|kedy|preco|nepris\w*|nevid\w*|nenaj\w*|najd\w*|zobraz\w*|uplat\w*|pouzi\w*|zad\w*|aktiv\w*|zotri\w*|plati|platnost|expiro\w*|automat\w*|e-?mail\w*|posta|spam|mobil\w*|pc|pocitac\w*|teda|takze|ano|nie)\b/;
const unknownPercent = (text: string) => [...text.matchAll(/\b(\d{1,3})\s*(?:%|percent\w*)/g)].some(match => ![5, 7, 10, 15, 25].includes(Number(match[1])));
const issuedCouponQuestion = (text: string) => /\b(?:kupon\w*|zlavov\w*\s+kod\w*)\b/.test(text)
  && /\b(?:mam|moj\w*|dostal\w*|vydan\w*|uplat\w*|pouzi\w*|zadam|zadat)\b/.test(text)
  && !/\b(?:daj|vytvor\w*|vygener\w*|schval\w*)\b/.test(text);
function ellipticalFollowUp(text: string) {
  return followUp.test(text) && (/\b(?:ju|jej|ho|ten|tento|tieto|tato|tuto|ta|to|tom|ich|mi)\b/.test(text)
    || /\b(?:nepris\w*|nevidim|nenachadzam|nenajdem|mobil\w*|pocitac\w*|spam|automat\w*)\b/.test(text)
    || /^(?:(?:a|ale|tak|prosim)\s+)*(?:kde|kam|ako|dokedy|preco|kedy|ano|nie|email|e-mail|mail|na pc)[?.! ]*$/.test(text));
}
const discountIds = new Set([
  'registracia-zlava', 'odmena-7-percent', 'vernost-body', 'vernost-papier',
  'mnozstevne-zlavy-tonery', 'kalendare-mnozstvo-zlavy', 'kupony-uplatnenie',
  'zlavy-kombinovanie', 'zlavy-prehlad', 'zlava-upresnenie', 'newsletter-zlava', 'akciove-ceny',
]);

function directFaq(message: string): string | null {
  const n = norm(message);
  const isDiscount = topic.test(n);
  // A quotation or an actual product selection must keep the live catalogue
  // and its prices. Coupon identifiers (MAXIM...) are deliberately not OEMs.
  const productReference = /\b(?:hp|brother|canon|epson|samsung|lexmark|kyocera|xerox|ricoh|oki)\b|\b(?:tn|crg|cf|ce|w|tk|mlt|clt|pfi|lc)[- ]?\d{2,}/.test(n);
  if (isProductPriceQuestion(message) || hasExplicitCartAddCommand(message)
    || productReference && /\b(?:najdi|hladam|ukaz|vyhladaj)\w*\b/.test(n)) return null;
  if (!isDiscount && !/newsletter|akciov/.test(n)
    && !(/\b(?:kombin\w*|uplat\w*|pouzi\w*)\b/.test(n) && (percent(n, 5) || percent(n, 7)))) return null;
  // Do not turn a request for an invented promotion into an approved coupon.
  if (unknownPercent(n)) return issuedCouponQuestion(n) ? 'kupony-uplatnenie' : null;
  if (/newsletter|odber\w*\s+novin/.test(n)) return 'newsletter-zlava';
  if (/\b(?:kombin\w*|scita\w*|naraz|sucasne|poradie|poradi)\b/.test(n)
    || percent(n, 5) && percent(n, 7) && !/\bbod(?:y|ov|mi|och|u|om)?\b/.test(n)) return 'zlavy-kombinovanie';
  if ((/\b(?:papier\w*|baleni\w*)\b/.test(n) || /\b(?:500|800|1000|1\s*000)\s+bod/.test(n) && /odmen/.test(n)) && /vernost|odmen|\bbod(?:y|ov|mi|och|u|om)?\b/.test(n)) return 'vernost-papier';
  if (/\bbod(?:y|ov|mi|och|u|om)?\b|vernost/.test(n)) return 'vernost-body';
  if (percent(n, 7)) return 'odmena-7-percent';
  if (/\b(?:registrac\w*|zaregistr\w*|uvitac\w*|prvy\s+nakup)\b/.test(n) && !/\bbez\s+registrac/.test(n)) return 'registracia-zlava';
  if (/\b(?:kalendar\w*|diar\w*|minidiar\w*)\b/.test(n) || percent(n, 15) && !/kupon/.test(n)) return 'kalendare-mnozstvo-zlavy';
  if (percent(n, 5)) return 'registracia-zlava';
  if (/\bdals\w*\s+nakup\w*\b|\bpo\s+(?:(?:dokonc\w*|uspesn\w*)\s+)?(?:objednavk\w*|nakupe)\b/.test(n)) return 'odmena-7-percent';
  if (/akciov|\bakci[auye]\b/.test(n)) return 'akciove-ceny';
  if (/\bkupon\w*\b|\bzlavov\w*\s+kod\w*\b/.test(n)) return 'kupony-uplatnenie';
  if (percent(n, 10) || percent(n, 25) || /mnozstevn/.test(n) && /toner|kompatibil|original|rovnak|sku/.test(n)) return 'mnozstevne-zlavy-tonery';
  if (/\b(?:ake|aku|aka|aky|mate|ponukat\w*|ponukate|poskytn\w*|dostat|individual\w*|mnozstevn\w*|vsetk\w*|prehlad|vacsi\w*)\b/.test(n)) return 'zlavy-prehlad';
  return isDiscount ? 'zlava-upresnenie' : null;
}

function recentDiscountFaq(history: Turn[]): string | null {
  // Follow only the current topic. Never revive an old discount after a new
  // shipping/product/password question, and never use history text as facts.
  for (const turn of history.slice(-8).reverse()) {
    if (turn.role === 'assistant') {
      const item = aiKnowledge.find(item => discountIds.has(item.id) && turn.content.trim().startsWith(`${item.title}:`));
      if (item) return item.id;
      continue;
    }
    const id = directFaq(turn.content);
    if (id && id !== 'zlava-upresnenie') return id;
    if (topic.test(norm(turn.content)) || turn.content.length <= 180 && ellipticalFollowUp(norm(turn.content))) continue;
    return null;
  }
  return null;
}

export function discountFaqForMessage(message: string, history: Turn[] = []): string | null {
  const conversation=resolveConversationContext(message,history);
  if(conversation.relation==='clarify'||conversation.relation==='acknowledge')return null;
  history=conversation.contextHistory;
  message=conversation.question;
  const n = norm(message);
  if (/clovek|operator|predajca|zavolajte|kontaktujte ma/.test(n)) return null;
  // The shipping threshold is checked after discounts and has its own facts.
  if (/\b(?:doprav\w*|postovn\w*)\b/.test(n) && !/\b(?:kombin\w*|scita\w*|sucasne|poradie|poradi)\b/.test(n)) return null;
  if (isProductPriceQuestion(message) || hasExplicitCartAddCommand(message)) return null;
  if (unknownPercent(norm(message)) && !issuedCouponQuestion(norm(message))) return null;
  const direct = directFaq(message);
  if (direct && direct !== 'zlava-upresnenie') return direct;
  // A self-contained new service question is not an elliptical discount reply.
  if (!topic.test(n) && /\b(?:doprav\w*|postovn\w*|balik\w*|objednavk\w*|zasielk\w*|hesl\w*|reklam\w*|toner\w*|tlaciarn\w*|platb\w*|zaplat\w*|kontakt\w*|telefon\w*|hp|canon|epson|brother)\b/.test(n)) return null;
  if (message.length <= 180 && (topic.test(n) && followUp.test(n) || ellipticalFollowUp(n))) {
    const recent = recentDiscountFaq(history);
    if (recent) return recent;
  }
  return direct;
}

export function discountHelpAnswer(message: string, history: Turn[] = []) {
  const id = discountFaqForMessage(message, history);
  const item = id && aiKnowledge.find(item => item.id === id);
  return item ? {
    answer: [`${item.title}:`, ...item.answer], products: [], groups: [],
    intent: item.intent, faq: item.id, confidence: 1, unanswered: false,
    clarification: item.id === 'zlava-upresnenie',
  } : null;
}
