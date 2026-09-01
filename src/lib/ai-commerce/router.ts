import type { AiIntent, CommerceState } from './domain.ts';
import { analyzeCatalogQuery } from '../catalog-query.ts';
import { isGeneralCalendarQuestion } from '../calendar-ai-catalog.ts';

const norm = (v: unknown) => String(v || '').toLocaleLowerCase('sk-SK').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const productCode = /\b(?:(?:cf|ce|crg|tn|dr|q|clt|mlt|tk|pgi|cli|lc)(?:[- ]?[a-z])?[- ]?\d{2,}[a-z0-9-]*|w[- ]?\d{3,}[a-z0-9-]*)\b/i;
const printer = /\b(?:hp|brother|canon|epson|samsung|oki|xerox|kyocera|lexmark|ricoh|sharp|toshiba|pantum|dell|utax|ibm|panasonic|philips|konica(?:\s+minolta)?|minolta|minoltu)(?:\s+[a-z][a-z-]*){0,5}\s+[a-z-]*\d{1,}[a-z0-9-]*\b/i;

export function routeCommerceMessage(message: string, state: CommerceState) {
  const n = norm(message); const intents: AiIntent[] = [];
  const catalogQuery = analyzeCatalogQuery(message);
  const explicitReference = message.match(/\b(?=[A-Z0-9_-]{4,}\b)(?=[A-Z0-9_-]*[A-Z])(?=[A-Z0-9_-]*\d)[A-Z0-9]+(?:[-_][A-Z0-9]+)*\b/i)?.[0] || null;
  const sharedCatalogReference = Boolean(explicitReference) || (
    catalogQuery.brands.length > 0 && catalogQuery.referenceTokens.some(token => /^\d{2,6}[a-z]{0,4}$/i.test(token))
  );
  const calendarQuestion = /\b(kalendar|kalendat|kaledar|kalemdar|kalndar|calendar|diar|minidiar|planovac|pf|novorocn|nastenn|stolov|trojmesac|trojspiral)\w*\b/.test(n);
  const generalCalendarQuestion = isGeneralCalendarQuestion(message);
  const calendarInformationQuestion = calendarQuestion
    && /\b(ake|aky|aku|co|mate|predavate|ponukate|ponuke|sortiment)\b/.test(n);
  // Častý prepis kódu Samsung MLT-D111S: písmeno S zákazník zadá ako 1.
  // Alias je úmyselne úzky, aby sme neopravovali iné modelové čísla naslepo.
  const knownProductAlias = /^\s*(?:samsung\s+|mlt[- ]?)?d[- ]?111(?:s|1)\s*$/i.test(message)
    ? 'MLT-D111S'
    : null;
  const numericSku = /^\s*\d{4,12}\s*$/.test(message) ? message.trim() : null;
  // Service questions must be routable at any point of a shopping flow.  In
  // particular, a pending quantity/type question must never turn "can I pay
  // cash?" into a product follow-up using the previous catalogue query.
  const serviceQuestion = /\b(platit\w*|zaplatit\w*|hotovost\w*|kartou|gopay|dobierk\w*|prevod\w*|doprava|doruc\w*|kurier\w*|objednavk\w*|zasielk\w*|balik\w*|exped\w*|odosl\w*|stav\w*\s+objednavk\w*|osobn\w*\s+odber\w*|vyzdvih\w*|pickup|parcelshop|balikomat\w*|reklam\w*|vraten\w*|odstup\w*|faktur\w*|registr\w*|ucet|heslo|kontakt\w*|telefon\w*|e-?mail\w*|otvarac\w*|otvoren\w*|pracovn\w*\s+doba|kde\s+(?:vas|vás)\s+najd\w*|adres\w*|sidlo|vernost\w*|odmen\w*|zlav\w*|bod(?:y|ov)?)\b/.test(n);
  const pendingAnswer = state.pendingQuestion === 'quantity'
    ? /^(?:\s*(?:\d{1,2}|jeden|jednu|jedno|dva|dve|tri|styri|pat)\s*(?:ks|kus|kusy|kusov)?\s*)$/.test(n)
    : state.pendingQuestion === 'product_type'
      ? /\b(original|renov|repas|kompatibil)\w*\b/.test(n)
      : false;
  const explicitConsumableSearch=/(?:hladam|potrebujem|chcem|najdi|mate|toner|napln|atrament)/.test(n)&&/(?:toner|napln|atrament)/.test(n);
  const genericConsumableQuestion=explicitConsumableSearch&&!sharedCatalogReference&&!printer.test(message);
  const shortPrinter = state.currentPrinter && !productCode.test(message) ? message.match(/\b[A-Z]{1,4}[- ]?\d{3,}[A-Z0-9-]*\b/i)?.[0] : null;
  const add = (x: AiIntent) => { if (!intents.includes(x)) intents.push(x); };
  if (/(clovek|operator|predajca|zavolajte|kontaktujte ma)/.test(n)) add('HUMAN_ESCALATION');
  if (sharedCatalogReference || knownProductAlias || numericSku) add('PRODUCT_SEARCH');
  if (calendarQuestion && !generalCalendarQuestion) add('PRODUCT_SEARCH');
  // Všeobecná otázka na kalendárový sortiment potrebuje súčasne overenú
  // poradenskú odpoveď aj živé produkty. Bez ADVICE sa načítal iba katalóg
  // a pri nečakanom prázdnom výsledku sa zobrazila tonerová výzva.
  if (calendarInformationQuestion) add('ADVICE');
  // Všeobecný dopyt bez modelu/kódu potrebuje vysvetľujúcu otázku, nie
  // COLOR_TYPE_FILTER s prázdnou odpoveďou ani náhodný výpis katalógu.
  if (genericConsumableQuestion) add('ADVICE');
  if (serviceQuestion) add('POLICY');
  if (/\b(porad\w*|alternativ\w*|lacnejs\w*)\b/.test(n)) add('ADVICE');
  if (explicitConsumableSearch&&sharedCatalogReference) add('PRODUCT_SEARCH');
  if (printer.test(message)) add('PRINTER_SEARCH');
  if (shortPrinter) add('PRINTER_SEARCH');
  if (/(pasuje|kompatibil|do (nej|tlaciarne)|aky toner)/.test(n)) add('COMPATIBILITY');
  if (/(original.*kompat|kompat.*original|porovnaj|rozdiel)/.test(n)) add('PRODUCT_COMPARE');
  if (/(cierny|black|cyan|magenta|yellow|zlty|originalny|renovovany|kompatibilny)/.test(n)) add('COLOR_TYPE_FILTER');
  const explicitBuy = /\b(?:chcem\s+(?:kupit|objednat|zobrat)|kupim|kupit|zoberiem|zobrat|pridaj|objednaj|daj\s+mi)\b/.test(n)
    || (Boolean(sharedCatalogReference || printer.test(message) || state.lastProductQuery) && /\bchcem\b/.test(n));
  if (explicitBuy && !serviceQuestion) add('BUY_INTENT');
  const explicitCart = /\b(?:otvor|ukaz|zobraz|skontroluj)\w*(?:\s+\w+){0,3}\s+kosik\w*|\b(?:co|kolko)\s+mam\s+v\s+kosik\w*|\b(?:odstran|vymaz)\w*(?:\s+\w+){0,3}\s+(?:z\s+)?(?:kosik|produkt|polozk)\w*|(?:^|\s)[+−-]\s*\d/.test(n);
  if (explicitCart) add('CART');
  const explicitCheckout = /\b(?:pokladn\w*|sumar\w*|prejst\w*.*(?:pokladn|platb|doprav)|pokrac\w*.*(?:nakup|objednav)|dokonc\w*.*objednav|chcem\s+(?:kupit|objednat)|objednaj)\b/.test(n);
  if (explicitCheckout) add('CHECKOUT');
  if (/(zopak|ako naposledy|posli ako naposledy|posledn.*objednav)/.test(n)) add('ORDER_REPEAT');
  if (/(ako|preco|kolko stran|vydrz|vytaznost|pasy|pruhy|ciary|smuhy|slaba tlac|cip)/.test(n)) add('ADVICE');
  if (/(reklam|vraten|odstup|registr|vernost|obchodne podmienky)/.test(n)) add('POLICY');
  if (!serviceQuestion && !productCode.test(message) && !printer.test(message) && state.lastProductQuery && (/(ten|ho|ich|do nej|a original|a kompatibil|a renov|originalny|kompatibilny|renovovany|renovovanu|renovovany|repasovany|je skladom|kolko stran|chcem|zoberiem|pridaj|\bkus(?:y|ov)?\b|\bks\b|kosik|pokladn)/.test(n) || pendingAnswer)) add('FOLLOW_UP');
  if (!intents.length) add('UNKNOWN');
  const brand = String(state.currentPrinter || '').match(/^(hp|brother|canon|epson|samsung|oki|xerox|kyocera|lexmark|ricoh|sharp|toshiba|pantum|dell|konica(?:\s+minolta)?|minolta|minoltu)/i)?.[0];
  const calendarQuery=calendarQuestion&&!generalCalendarQuestion?message:null;
  const printerQuery = message.match(printer)?.[0] || (shortPrinter ? `${brand || ''} ${shortPrinter}`.trim() : null);
  const hasExplicitProductCode = productCode.test(message);
  // Pri modeli tlačiarne vraciame iba čistý model (napr. Epson WF-6090), nie
  // celú vetu „Hľadám náplne...“. OEM kód má naďalej prednosť, aby sa Canon
  // CRG054 alebo Brother TN2421 nikdy nepovažovali za model tlačiarne.
  const query = serviceQuestion ? null : calendarQuery || knownProductAlias || numericSku
    || (hasExplicitProductCode && sharedCatalogReference ? message : null)
    || printerQuery
    || (sharedCatalogReference ? message : null)
    || (intents.includes('FOLLOW_UP') ? state.lastProductQuery : null);
  return { intents, productQuery: query || null, needsProducts: Boolean(query) && intents.some(x => ['PRODUCT_SEARCH','PRINTER_SEARCH','COMPATIBILITY','PRODUCT_COMPARE','COLOR_TYPE_FILTER','BUY_INTENT','FOLLOW_UP'].includes(x)) };
}
