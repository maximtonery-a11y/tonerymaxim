export function earnedPaperPacks(lifetimePoints: number) {
  const total = Math.max(0, Math.floor(Number(lifetimePoints) || 0));
  const completedCycles = Math.floor(total / 1000);
  const cyclePoints = total % 1000;
  const packsInCycle = cyclePoints >= 800 ? 3 : cyclePoints >= 500 ? 1 : 0;
  return {
    cycle: completedCycles + 1,
    cyclePoints,
    earnedPacks: completedCycles * 6 + packsInCycle,
    nextMilestone: cyclePoints < 500 ? 500 : cyclePoints < 800 ? 800 : 1000,
  };
}

export function canClaimPaperReward(paymentCode: unknown, paymentState: unknown): boolean {
  const code = String(paymentCode || "").toLowerCase();
  if (!["gopay", "applepay", "googlepay"].includes(code)) return true;
  return ["PAID", "AUTHORIZED"].includes(String(paymentState || "").toUpperCase());
}
