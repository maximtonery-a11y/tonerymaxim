import assert from "node:assert/strict";
import test from "node:test";
import { siteDemand, changedOffers, demandOffers } from "../src/lib/ads-site-demand.ts";
import type { TMAnalyticsEvent } from "../src/lib/tm-analytics.ts";
const now = Date.parse("2026-11-24T12:00:00Z");
const items = [
  {id:23, sku:"INK-23",name:"Canon PGI-570XL čierna kompatibilná náplň",product_type_key:"compatible"},
  {id:24, sku:"INK-24",name:"Canon PFI-707 renovovaná sada",product_type_key:"renovated",stock_status:"onbackorder"},
  {id:25, sku:"OEM-25",name:"Canon PFI-707 originálna náplň",product_type_key:"original"}
];
function event(changes: Partial<TMAnalyticsEvent> = {}): TMAnalyticsEvent {
  return {type:"pageview",title:"Canon PI570 – tonery a náplne | ToneryMaxim.sk", path:"/produkty", sessionId:"test-session", ts:new Date(now-1000).toISOString(),...changes};
}
test("counts related searches once per session, records real quantities and skips owners and old events",()=>{
  const add=(qty:number)=>event({type:"add_to_cart", meta:{item_ids:"INK-23:"+qty}});
  const rows=siteDemand(items,[event(),event(),event({sessionId:"other",owner:true}),add(1),add(4),event({sessionId:"stale",ts:new Date(now-3600000).toISOString()}),event({type:"search",search:"PFI-707"})],now);
  assert.equal(rows.length,2);
  assert.deepEqual([rows[0].offer_id, rows[0].search_sessions_matching_product,rows[0].add_sessions,rows[0].four_or_more_same_item_sessions],["23",1,1,1]);
  assert.equal(rows[1].offer_id,"24"); assert.equal(rows[1].stock_status,"onbackorder");
  assert.ok(!JSON.stringify(rows).includes("test-session"));
});
test("ambiguous SKU and unrelated searches are ignored",()=>{
  assert.deepEqual(siteDemand([...items,{...items[2],sku:"INK-23"}],[event({type:"add_to_cart",meta:{item_ids:"INK-23:4"}}),event({search:"private@example.sk",type:"search"})],now),[]);
});

test("price and stock changes keep missing, zero and removals separate", () => {
  const before = demandOffers([{...items[0],price:15,stock_quantity:null},items[1]]);
  const after = demandOffers([{...items[0],price:"12.50",stock_quantity:0}]);
  const changes = changedOffers(before,after,new Date(now).toISOString());
  assert.equal(changes.length,2);
  assert.equal(changes[0].before?.stock_quantity,null);
  assert.equal(changes[0].after?.stock_quantity,0);
  assert.equal(changes[0].after?.price_eur,12.5);
  assert.equal(changes[1].after,null);
  assert.deepEqual(changedOffers(after,after,"same"),[]);
});
