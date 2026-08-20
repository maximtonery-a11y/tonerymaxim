export type AiIntent =
  | 'PRODUCT_SEARCH' | 'PRINTER_SEARCH' | 'COMPATIBILITY' | 'PRODUCT_COMPARE'
  | 'COLOR_TYPE_FILTER' | 'BUY_INTENT' | 'CART' | 'CHECKOUT' | 'ORDER_REPEAT'
  | 'ADVICE' | 'POLICY' | 'HUMAN_ESCALATION' | 'FOLLOW_UP' | 'UNKNOWN';

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };
export type CartInput = { id?: string | number; sku?: string; quantity?: number; qty?: number };

export type CommerceState = {
  version: 1;
  sessionId: string;
  history: ConversationTurn[];
  currentPrinter: string | null;
  currentProductId: string | null;
  selectedProductId: string | null;
  currentColor: 'black' | 'cyan' | 'magenta' | 'yellow' | null;
  currentType: 'compatible' | 'original' | 'renovated' | null;
  cart: CartInput[];
  checkoutDraft: Record<string, unknown>;
  lastProductQuery: string | null;
  lastIntent: AiIntent | null;
  pendingQuestion: string | null;
};

export function emptyCommerceState(sessionId = ''): CommerceState {
  return { version: 1, sessionId, history: [], currentPrinter: null, currentProductId: null,
    selectedProductId: null, currentColor: null, currentType: null, cart: [], checkoutDraft: {},
    lastProductQuery: null, lastIntent: null, pendingQuestion: null };
}

const clean = (v: unknown, max = 500) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
export function normalizeCommerceState(raw: any): CommerceState {
  const base = emptyCommerceState(clean(raw?.sessionId, 80));
  const history = Array.isArray(raw?.history) ? raw.history.slice(-20).map((x: any) => ({
    role: x?.role === 'assistant' ? 'assistant' as const : 'user' as const, content: clean(x?.content),
  })).filter((x: ConversationTurn) => x.content) : [];
  const cart = Array.isArray(raw?.cart) ? raw.cart.slice(0, 30).map((x: any) => ({
    id: clean(x?.id, 40), sku: clean(x?.sku, 100), quantity: Math.min(99, Math.max(1, Math.floor(Number(x?.quantity ?? x?.qty) || 1))),
  })) : [];
  const color = ['black','cyan','magenta','yellow'].includes(raw?.currentColor) ? raw.currentColor : null;
  const type = ['compatible','original','renovated'].includes(raw?.currentType) ? raw.currentType : null;
  return { ...base, history, cart, currentPrinter: clean(raw?.currentPrinter, 120) || null,
    currentProductId: clean(raw?.currentProductId, 40) || null, selectedProductId: clean(raw?.selectedProductId, 40) || null,
    currentColor: color, currentType: type, checkoutDraft: raw?.checkoutDraft && typeof raw.checkoutDraft === 'object' ? raw.checkoutDraft : {},
    lastProductQuery: clean(raw?.lastProductQuery, 160) || null, lastIntent: raw?.lastIntent || null,
    pendingQuestion: clean(raw?.pendingQuestion, 500) || null };
}
