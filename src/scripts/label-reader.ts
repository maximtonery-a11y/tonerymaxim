import type { Block } from 'tesseract.js';
import { drawLabelLine, type LabelSelection } from '../lib/label-image';
import type { LabelLine } from '../lib/label-search';

// Resize and discard the original before starting OCR; camera metadata never enters the search.
async function prepareImages(file: File, signal: AbortSignal, area?: LabelSelection): Promise<Uint8Array<ArrayBuffer>[]> {
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
    const canvas = document.createElement('canvas');
    const frames: Uint8Array<ArrayBuffer>[] = [];
    async function saveFrame() {
      signal.throwIfAborted();
      const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!png) throw new Error('decode');
      frames.push(new Uint8Array(await png.arrayBuffer()));
    }
    try {
      signal.throwIfAborted();
      if (area && 'start' in area) {
        for (const ratio of [.18, .24]) {
          signal.throwIfAborted();
          drawLabelLine(canvas, image, width, height, area.start, area.end, ratio);
          await saveFrame();
        }
      } else {
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
        await saveFrame();
      }
      return frames;
    } finally {
      canvas.width = canvas.height = 1;
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
type WorkerResult = { blocks?: Block[] };

export async function createLabelReader(signal: AbortSignal, singleLine = false) {
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
    await job('setParameters', { params: { tessedit_pageseg_mode: singleLine ? '7' : '11', user_defined_dpi: '200' } });
    return {
      close,
      async recognize(image: Uint8Array<ArrayBuffer>, progress?: (n: number) => void): Promise<LabelLine[]> {
        const { blocks = [] } = await job('recognize', { image, options: {}, output: { blocks: true } }, [image.buffer], progress);
        return blocks.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines))
          .map(line => ({ text: line.text, confidence: line.confidence, words: line.words.map(word => ({ text: word.text, confidence: word.confidence })) }));
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}

export async function readLabel(file: File, signal: AbortSignal, report: (message: string) => void, area?: LabelSelection): Promise<LabelLine[][]> {
  const images = await prepareImages(file, signal, area);
  report('Pripravujem čítanie štítku…');
  const reader = await createLabelReader(signal, Boolean(area && 'start' in area));
  try {
    const passes: LabelLine[][] = [];
    for (const image of images) {
      passes.push(await reader.recognize(image, progress =>
        report(`Čítam označenie… ${Math.round((passes.length + progress) * 100 / images.length)} %`)));
    }
    return passes;
  } finally { reader.close(); }
}
