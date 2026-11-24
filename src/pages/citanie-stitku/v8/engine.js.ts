import { resolve } from 'node:path';
import { build } from 'esbuild';
import type { APIRoute } from 'astro';

export const prerender = true;
export const GET: APIRoute = async () => {
  // Classic workers with a single local script also run on WebKit versions
  // that cannot import ES modules from a camera worker.
  const { outputFiles } = await build({
    entryPoints: [resolve('src/workers/label-worker.mjs')],
    alias: { 'onnxruntime-web/wasm': resolve('node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs') },
    bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false, minify: true,
    legalComments: 'inline', external: ['node:*'], define: { 'import.meta.url': 'self.location.href' },
  });
  return new Response(outputFiles[0].text, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
};
