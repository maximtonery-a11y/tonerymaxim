import type { APIRoute } from "astro";
import { readCustomerSession } from "../../lib/auth-session";
import { getWooCustomerById, getWooCustomerOrders } from "../../lib/woo-client";
import { resolveCommerceProducts } from "../../lib/ai-commerce/catalog";

export const prerender = false;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const validOrder = (o: any) => !["cancelled","refunded","failed","trash"].includes(String(o?.status || "").toLowerCase()) && Array.isArray(o?.line_items) && o.line_items.length;
const compact = (v: any) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

function shippingKey(order: any) {
  const t = `${order?.shipping_lines?.map((x:any)=>`${x?.method_title||""} ${x?.method_id||""}`).join(" ")||""} ${order?.meta_data?.map((x:any)=>`${x?.key||""} ${x?.value||""}`).join(" ")||""}`.toLowerCase();
  if (t.includes("gls") && (t.includes("parcel") || t.includes("pickup") || t.includes("balík") || t.includes("balik"))) return "gls_pickup";
  if (t.includes("gls")) return "gls_courier";
  if (t.includes("dpd") && t.includes("box")) return "dpd_box";
  if (t.includes("dpd") && (t.includes("pickup") || t.includes("odbern") || t.includes("výdajn") || t.includes("vydajn"))) return "dpd_pickup";
  return "dpd_courier";
}
function paymentKey(order: any) {
  const t = `${order?.payment_method||""} ${order?.payment_method_title||""}`.toLowerCase();
  if (t.includes("dobier") || t.includes("cod")) return "cod";
  if (t.includes("gopay") || t.includes("kart")) return "gopay";
  if (t.includes("fakt") || t.includes("invoice")) return "invoice_org";
  return "bank_prepaid";
}
async function currentProduct(item: any) {
  const q = String(item?.sku || item?.name || "").trim();
  if (!q) return null;
  const resolved = await resolveCommerceProducts(q);
  const byId = resolved.products.find(p => Number(p.id) === Number(item?.product_id));
  const bySku = resolved.products.find(p => compact(p.sku) === compact(item?.sku));
  const p = byId || bySku || (resolved.products.length === 1 ? resolved.products[0] : null);
  return p ? { ...p, historical_quantity: Math.max(1, Number(item?.quantity || 1)) } : null;
}

export const GET: APIRoute = async ({ cookies }) => {
  const session = readCustomerSession(cookies);
  if (!session) return json({ ok: false, loggedIn: false }, 401);
  const [customer, rawOrders] = await Promise.all([getWooCustomerById(session.id), getWooCustomerOrders(session.id, 50)]);
  if (!customer) return json({ ok: false, loggedIn: false }, 401);
  const orders = (rawOrders || []).filter(validOrder);
  const last = orders[0] || null;
  const lastResolved = last ? await Promise.all((last.line_items || []).map(async(item:any)=>({ item, product:await currentProduct(item) }))) : [];
  const lastProducts = lastResolved.map(x=>x.product).filter(Boolean);
  const unavailableProducts = lastResolved.filter(x=>!x.product).map(x=>({ sku:String(x.item?.sku||''), name:String(x.item?.name||'Produkt'), historical_quantity:Math.max(1,Number(x.item?.quantity||1)) }));
  const aggregate = new Map<string, any>();
  for (const order of orders) for (const item of (order.line_items || [])) {
    const key = String(item.product_id || compact(item.sku) || compact(item.name));
    const x = aggregate.get(key) || { item, count: 0, qtyTotal: 0, lastDate: order.date_created || "" };
    x.count++; x.qtyTotal += Number(item.quantity || 0); aggregate.set(key, x);
  }
  const frequentRaw = [...aggregate.values()].sort((a,b)=>b.count-a.count || String(b.lastDate).localeCompare(String(a.lastDate))).slice(0,8);
  const frequentProducts = (await Promise.all(frequentRaw.map(async x => {
    const p:any = await currentProduct(x.item); if (!p) return null;
    return { ...p, purchase_count: x.count, suggested_quantity: Math.max(1, Math.round(x.qtyTotal / x.count)) };
  }))).filter(Boolean);
  const b:any = last?.billing || customer.billing || {};
  const s:any = last?.shipping && Object.values(last.shipping).some(Boolean) ? last.shipping : (customer.shipping || b);
  return json({ ok: true, loggedIn: true, customer: { first_name: customer.first_name || b.first_name || "", last_name: customer.last_name || b.last_name || "", email: customer.email || b.email || "", phone: b.phone || "", address: s.address_1 || b.address_1 || "", zip: s.postcode || b.postcode || "", city: s.city || b.city || "" }, orderCount: orders.length, lastOrder: last ? { id:last.id, number:last.number||String(last.id), date:last.date_created, products:lastProducts, unavailableProducts, shipping:shippingKey(last), payment:paymentKey(last), shippingLabel:(last as any).shipping_lines?.[0]?.method_title || "Doprava ako naposledy", paymentLabel:last.payment_method_title || "Platba ako naposledy" } : null, frequentProducts });
};
