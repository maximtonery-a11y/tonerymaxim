import * as ort from './ort.mjs';
import { initDet, initRec, warpDet } from './paddle.mjs';

// A single dedicated worker owns both sessions. Cancelling a scan releases both, including the WASM heap.
const folder = new URL('./', import.meta.url);
// The bundled runtime contains its loader. WebKit workers can start without
// dynamically importing a second script, and the WASM bytes are supplied below.
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';
const options = { ort, ortOption: { executionProviders: ['wasm'], graphOptimizationLevel: 'basic' } };
// PaddleOCR ppocr/utils/en_dict.txt, blob 7677d31b9d3f08eef2823c2cf051beeab1f0470b.
const englishAlphabet = "0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~!\"#$%&'()*+,-./ ";
let models;
async function unpack(name) {
  const response = await fetch(new URL(name, folder), { cache: 'force-cache', credentials: 'omit' });
  if (!response.ok || !response.body) throw new Error('model download');
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
async function loadModels() {
  const [wasm, detection, recognition] = await Promise.all([
    unpack('ort-wasm-simd-threaded.wasm.gz'), unpack('det.onnx.gz'), unpack('rec.onnx.gz'),
  ]);
  ort.env.wasm.wasmBinary = wasm;
  return Promise.all([
    initDet({ ...options, input: detection, ratio: 0.42 }),
    initRec({ ...options, input: recognition, decodeDic: [...englishAlphabet].join('\n'), optimize: { space: false } }),
  ]);
}

// When two independently captured frames are steady, reuse the text positions on the second frame.
// Read the actual new pixels again, including the context around private fields and manufacturers.
function sameRows(image, previous) {
  const source = new OffscreenCanvas(image.width, image.height);
  const ctx = source.getContext('2d', { willReadFrequently: true });
  ctx.putImageData(image, 0, 0);
  return previous.map(box => {
    const xs = box.map(p => p[0]), ys = box.map(p => p[1]);
    const height = Math.max(...ys) - Math.min(...ys);
    const pad = Math.max(2, Math.round(height * 0.10));
    const x = Math.max(0, Math.floor(Math.min(...xs)) - pad), y = Math.max(0, Math.floor(Math.min(...ys)) - pad);
    const w = Math.max(1, Math.min(image.width, Math.ceil(Math.max(...xs)) + pad) - x);
    const h = Math.max(1, Math.min(image.height, Math.ceil(Math.max(...ys)) + pad) - y);
    return { ...warpDet(ctx.getImageData(x, y, w, h))[0], box };
  });
}

self.onmessage = async ({ data }) => {
  try {
    models ??= loadModels();
    const [detector, reader] = await models;
    if (data.action === 'load') { self.postMessage({ ready: true }); return; }
    const image = new ImageData(data.pixels, data.width, data.height);
    const detected = data.boxes ? sameRows(image, data.boxes) : await detector.det(image);
    // A dense page is handled by the usual full-scene reader, never by accepting an arbitrary first row.
    if (!detected.length || detected.length > 18) { self.postMessage({ rows: [] }); return; }
    const rows = await reader.rec(detected);
    self.postMessage({ rows: rows.map(({ text, mean, box }) => ({ text, confidence: mean * 100, box })) });
  } catch { self.postMessage({ failed: true }); }
};
