import { loadAdsIntelligenceSettings } from '../src/lib/ads-intelligence-settings-store.ts';
import { calculateAdsIntelligenceLive, writeAdsIntelligenceSnapshot } from '../src/lib/ads-intelligence-runtime.ts';

// Run only in a separate Coolify worker resource. The storefront never starts it.
const settings=await loadAdsIntelligenceSettings();
const snapshot=await calculateAdsIntelligenceLive(settings);
const file=writeAdsIntelligenceSnapshot(snapshot);
console.log(JSON.stringify({ok:true,file,generated_at:snapshot.generated_at,products:snapshot.summary.products}));
