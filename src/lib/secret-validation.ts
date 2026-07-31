const PLACEHOLDER_MARKERS = [
  'SEM_VLOZTE',
  'CHANGE_ME',
  'CHANGEME',
  'REPLACE_ME',
  'YOUR_SECRET',
  'EXAMPLE_SECRET',
  'LOCAL_DEVELOPMENT_SECRET',
];

export function isPlaceholderSecret(value: unknown): boolean {
  const normalized = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return !normalized || PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
}

export function isStrongSecret(value: unknown, minimumLength = 32): boolean {
  const secret = String(value || '').trim();
  return secret.length >= minimumLength && !isPlaceholderSecret(secret);
}
