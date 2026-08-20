export type AdsIntelligenceSettings = {
  enabled: boolean;
  vatRate: number;
  coldStartCvr: number;
  marginSafetyHigh: number;
  marginSafetyMedium: number;
  marginSafetyLow: number;
  scaleDemandThreshold: number;
  minClicksBeforeLimit: number;
  minClicksBeforePause: number;
  pauseSpendTargetCpaMultiple: number;
  maxCpcAbsolute: number;
  dailyBudgetEur: number;
  maxActiveProducts: number;
};

export const DEFAULT_ADS_INTELLIGENCE_SETTINGS: AdsIntelligenceSettings = {
  enabled: true,
  vatRate: 0.23,
  coldStartCvr: 0.025,
  marginSafetyHigh: 0.55,
  marginSafetyMedium: 0.40,
  marginSafetyLow: 0.25,
  scaleDemandThreshold: 150,
  minClicksBeforeLimit: 25,
  minClicksBeforePause: 50,
  pauseSpendTargetCpaMultiple: 1.25,
  maxCpcAbsolute: 1.50,
  dailyBudgetEur: 30,
  maxActiveProducts: 100,
};

export function sanitizeAdsSettings(input: Partial<AdsIntelligenceSettings> = {}): AdsIntelligenceSettings {
  const d=DEFAULT_ADS_INTELLIGENCE_SETTINGS;
  const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
  const n=(v:unknown,f:number)=>Number.isFinite(Number(v))?Number(v):f;
  return {
    enabled: input.enabled ?? d.enabled,
    vatRate: clamp(n(input.vatRate,d.vatRate),0,0.30),
    coldStartCvr: clamp(n(input.coldStartCvr,d.coldStartCvr),0.005,0.20),
    marginSafetyHigh: clamp(n(input.marginSafetyHigh,d.marginSafetyHigh),0.10,0.80),
    marginSafetyMedium: clamp(n(input.marginSafetyMedium,d.marginSafetyMedium),0.10,0.70),
    marginSafetyLow: clamp(n(input.marginSafetyLow,d.marginSafetyLow),0.05,0.50),
    scaleDemandThreshold: clamp(n(input.scaleDemandThreshold,d.scaleDemandThreshold),20,2000),
    minClicksBeforeLimit: Math.round(clamp(n(input.minClicksBeforeLimit,d.minClicksBeforeLimit),10,100)),
    minClicksBeforePause: Math.round(clamp(n(input.minClicksBeforePause,d.minClicksBeforePause),30,200)),
    pauseSpendTargetCpaMultiple: clamp(n(input.pauseSpendTargetCpaMultiple,d.pauseSpendTargetCpaMultiple),0.5,5),
    maxCpcAbsolute: clamp(n(input.maxCpcAbsolute,d.maxCpcAbsolute),0.05,10),
    dailyBudgetEur: clamp(n(input.dailyBudgetEur,d.dailyBudgetEur),1,10000),
    maxActiveProducts: Math.round(clamp(n(input.maxActiveProducts,d.maxActiveProducts),10,1000)),
  };
}
