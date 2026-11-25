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
  const color = printedColor(lines);
  const marks = suggestedMarks(dictionary, keys, brands, color, blocked);
  // Preserve each legible member of a printed list even when another member is a closer match.
  const listed = new Set<string>();
  for (const line of lines) {
    if (!/[/／]|([A-Z]{2,})[- ]?\d{2,6}\1[- ]?\d/i.test(line.text)) continue;
    const refs = printedMarks([line], blocked).filter((ref) => /[A-Z]/.test(ref) && /\d{2}/.test(ref));
    if (refs.length > 1) for (const ref of refs) listed.add(ref);
  }
  const prefixOf = (ref: string) => /^[A-Z]+/.exec(ref)?.[0];
  const anchors = marks.filter((mark) => mark.refs.some((ref) => listed.has(ref)));
  const anchoredBrands = new Set(anchors.map((mark) => mark.brand));
  const anchoredFamilies = new Set(
    anchors.flatMap((mark) => mark.refs.filter((ref) => listed.has(ref)).map(prefixOf)),
  );
  for (const ref of listed) {
    for (const extra of suggestedMarks(dictionary, [ref], brands, color, blocked)) {
      if (!extra.refs.includes(ref) && anchors.length) {
        if (!anchoredBrands.has(extra.brand)) continue;
        if (
          anchoredFamilies.has(prefixOf(ref)) &&
          !extra.refs.some((code) => prefixOf(code) === prefixOf(ref))
        )
          continue;
      }
      if (!marks.includes(extra)) marks.push(extra);
    }
  }
  if (direct && !listed.size && marks.every((mark) => mark.refs.includes(direct))) return [];
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
