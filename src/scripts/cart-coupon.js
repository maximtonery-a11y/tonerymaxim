async function requestCoupon(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: globalThis.AbortSignal?.timeout?.(8000),
  });
  // Validation returns 400 with a customer-facing reason for an ineligible code.
  if (!response.ok && response.status !== 400) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  if (typeof result?.ok !== "boolean") throw new Error("Invalid coupon response");
  return result;
}

export async function resolveCartCoupon(cart, savedCoupon, { automatic = true, enteredCode } = {}) {
  const manual = enteredCode ?? (savedCoupon?.manual ? savedCoupon.code : undefined);
  let rejectedManual;
  if (manual !== undefined) {
    if (!manual) return null;
    const chosen = { ...await requestCoupon("/api/coupon-validate", { code: manual, cart }), manual: true };
    if (chosen.ok || enteredCode !== undefined || !automatic) return chosen;
    rejectedManual = chosen;
  }
  if (automatic) {
    const best = await requestCoupon("/api/coupon-active", { cart });
    if (best.ok && best.code) return best;
  }
  if (rejectedManual) return rejectedManual;
  // Guests can redeem an issued code even though they have no automatic account coupon.
  if (savedCoupon?.code) return requestCoupon("/api/coupon-validate", { code: savedCoupon.code, cart });
  return null;
}
