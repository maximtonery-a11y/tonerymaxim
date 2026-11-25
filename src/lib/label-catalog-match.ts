import { visibleLabelLines, type LabelLine } from './label-search.ts';

// Only public dictionary keys cross the network. Image text is matched on the device.
export type CatalogMark = {
  id: string;
  brand: string;
  name: string;
  kind: string;
  color: string;
  refs: string[];
};
export type MarkWire = [string, string, string, string, string[]];
export function markId(brand: string, name: string, kind: string, color: string) {
  return kind === 'Tlačiareň' ? 'P|' + name : [brand, name, kind, color].join('|').toUpperCase();
}
export const markKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const colorNames: Record<string, string> = {
  BK: 'čierna',
  K: 'čierna',
  C: 'azúrová',
  M: 'purpurová',
  Y: 'žltá',
};
const glyphs = ['0O', '1IL', '5S', '8B', '2Z', '6G'];
const commonColor = /(?:^|[^A-Z0-9])(BK|BLACK|CYAN|MAGENTA|YELLOW)(?![A-Z0-9])/gi;
export function printedColor(lines: LabelLine[]) {
  const words = lines.flatMap((line) =>
    [...line.text.matchAll(commonColor)].map((match) => match[1].toUpperCase()),
  );
  const colors = new Set(
    words.map(
      (word) =>
        ({ BLACK: 'čierna', BK: 'čierna', CYAN: 'azúrová', MAGENTA: 'purpurová', YELLOW: 'žltá' })[word],
    ),
  );
  return colors.size === 1 ? [...colors][0] : undefined;
}
const hasCode = (s: string) => /\d/.test(s) && (/[A-Z]/.test(s) || /^\d{3,10}$/.test(s));

export function printedMarks(lines: LabelLine[], blocked: Set<string>) {
  const found = new Set<string>();
  for (const row of visibleLabelLines(lines, blocked)) {
    if (row.confidence < 20) continue;
    const text = row.text.toUpperCase().replace(/[‐‑‒–—−]/g, '-');
    // A lost slash often joins two complete references bearing the same prefix.
    const separate = text.replace(/([A-Z]{1,5})(-?\d{2,6})(?=\1-?\d)/g, '$1$2/');
    const parts = separate.match(/[A-Z0-9]+(?:-[A-Z0-9]+)*/g) || [];
    for (let i = 0; i < parts.length; i++) {
      const token = markKey(parts[i]);
      if (blocked.has(token)) continue;
      if (token.length >= 3 && token.length <= 20 && hasCode(token)) found.add(token);
      const next = parts[i + 1] || '';
      if (/^[A-Z]{1,4}$/.test(token) && /^\d{2,6}[A-Z]{0,4}$/.test(next) && !blocked.has(next))
        found.add(token + next);
    }
  }
  return [...found].filter((token) => !blocked.has(token)).slice(0, 48);
}

export function makeMarkIndex(marks: CatalogMark[]) {
  const exact = new Map<string, CatalogMark[]>(),
    prefixes = new Map<string, Set<string>>();
  const byNumber = new Map<string, string[]>();
  for (const mark of marks)
    for (const ref of mark.refs) {
      const key = markKey(ref);
      if (key.length < 3 || key.length > 20) continue;
      const rows = exact.get(key);
      if (rows) {
        if (!rows.includes(mark)) rows.push(mark);
      } else {
        exact.set(key, [mark]);
        const core = /^([A-Z]{1,6})(\d{3,7})([A-Z]*)$/.exec(key);
        if (core) {
          const bucket = core[2] + '|' + core[3];
          if (!byNumber.has(bucket)) byNumber.set(bucket, []);
          byNumber.get(bucket)!.push(key);
        }
        const prefix = key.slice(0, 4);
        if (!prefixes.has(prefix)) prefixes.set(prefix, new Set());
        prefixes.get(prefix)!.add(key);
      }
    }
  return {
    exact,
    prefixes,
    byNumber,
    brands: [...new Set(marks.map((mark) => mark.brand.toUpperCase()))],
  };
}

export function suggestedMarks(
  index: ReturnType<typeof makeMarkIndex>,
  tokens: string[],
  brands: string[],
  printedInk?: string,
  blocked?: Set<string>,
) {
  const scores = new Map<CatalogMark, number>();
  function credit(key: string, score: number, color?: string) {
    for (const row of index.exact.get(key) || []) {
      // A crop can distort a character in a serial previously read on the full photo.
      if (blocked?.size && row.refs.some(ref => blocked.has(ref))) continue;
      if (brands.length && !brands.includes(row.brand.toUpperCase())) continue;
      if (
        printedInk &&
        row.kind !== 'Tlačiareň' &&
        row.color &&
        row.color.toLocaleLowerCase('sk') !== printedInk
      )
        continue;
      if (color && row.color.toLocaleLowerCase('sk') !== color) continue;
      scores.set(row, Math.max(scores.get(row) || 0, score));
    }
  }
  for (const value of tokens) {
    if (/^\d{3,5}$/.test(value) && !brands.length) continue;
    credit(value, 100);
    // A supplier prefix and a printed colour can surround a public model.
    // Keep the complete digit sequence and the colour from the same word.
    const wrapped = /^([A-Z]{1,5})(\d{3,6})(BK|[KCMY])$/.exec(value);
    if (wrapped)
      for (let i = 0; i < wrapped[1].length; i++)
        credit(wrapped[1].slice(i) + wrapped[2], 88, colorNames[wrapped[3]]);
    if (value.length < 5) continue;
    // Preserve every digit and the complete suffix when the leading letters are damaged.
    const core = /^([A-Z]{1,6})(\d{3,7})([A-Z]*)$/.exec(value);
    if (core && !index.exact.has(value)) {
      for (const key of index.byNumber.get(core[2] + '|' + core[3]) || []) {
        const prefix = key.slice(0, key.indexOf(core[2]));
        if (prefix[0] !== core[1][0] || Math.abs(prefix.length - core[1].length) > 1) continue;
        const longer = prefix.length >= core[1].length ? prefix : core[1];
        const shorter = longer === prefix ? core[1] : prefix;
        const close =
          longer.length === shorter.length
            ? [...longer].filter((c, i) => c !== shorter[i]).length === 1
            : [...longer].some((_, i) => longer.slice(0, i) + longer.slice(i + 1) === shorter);
        if (close) credit(key, 70);
      }
    }
    for (let i = 0; i < value.length; i++) {
      const similar = glyphs.find((set) => set.includes(value[i]));
      if (similar)
        for (const c of similar)
          if (c !== value[i]) credit(value.slice(0, i) + c + value.slice(i + 1), 75);
    }
    // Complete at most two missing characters, only after the whole numeric core.
    if (/[A-Z]/.test(value))
      for (const key of index.prefixes.get(value.slice(0, 4)) || []) {
        if (key.startsWith(value) && /^[A-Z]{1,2}$/.test(key.slice(value.length))) credit(key, 65);
      }
  }
  const ranked = [...scores].sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name, 'sk'));
  if (!ranked.length) return [];
  const best = ranked[0][1];
  const candidates = ranked.filter(([, score]) => score >= (best >= 88 ? 88 : best));
  // A common fragment alone is not enough to pick a handful of arbitrary matches.
  return candidates.length <= 6 ? candidates.map(([row]) => row) : [];
}
