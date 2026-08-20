import { join } from 'node:path';
import { readSignedJson, writeSignedJson, TM_DATA_ROOT } from './secure-persistence.ts';
import { DEFAULT_ADS_INTELLIGENCE_SETTINGS, sanitizeAdsSettings, type AdsIntelligenceSettings } from './ads-intelligence-settings.ts';

const FILE = join(TM_DATA_ROOT, 'ads-intelligence', 'settings.json');
export async function loadAdsIntelligenceSettings(): Promise<AdsIntelligenceSettings> {
  const saved = await readSignedJson<Partial<AdsIntelligenceSettings>>(FILE);
  return sanitizeAdsSettings(saved || DEFAULT_ADS_INTELLIGENCE_SETTINGS);
}
export async function saveAdsIntelligenceSettings(input: Partial<AdsIntelligenceSettings>): Promise<AdsIntelligenceSettings> {
  const settings = sanitizeAdsSettings(input);
  await writeSignedJson(FILE, settings);
  return settings;
}
