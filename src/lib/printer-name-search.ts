// Shared by the public API and printer selector; no catalogue or server imports.
type PrinterNames = { title?: string; brand?: string; aliases?: string[] };
const normalize = (value: unknown) => String(value || '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const compact = (value: unknown) => normalize(value).replace(/[^a-z0-9]/g, '');
const names = (printer: PrinterNames) => [printer.title || '', ...(printer.aliases || [])];

export function exactPrinterName(printer: PrinterNames, query: string): boolean {
  const key = compact(query);
  const withBrand = compact(`${printer.brand || ''} ${query}`);
  return Boolean(key && names(printer).some(name => compact(name) === key || compact(name) === withBrand));
}

export function matchingPrinterName(printer: PrinterNames, query: string): string | null {
  const normalized = normalize(query), key = compact(query), values = names(printer);
  if (!normalized) return printer.title || null;
  const exact = key && values.find(name => compact(name) === key);
  if (exact) return exact;
  return values.find(name => normalize(name).includes(normalized) || compact(name).includes(key)
    || normalized.split(/\s+/).every(part => normalize(name).includes(part))) || null;
}
