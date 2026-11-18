import type { Block, Word } from 'tesseract.js';
import { locateLabelRow, printStrip, readLoopDigit } from '../lib/label-photo';
import { labelCandidates, liveLabelCandidate, printedTonerCodes, type LabelLine } from '../lib/label-search';

export type OcrMode = 'scene' | 'line' | 'digits';
type ReadCanvas = (canvas: HTMLCanvasElement, mode: OcrMode) => Promise<Block[]>;
const printerNumber = /^((?:DCP|MFC|HL|ET|XP|WF|LBP|MF)[-]?[LJT]?)([0-9OSBZ]{3,5})([A-Z]{1,4})$/i;
const confusion = ['S59', '689', 'B8', 'O0', 'Z2'];

async function verifyNumber(word: Word, source: HTMLCanvasElement, read: ReadCanvas) {
  const match = printerNumber.exec(word.text);
  if (!match || !word.symbols?.length || (word.confidence >= 90 && /^\d+$/.test(match[2]))) return;
  const [text, prefix, number] = match;
  if (word.symbols.map(s => s.text).join('') !== text) return;
  const digits = word.symbols.slice(prefix.length, prefix.length + number.length);
  const letters = word.symbols.filter((_, i) => i < prefix.length || i >= prefix.length + number.length);
  if (letters.some(s => s.confidence < 75)) return;
  const box = {
    x0: digits[0].bbox.x0,
    x1: digits[digits.length - 1].bbox.x1,
    y0: Math.min(...digits.map(s => s.bbox.y0)),
    y1: Math.max(...digits.map(s => s.bbox.y1)),
  };
  if (box.x1 - box.x0 < 12 || box.y1 - box.y0 < 7) return;
  // Reread the actual digits at two scales. The prefix and the network/colour
  // suffix must stay intact even when a wide printed 9 resembles S or 8.
  const shapes = digits.map(s => (/^[S589]$/i.test(s.text) ? readLoopDigit(source, s.bbox) : undefined));
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
    const observed = blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)));
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
    differences.some(([a, b]) => !confusion.some(set => set.includes(a) && set.includes(b)))
  )
    return;
  return {
    text: prefix + previous + match[3],
    confidence: Math.min(...scores, ...letters.map(s => s.confidence)),
    verifiedDigits: true,
  };
}

export async function readPrintedLabel(
  source: HTMLCanvasElement,
  read: ReadCanvas,
  singleLine = false,
  explore = true
) {
  let refinements = 0;
  async function readLines(canvas: HTMLCanvasElement, mode: OcrMode): Promise<LabelLine[]> {
    const blocks = await read(canvas, mode);
    const output: LabelLine[] = [];
    for (const line of blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines))) {
      let text = line.text;
      const words: NonNullable<LabelLine['words']> = [];
      for (const word of line.words || []) {
        const verify =
          explore &&
          refinements < 2 &&
          printerNumber.test(word.text) &&
          (word.confidence < 90 || /[OSBZ]\d{2,}/i.test(word.text));
        const checked = verify ? await verifyNumber(word, canvas, read) : undefined;
        if (verify) refinements++;
        if (checked) text = text.replace(word.text, checked.text);
        words.push(checked || { text: word.text, confidence: word.confidence });
      }
      output.push({ text, confidence: line.confidence, words });
    }
    return output;
  }

  const lines = await readLines(source, singleLine ? 'line' : 'scene');
  const blocked = new Set<string>();
  const candidates = labelCandidates(lines, blocked);
  const tentative = candidates.length === 1 ? printedTonerCodes(candidates[0].code).join('/') : '';
  if (!explore || blocked.size || candidates.some(item => item.certain) || (!tentative && liveLabelCandidate(lines, blocked))) {
    return { lines, barcode: false };
  }
  const row = locateLabelRow(source);
  if (!row || row.barcode) return { lines, barcode: !!row?.barcode };
  const strip = printStrip(source, row.box, 56, 1.27, 0.2, 0.18);
  try {
    const extra = await readLines(strip, 'line');
    if (tentative) {
      for (const line of extra) if (printedTonerCodes(line.text).join('/') === tentative) line.confirmedList = true;
    }
    return { lines: [...lines, ...extra], barcode: false };
  } finally {
    strip.width = strip.height = 1;
  }
}
