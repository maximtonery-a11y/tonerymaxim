import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { APIRoute, GetStaticPaths } from 'astro';

// The build publishes these fixed, lockfile-pinned files. The web server never runs inference.
export const prerender = true;
export const getStaticPaths = (() => {
  const files = {
    'det.onnx.gz': 'paddle-ocr-onnx-models/models/en_PP-OCRv3_det_infer.onnx',
    'rec.onnx.gz': 'paddle-ocr-onnx-models/models/en_PP-OCRv4_rec.onnx',
    'paddle.mjs': 'esearch-ocr/dist/esearch-ocr.js',
    'ort.mjs': 'onnxruntime-web/dist/ort.wasm.min.mjs',
    'ort-wasm-simd-threaded.mjs': 'onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm.gz': 'onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
    'LICENSE-paddle.txt': 'paddle-ocr-onnx-models/LICENSE',
    'LICENSE-esearch.txt': 'esearch-ocr/LICENSE',
  };
  return Object.entries(files).map(([asset, path]) => ({ params: { asset }, props: { path } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params, props }) => {
  const name = params.asset || '';
  const type = name.endsWith('.mjs') ? 'text/javascript' : name.endsWith('.gz') ? 'application/gzip'
    : name.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'application/octet-stream';
  const data = await readFile(resolve('node_modules', props.path));
  return new Response(new Uint8Array(name.endsWith('.gz') ? gzipSync(data, { level: 9 }) : data), {
    headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' },
  });
};
