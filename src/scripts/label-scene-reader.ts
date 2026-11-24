import { labelCandidates, type LabelLine } from '../lib/label-search';
import type { PixelBox } from '../lib/label-photo';

type Box = [number, number][];
type Row = { text: string; confidence: number; box: Box };
export type SceneResult = { lines: LabelLine[]; boxes: Box[] };

type NativeWord = { rawValue: string; boundingBox: DOMRectReadOnly };
type NativeReader = { detect(image: HTMLCanvasElement): Promise<NativeWord[]> };

/** Prefer the device's text recognizer when it works; otherwise read with local PaddleOCR. */
export function createSceneReader(signal: AbortSignal) {
  signal.throwIfAborted();
  const Detector = (window as Window & { TextDetector?: new () => NativeReader }).TextDetector;
  let native: NativeReader | undefined;
  try { if (Detector) native = new Detector(); } catch { /* Some browsers expose an unavailable backend. */ }
  let worker: Worker | undefined;
  let ready: Promise<void> | undefined;
  let pending: { resolve: (rows: Row[]) => void; reject: (error: Error) => void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const canvas = document.createElement('canvas');
  function close() {
    clearTimeout(timer);
    signal.removeEventListener('abort', close);
    worker?.terminate();
    worker = undefined;
    pending?.reject(new Error('scene reader closed'));
    pending = undefined;
    canvas.width = canvas.height = 1;
  }
  signal.addEventListener('abort', close, { once: true });
  function request(data: object, transfer: Transferable[] = []) {
    return new Promise<Row[]>((resolve, reject) => {
      if (!worker || pending || signal.aborted) { reject(new Error('scene reader unavailable')); return; }
      pending = { resolve, reject };
      timer = setTimeout(close, 9000);
      try { worker.postMessage(data, transfer); } catch { close(); }
    });
  }
  function start() {
    if (!ready) {
      if (typeof OffscreenCanvas !== 'function') throw new Error('offscreen unavailable');
      worker = new Worker('/citanie-stitku/v8/label-worker.mjs');
      worker.onerror = event => { event.preventDefault(); close(); };
      worker.onmessageerror = close;
      worker.onmessage = event => {
        clearTimeout(timer);
        if (event.data.failed) { close(); return; }
        const job = pending;
        pending = undefined;
        job?.resolve(event.data.rows || []);
      };
      ready = request({ action: 'load' }).then(() => {});
      void ready.catch(() => {});
    }
    return ready;
  }
  if (!native) { try { start(); } catch { /* Legacy browsers use the existing OCR fallback. */ } }
  async function read(source: HTMLCanvasElement, privateCodes: Set<string>, accept?: (box: PixelBox) => boolean, boxes?: Box[]): Promise<SceneResult> {
    signal.throwIfAborted();
    const ratio = Math.min(1, 1024 / Math.max(source.width, source.height));
    canvas.width = Math.max(1, Math.round(source.width * ratio));
    canvas.height = Math.max(1, Math.round(source.height * ratio));
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    let rows: Row[] = [];
    if (native) {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const words = await Promise.race([native.detect(canvas), new Promise<NativeWord[]>((resolve) => {
          deadline = setTimeout(() => resolve([]), 350);
        })]);
        rows = words.map(({ rawValue, boundingBox: b }) => ({ text: rawValue, confidence: 90,
          box: [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]] }));
      } catch { /* Fall back when a native recognizer fails on this device. */ }
      finally { clearTimeout(deadline); }
      signal.throwIfAborted();
      // A native backend that only spotted display/status text did not identify a label.
      if (!labelCandidates(rows, privateCodes).length) { rows = []; native = undefined; }
    }
    if (!rows.length) {
      await start();
      signal.throwIfAborted();
      const { data: pixels } = context.getImageData(0, 0, canvas.width, canvas.height);
      rows = await request({ width: canvas.width, height: canvas.height, pixels, boxes }, [pixels.buffer]);
    }
    // OCR engines sometimes join the family and model into one word or insert a space before 'dw'.
    // Restore boundaries only where every printed character is present.
    rows.sort((a, b) => Math.min(...a.box.map(p => p[1])) - Math.min(...b.box.map(p => p[1])));
    labelCandidates(rows, privateCodes);
    const visible = rows.filter(({ box }) => {
      const xs = box.map(point => point[0] / ratio), ys = box.map(point => point[1] / ratio);
      return !accept || accept({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    });
    return { lines: visible, boxes: rows.map(row => row.box) };
  }
  return { read, close };
}
