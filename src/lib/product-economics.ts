import type { TmProduct } from './tm-products-cache.ts';

export type EconomicsMaterial = 'toner' | 'ink' | 'other';
export type EconomicsProductType = 'compatible' | 'renovated' | 'original' | 'other';
export type EconomicsConfidence = 'high' | 'medium' | 'low';

export type ProductEconomics = {
  product_id: string;
  woo_id: string;
  sku: string;
  merchant_id: string;
  name: string;
  brand: string;
  product_type: EconomicsProductType;
  material_type: EconomicsMaterial;
  selling_price: number;
  selling_price_no_vat: number;
  margin_multiplier: number;
  estimated_purchase_price: number;
  real_purchase_price: number | null;
  purchase_price_used: number;
  purchase_price_source: 'abix' | 'estimated';
  estimated_gross_margin: number;
  estimated_gross_margin_pct: number;
  stock_quantity: number | null;
  stock_status: string;
  merchant_eligible: boolean;
  confidence: EconomicsConfidence;
  confidence_score: number;
  reason_codes: string[];
};

function n(value: unknown): number {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}
function money(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function norm(value: unknown): string {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function categoryText(product: TmProduct): string {
  return (Array.isArray(product.categories) ? product.categories : []).map((c: any) => `${c?.name || ''} ${c?.slug || ''}`).join(' ');
}
function materialType(product: TmProduct): EconomicsMaterial {
  const text = norm(`${product.name || ''} ${product.slug || ''} ${product.product_type_detail_label || ''} ${categoryText(product)}`);
  if (/\batrament\b|\bink\b|inkjet|kazet|napln/.test(text)) return 'ink';
  if (/\btoner\b|laserov/.test(text)) return 'toner';
  return 'other';
}
function productType(product: TmProduct): EconomicsProductType {
  const key = String(product.product_type_key || '').toLowerCase();
  if (key === 'compatible' || key === 'renovated' || key === 'original') return key;
  const text = norm(`${product.name || ''} ${product.product_type_detail_label || ''} ${categoryText(product)}`);
  if (/kompatibil|alternativ/.test(text)) return 'compatible';
  if (/renovovan|repasovan|remanufactured/.test(text)) return 'renovated';
  if (/original/.test(text)) return 'original';
  return 'other';
}
function brand(product: TmProduct): string {
  const explicit = norm(product.product_brand || '');
  if (explicit) return explicit;
  const text = norm(`${product.name || ''} ${categoryText(product)}`);
  for (const b of ['epson', 'xerox', 'brother', 'canon', 'hp']) if (new RegExp(`\\b${b}\\b`).test(text)) return b;
  return '';
}

/**
 * Mirrors the current All Import pricing rules. For threshold rules (Xerox toner
 * and Epson ink) reverse calculation can be ambiguous without supplier COGS.
 * In that overlap we return the standard multiplier and lower confidence so the
 * record is never presented as an exact purchase price.
 */
function multiplierFor(product: TmProduct, sellingPrice: number, vatRate: number): { multiplier: number; confidence: EconomicsConfidence; reasons: string[] } {
  const material = materialType(product);
  const type = productType(product);
  const b = brand(product);
  const reasons: string[] = [];

  if (material === 'toner') {
    if (type === 'compatible') {
      if (b === 'xerox') {
        const specialNet = (sellingPrice / 1.9) / (1 + vatRate);
        const standardNet = (sellingPrice / 3.0) / (1 + vatRate);
        if (specialNet >= 20 && standardNet < 20) {
          reasons.push('XEROX_THRESHOLD_AMBIGUOUS_WITHOUT_COGS');
          return { multiplier: 3.0, confidence: 'low', reasons };
        }
      }
      return { multiplier: 3.0, confidence: 'high', reasons };
    }
    if (type === 'renovated') return { multiplier: 1.9, confidence: 'high', reasons };
    if (type === 'original') return { multiplier: 1.3, confidence: 'high', reasons };
    reasons.push('UNKNOWN_TONER_MATERIAL_TYPE');
    return { multiplier: 1.3, confidence: 'medium', reasons };
  }

  if (material === 'ink') {
    if (type === 'compatible') {
      if (b === 'epson') {
        const specialNet = (sellingPrice / 1.9) / (1 + vatRate);
        const standardNet = (sellingPrice / 4.0) / (1 + vatRate);
        if (specialNet >= 8 && standardNet < 8) {
          reasons.push('EPSON_THRESHOLD_AMBIGUOUS_WITHOUT_COGS');
          return { multiplier: 4.0, confidence: 'low', reasons };
        }
      }
      return { multiplier: 4.0, confidence: 'high', reasons };
    }
    if (type === 'renovated') return { multiplier: 1.9, confidence: 'high', reasons };
    if (type === 'original') return { multiplier: 1.3, confidence: 'high', reasons };
    reasons.push('UNKNOWN_INK_MATERIAL_TYPE');
    return { multiplier: 1.3, confidence: 'medium', reasons };
  }

  reasons.push('FALLBACK_OTHER_PRODUCT');
  return { multiplier: 1.3, confidence: 'medium', reasons };
}

export function buildProductEconomics(product: TmProduct, options: { vatRate?: number; realPurchasePrice?: number | null } = {}): ProductEconomics {
  const sellingPrice = n(product.price || product.sale_price || product.regular_price);
  const vatRate = Number.isFinite(options.vatRate) ? Number(options.vatRate) : 0.23;
  const rule = multiplierFor(product, sellingPrice, vatRate);
  const sellingPriceNoVat = vatRate >= 0 ? money(sellingPrice / (1 + vatRate)) : sellingPrice;
  // All Import multipliers are applied to supplier price without VAT. The old
  // calculation compared a gross selling price with a net supplier price and
  // therefore overstated margin and every CPC/CPA ceiling derived from it.
  const purchase = rule.multiplier > 0 ? money(sellingPriceNoVat / rule.multiplier) : 0;
  const realPurchase = Number.isFinite(options.realPurchasePrice) && Number(options.realPurchasePrice) > 0 ? money(Number(options.realPurchasePrice)) : null;
  const purchaseUsed = realPurchase ?? purchase;
  const margin = money(sellingPriceNoVat - purchaseUsed);
  const reasons = [...rule.reasons];
  if (!product.sku) reasons.push('MISSING_SKU');
  if (!sellingPrice) reasons.push('MISSING_PRICE');
  if (!product.product_brand) reasons.push('BRAND_INFERRED_OR_MISSING');
  const merchantEligible = Boolean(product.id && product.slug && sellingPrice > 0 && product.stock_status === 'instock');
  if (!merchantEligible) reasons.push('NOT_MERCHANT_READY');

  let score = rule.confidence === 'high' ? 95 : rule.confidence === 'medium' ? 75 : 50;
  if (!product.sku) score -= 20;
  if (!sellingPrice) score -= 40;
  if (!product.product_brand) score -= 5;
  score = Math.max(0, Math.min(100, score));
  const confidence: EconomicsConfidence = score >= 85 ? 'high' : score >= 60 ? 'medium' : 'low';

  return {
    product_id: String(product.id || product.sku || product.slug || ''),
    woo_id: String(product.id || ''),
    sku: String(product.sku || ''),
    merchant_id: String(product.id || product.sku || product.slug || ''),
    name: String(product.name || ''),
    brand: brand(product),
    product_type: productType(product),
    material_type: materialType(product),
    selling_price: money(sellingPrice),
    selling_price_no_vat: sellingPriceNoVat,
    margin_multiplier: rule.multiplier,
    estimated_purchase_price: purchase,
    real_purchase_price: realPurchase,
    purchase_price_used: purchaseUsed,
    purchase_price_source: realPurchase != null ? 'abix' : 'estimated',
    estimated_gross_margin: margin,
    estimated_gross_margin_pct: sellingPriceNoVat > 0 ? money((margin / sellingPriceNoVat) * 100) : 0,
    stock_quantity: product.stock_quantity == null ? null : n(product.stock_quantity),
    stock_status: String(product.stock_status || ''),
    merchant_eligible: merchantEligible,
    confidence,
    confidence_score: score,
    reason_codes: reasons,
  };
}

export function buildCatalogEconomics(products: TmProduct[], options: { vatRate?: number; purchasePrices?: Map<string, { purchase_price: number }> } = {}): ProductEconomics[] {
  return products.map((product) => {
    const sku = String(product.sku || '').toLowerCase();
    const realPurchasePrice = sku ? options.purchasePrices?.get(sku)?.purchase_price ?? null : null;
    return buildProductEconomics(product, { vatRate: options.vatRate, realPurchasePrice });
  });
}
