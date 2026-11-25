import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { APIRoute } from 'astro';
import { getProductsCache, jsonResponse, type TmProduct } from '../../lib/tm-products-cache.ts';
import { buildLabelCatalog } from '../../lib/label-catalog-index.ts';

export const prerender = false;
const compress = promisify(gzip);
async function prepare(products: TmProduct[]) {
  const groups = await buildLabelCatalog(products);
  const dictionary = JSON.stringify(
    [...groups.values()].map(({ mark }) => [mark.brand, mark.name, mark.kind, mark.color, mark.refs]),
  );
  const compressed = await compress(dictionary, { level: 3 });
  return { groups, dictionary, compressed };
}
let current: { generation: string; ready: ReturnType<typeof prepare> } | undefined;
export const GET: APIRoute = async ({ url, request }) => {
  try {
    const cache = await getProductsCache();
    if (current?.generation !== cache.generated_at) {
      const ready = prepare(cache.products);
      current = { generation: cache.generated_at, ready };
      void ready.catch(() => {
        if (current?.ready === ready) current = undefined;
      });
    }
    const cached = await current.ready;
    const choice = url.searchParams.get('choice');
    if (choice !== null)
      return jsonResponse({ offers: cached.groups.get(choice)?.offers || [] }, 200, 'no-store');
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
      Vary: 'Accept-Encoding',
    });
    if (/(?:^|,)\s*gzip\s*(?:,|$)/i.test(request.headers.get('accept-encoding') || '')) {
      headers.set('Content-Encoding', 'gzip');
      return new Response(new Uint8Array(cached.compressed), { headers });
    }
    return new Response(cached.dictionary, { headers });
  } catch {
    return jsonResponse({ error: 'Katalóg sa nepodarilo načítať.' }, 503, 'no-store');
  }
};
