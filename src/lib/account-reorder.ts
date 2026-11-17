import { wooRequest } from './woo-client';
import { getProductsCache } from './tm-products-cache';
import { CALENDAR_SOURCE, getCalendarProducts } from './calendar-catalog';
import { isAvailableNow, orderFulfilmentText, storefrontStockText } from './product-availability';
import { AccountOrderError, type AccountOrder } from './account-orders';

export type ReorderItem = {
  id: string; productId: string; product_id: string; sku: string; name: string; price: number; qty: number;
  url: string; image: string; slug: string; product_type_key: string; product_type_label: string;
  stock_status: string; stock_quantity: number | null; stock_text: string; capacity: string; color: string;
  warranty: string; series_pack_key: string; series_pack_label: string; series_pack_discount_rate: number; source?: string;
};
export type ReorderPlan = { orderId: number; orderNumber: string; checkedAt: number; items: ReorderItem[]; skipped: Array<{ name: string; reason: string }> };
const text = (value: unknown) => String(value ?? '').trim();
const validId = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
function stockText(product: Record<string, any>, qty: number) {
  return isAvailableNow(product) && product.stock_quantity == null ? storefrontStockText(product) : orderFulfilmentText(product, qty);
}
function meta(line: NonNullable<AccountOrder['line_items']>[number], key: string) {
  return text(line.meta_data?.find(entry => entry.key === key)?.value);
}
function cartItem(product: Record<string, any>, qty: number): ReorderItem {
  return {
    id: text(product.id), productId: text(product.id), product_id: text(product.id), sku: text(product.sku),
    name: text(product.name).slice(0, 250), price: Math.round(Number(product.price) * 100) / 100, qty,
    url: product.slug ? '/produkt/' + encodeURIComponent(product.slug) : '/produkty?s=' + encodeURIComponent(product.sku),
    image: text(product.image), slug: text(product.slug), product_type_key: text(product.product_type_key), product_type_label: text(product.product_type_label),
    stock_status: text(product.stock_status), stock_quantity: product.stock_quantity == null ? null : Number(product.stock_quantity),
    stock_text: stockText(product, qty), capacity: text(product.capacity || product.page_yield), color: text(product.color),
    warranty: text(product.warranty || '24 mesiacov'), series_pack_key: text(product.series_pack_key), series_pack_label: text(product.series_pack_label),
    series_pack_discount_rate: Number(product.series_pack_discount_rate) || 0,
  };
}
export async function prepareAccountReorder(customerId: number, orderId: number): Promise<ReorderPlan> {
  if (!validId(customerId)) throw new AccountOrderError('Neprihlásený zákazník.', 401);
  if (!validId(orderId)) throw new AccountOrderError('Neplatná objednávka.', 400);
  let order: AccountOrder;
  try { order = await wooRequest<AccountOrder>('/orders/' + orderId); } catch { throw new AccountOrderError('Objednávka nie je dostupná.', 404); }
  // Never infer ownership from an email address, a submitted customer_id or an order key.
  if (order?.id !== orderId || Number(order.customer_id) !== customerId) throw new AccountOrderError('Objednávka nie je dostupná.', 404);
  if (!Array.isArray(order.line_items) || order.line_items.length > 200) throw new AccountOrderError('Túto objednávku momentálne nemožno zopakovať.', 422);
  const plan: ReorderPlan = { orderId, orderNumber: text(order.number || order.id), checkedAt: Date.now(), items: [], skipped: [] };
  const lines = order.line_items;
  if (!lines.length) return plan;
  const ids = [...new Set(lines.filter(line => !line.variation_id && validId(line.product_id)).map(line => Number(line.product_id)))];
  const cache = ids.length ? await getProductsCache() : { products: [] };
  const catalog = new Map<string, Record<string, any>>((cache.products || []).map((product: any) => [text(product.id), product]));
  const live = new Map<string, Record<string, any>>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const products = await wooRequest<any[]>('/products', { query: { include: chunk.join(','), per_page: chunk.length,
      status: 'publish', _fields: 'id,sku,name,slug,price,status,stock_status,stock_quantity,purchasable' } });
    if (!Array.isArray(products)) throw new AccountOrderError();
    for (const product of products) if (chunk.includes(Number(product.id))) live.set(text(product.id), product);
  }
  const calendarLines = lines.filter(line => meta(line, 'tm_catalog_source') === CALENDAR_SOURCE);
  const calendars = calendarLines.length ? await getCalendarProducts() : [];
  for (const line of lines) {
    const name = text(line.name || line.sku || 'Produkt').slice(0, 250);
    const skip = (reason: string) => plan.skipped.push({ name, reason });
    if (meta(line, 'tm_loyalty_reward') === 'yes' || text(line.sku) === 'TM-LOYALTY-PAPER-REWARD') {
      skip('Vernostný darček sa neprenáša zo starej objednávky. Dostupnú odmenu nájdete v košíku.'); continue;
    }
    const quantity = Number(line.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) { skip('Pôvodné množstvo sa nepodarilo overiť.'); continue; }
    const qty = Math.min(99, quantity);
    if (quantity > 99) skip('Do košíka možno vložiť najviac 99 ks jednej položky.');
    let item: ReorderItem;
    if (meta(line, 'tm_catalog_source') === CALENDAR_SOURCE) {
      const calendar = calendars.find(product => product.sku === text(line.sku || meta(line, 'sku')));
      if (!calendar?.availability.inStock) { skip('Kalendár už nie je dostupný.'); continue; }
      item = { ...cartItem({ ...calendar, id: 'calendar:' + calendar.sku, product_type_key: 'calendar', product_type_label: calendar.category || 'Kalendár', stock_status: 'instock' }, qty), source: CALENDAR_SOURCE };
      item.url = '/kalendare/' + encodeURIComponent(calendar.slug || '');
    } else {
      if (line.variation_id) { skip('Tento variant vyberte znovu priamo pri produkte.'); continue; }
      const cached = catalog.get(text(line.product_id));
      const current = live.get(text(line.product_id));
      if (!cached || !current || current.status !== 'publish' || current.purchasable === false || !text(current.sku)
        || (text(line.sku) && text(line.sku) !== text(current.sku)) || !Number.isFinite(Number(current.price)) || Number(current.price) <= 0) {
        skip('Produkt už nie je dostupný v pôvodnom vyhotovení.'); continue;
      }
      item = cartItem({ ...cached, ...current }, qty);
    }
    const duplicate = plan.items.find(existing => existing.sku === item.sku);
    if (duplicate) {
      if (duplicate.id !== item.id) throw new AccountOrderError('Produkty sa nepodarilo jednoznačne overiť.');
      const total = duplicate.qty + item.qty;
      duplicate.qty = Math.min(99, total);
      duplicate.stock_text = stockText(duplicate, duplicate.qty);
      if (total > 99) skip('Do košíka možno vložiť najviac 99 ks jednej položky.');
    } else plan.items.push(item);
  }
  plan.checkedAt = Date.now();
  return plan;
}
