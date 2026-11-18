import type { Block, Word } from 'tesseract.js';
import { locateLabelRows, printStrip, readLoopDigit, type PixelBox } from '../lib/label-photo';
import { labelCandidates, liveLabelCandidate, printedTonerCodes, type LabelLine } from '../lib/label-search';

export type OcrMode = 'scene' | 'line' | 'digits';
type ReadCanvas = (canvas: HTMLCanvasElement, mode: OcrMode) => Promise<Block[]>;
const printerNumber = /^((?:DCP|MFC|HL|ET|XP|WF|LBP|MF)[-]?[LJT]?)([0-9OSBZ]{3,5})([A-Z]{1,4})$/i;
const confusion = ['S59', '689', 'B8', 'O0', 'Z2'];

async function verifyNumber(word: Word, source: HTMLCanvasElement, read: ReadCanvas) {
  const match = printerNumber.exec(word.text);
  if (!match || !word.symbols?.length || (word.confidence >= 90 && /^\d+$/.test(match[2]))) return;
  const [text, prefix, number] = match;
  if (word.symbols.map((s) => s.text).join('') !== text) return;
  const digits = word.symbols.slice(prefix.length, prefix.length + number.length);
  const letters = word.symbols.filter((_, i) => i < prefix.length || i >= prefix.length + number.length);
  if (letters.some((s) => s.confidence < 75)) return;
  const box = {
    x0: digits[0].bbox.x0,
    x1: digits[digits.length - 1].bbox.x1,
    y0: Math.min(...digits.map((s) => s.bbox.y0)),
    y1: Math.max(...digits.map((s) => s.bbox.y1)),
  };
  if (box.x1 - box.x0 < 12 || box.y1 - box.y0 < 7) return;
  // Reread the actual digits at two scales. The prefix and the network/colour
  // suffix must stay intact even when a wide printed 9 resembles S or 8.
  const shapes = digits.map((s) => (/^[S589]$/i.test(s.text) ? readLoopDigit(source, s.bbox) : undefined));
  let previous = '';
  const scores: number[] = [];
  for (const height of [40, 65]) {
    const strip = printStrip(source, box, height, 0.73, 0.13, 0.13);
    let blocks: Block[];
    try {
      blocks = await read(strip, 'digits');
    } finally {
      strip.width = strip.height = 1;
    }
    const observed = blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
    if (observed.length !== 1) return;
    const hit = observed[0];
    if (!/^\d+$/.test(hit.text) || hit.text.length !== number.length || hit.confidence < 65) continue;
    const measured = [...hit.text].map((v, i) => (shapes[i] && /[589]/.test(v) ? shapes[i] : v)).join('');
    if (previous && previous !== measured) return;
    previous = measured;
    scores.push(hit.confidence);
  }
  if (scores.length !== 2 || (Math.max(...scores) < 85 && !shapes.some(Boolean))) return;
  const differences = [...number]
    .map((letter, i) => [letter.toUpperCase(), previous[i]])
    .filter(([a, b]) => a !== b);
  if (
    differences.length > 1 ||
    differences.some(([a, b]) => !confusion.some((set) => set.includes(a) && set.includes(b)))
  )
    return;
  return {
    text: prefix + previous + match[3],
    confidence: Math.min(...scores, ...letters.map((s) => s.confidence)),
    verifiedDigits: true,
  };
}

export async function readPrintedLabel(
  source: HTMLCanvasElement,
  read: ReadCanvas,
  singleLine = false,
  explore = true,
  acceptLine?: (box: PixelBox) => boolean,
  privateCodes = new Set<string>()
) {
  let refinements = 0;
  let familyBox: PixelBox | undefined;
  const drumFamily = /DR[ -]?\d{3,5}(?:[C0][L1I]?)?/i;
  const hasDrumVariant = (lines: LabelLine[]) =>
    labelCandidates(lines).some((item) => /^DR-?\d+CL-(?:CMYK?|BK|[CMY])$/.test(item.code));
  async function readLines(
    canvas: HTMLCanvasElement,
    mode: OcrMode,
    region?: (box: PixelBox) => boolean
  ): Promise<LabelLine[]> {
    const blocks = await read(canvas, mode);
    const output: LabelLine[] = [];
    const all = blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    if (region) labelCandidates(all, privateCodes);
    for (const line of all) {
      if (region && !region(line.bbox)) continue;
      let text = line.text;
      const visibleWords = region ? line.words.filter((word) => region(word.bbox)) : line.words;
      if (region && visibleWords.length !== line.words.length)
        text = visibleWords.map((word) => word.text).join(' ');
      const words: NonNullable<LabelLine['words']> = [];
      for (const word of visibleWords || []) {
        if (
          canvas === source &&
          drumFamily.test(word.text) &&
          (!familyBox || word.bbox.y1 - word.bbox.y0 > familyBox.y1 - familyBox.y0)
        )
          familyBox = word.bbox;
        const verify =
          explore &&
          refinements < 2 &&
          printerNumber.test(word.text) &&
          (word.confidence < 90 || /[OSBZ]\d{2,}/i.test(word.text));
        const checked = verify ? await verifyNumber(word, canvas, read) : undefined;
        if (verify) refinements++;
        if (checked) text = text.replace(word.text, checked.text);
        if (checked) words.push(checked);
        else if (word.text.includes('/') && printedTonerCodes(word.text).length > 1) {
          const symbols = word.symbols || [];
          const scores = symbols.map((symbol) => symbol.confidence).sort((a, b) => a - b);
          const legibleList =
            symbols.length >= 10 &&
            scores[Math.floor(scores.length * 0.12)] >= 80 &&
            symbols[symbols.length - 1].confidence >= 85;
          words.push({ text: word.text, confidence: word.confidence, legibleList });
        } else words.push({ text: word.text, confidence: word.confidence });
      }
      output.push({ text, confidence: line.confidence, words });
    }
    return output;
  }

  const lines = await readLines(source, singleLine ? 'line' : 'scene', acceptLine);
  const blocked = new Set<string>();
  const candidates = labelCandidates(lines, blocked);
  const tentative = candidates.length === 1 ? printedTonerCodes(candidates[0].code).join('/') : '';
  const inspectSuffix =
    (familyBox || lines.some((line) => drumFamily.test(line.text))) && !hasDrumVariant(lines);
  if (
    !explore ||
    blocked.size ||
    (!inspectSuffix &&
      (candidates.some((item) => item.certain) || (!tentative && liveLabelCandidate(lines, blocked))))
  ) {
    return { lines, barcode: false };
  }
  async function readBelowFamily(box: PixelBox) {
    const h = box.y1 - box.y0;
    if (h < 7 || box.y1 + h * 0.8 > source.height) return;
    // On drum labels the smaller orderable variant is often directly beneath
    // the large family reference. Read the actual letters again at line scale.
    const lower = { x0: box.x0 - h * 0.15, x1: box.x1 + h * 0.5, y0: box.y1 + h * 0.02, y1: box.y1 + h * 0.96 };
    if (acceptLine && !acceptLine(lower)) return;
    const strip = printStrip(source, lower, 55, 1.05, 0.03, 0.01);
    try {
      lines.push(...(await readLines(strip, 'line')));
    } finally {
      strip.width = strip.height = 1;
    }
  }
  if (inspectSuffix && familyBox) {
    await readBelowFamily(familyBox);
    if (hasDrumVariant(lines)) return { lines, barcode: false };
  }
  const rows = locateLabelRows(source).filter((row) => !acceptLine || acceptLine(row.box));
  const barcode = rows.some((row) => row.barcode);
  // Spend at most two short line reads on difficult frames, independently of
  // how many edges the scene contains. Do not transcribe the barcode itself.
  for (const row of rows.filter((row) => !row.barcode).slice(0, 2)) {
    const strip = printStrip(source, row.box, 56, 1.27, 0.2, 0.18);
    try {
      const extra = await readLines(strip, 'line');
      if (tentative) {
        for (const line of extra)
          if (printedTonerCodes(line.text).join('/') === tentative) line.confirmedList = true;
      }
      lines.push(...extra);
      if (!familyBox && extra.some((line) => drumFamily.test(line.text)) && !hasDrumVariant(lines)) {
        familyBox = row.box;
        await readBelowFamily(row.box);
      }
      if (liveLabelCandidate(lines, blocked)) break;
    } finally {
      strip.width = strip.height = 1;
    }
  }
  return { lines, barcode };
}
