type ProductCachePolicyInput = {
  reportedTotal: number;
  configuredMinimum?: number;
  safeMinimum?: number;
  completenessRatio?: number;
};

function nonNegativeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function normalizedCompletenessRatio(value: unknown, fallback = 0.99) {
  const parsed = nonNegativeNumber(value, fallback);
  return Math.min(1, Math.max(0.9, parsed));
}

export function requiredProductCount({
  reportedTotal,
  configuredMinimum = 0,
  safeMinimum = 100,
  completenessRatio = 0.99,
}: ProductCachePolicyInput) {
  const reported = Math.floor(nonNegativeNumber(reportedTotal));
  const configured = Math.floor(nonNegativeNumber(configuredMinimum));
  const safe = Math.floor(nonNegativeNumber(safeMinimum, 100));
  const ratio = normalizedCompletenessRatio(completenessRatio);
  const reportedRequired = reported > 0 ? Math.ceil(reported * ratio) : 0;

  return Math.max(safe, configured, reportedRequired);
}

export function productCompletenessRatio(total: number, reportedTotal: number) {
  const products = nonNegativeNumber(total);
  const reported = nonNegativeNumber(reportedTotal);
  if (reported <= 0) return products > 0 ? 1 : 0;
  return products / reported;
}
