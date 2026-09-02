const clean = (value: unknown, max = 120) => String(value || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

// Označenie produktu je určené iba pre text odpovede zákazníkovi. Katalóg
// naďalej dostáva pôvodný celý dopyt, aby sa nemenila presnosť vyhľadávania.
const reference = /\b(?=[a-z0-9_-]{4,}\b)(?=[a-z0-9_-]*[a-z])(?=[a-z0-9_-]*\d)[a-z0-9]+(?:[-_][a-z0-9]+)*\b/i;

export function customerProductLabel(productQuery: unknown, message: unknown, source: unknown) {
  const query = clean(productQuery);
  if (String(source || '') === 'printer') return query || clean(message);

  // Router môže opraviť zákaznícky prepis na kanonický kód (napr. D1111 na
  // MLT-D111S), preto má samostatný kód z productQuery prednosť.
  const canonical = query.match(new RegExp(`^${reference.source}$`, 'i'))?.[0];
  const explicitSku = clean(message).match(/\bsku\s*[:#-]?\s*([a-z0-9][a-z0-9_-]{1,99})\b/i)?.[1];
  const mentioned = query.match(reference)?.[0] || clean(message).match(reference)?.[0];
  const label = canonical || explicitSku || mentioned || query || clean(message);
  return clean(label).toUpperCase();
}
