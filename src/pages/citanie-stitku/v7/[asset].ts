import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { APIRoute, GetStaticPaths } from 'astro';

// These files are emitted as static assets at build time. A phone downloads only its own core.
export const prerender = true;
export const getStaticPaths = (() => {
  const files: Record<string, string> = {
    'worker.min.js': 'tesseract.js/dist/worker.min.js',
    'worker.min.js.LICENSE.txt': 'tesseract.js/dist/worker.min.js.LICENSE.txt',
    'LICENSE-tesseract.txt': 'tesseract.js/LICENSE.md',
    'LICENSE-core.txt': 'tesseract.js-core/LICENSE',
    'eng.traineddata': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
    'eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  };
  for (const simd of ['', '-simd', '-relaxedsimd']) {
    const file = `tesseract-core${simd}-lstm.wasm.js`;
    files[file] = `tesseract.js-core/${file}`;
  }
  return Object.entries(files).map(([asset, path]) => ({ params: { asset }, props: { path } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params, props }) => {
  const name = params.asset || '';
  const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.gz') ? 'application/gzip'
    : name.endsWith('.traineddata') ? 'application/octet-stream' : 'text/plain';
  const data = await readFile(resolve('node_modules', props.path));
  // Publish the plain dictionary so HTTP owns transport compression in the fallback reader.
  return new Response(new Uint8Array(name.endsWith('.traineddata') ? gunzipSync(data) : data), {
    headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' },
  });
};
