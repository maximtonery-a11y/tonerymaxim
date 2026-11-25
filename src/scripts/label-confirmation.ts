import { labelBrands, type LabelLine, type CatalogLink } from '../lib/label-search';
import {
  makeMarkIndex,
  markKey,
  markId,
  printedColor,
  printedMarks,
  suggestedMarks,
  type MarkWire,
  type CatalogMark,
} from '../lib/label-catalog-match';

let dictionary: ReturnType<typeof makeMarkIndex> | undefined;
export async function matchCatalogLines(
  lines: LabelLine[],
  blocked: Set<string>,
  signal: AbortSignal,
  recognized?: string,
) {
  const keys = printedMarks(lines, blocked);
  const direct = markKey(recognized || '');
  if (
    !keys.length ||
    (direct && !keys.some((key) => /[A-Z]/.test(key) && !key.includes(direct) && !direct.includes(key)))
  )
    return [];
  if (!dictionary) {
    const response = await fetch('/api/label-catalog', { signal });
    if (!response.ok) throw new Error('catalog');
    const rows: MarkWire[] = await response.json();
    signal.throwIfAborted();
    dictionary = makeMarkIndex(
      rows.map(([brand, name, kind, color, refs]) => ({
        id: markId(brand, name, kind, color),
        brand,
        name,
        kind,
        color,
        refs,
      })),
    );
  }
  const words =
    ' ' + lines.map((line) => line.text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')).join(' ') + ' ';
  const brands = [
    ...new Set([
      ...labelBrands(lines),
      ...dictionary.brands.filter((brand) => words.includes(' ' + brand + ' ')),
    ]),
  ];
  const marks = suggestedMarks(dictionary, keys, brands, printedColor(lines), blocked);
  if (direct && marks.every((mark) => mark.refs.includes(direct))) return [];
  return marks;
}
export async function confirmedOffers(mark: CatalogMark, signal: AbortSignal): Promise<CatalogLink[]> {
  const res = await fetch('/api/label-catalog?choice=' + encodeURIComponent(mark.id), { signal });
  if (!res.ok) throw new Error('catalog');
  const data = await res.json();
  const path =
    mark.kind === 'Tlačiareň'
      ? /^\/tlaciarne\/[a-z0-9-]+\/[a-z0-9-]+\/?$/
      : /^\/produkt\/[a-z0-9-]+\/?$/;
  return data.offers.filter((item: CatalogLink) => path.test(item.url));
}
export function markDescription(mark: CatalogMark) {
  return [mark.kind === 'Tlačiareň' ? mark.name : mark.brand + ' ' + mark.name, mark.kind, mark.color]
    .filter(Boolean)
    .join(' · ');
}
