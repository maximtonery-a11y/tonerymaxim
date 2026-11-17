// Separate keys keep claim retries independent of checkout and GoPay locks.
const attempts = new Map<string, { id: string; fingerprint: string }>();
export async function claimSubmissionId(key: string, payload: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  const fingerprint = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const cached = attempts.get(key);
  if (cached?.fingerprint === fingerprint) return cached.id;
  try {
    const previous = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (previous?.fingerprint === fingerprint && typeof previous.id === 'string') {
      attempts.set(key, previous);
      return previous.id;
    }
  } catch { /* Storage can be unavailable in private browser modes. */ }
  const id = crypto.randomUUID();
  attempts.set(key, { id, fingerprint });
  try { sessionStorage.setItem(key, JSON.stringify({ id, fingerprint })); } catch { /* The server still saves the case before sending. */ }
  return id;
}

export function clearClaimSubmission(key: string): void {
  attempts.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* Optional browser persistence. */ }
}

export function claimConfirmation(data: { caseNumber: string; emailPending?: boolean; wooSaved?: boolean }): string {
  return data.emailPending || data.wooSaved === false
    ? `Reklamáciu evidujeme pod číslom ${data.caseNumber}. Potvrdenie vám odošleme po dokončení spracovania podania.`
    : `Reklamáciu ${data.caseNumber} sme prijali. Potvrdenie sme poslali na e-mail.`;
}
