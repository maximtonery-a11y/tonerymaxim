export type LabelCandidate = { brand: string; code: string; kind: 'printer' | 'supply'; certain: boolean; requiresPairing?: boolean };

export const barcodeGuidance = 'Vidím čiarový kód. Otočte kazetu alebo valec k nápisu s modelom, prípadne namierte na názov tlačiarne.';

export function candidateText(item: LabelCandidate) {
  return [item.brand, item.code].filter(Boolean).join(' ');
}
