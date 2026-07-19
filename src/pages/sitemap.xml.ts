import type { APIRoute } from 'astro';
import { getProductsCache } from '../lib/tm-products-cache';

export const prerender = false;
const staticPaths = ['/novy/', '/novy/produkty', '/novy/tlaciarne', '/novy/kontakt', '/novy/doprava-a-platba', '/novy/faq', '/novy/reklamacie', '/novy/reklamacia-online', '/novy/odstupenie-od-zmluvy', '/novy/obchodne-podmienky', '/novy/ochrana-osobnych-udajov'];
const brands = ['hp','canon','brother','epson','xerox','samsung','lexmark','kyocera','oki','ricoh','konica-minolta','utax','panasonic','toshiba','dell'];
function xml(value: string) { return value.replace(/[<>&"']/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c] || c)); }
export const GET: APIRoute = async ({ url }) => {
  const origin = url.origin;
  const cache = await getProductsCache().catch(() => null);
  const productPaths = (cache?.products || []).filter((p: any) => p.slug && p.name).map((p: any) => `/novy/produkt/${encodeURIComponent(p.slug)}`);
  const urls = [...staticPaths, ...brands.map((b) => `/novy/tlaciarne/${b}`), ...productPaths];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url><loc>${xml(new URL(path, origin).toString())}</loc><changefreq>${path.startsWith('/novy/produkt/') ? 'weekly' : 'monthly'}</changefreq><priority>${path === '/novy/' ? '1.0' : path.startsWith('/novy/produkt/') ? '0.8' : '0.7'}</priority></url>`).join('\n')}
</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } });
};
