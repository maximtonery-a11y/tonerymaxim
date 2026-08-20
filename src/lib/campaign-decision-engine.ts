import type { ProductEconomics } from './product-economics.ts';

export type CampaignAction = 'SCALE' | 'KEEP' | 'LIMIT' | 'PAUSE' | 'EXCLUDE';
export type CampaignChannel = 'shopping' | 'search' | 'observe_only' | 'none';
export type DecisionConfidence = 'high' | 'medium' | 'low';

export type CampaignSignals = {
  clicks?: number; impressions?: number; cost?: number; conversions?: number; conversion_value?: number;
};

export type CampaignDecision = {
  product_id: string; sku: string; merchant_id: string; action: CampaignAction; channel: CampaignChannel;
  eligible: boolean; priority_score: number; max_cpc: number; break_even_cpa: number; target_cpa: number;
  break_even_roas: number; target_roas: number; budget_weight: number; confidence: DecisionConfidence;
  observed_clicks: number; observed_cost: number; observed_conversions: number; observed_conversion_value: number;
  reason_codes: string[];
};

const money = (v:number) => Math.round((v + Number.EPSILON) * 100) / 100;
const clamp = (v:number,min:number,max:number) => Math.max(min, Math.min(max,v));
const n = (v:unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;

export function decideCampaign(e: ProductEconomics, s: CampaignSignals = {}): CampaignDecision {
  const reasons:string[] = [];
  const clicks=n(s.clicks), cost=n(s.cost), conv=n(s.conversions), value=n(s.conversion_value);
  const eligible = e.merchant_eligible && e.selling_price > 0 && e.purchase_price_used > 0 && e.estimated_gross_margin > 0;
  if (!e.merchant_eligible) reasons.push('NOT_MERCHANT_ELIGIBLE');
  if (e.stock_status !== 'instock') reasons.push('OUT_OF_STOCK');
  if (e.estimated_gross_margin <= 0) reasons.push('NO_POSITIVE_MARGIN');
  if (e.confidence === 'low') reasons.push('LOW_ECONOMICS_CONFIDENCE');

  // V1 safety model: never allow acquisition cost to consume the full gross margin.
  const breakEvenCpa = Math.max(0, e.estimated_gross_margin);
  const safetyShare = e.confidence === 'high' ? 0.55 : e.confidence === 'medium' ? 0.40 : 0.25;
  const targetCpa = money(breakEvenCpa * safetyShare);
  const breakEvenRoas = breakEvenCpa > 0 ? money((e.selling_price / breakEvenCpa) * 100) : 9999;
  const targetRoas = targetCpa > 0 ? money((e.selling_price / targetCpa) * 100) : 9999;
  // Conservative CPC cap until product-level conversion history exists.
  const assumedCvr = conv > 0 && clicks > 0 ? clamp(conv / clicks, 0.005, 0.20) : 0.025;
  const maxCpc = money(targetCpa * assumedCvr);

  let score = 0;
  if (eligible) score += 30;
  score += clamp(e.estimated_gross_margin_pct,0,70) * 0.55;
  score += e.confidence_score * 0.20;
  if (e.product_type === 'compatible') score += 8;
  if (e.product_type === 'original') score -= 4;
  if (e.stock_quantity != null) score += e.stock_quantity >= 5 ? 5 : e.stock_quantity > 0 ? 2 : -20;
  score = Math.round(clamp(score,0,100));

  let action:CampaignAction = eligible ? (score >= 75 ? 'SCALE' : score >= 55 ? 'KEEP' : 'LIMIT') : 'EXCLUDE';
  if (eligible && clicks >= 8 && conv === 0 && cost >= Math.max(targetCpa, 5)) { action='PAUSE'; reasons.push('SPEND_WITHOUT_CONVERSION'); }
  if (eligible && conv > 0 && cost/conv > targetCpa) { action='LIMIT'; reasons.push('CPA_ABOVE_TARGET'); }
  if (eligible && value > 0 && cost > 0 && (value/cost)*100 < targetRoas) { action='LIMIT'; reasons.push('ROAS_BELOW_TARGET'); }
  if (eligible && conv > 0 && cost/conv <= targetCpa) reasons.push('CPA_WITHIN_TARGET');

  const channel:CampaignChannel = !eligible ? 'none' : e.confidence === 'low' ? 'observe_only' : e.product_type === 'compatible' ? 'shopping' : 'search';
  if (channel === 'observe_only') reasons.push('OBSERVE_ONLY_LOW_CONFIDENCE');
  const weight = action === 'SCALE' ? 1.5 : action === 'KEEP' ? 1 : action === 'LIMIT' ? 0.5 : 0;
  if (eligible && reasons.length === 0) reasons.push('ECONOMICS_OK_NO_NEGATIVE_SIGNAL');

  return { product_id:e.product_id, sku:e.sku, merchant_id:e.merchant_id, action, channel, eligible,
    priority_score:score, max_cpc:maxCpc, break_even_cpa:money(breakEvenCpa), target_cpa:targetCpa,
    break_even_roas:breakEvenRoas, target_roas:targetRoas, budget_weight:weight,
    confidence:e.confidence, observed_clicks:clicks, observed_cost:money(cost), observed_conversions:conv,
    observed_conversion_value:money(value), reason_codes:reasons };
}

export function buildCampaignDecisions(economics: ProductEconomics[], signals: Map<string, CampaignSignals> = new Map()): CampaignDecision[] {
  return economics.map(e => decideCampaign(e, signals.get(e.merchant_id) ?? signals.get(e.sku) ?? {}));
}
