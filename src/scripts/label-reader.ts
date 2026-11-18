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

export async function readLabel(file: File, signal: AbortSignal, report: (message: string) => void, area?: LabelSelection): Promise<LabelLine[][]> {
  const images = await prepareImages(file, signal, area);
  if (signal.aborted) throw new DOMException('Zrušené', 'AbortError');
  const folder = new URL('/citanie-stitku/v7/', location.origin).href;
  // Own the worker from the first byte. A cancel, timeout or page exit must also end a
  // stalled language download. These are the dedicated worker jobs of pinned Tesseract.js 7.
  const worker = new Worker(folder + 'worker.min.js');
  const jobs = [
    { action: 'load', payload: { options: { lstmOnly: true, corePath: folder } } },
    { action: 'loadLanguage', payload: { langs: 'eng', options: { langPath: folder, gzip: true, lstmOnly: true, cachePath: 'tm-label-v7' } } },
    { action: 'initialize', payload: { langs: 'eng', oem: 1, config: {} } },
    { action: 'setParameters', payload: { params: { tessedit_pageseg_mode: area && 'start' in area ? '7' : '11', user_defined_dpi: '200' } } },
    ...images.map(image => ({ action: 'recognize', payload: { image, options: {}, output: { blocks: true } } })),
  ];
  let onAbort = () => {};
  try {
    report('Pripravujem čítanie štítku…');
    const passes = await new Promise<Block[][]>((resolve, reject) => {
      const completed: Block[][] = [];
      onAbort = () => reject(new DOMException('Zrušené', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      worker.onerror = () => reject(new Error('worker'));
      worker.onmessageerror = () => reject(new Error('worker message'));
      let step = 0;
      const send = () => {
        const job = jobs[step];
        worker.postMessage({ ...job, workerId: 'label', jobId: String(step) }, 'image' in job.payload && job.payload.image ? [job.payload.image.buffer] : []);
      };
      worker.onmessage = ({ data }) => {
        if (data.jobId !== String(step)) return;
        if (data.status === 'reject') { reject(new Error('recognition')); return; }
        if (data.status === 'progress') {
          if (data.data.status === 'recognizing text') report(`Čítam označenie… ${Math.round((completed.length + data.data.progress) * 100 / images.length)} %`);
          return;
        }
        if (data.status !== 'resolve') return;
        if (data.action === 'recognize') completed.push(data.data.blocks || []);
        step++;
        if (step === jobs.length) resolve(completed);
        else send();
      };
      send();
    });
    return passes.map(blocks => blocks.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines))
      .map(line => ({ text: line.text, confidence: line.confidence, words: line.words.map(word => ({ text: word.text, confidence: word.confidence })) })));
  } finally {
    signal.removeEventListener('abort', onAbort);
    worker.terminate();
  }
}
