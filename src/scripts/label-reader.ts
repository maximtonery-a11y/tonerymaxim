import type { Block } from 'tesseract.js';
import { drawLabelLine, type LabelSelection } from '../lib/label-image';
import { candidateText, hasSplitSupplyLabel, isCompleteBrotherModel, labelCandidates, type LabelLine } from '../lib/label-search';
import { labelImageForOcr, type PixelBox } from '../lib/label-photo';
import { readPrintedLabel, type OcrMode } from './label-physical-ocr';

// Resize and discard the original before starting OCR; camera metadata never enters the search.
async function prepareImages(file: File, signal: AbortSignal, area?: LabelSelection): Promise<HTMLCanvasElement[]> {
  if (!file.size || file.size > 22 * 1024 * 1024 || !/^image\/(?:jpeg|jpg|png|webp|avif|heic|heif|bmp)$/i.test(file.type)) {
    throw new Error('Vyberte fotku do 22 MB. Najistejší formát je JPG alebo PNG.');
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width * height > 64_000_000) throw new Error('size');
    const frames: HTMLCanvasElement[] = [];
    try {
      signal.throwIfAborted();
      if (area && 'start' in area) {
        for (const ratio of [.18, .24]) {
          signal.throwIfAborted();
          const canvas = document.createElement('canvas');
          frames.push(canvas);
          drawLabelLine(canvas, image, width, height, area.start, area.end, ratio);
        }
      } else {
        const canvas = document.createElement('canvas');
        frames.push(canvas);
        const cutWidth = area ? Math.max(1, Math.round(width * .62)) : width;
        const cutHeight = area ? Math.max(1, Math.round(height * .17)) : height;
        const left = area ? Math.max(0, Math.min(width - cutWidth, width * area.x - cutWidth / 2)) : 0;
        const top = area ? Math.max(0, Math.min(height - cutHeight, height * area.y - cutHeight / 2)) : 0;
        const scale = Math.min(area ? 2.5 : 1, 1840 / Math.max(cutWidth, cutHeight));
        canvas.width = Math.max(1, Math.round(cutWidth * scale));
        canvas.height = Math.max(1, Math.round(cutHeight * scale));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('canvas');
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, left, top, cutWidth, cutHeight, 0, 0, canvas.width, canvas.height);
      }
      return frames;
    } catch (error) {
      for (const frame of frames) frame.width = frame.height = 1;
      throw error;
    }
  } catch {
    signal.throwIfAborted();
    throw new Error('Túto fotku telefón neotvoril. Skúste bližší záber alebo obrázok vo formáte JPG či PNG.');
  } finally {
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

type WorkerPayload = Record<string, unknown>;
type WorkerResult = { blocks?: Block[] | null };

export async function createLabelReader(signal: AbortSignal) {
  signal.throwIfAborted();
  const folder = new URL('/citanie-stitku/v7/', location.origin).href;
  const worker = new Worker(folder + 'worker.min.js');
  let nextId = 0;
  let stopped = false;
  let pending: { id: string; resolve: (data: WorkerResult) => void; reject: (error: Error) => void; progress?: (n: number) => void } | undefined;

  function close(reason: Error = new DOMException('Zrušené', 'AbortError')) {
    if (stopped) return;
    stopped = true;
    signal.removeEventListener('abort', onAbort);
    worker.terminate();
    pending?.reject(reason);
    pending = undefined;
  }
  function onAbort() { close(); }
  signal.addEventListener('abort', onAbort, { once: true });
  worker.onerror = worker.onmessageerror = () => close(new Error('worker'));
  worker.onmessage = ({ data }) => {
    if (!pending || data.jobId !== pending.id) return;
    if (data.status === 'progress') {
      if (data.data?.status === 'recognizing text') pending.progress?.(data.data.progress);
      return;
    }
    if (data.status === 'reject') { close(new Error('recognition')); return; }
    if (data.status === 'resolve') {
      const { resolve } = pending;
      pending = undefined;
      resolve(data.data || {});
    }
  };
  function job(action: string, payload: WorkerPayload, transfer: Transferable[] = [], progress?: (n: number) => void) {
    if (stopped || pending) throw new Error('reader unavailable');
    const id = String(++nextId);
    return new Promise<WorkerResult>((resolve, reject) => {
      pending = { id, resolve, reject, progress };
      try { worker.postMessage({ action, payload, workerId: 'label', jobId: id }, transfer); }
      catch { close(new Error('worker message')); }
    });
  }
  try {
    await job('load', { options: { lstmOnly: true, corePath: folder } });
    await job('loadLanguage', { langs: 'eng', options: { langPath: folder, gzip: true, lstmOnly: true, cachePath: 'tm-label-v7' } });
    await job('initialize', { langs: 'eng', oem: 1, config: {} });
    await job('setParameters', { params: { tessedit_pageseg_mode: '11', user_defined_dpi: '200' } });
    return {
      close,
      async recognize(canvas: HTMLCanvasElement, progress?: (n: number) => void, lineOnly = false, explore = true,
        acceptLine?: (box: PixelBox) => boolean, privateCodes?: Set<string>, keepColor = true) {
        async function read(frame: HTMLCanvasElement, mode: OcrMode) {
          signal.throwIfAborted();
          const image = labelImageForOcr(frame, keepColor);
          const options = { tessedit_pageseg_mode: mode === 'scene' ? '11' : '7', tessedit_char_whitelist: mode === 'digits' ? '0123456789' : '' };
          const { blocks } = await job('recognize', { image, options, output: { blocks: true } }, [image.buffer], progress);
          return blocks || [];
        }
        return readPrintedLabel(canvas, read, lineOnly, explore, acceptLine, privateCodes);
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}

export async function readLabel(file: File, signal: AbortSignal, report: (message: string) => void, area?: LabelSelection, privateCodes = new Set<string>()) {
  const images = await prepareImages(file, signal, area);
  report('Pripravujem čítanie štítku…');
  let reader: Awaited<ReturnType<typeof createLabelReader>> | undefined;
  let sceneLines: LabelLine[] = [];
  try {
    if (!area) {
      const { createSceneReader } = await import('./label-scene-reader');
      const scene = createSceneReader(signal);
      try {
        const { lines } = await scene.read(images[0], privateCodes);
        const candidates = labelCandidates(lines, privateCodes);
        if (hasSplitSupplyLabel(lines) || candidates.length > 1 || candidates.some(item => item.certain)) {
          return { passes: [lines], barcode: false };
        }
        const candidate = candidates[0];
        const completeBrother = candidate?.kind === 'printer' && candidate.brand === 'Brother' && isCompleteBrotherModel(candidate.code);
        if (completeBrother) {
          // The narrow silver lettering on a dark panel often needs a different
          // scale. Keep the whole photograph so serial-number context is visible.
          const enhanced = document.createElement('canvas');
          try {
            const scale = Math.min(.85, 800 / Math.max(images[0].width, images[0].height));
            enhanced.width = Math.max(1, Math.round(images[0].width * scale));
            enhanced.height = Math.max(1, Math.round(images[0].height * scale));
            const ctx = enhanced.getContext('2d')!;
            ctx.filter = 'contrast(1.35)';
            ctx.drawImage(images[0], 0, 0, enhanced.width, enhanced.height);
            const second = await scene.read(enhanced, privateCodes);
            const options = labelCandidates(second.lines, privateCodes);
            if (options.length === 1 && candidateText(options[0]) === candidateText(candidate)
                && labelCandidates(lines, privateCodes).length === 1) {
              return { passes: [lines], barcode: false, confirmedPrinter: candidateText(candidate) };
            }
          } finally { enhanced.width = enhanced.height = 1; }
        }
        if (candidates.length) sceneLines = lines;
      } catch { signal.throwIfAborted(); }
      finally { scene.close(); }
    }
    reader = await createLabelReader(signal);
    let barcode = false;
    const passes: LabelLine[][] = [];
    for (const image of images) {
      const result = await reader.recognize(image, progress =>
        report(`Čítam označenie… ${Math.round((passes.length + progress) * 100 / images.length)} %`), Boolean(area && 'start' in area), !area, undefined, privateCodes);
      passes.push(result.lines);
      barcode ||= result.barcode;
    }
    if (sceneLines.length) {
      const first = labelCandidates(sceneLines, privateCodes);
      const second = labelCandidates(passes.flat(), privateCodes);
      if (!second.length) return { passes: [sceneLines], barcode };
      if (first.length === 1 && second.length === 1 && candidateText(first[0]) === candidateText(second[0])) {
        // Independently read the entire Brother model, including its suffix, with both engines.
        // Shared model numbers from multiple manufacturers still need the brand choice.
        const samePrinter = first[0].brand === 'Brother' && first[0].kind === 'printer' && isCompleteBrotherModel(first[0].code);
        return { passes, barcode, confirmedPrinter: samePrinter ? candidateText(first[0]) : undefined };
      }
      if (first.length && second.every(item => !first.some(other => candidateText(other) === candidateText(item)))) {
        return { passes: [[...sceneLines, ...passes.flat()]], barcode, disputed: true };
      }
    }
    return { passes, barcode };
  } finally {
    reader?.close();
    for (const image of images) image.width = image.height = 1;
  }
}
